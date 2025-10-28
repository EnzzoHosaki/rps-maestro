package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/EnzzoHosaki/rps-maestro/internal/models"
	"github.com/EnzzoHosaki/rps-maestro/internal/repository"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type WorkerHandler struct {
	jobRepo    repository.JobRepository
	jobLogRepo repository.JobLogRepository
}

func NewWorkerHandler(
	jobRepo repository.JobRepository,
	jobLogRepo repository.JobLogRepository,
) *WorkerHandler {
	return &WorkerHandler{
		jobRepo:    jobRepo,
		jobLogRepo: jobLogRepo,
	}
}

func (h *WorkerHandler) HandleJobStart(c *gin.Context) {
	jobIDParam := c.Param("id")
	jobID, err := uuid.Parse(jobIDParam)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ID do job inválido"})
		return
	}

	job, err := h.jobRepo.GetByID(c.Request.Context(), jobID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Job não encontrado"})
		return
	}

	if err := h.jobRepo.SetStarted(c.Request.Context(), jobID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Erro ao marcar job como iniciado: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "Job iniciado com sucesso",
		"job_id":  job.ID,
		"status":  "running",
	})
}

func (h *WorkerHandler) HandleJobLog(c *gin.Context) {
	jobIDParam := c.Param("id")
	jobID, err := uuid.Parse(jobIDParam)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ID do job inválido"})
		return
	}

	var logRequest struct {
		Level   string `json:"level" binding:"required"`
		Message string `json:"message" binding:"required"`
	}

	if err := c.ShouldBindJSON(&logRequest); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Dados inválidos: " + err.Error()})
		return
	}

	validLevels := map[string]bool{
		"DEBUG":    true,
		"INFO":     true,
		"WARNING":  true,
		"WARN":     true,
		"ERROR":    true,
		"CRITICAL": true,
	}

	if !validLevels[logRequest.Level] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Nível de log inválido. Use: DEBUG, INFO, WARNING, WARN, ERROR, CRITICAL"})
		return
	}

	_, err = h.jobRepo.GetByID(c.Request.Context(), jobID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Job não encontrado"})
		return
	}

	jobLog := &models.JobLog{
		JobID:   jobID,
		Level:   logRequest.Level,
		Message: logRequest.Message,
	}

	if err := h.jobLogRepo.Create(c.Request.Context(), jobLog); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Erro ao criar log: " + err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"message": "Log registrado com sucesso",
		"log_id":  jobLog.ID,
	})
}

func (h *WorkerHandler) HandleJobFinish(c *gin.Context) {
	jobIDParam := c.Param("id")
	jobID, err := uuid.Parse(jobIDParam)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ID do job inválido"})
		return
	}

	var finishRequest struct {
		Status string                 `json:"status" binding:"required"`
		Result map[string]interface{} `json:"result"`
	}

	if err := c.ShouldBindJSON(&finishRequest); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Dados inválidos: " + err.Error()})
		return
	}

	validStatuses := map[string]bool{
		"completed":             true,
		"completed_no_invoices": true,
		"failed":                true,
		"canceled":              true,
	}

	if !validStatuses[finishRequest.Status] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Status inválido. Use: completed, completed_no_invoices, failed ou canceled"})
		return
	}

	_, err = h.jobRepo.GetByID(c.Request.Context(), jobID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Job não encontrado"})
		return
	}

	if err := h.jobRepo.UpdateStatus(c.Request.Context(), jobID, finishRequest.Status); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Erro ao atualizar status: " + err.Error()})
		return
	}

	if err := h.jobRepo.SetCompleted(c.Request.Context(), jobID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Erro ao marcar job como completo: " + err.Error()})
		return
	}

	if finishRequest.Result != nil {
		resultJSON, err := json.Marshal(finishRequest.Result)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Erro ao processar resultado: " + err.Error()})
			return
		}

		if err := h.jobRepo.SetResult(c.Request.Context(), jobID, resultJSON); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Erro ao salvar resultado: " + err.Error()})
			return
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "Job finalizado com sucesso",
		"job_id":  jobID,
		"status":  finishRequest.Status,
	})
}
