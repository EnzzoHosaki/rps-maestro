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
		Level      string `json:"level" binding:"required"`
		Message    string `json:"message" binding:"required"`
		Actionable bool   `json:"actionable"`
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
		JobID:      jobID,
		Level:      logRequest.Level,
		Message:    logRequest.Message,
		Actionable: logRequest.Actionable,
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

// HandleJobStatus expõe o estado atual do job pra o worker decidir o que fazer
// antes de processar uma mensagem. Existe pra cobrir o caso de redelivery:
// quando o RabbitMQ reenfileira uma mensagem porque o basic_ack falhou (canal
// morto por consumer_timeout, restart do broker, etc.), o worker pode pegar a
// mesma mensagem cujo job já está em estado terminal no banco. Reprocessar
// significaria repetir 30-40min de automação à toa — pior, sobrescrever o
// resultado anterior. Com este endpoint o worker faz idempotency check:
//
//	if status in {completed, completed_no_invoices, failed, canceled}:
//	    basic_ack(); return
//
// Não tem side effect (ao contrário de HandleCancellationCheck que atualiza
// heartbeat) — é só leitura.
func (h *WorkerHandler) HandleJobStatus(c *gin.Context) {
	jobID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ID do job inválido"})
		return
	}

	job, err := h.jobRepo.GetByID(c.Request.Context(), jobID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Job não encontrado"})
		return
	}

	terminal := false
	switch job.Status {
	case "completed", "completed_no_invoices", "failed", "canceled":
		terminal = true
	}

	c.JSON(http.StatusOK, gin.H{
		"status":                    job.Status,
		"terminal":                  terminal,
		"started_at":                job.StartedAt,
		"completed_at":              job.CompletedAt,
		"last_heartbeat_at":         job.LastHeartbeatAt,
		"cancellation_requested_at": job.CancellationRequestedAt,
		"retry_count":               job.RetryCount,
	})
}

// HandleCancellationCheck retorna {cancellation_requested: bool} para o worker
// fazer poll periódico durante a execução de operações longas. Quando o usuário
// solicita cancelamento via POST /jobs/:id/cancel, este endpoint passa a
// retornar true e o worker deve abortar com graça e reportar
// status="canceled" no /finish.
//
// Side effect: cada chamada atualiza last_heartbeat_at do job. O retry worker
// usa esse timestamp pra distinguir worker vivo de worker morto — então a
// cadência de polling do worker (ver bot-xml-gms) precisa ser menor que o
// heartbeat timeout configurado no retry worker (default 5min).
func (h *WorkerHandler) HandleCancellationCheck(c *gin.Context) {
	jobID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ID do job inválido"})
		return
	}

	requested, err := h.jobRepo.IsCancellationRequested(c.Request.Context(), jobID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Job não encontrado"})
		return
	}

	// Heartbeat: best-effort, não bloqueia a resposta se falhar. Se o update
	// der erro a gente loga (silenciosamente aqui) mas o worker continua
	// recebendo a resposta de cancelamento.
	_ = h.jobRepo.UpdateHeartbeat(c.Request.Context(), jobID)

	c.JSON(http.StatusOK, gin.H{"cancellation_requested": requested})
}
