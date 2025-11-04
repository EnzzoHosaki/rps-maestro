package scheduler

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"github.com/EnzzoHosaki/rps-maestro/internal/models"
	"github.com/EnzzoHosaki/rps-maestro/internal/queue"
	"github.com/EnzzoHosaki/rps-maestro/internal/repository"
	"github.com/google/uuid"
	"github.com/robfig/cron/v3"
)

type Scheduler struct {
	scheduleRepo   repository.ScheduleRepository
	automationRepo repository.AutomationRepository
	jobRepo        repository.JobRepository
	queueClient    *queue.RabbitMQClient
	cron           *cron.Cron
	ticker         *time.Ticker
	stopChan       chan struct{}
}

func NewScheduler(
	scheduleRepo repository.ScheduleRepository,
	automationRepo repository.AutomationRepository,
	jobRepo repository.JobRepository,
	queueClient *queue.RabbitMQClient,
) *Scheduler {
	return &Scheduler{
		scheduleRepo:   scheduleRepo,
		automationRepo: automationRepo,
		jobRepo:        jobRepo,
		queueClient:    queueClient,
		cron:           cron.New(cron.WithSeconds()),
		ticker:         time.NewTicker(1 * time.Minute),
		stopChan:       make(chan struct{}),
	}
}

func (s *Scheduler) Start(ctx context.Context) {
	log.Println("🕒 Scheduler iniciado")

	s.loadSchedules(ctx)

	go func() {
		s.cron.Start()
		
		for {
			select {
			case <-s.ticker.C:
				s.checkAndExecuteSchedules(ctx)
			case <-s.stopChan:
				log.Println("🛑 Scheduler parado")
				s.cron.Stop()
				return
			case <-ctx.Done():
				log.Println("🛑 Scheduler cancelado pelo contexto")
				s.cron.Stop()
				return
			}
		}
	}()
}

func (s *Scheduler) Stop() {
	close(s.stopChan)
	s.ticker.Stop()
}

func (s *Scheduler) loadSchedules(ctx context.Context) {
	schedules, err := s.scheduleRepo.GetAllEnabled(ctx)
	if err != nil {
		log.Printf("❌ Erro ao carregar schedules: %v", err)
		return
	}

	log.Printf("📋 Carregando %d schedule(s) ativo(s)", len(schedules))

	for _, schedule := range schedules {
		if err := s.addScheduleToCron(ctx, schedule); err != nil {
			log.Printf("⚠️ Erro ao adicionar schedule %d ao cron: %v", schedule.ID, err)
		}
	}
}

func (s *Scheduler) addScheduleToCron(ctx context.Context, schedule models.Schedule) error {
	_, err := s.cron.AddFunc(schedule.CronExpression, func() {
		if err := s.executeSchedule(ctx, schedule); err != nil {
			log.Printf("❌ Erro ao executar schedule %d: %v", schedule.ID, err)
		}
	})

	if err != nil {
		return fmt.Errorf("expressão cron inválida: %w", err)
	}

	nextRun := s.calculateNextRun(schedule.CronExpression)
	if nextRun != nil {
		if err := s.scheduleRepo.UpdateNextRun(ctx, schedule.ID, nextRun); err != nil {
			log.Printf("⚠️ Erro ao atualizar next_run_at do schedule %d: %v", schedule.ID, err)
		}
	}

	log.Printf("✅ Schedule %d adicionado ao cron: %s", schedule.ID, schedule.CronExpression)
	return nil
}

func (s *Scheduler) checkAndExecuteSchedules(ctx context.Context) {
	schedules, err := s.scheduleRepo.GetAllEnabled(ctx)
	if err != nil {
		log.Printf("❌ Erro ao buscar schedules: %v", err)
		return
	}

	now := time.Now()

	for _, schedule := range schedules {
		if schedule.NextRunAt != nil && schedule.NextRunAt.Before(now) {
			log.Printf("⏰ Executando schedule %d agora", schedule.ID)
			
			if err := s.executeSchedule(ctx, schedule); err != nil {
				log.Printf("❌ Erro ao executar schedule %d: %v", schedule.ID, err)
				continue
			}

			nextRun := s.calculateNextRun(schedule.CronExpression)
			if nextRun != nil {
				if err := s.scheduleRepo.UpdateNextRun(ctx, schedule.ID, nextRun); err != nil {
					log.Printf("⚠️ Erro ao atualizar next_run_at: %v", err)
				}
			}
		}
	}
}

func (s *Scheduler) executeSchedule(ctx context.Context, schedule models.Schedule) error {
	automation, err := s.automationRepo.GetByID(ctx, schedule.AutomationID)
	if err != nil {
		return fmt.Errorf("automação não encontrada: %w", err)
	}

	job := &models.Job{
		ID:           uuid.New(),
		AutomationID: automation.ID,
		Status:       "pending",
		Parameters:   schedule.Parameters,
		CreatedAt:    time.Now(),
	}

	if err := s.jobRepo.Create(ctx, job); err != nil {
		return fmt.Errorf("erro ao criar job: %w", err)
	}

	message := map[string]interface{}{
		"job_id":        job.ID.String(),
		"automation_id": automation.ID,
		"script_path":   automation.ScriptPath,
		"parameters":    json.RawMessage(schedule.Parameters),
	}

	messageBytes, err := json.Marshal(message)
	if err != nil {
		return fmt.Errorf("erro ao serializar mensagem: %w", err)
	}

	if err := s.queueClient.Publish(automation.QueueName, messageBytes); err != nil {
		return fmt.Errorf("erro ao publicar na fila: %w", err)
	}

	log.Printf("✅ Job %s criado e enviado para fila %s (schedule %d)", 
		job.ID.String(), automation.QueueName, schedule.ID)

	return nil
}

func (s *Scheduler) calculateNextRun(cronExpression string) *time.Time {
	parser := cron.NewParser(cron.Second | cron.Minute | cron.Hour | cron.Dom | cron.Month | cron.Dow)
	schedule, err := parser.Parse(cronExpression)
	if err != nil {
		log.Printf("❌ Erro ao parsear expressão cron '%s': %v", cronExpression, err)
		return nil
	}

	next := schedule.Next(time.Now())
	return &next
}

func (s *Scheduler) ReloadSchedules(ctx context.Context) {
	log.Println("🔄 Recarregando schedules...")
	
	s.cron.Stop()
	
	s.cron = cron.New(cron.WithSeconds())
	
	s.loadSchedules(ctx)
	
	s.cron.Start()
	
	log.Println("✅ Schedules recarregados")
}
