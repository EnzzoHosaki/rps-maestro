package main

import (
	"context"
	"time"

	"github.com/EnzzoHosaki/rps-maestro/internal/api"
	"github.com/EnzzoHosaki/rps-maestro/internal/config"
	"github.com/EnzzoHosaki/rps-maestro/internal/logger"
	"github.com/EnzzoHosaki/rps-maestro/internal/queue"
	"github.com/EnzzoHosaki/rps-maestro/internal/repository"
	"github.com/EnzzoHosaki/rps-maestro/internal/retry"
	"github.com/EnzzoHosaki/rps-maestro/internal/scheduler"
	"github.com/rs/zerolog/log"
)

func connectWithRetry(cfg config.RabbitMQConfig, maxRetries int, delay time.Duration) (*queue.RabbitMQClient, error) {
	var lastErr error
	for i := 0; i < maxRetries; i++ {
		client, err := queue.NewRabbitMQClient(cfg)
		if err == nil {
			return client, nil
		}
		lastErr = err
		if i < maxRetries-1 {
			log.Warn().
				Int("attempt", i+1).
				Int("max", maxRetries).
				Dur("retry_in", delay).
				Msg("falha ao conectar ao RabbitMQ, tentando novamente...")
			time.Sleep(delay)
		}
	}
	return nil, lastErr
}

func main() {
	cfg, err := config.LoadConfig("./configs")
	if err != nil {
		// logger ainda não iniciado — usa panic para este fatal
		panic("não foi possível carregar a configuração: " + err.Error())
	}

	logger.Init(cfg.Log.Level)
	log.Info().Str("log_level", cfg.Log.Level).Msg("configurações carregadas")

	repo, err := repository.NewPostgresRepository(cfg.Database)
	if err != nil {
		log.Fatal().Err(err).Msg("não foi possível conectar ao PostgreSQL")
	}
	defer repo.Close()
	log.Info().Msg("conexão com PostgreSQL estabelecida")

	queueClient, err := connectWithRetry(cfg.RabbitMQ, 10, 3*time.Second)
	if err != nil {
		log.Fatal().Err(err).Msg("não foi possível conectar ao RabbitMQ após 10 tentativas")
	}
	defer queueClient.Close()

	ctx := context.Background()

	userRepo := repo.GetUserRepository()
	automationRepo := repo.GetAutomationRepository()
	jobRepo := repo.GetJobRepository()
	jobLogRepo := repo.GetJobLogRepository()
	scheduleRepo := repo.GetScheduleRepository()

	if err := queueClient.ConsumeDLQ(ctx, func(jobID, reason string) {
		log.Warn().Str("job_id", jobID).Str("reason", reason).Msg("job dead-lettered")
	}); err != nil {
		log.Error().Err(err).Msg("erro ao iniciar consumidor da DLQ")
	}

	retryWorker := retry.New(jobRepo, automationRepo, queueClient)
	go retryWorker.Start(ctx)

	sched := scheduler.New(scheduleRepo, automationRepo, jobRepo, queueClient)
	sched.Start(ctx)
	defer sched.Stop()

	server := api.NewServer(
		cfg.Server, cfg.JWT, cfg.Worker,
		userRepo, automationRepo, jobRepo, jobLogRepo, scheduleRepo,
		queueClient, sched,
	)

	server.Start()
}
