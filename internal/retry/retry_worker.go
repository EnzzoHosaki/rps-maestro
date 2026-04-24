package retry

import (
	"context"
	"encoding/json"
	"time"

	"github.com/EnzzoHosaki/rps-maestro/internal/queue"
	"github.com/EnzzoHosaki/rps-maestro/internal/repository"
	"github.com/rs/zerolog/log"
)

const maxRetries = 3

// RetryWorker detecta jobs travados (running há muito tempo) e os re-enfileira.
// Após maxRetries tentativas sem sucesso, marca o job como failed.
type RetryWorker struct {
	jobRepo        repository.JobRepository
	automationRepo repository.AutomationRepository
	queueClient    *queue.RabbitMQClient
	stuckTimeout   time.Duration
	checkInterval  time.Duration
}

func New(
	jobRepo repository.JobRepository,
	automationRepo repository.AutomationRepository,
	queueClient *queue.RabbitMQClient,
) *RetryWorker {
	return &RetryWorker{
		jobRepo:        jobRepo,
		automationRepo: automationRepo,
		queueClient:    queueClient,
		stuckTimeout:   30 * time.Minute,
		checkInterval:  5 * time.Minute,
	}
}

// Start inicia o loop de verificação. Deve ser chamado em uma goroutine.
func (w *RetryWorker) Start(ctx context.Context) {
	log.Info().
		Dur("timeout", w.stuckTimeout).
		Dur("interval", w.checkInterval).
		Msg("[retry] worker iniciado")

	ticker := time.NewTicker(w.checkInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			log.Info().Msg("[retry] worker encerrado")
			return
		case <-ticker.C:
			w.checkAndRetry(ctx)
		}
	}
}

func (w *RetryWorker) checkAndRetry(ctx context.Context) {
	jobs, err := w.jobRepo.GetStuckJobs(ctx, w.stuckTimeout)
	if err != nil {
		log.Error().Err(err).Msg("[retry] erro ao buscar stuck jobs")
		return
	}

	if len(jobs) == 0 {
		return
	}

	log.Info().Int("count", len(jobs)).Msg("[retry] stuck jobs encontrados")

	for _, job := range jobs {
		if job.RetryCount >= maxRetries {
			result, _ := json.Marshal(map[string]string{"error": "max retries exceeded"})
			if err := w.jobRepo.SetResult(ctx, job.ID, result); err != nil {
				log.Error().Err(err).Str("job_id", job.ID.String()).Msg("[retry] erro ao salvar resultado de falha")
			}
			if err := w.jobRepo.UpdateStatus(ctx, job.ID, "failed"); err != nil {
				log.Error().Err(err).Str("job_id", job.ID.String()).Msg("[retry] erro ao marcar job como failed")
			}
			log.Warn().Str("job_id", job.ID.String()).Int("retries", job.RetryCount).Msg("[retry] job marcado como failed após max tentativas")
			continue
		}

		automation, err := w.automationRepo.GetByID(ctx, job.AutomationID)
		if err != nil {
			log.Error().Err(err).Str("job_id", job.ID.String()).Msg("[retry] automação não encontrada")
			continue
		}

		if err := w.jobRepo.IncrementRetryCount(ctx, job.ID); err != nil {
			log.Error().Err(err).Str("job_id", job.ID.String()).Msg("[retry] erro ao incrementar retry_count")
			continue
		}

		if err := w.jobRepo.UpdateStatus(ctx, job.ID, "pending"); err != nil {
			log.Error().Err(err).Str("job_id", job.ID.String()).Msg("[retry] erro ao resetar status")
			continue
		}

		var params map[string]interface{}
		if len(job.Parameters) > 0 {
			json.Unmarshal(job.Parameters, &params)
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

		if err := w.queueClient.PublishJob(ctx, queueName, msg); err != nil {
			log.Error().Err(err).Str("job_id", job.ID.String()).Msg("[retry] erro ao re-enfileirar job")
			continue
		}

		log.Info().
			Str("job_id", job.ID.String()).
			Int("attempt", job.RetryCount+1).
			Msg("[retry] job re-enfileirado")
	}
}
