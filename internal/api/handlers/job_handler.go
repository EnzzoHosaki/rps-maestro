package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/EnzzoHosaki/rps-maestro/internal/models"
	"github.com/EnzzoHosaki/rps-maestro/internal/queue"
	"github.com/EnzzoHosaki/rps-maestro/internal/repository"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type JobHandler struct {
	jobRepo        repository.JobRepository
	jobLogRepo     repository.JobLogRepository
	automationRepo repository.AutomationRepository
	queueClient    *queue.RabbitMQClient
}

func NewJobHandler(
	jobRepo repository.JobRepository,
	jobLogRepo repository.JobLogRepository,
	automationRepo repository.AutomationRepository,
	queueClient *queue.RabbitMQClient,
) *JobHandler {
	return &JobHandler{
		jobRepo:        jobRepo,
		jobLogRepo:     jobLogRepo,
		automationRepo: automationRepo,
		queueClient:    queueClient,
	}
}

func (h *JobHandler) GetJobByID(c *gin.Context) {
	jobID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ID inválido"})
		return
	}

	job, err := h.jobRepo.GetByID(c.Request.Context(), jobID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Job não encontrado"})
		return
	}

	c.JSON(http.StatusOK, job)
}

func (h *JobHandler) GetJobLogs(c *gin.Context) {
	jobID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ID inválido"})
		return
	}

	logs, err := h.jobLogRepo.GetByJobID(c.Request.Context(), jobID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Erro ao buscar logs: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, logs)
}

// ListJobs retorna jobs paginados com filtros opcionais por query string.
//
// Query params suportados:
//   - status:        pending | running | completed | completed_no_invoices | failed | canceled
//   - automation_id: int
//   - user_id:       int
//   - since:         RFC3339 (jobs criados a partir desta data)
//   - until:         RFC3339 (jobs criados até esta data)
//   - limit:         1..200, default 50
//   - offset:        default 0
//
// Resposta: { "items": [Job], "total": int, "limit": int, "offset": int }
func (h *JobHandler) ListJobs(c *gin.Context) {
	filter := models.JobListFilter{}

	if status := c.Query("status"); status != "" {
		filter.Status = &status
	}
	if v := c.Query("automation_id"); v != "" {
		id, err := strconv.Atoi(v)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "automation_id inválido"})
			return
		}
		filter.AutomationID = &id
	}
	if v := c.Query("user_id"); v != "" {
		id, err := strconv.Atoi(v)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "user_id inválido"})
			return
		}
		filter.UserID = &id
	}
	if v := c.Query("since"); v != "" {
		t, err := time.Parse(time.RFC3339, v)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "since inválido (use RFC3339)"})
			return
		}
		filter.Since = &t
	}
	if v := c.Query("until"); v != "" {
		t, err := time.Parse(time.RFC3339, v)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "until inválido (use RFC3339)"})
			return
		}
		filter.Until = &t
	}
	if v := c.Query("limit"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "limit inválido"})
			return
		}
		filter.Limit = n
	}
	if v := c.Query("offset"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "offset inválido"})
			return
		}
		filter.Offset = n
	}

	jobs, total, err := h.jobRepo.List(c.Request.Context(), filter)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Erro ao listar jobs: " + err.Error()})
		return
	}

	limit := filter.Limit
	if limit <= 0 {
		limit = 50
	}

	c.JSON(http.StatusOK, gin.H{
		"items":  jobs,
		"total":  total,
		"limit":  limit,
		"offset": filter.Offset,
	})
}

// CancelJob solicita cancelamento (soft) de um job em pending ou running.
//
// Para jobs em pending o status é movido imediatamente para 'canceled' (não
// chegará a sair pra o worker). Para jobs em running apenas marcamos
// cancellation_requested_at — o worker decide quando parar (ver
// GET /worker/jobs/:id/cancellation no WorkerHandler).
func (h *JobHandler) CancelJob(c *gin.Context) {
	jobID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ID inválido"})
		return
	}

	if err := h.jobRepo.RequestCancellation(c.Request.Context(), jobID); err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		return
	}

	job, err := h.jobRepo.GetByID(c.Request.Context(), jobID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Erro ao buscar job: " + err.Error()})
		return
	}
	c.JSON(http.StatusAccepted, job)
}

// RetryJob cria um NOVO job clonando os parâmetros do job original e o
// publica na fila. O job original mantém seu status histórico ('failed',
// 'canceled', etc.) — nada nele é alterado.
func (h *JobHandler) RetryJob(c *gin.Context) {
	jobID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ID inválido"})
		return
	}

	original, err := h.jobRepo.GetByID(c.Request.Context(), jobID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Job original não encontrado"})
		return
	}

	automation, err := h.automationRepo.GetByID(c.Request.Context(), original.AutomationID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Automação não encontrada"})
		return
	}

	var userID *int
	if uid, ok := c.Get("user_id"); ok {
		if id, ok := uid.(int); ok {
			userID = &id
		}
	}

	newJob := &models.Job{
		AutomationID: original.AutomationID,
		UserID:       userID,
		Status:       "pending",
		Parameters:   original.Parameters,
	}
	if err := h.jobRepo.Create(c.Request.Context(), newJob); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Erro ao criar job: " + err.Error()})
		return
	}

	// JobMessage espera map[string]interface{}; o worker recebe via JSON, então
	// a serialização precisa preservar a forma original dos parâmetros.
	var paramsMap map[string]interface{}
	if len(original.Parameters) > 0 {
		_ = json.Unmarshal(original.Parameters, &paramsMap)
	}
	if paramsMap == nil {
		paramsMap = map[string]interface{}{}
	}

	queueMsg := queue.JobMessage{
		JobID:        newJob.ID.String(),
		AutomationID: original.AutomationID,
		ScriptPath:   automation.ScriptPath,
		Parameters:   paramsMap,
	}

	queueName := automation.QueueName
	if queueName == "" {
		queueName = "automation_jobs"
	}

	if err := h.queueClient.PublishJob(c.Request.Context(), queueName, queueMsg); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Erro ao enfileirar job: " + err.Error()})
		return
	}

	c.JSON(http.StatusAccepted, newJob)
}
