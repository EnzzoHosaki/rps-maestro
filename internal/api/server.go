package api

import (
	"fmt"
	"time"

	"github.com/EnzzoHosaki/rps-maestro/internal/api/handlers"
	"github.com/EnzzoHosaki/rps-maestro/internal/api/middleware"
	"github.com/EnzzoHosaki/rps-maestro/internal/config"
	"github.com/EnzzoHosaki/rps-maestro/internal/queue"
	"github.com/EnzzoHosaki/rps-maestro/internal/repository"
	"github.com/EnzzoHosaki/rps-maestro/internal/scheduler"
	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/rs/zerolog/log"
)

type Server struct {
	config         config.ServerConfig
	jwtCfg         config.JWTConfig
	workerAPIKey   string
	userRepo       repository.UserRepository
	automationRepo repository.AutomationRepository
	jobRepo        repository.JobRepository
	jobLogRepo     repository.JobLogRepository
	scheduleRepo   repository.ScheduleRepository
	queueClient    *queue.RabbitMQClient
	scheduler      *scheduler.Scheduler
	router         *gin.Engine
}

func NewServer(
	cfg config.ServerConfig,
	jwtCfg config.JWTConfig,
	workerCfg config.WorkerConfig,
	userRepo repository.UserRepository,
	automationRepo repository.AutomationRepository,
	jobRepo repository.JobRepository,
	jobLogRepo repository.JobLogRepository,
	scheduleRepo repository.ScheduleRepository,
	queueClient *queue.RabbitMQClient,
	sched *scheduler.Scheduler,
) *Server {
	gin.SetMode(gin.ReleaseMode)
	router := gin.New()
	router.Use(gin.Recovery())

	router.Use(func(c *gin.Context) {
		start := time.Now()
		c.Next()
		log.Info().
			Str("method", c.Request.Method).
			Str("path", c.Request.URL.Path).
			Int("status", c.Writer.Status()).
			Dur("latency", time.Since(start)).
			Msg("request")
	})

	corsConfig := cors.Config{
		AllowMethods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Authorization", "X-Worker-API-Key"},
		ExposeHeaders:    []string{"Content-Length"},
		AllowCredentials: false,
		MaxAge:           12 * time.Hour,
	}
	if len(cfg.AllowedOrigins) > 0 {
		corsConfig.AllowOrigins = cfg.AllowedOrigins
		log.Info().Strs("origins", cfg.AllowedOrigins).Msg("[cors] origens permitidas")
	} else {
		corsConfig.AllowAllOrigins = true
		log.Info().Msg("[cors] AllowAllOrigins=true (defina MAESTRO_CORS_ALLOWED_ORIGINS para restringir)")
	}
	router.Use(cors.New(corsConfig))

	server := &Server{
		config:         cfg,
		jwtCfg:         jwtCfg,
		workerAPIKey:   workerCfg.APIKey,
		userRepo:       userRepo,
		automationRepo: automationRepo,
		jobRepo:        jobRepo,
		jobLogRepo:     jobLogRepo,
		scheduleRepo:   scheduleRepo,
		queueClient:    queueClient,
		scheduler:      sched,
		router:         router,
	}

	server.setupRoutes()
	return server
}

func (s *Server) setupRoutes() {
	v1 := s.router.Group("/api/v1")

	v1.GET("/health", s.healthCheck)

	authHandler := handlers.NewAuthHandler(s.userRepo, s.jwtCfg.Secret, s.jwtCfg.ExpiresIn)
	auth := v1.Group("/auth")
	{
		auth.POST("/login", authHandler.Login)
		auth.POST("/refresh", middleware.JWTAuth(s.jwtCfg.Secret), authHandler.Refresh)
	}

	workerHandler := handlers.NewWorkerHandler(s.jobRepo, s.jobLogRepo)
	worker := v1.Group("/worker", middleware.WorkerAPIKey(s.workerAPIKey))
	{
		worker.POST("/jobs/:id/start", workerHandler.HandleJobStart)
		worker.POST("/jobs/:id/log", workerHandler.HandleJobLog)
		worker.POST("/jobs/:id/finish", workerHandler.HandleJobFinish)
	}

	protected := v1.Group("", middleware.JWTAuth(s.jwtCfg.Secret))

	userHandler := handlers.NewUserHandler(s.userRepo)
	users := protected.Group("/users")
	{
		users.POST("", userHandler.CreateUser)
		users.GET("", userHandler.GetAllUsers)
		users.GET("/email", userHandler.GetUserByEmail)
		users.GET("/:id", userHandler.GetUserByID)
		users.PUT("/:id", userHandler.UpdateUser)
		users.DELETE("/:id", userHandler.DeleteUser)
	}

	automationHandler := handlers.NewAutomationHandler(s.automationRepo, s.jobRepo, s.queueClient)
	automations := protected.Group("/automations")
	{
		automations.POST("", automationHandler.CreateAutomation)
		automations.GET("", automationHandler.GetAllAutomations)
		automations.GET("/:id", automationHandler.GetAutomationByID)
		automations.PUT("/:id", automationHandler.UpdateAutomation)
		automations.DELETE("/:id", automationHandler.DeleteAutomation)
		automations.POST("/:id/execute", automationHandler.ExecuteAutomation)
	}

	jobHandler := handlers.NewJobHandler(s.jobRepo, s.jobLogRepo)
	jobs := protected.Group("/jobs")
	{
		jobs.GET("/:id", jobHandler.GetJobByID)
		jobs.GET("/:id/logs", jobHandler.GetJobLogs)
	}

	scheduleHandler := handlers.NewScheduleHandler(s.scheduleRepo, s.scheduler)
	schedules := protected.Group("/schedules")
	{
		schedules.POST("", scheduleHandler.CreateSchedule)
		schedules.GET("", scheduleHandler.GetAllEnabledSchedules)
		schedules.GET("/:id", scheduleHandler.GetScheduleByID)
		schedules.PUT("/:id", scheduleHandler.UpdateSchedule)
		schedules.DELETE("/:id", scheduleHandler.DeleteSchedule)
	}
}

func (s *Server) Start() {
	addr := fmt.Sprintf(":%d", s.config.Port)
	log.Info().Str("addr", addr).Msg("servidor HTTP iniciado")

	if err := s.router.Run(addr); err != nil {
		log.Fatal().Err(err).Msg("servidor encerrado com erro")
	}
}

func (s *Server) healthCheck(c *gin.Context) {
	c.JSON(200, gin.H{"status": "ok"})
}
