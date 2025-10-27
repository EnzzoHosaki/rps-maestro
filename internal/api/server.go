// Local: rps-maestro/internal/api/server.go
package api

import (
	"fmt"
	"log"

	"github.com/EnzzoHosaki/rps-maestro/internal/config"
	"github.com/EnzzoHosaki/rps-maestro/internal/repository"
	"github.com/gin-gonic/gin"
)

type Server struct {
	config              config.ServerConfig
	userRepo            repository.UserRepository
	automationRepo      repository.AutomationRepository
	jobRepo             repository.JobRepository
	jobLogRepo          repository.JobLogRepository
	scheduleRepo        repository.ScheduleRepository
	router              *gin.Engine
}

func NewServer(
	cfg config.ServerConfig,
	userRepo repository.UserRepository,
	automationRepo repository.AutomationRepository,
	jobRepo repository.JobRepository,
	jobLogRepo repository.JobLogRepository,
	scheduleRepo repository.ScheduleRepository,
) *Server {
	router := gin.Default()
	
	server := &Server{
		config:         cfg,
		userRepo:       userRepo,
		automationRepo: automationRepo,
		jobRepo:        jobRepo,
		jobLogRepo:     jobLogRepo,
		scheduleRepo:   scheduleRepo,
		router:         router,
	}

	server.setupRoutes()

	return server
}

func (s *Server) setupRoutes() {
	v1 := s.router.Group("/api/v1")
	{
		v1.GET("/health", s.healthCheck)

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