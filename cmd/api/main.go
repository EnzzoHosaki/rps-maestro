package main

import (
	"context"
	"errors"
	"net/http"
	"os/signal"
	"syscall"
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

	if err := cfg.Validate(); err != nil {
		log.Fatal().Err(err).Msg("configuração inválida")
	}
	if cfg.Worker.APIKey == "" {
		log.Warn().Msg("MAESTRO_WORKER_API_KEY vazio — endpoints /worker estão SEM autenticação (ok só em dev)")
	}
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

	// ctx cancelado por SIGINT/SIGTERM — propaga pro DLQ consumer, retry worker
	// e scheduler pararem junto no shutdown.
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

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

	server := api.NewServer(
		cfg.Server, cfg.JWT, cfg.Worker,
		userRepo, automationRepo, jobRepo, jobLogRepo, scheduleRepo,
		queueClient, sched,
	)

	// Sobe o HTTP numa goroutine; o main bloqueia no sinal de shutdown.
	go func() {
		if err := server.Start(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatal().Err(err).Msg("servidor HTTP encerrado com erro")
		}
	}()

	<-ctx.Done()
	stop() // restaura o handler padrão: um 2º sinal mata na hora
	log.Info().Msg("sinal de shutdown recebido, encerrando graciosamente…")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		log.Error().Err(err).Msg("erro no shutdown do servidor HTTP")
	}
	sched.Stop()
	log.Info().Msg("shutdown concluído")
}
