// Local: rps-maestro/cmd/api/main.go
package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"
	"github.com/EnzzoHosaki/rps-maestro/internal/api"
	"github.com/EnzzoHosaki/rps-maestro/internal/config"
	"github.com/EnzzoHosaki/rps-maestro/internal/queue"
	"github.com/EnzzoHosaki/rps-maestro/internal/repository"
	"github.com/EnzzoHosaki/rps-maestro/internal/scheduler"
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
			log.Printf("Tentativa %d/%d de conectar ao RabbitMQ falhou, tentando novamente em %v...", i+1, maxRetries, delay)
			time.Sleep(delay)
		}
	}
	return nil, lastErr
}

func main() {
	cfg, err := config.LoadConfig("./configs")
	if err != nil {
		log.Fatalf("não foi possível carregar a configuração: %v", err)
	}
	fmt.Println("Configurações carregadas com sucesso.")

	repo, err := repository.NewPostgresRepository(cfg.Database)
	if err != nil {
		log.Fatalf("não foi possível conectar ao banco de dados: %v", err)
	}
	defer repo.Close()
	fmt.Println("Conexão com o PostgreSQL estabelecida com sucesso!")

	queueClient, err := connectWithRetry(cfg.RabbitMQ, 10, 3*time.Second)
	if err != nil {
		log.Fatalf("não foi possível conectar ao RabbitMQ após 10 tentativas: %v", err)
	}
	defer queueClient.Close()
	fmt.Println("Conexão com o RabbitMQ estabelecida com sucesso!")
	
	userRepo := repo.GetUserRepository()
	automationRepo := repo.GetAutomationRepository()
	jobRepo := repo.GetJobRepository()
	jobLogRepo := repo.GetJobLogRepository()
	scheduleRepo := repo.GetScheduleRepository()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	sched := scheduler.NewScheduler(scheduleRepo, automationRepo, jobRepo, queueClient)
	sched.Start(ctx)
	fmt.Println("⏰ Scheduler iniciado com sucesso!")

	server := api.NewServer(cfg.Server, userRepo, automationRepo, jobRepo, jobLogRepo, scheduleRepo, queueClient)

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)

	go func() {
		server.Start()
	}()

	<-sigChan
	fmt.Println("\n🛑 Sinal de interrupção recebido, encerrando...")

	sched.Stop()
	fmt.Println("✅ Scheduler parado")

	queueClient.Close()
	repo.Close()
	fmt.Println("✅ Aplicação encerrada com sucesso")
}