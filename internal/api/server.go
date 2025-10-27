// Local: rps-maestro/internal/api/server.go
package api

import (
	"fmt"
	"log"

	"github.com/EnzzoHosaki/rps-maestro/internal/api/handlers"
	"github.com/EnzzoHosaki/rps-maestro/internal/config"
	"github.com/EnzzoHosaki/rps-maestro/internal/queue"
	"github.com/EnzzoHosaki/rps-maestro/internal/repository"
	"github.com/gin-gonic/gin"
)

type Server struct {
	config         config.ServerConfig
	userRepo       repository.UserRepository
	automationRepo repository.AutomationRepository
	jobRepo        repository.JobRepository
	jobLogRepo     repository.JobLogRepository
	scheduleRepo   repository.ScheduleRepository
	queueClient    *queue.RabbitMQClient
	router         *gin.Engine
}

func NewServer(
	cfg config.ServerConfig,
	userRepo repository.UserRepository,
	automationRepo repository.AutomationRepository,
	jobRepo repository.JobRepository,
	jobLogRepo repository.JobLogRepository,
	scheduleRepo repository.ScheduleRepository,
	queueClient *queue.RabbitMQClient,
) *Server {
	router := gin.Default()
	
	server := &Server{
		config:         cfg,
		userRepo:       userRepo,
		automationRepo: automationRepo,
		jobRepo:        jobRepo,
		jobLogRepo:     jobLogRepo,
		scheduleRepo:   scheduleRepo,
		queueClient:    queueClient,
		router:         router,
	}

	server.setupRoutes()

	return server
}

func (s *Server) setupRoutes() {
	v1 := s.router.Group("/api/v1")
	{
		v1.GET("/health", s.healthCheck)

		// Rotas das automações
		automationHandler := handlers.NewAutomationHandler(s.automationRepo, s.jobRepo, s.queueClient)
		automations := v1.Group("/automations")
		{
			automations.POST("", automationHandler.CreateAutomation)
			automations.GET("", automationHandler.GetAllAutomations)
			automations.GET("/:id", automationHandler.GetAutomationByID)
			automations.PUT("/:id", automationHandler.UpdateAutomation)
			automations.DELETE("/:id", automationHandler.DeleteAutomation)
			automations.POST("/:id/execute", automationHandler.ExecuteAutomation)
		}

		// Rotas dos jobs
		jobHandler := handlers.NewJobHandler(s.jobRepo, s.jobLogRepo)
		jobs := v1.Group("/jobs")
		{
			jobs.GET("/:id", jobHandler.GetJobByID)
			jobs.GET("/:id/logs", jobHandler.GetJobLogs)
		}

		// Rotas dos schedules
		scheduleHandler := handlers.NewScheduleHandler(s.scheduleRepo)
		schedules := v1.Group("/schedules")
		{
			schedules.POST("", scheduleHandler.CreateSchedule)
			schedules.GET("", scheduleHandler.GetAllEnabledSchedules)
			schedules.GET("/:id", scheduleHandler.GetScheduleByID)
			schedules.PUT("/:id", scheduleHandler.UpdateSchedule)
			schedules.DELETE("/:id", scheduleHandler.DeleteSchedule)
		}
	}
}

func (s *Server) Start() {
	addr := fmt.Sprintf(":%d", s.config.Port)
	log.Printf("Iniciando servidor HTTP na porta %s", addr)
	
	if err := s.router.Run(addr); err != nil {
		log.Fatalf("Não foi possível iniciar o servidor: %v", err)
	}
}

func (s *Server) healthCheck(ctx *gin.Context) {
	ctx.JSON(200, gin.H{
		"status": "ok",
	})
}