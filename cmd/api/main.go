// Local: rps-maestro/cmd/api/main.go
package main

import (
	"fmt"
	"log"
	"github.com/EnzzoHosaki/rps-maestro/internal/api"
	"github.com/EnzzoHosaki/rps-maestro/internal/config"
	"github.com/EnzzoHosaki/rps-maestro/internal/queue"
	"github.com/EnzzoHosaki/rps-maestro/internal/repository"
)

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

	queueClient, err := queue.NewRabbitMQClient(cfg.RabbitMQ)
	if err != nil {
		log.Fatalf("não foi possível conectar ao RabbitMQ: %v", err)
	}
	defer queueClient.Close()
	fmt.Println("Conexão com o RabbitMQ estabelecida com sucesso!")
	
	userRepo := repo.GetUserRepository()
	automationRepo := repo.GetAutomationRepository()
	jobRepo := repo.GetJobRepository()
	jobLogRepo := repo.GetJobLogRepository()
	scheduleRepo := repo.GetScheduleRepository()

	server := api.NewServer(cfg.Server, userRepo, automationRepo, jobRepo, jobLogRepo, scheduleRepo)

	server.Start()

}