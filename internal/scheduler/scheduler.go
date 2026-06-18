package scheduler

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"sync"
	"time"

	"github.com/EnzzoHosaki/rps-maestro/internal/models"
	"github.com/EnzzoHosaki/rps-maestro/internal/queue"
	"github.com/EnzzoHosaki/rps-maestro/internal/repository"
	"github.com/robfig/cron/v3"
)

// defaultSchedulerTZ é o fuso usado pra interpretar as expressões cron quando
// nenhum SCHEDULER_TZ/TZ é definido. Os agendamentos foram criados pensando no
// horário de Brasília, então é o default certo — e fixá-lo aqui blinda o
// scheduler do TZ do container (alpine sem tzdata cai em UTC e dispara 3h
// adiantado).
const defaultSchedulerTZ = "America/Sao_Paulo"

type Scheduler struct {
	cron           *cron.Cron
	scheduleRepo   repository.ScheduleRepository
	automationRepo repository.AutomationRepository
	jobRepo        repository.JobRepository
	queueClient    *queue.RabbitMQClient
	entries        map[int]cron.EntryID
	mu             sync.Mutex
	loc            *time.Location
	locName        string // nome IANA pra injetar via CRON_TZ; "" se caiu no fallback
}

// resolveLocation escolhe o fuso do scheduler: SCHEDULER_TZ > TZ > default
// (America/Sao_Paulo). Cai em time.Local com aviso se o nome não carregar (o
// binário embute time/tzdata, então em condições normais sempre carrega).
func resolveLocation() (*time.Location, string) {
	name := os.Getenv("SCHEDULER_TZ")
	if name == "" {
		name = os.Getenv("TZ")
	}
	if name == "" {
		name = defaultSchedulerTZ
	}
	loc, err := time.LoadLocation(name)
	if err != nil {
		log.Printf("[scheduler] timezone %q inválida (%v) — usando time.Local (%s)", name, err, time.Local)
		return time.Local, ""
	}
	log.Printf("[scheduler] fuso horário: %s", name)
	return loc, name
}

func New(
	scheduleRepo repository.ScheduleRepository,
	automationRepo repository.AutomationRepository,
	jobRepo repository.JobRepository,
	queueClient *queue.RabbitMQClient,
) *Scheduler {
	loc, locName := resolveLocation()
	return &Scheduler{
		cron:           cron.New(cron.WithLocation(loc)),
		scheduleRepo:   scheduleRepo,
		automationRepo: automationRepo,
		jobRepo:        jobRepo,
		queueClient:    queueClient,
		entries:        make(map[int]cron.EntryID),
		loc:            loc,
		locName:        locName,
	}
}

// Start carrega os agendamentos do banco e inicia o cron runner.
func (s *Scheduler) Start(ctx context.Context) {
	if err := s.Reload(ctx); err != nil {
		log.Printf("[scheduler] erro ao carregar agendamentos iniciais: %v", err)
	}
	s.cron.Start()
	log.Printf("[scheduler] iniciado com %d agendamento(s) ativo(s)", len(s.entries))
}

// Stop encerra o cron runner gracefully.
func (s *Scheduler) Stop() {
	s.cron.Stop()
}

// Reload sincroniza os agendamentos do banco com o cron runner.
// Deve ser chamado após criar, atualizar ou deletar um agendamento via API.
func (s *Scheduler) Reload(ctx context.Context) error {
	schedules, err := s.scheduleRepo.GetAllEnabled(ctx)
	if err != nil {
		return fmt.Errorf("erro ao buscar agendamentos: %w", err)
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	// Remove TODAS as entradas registradas e re-registra do zero. Isso garante
	// que edições na expressão cron de um agendamento existente passem a valer
	// imediatamente (sem reiniciar o backend) e que o next_run_at seja sempre
	// recalculado — incluindo agendamentos desabilitados/deletados, que
	// simplesmente não voltam a ser registrados por não estarem em GetAllEnabled.
	for id, entryID := range s.entries {
		s.cron.Remove(entryID)
		delete(s.entries, id)
	}

	// Registra todos os agendamentos habilitados
	for _, sc := range schedules {
		scheduleID := sc.ID
		// ParseScheduleTZ (não AddFunc/ParseStandard) pra (a) aceitar o `L`
		// (último dia do mês) via Schedule customizada e (b) fixar o fuso na
		// expressão, senão o disparo herda o TZ do container (UTC).
		sched, err := ParseScheduleTZ(sc.CronExpression, s.locName)
		if err != nil {
			log.Printf("[scheduler] expressão cron inválida no agendamento %d (%q): %v", sc.ID, sc.CronExpression, err)
			continue
		}
		entryID := s.cron.Schedule(sched, cron.FuncJob(func() {
			s.runSchedule(scheduleID)
		}))
		s.entries[sc.ID] = entryID

		next := s.cron.Entry(entryID).Next
		if err := s.scheduleRepo.UpdateNextRun(ctx, sc.ID, &next); err != nil {
			log.Printf("[scheduler] erro ao atualizar next_run_at do agendamento %d: %v", sc.ID, err)
		}
		log.Printf("[scheduler] agendamento %d registrado (próxima execução: %s)", sc.ID, next.Format("2006-01-02 15:04:05"))
	}

	return nil
}

func (s *Scheduler) runSchedule(scheduleID int) {
	ctx := context.Background()

	sc, err := s.scheduleRepo.GetByID(ctx, scheduleID)
	if err != nil {
		log.Printf("[scheduler] erro ao buscar agendamento %d: %v", scheduleID, err)
		return
	}
	if !sc.IsEnabled {
		return
	}

	automation, err := s.automationRepo.GetByID(ctx, sc.AutomationID)
	if err != nil {
		log.Printf("[scheduler] automação %d não encontrada para agendamento %d: %v", sc.AutomationID, scheduleID, err)
		return
	}

	params, err := parseParams(sc.Parameters)
	if err != nil {
		log.Printf("[scheduler] parâmetros inválidos no agendamento %d: %v", scheduleID, err)
		return
	}

	// Expande placeholders de data ({{today}}, {{yesterday}}, {{prev_run+N}}…)
	// antes de serializar — assim cada disparo do cron tem datas frescas
	// relativas ao momento da execução, em vez da data salva no schedule.
	// prevRun (execução agendada anterior) é calculado do próprio cron pra
	// dar suporte a {{prev_run±N}}; zero se não der pra calcular.
	now := time.Now().In(s.loc)
	var prevRun time.Time
	if sched, perr := ParseScheduleTZ(sc.CronExpression, s.locName); perr == nil {
		// Trunca ao minuto: `now` é alguns ms DEPOIS do horário agendado, então
		// sem isso o PrevFire devolveria o próprio disparo atual como "anterior".
		// Truncado, ele devolve o disparo imediatamente anterior a este.
		prevRun = PrevFire(sched, now.Truncate(time.Minute))
	}
	params = ExpandDatePlaceholders(params, now, prevRun)

	paramsJSON, err := json.Marshal(params)
	if err != nil {
		log.Printf("[scheduler] erro ao serializar parâmetros do agendamento %d: %v", scheduleID, err)
		return
	}

	job := &models.Job{
		AutomationID: automation.ID,
		Status:       "pending",
		Parameters:   paramsJSON,
	}

	if err := s.jobRepo.Create(ctx, job); err != nil {
		log.Printf("[scheduler] erro ao criar job para agendamento %d: %v", scheduleID, err)
		return
	}

	queueName := automation.QueueName
	if queueName == "" {
		queueName = "automation_jobs"
	}

	msg := queue.JobMessage{
		JobID:        job.ID.String(),
		AutomationID: automation.ID,
		ScriptPath:   automation.ScriptPath,
		Parameters:   params,
	}

	if err := s.queueClient.PublishJob(ctx, queueName, msg); err != nil {
		log.Printf("[scheduler] erro ao enfileirar job para agendamento %d: %v", scheduleID, err)
		return
	}

	// Atualiza next_run_at após disparar
	s.mu.Lock()
	if entryID, ok := s.entries[scheduleID]; ok {
		next := s.cron.Entry(entryID).Next
		if err := s.scheduleRepo.UpdateNextRun(ctx, scheduleID, &next); err != nil {
			log.Printf("[scheduler] erro ao atualizar next_run_at do agendamento %d: %v", scheduleID, err)
		}
	}
	s.mu.Unlock()

	log.Printf("[scheduler] job %s criado — automação %q (agendamento %d)", job.ID, automation.Name, scheduleID)
}

func parseParams(raw json.RawMessage) (map[string]interface{}, error) {
	if len(raw) == 0 {
		return make(map[string]interface{}), nil
	}
	var params map[string]interface{}
	if err := json.Unmarshal(raw, &params); err != nil {
		return nil, err
	}
	return params, nil
}
