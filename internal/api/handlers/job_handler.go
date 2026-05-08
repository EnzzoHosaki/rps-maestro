package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/EnzzoHosaki/rps-maestro/internal/models"
	"github.com/EnzzoHosaki/rps-maestro/internal/queue"
	"github.com/EnzzoHosaki/rps-maestro/internal/repository"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// terminalJobStatuses define os estados em que o stream SSE deve encerrar
// após drenar os logs restantes.
var terminalJobStatuses = map[string]bool{
	"completed":             true,
	"completed_no_invoices": true,
	"failed":                true,
	"canceled":              true,
}

const (
	// sseLogPollInterval é o intervalo entre consultas no banco de logs novos.
	sseLogPollInterval = 1 * time.Second
	// sseHeartbeatInterval mantém a conexão viva através de proxies/LBs que
	// derrubam conexões idle.
	sseHeartbeatInterval = 15 * time.Second
	// sseMaxStreamDuration é o teto absoluto pra um único cliente SSE evitar
	// que conexões zumbis fiquem segurando recursos do servidor.
	sseMaxStreamDuration = 60 * time.Minute
	// sseLogBatchSize limita quantos logs vão num único ciclo de polling pra
	// um cliente — evita bloquear o evento loop com dumps gigantes.
	sseLogBatchSize = 200
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

// StreamJobLogs serve logs em tempo real via Server-Sent Events.
//
// Protocolo:
//
//	event: log
//	data: {"id":42,"jobId":"...","timestamp":"...","level":"INFO","message":"..."}
//
//	event: status
//	data: {"status":"running"}
//
//	event: end
//	data: {"status":"completed"}
//
//	: ping  (heartbeat — comentário SSE, ignorado pelo cliente)
//
// Comportamento:
//
//   - Faz dump inicial de todo o histórico de logs do job.
//   - Em seguida, faz polling no banco a cada sseLogPollInterval procurando
//     logs com id > último visto e os emite.
//   - Verifica o status do job na mesma cadência. Quando o status entra em
//     estado terminal (completed/failed/canceled/...), drena uma última vez
//     e envia "event: end".
//   - Heartbeat (linha de comentário SSE) a cada sseHeartbeatInterval pra
//     evitar que proxies derrubem a conexão por idle.
//   - Respeita disconnect do cliente via c.Request.Context().Done().
//   - Hard cap em sseMaxStreamDuration por segurança.
//
// Autenticação: aceita JWT via header Authorization OU query string ?token=
// (necessário pra EventSource do navegador, ver middleware.JWTAuth).
func (h *JobHandler) StreamJobLogs(c *gin.Context) {
	jobID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ID inválido"})
		return
	}

	// Confirma que o job existe antes de comprometer a resposta com headers SSE.
	job, err := h.jobRepo.GetByID(c.Request.Context(), jobID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Job não encontrado"})
		return
	}

	c.Writer.Header().Set("Content-Type", "text/event-stream")
	c.Writer.Header().Set("Cache-Control", "no-cache")
	c.Writer.Header().Set("Connection", "keep-alive")
	// Desliga buffering de proxies (nginx).
	c.Writer.Header().Set("X-Accel-Buffering", "no")

	clientCtx := c.Request.Context()
	deadline := time.Now().Add(sseMaxStreamDuration)
	heartbeatAt := time.Now().Add(sseHeartbeatInterval)
	lastLogID := int64(0)
	currentStatus := job.Status
	terminalDrained := false

	// Status inicial.
	if !writeSSE(c.Writer, "status", map[string]string{"status": currentStatus}) {
		return
	}

	// Stream principal. c.Stream retorna quando a função retorna false ou quando
	// o cliente desconecta. Aqui controlamos manualmente porque queremos polling
	// com tempo, não eventos.
	c.Stream(func(w io.Writer) bool {
		// Disconnect do cliente.
		if clientCtx.Err() != nil {
			return false
		}
		// Hard timeout.
		if time.Now().After(deadline) {
			_ = writeSSEData(w, "end", map[string]string{
				"status": currentStatus,
				"reason": "max_duration_reached",
			})
			return false
		}

		// 1. Drena novos logs.
		logs, err := h.jobLogRepo.ListSince(clientCtx, jobID, lastLogID, sseLogBatchSize)
		if err != nil {
			_ = writeSSEData(w, "error", map[string]string{"error": err.Error()})
			return false
		}
		for _, l := range logs {
			if !writeSSE(w, "log", l) {
				return false
			}
			lastLogID = l.ID
		}

		// 2. Heartbeat pra manter conexão viva atravessando proxies idle.
		if time.Now().After(heartbeatAt) {
			if _, err := fmt.Fprint(w, ": ping\n\n"); err != nil {
				return false
			}
			if f, ok := w.(http.Flusher); ok {
				f.Flush()
			}
			heartbeatAt = time.Now().Add(sseHeartbeatInterval)
		}

		// 3. Atualiza status do job.
		fresh, err := h.jobRepo.GetByID(clientCtx, jobID)
		if err == nil && fresh.Status != currentStatus {
			currentStatus = fresh.Status
			_ = writeSSE(w, "status", map[string]string{"status": currentStatus})
		}

		// 4. Se entrou em estado terminal, faz uma última varredura e encerra.
		if terminalJobStatuses[currentStatus] {
			if !terminalDrained {
				// Mais um pulo no banco (sem esperar o próximo poll) pra pegar
				// o último log que o worker emitiu antes de chamar /finish.
				late, err := h.jobLogRepo.ListSince(clientCtx, jobID, lastLogID, sseLogBatchSize)
				if err == nil {
					for _, l := range late {
						if !writeSSE(w, "log", l) {
							return false
						}
						lastLogID = l.ID
					}
				}
				terminalDrained = true
			}
			_ = writeSSEData(w, "end", map[string]string{"status": currentStatus})
			return false
		}

		// 5. Aguarda antes do próximo ciclo, respeitando cancel do cliente.
		select {
		case <-clientCtx.Done():
			return false
		case <-time.After(sseLogPollInterval):
			return true
		}
	})
}

// writeSSE serializa o payload em JSON e escreve um evento SSE; retorna false
// se a escrita falhar (cliente desconectou).
func writeSSE(w io.Writer, event string, payload any) bool {
	return writeSSEData(w, event, payload) == nil
}

func writeSSEData(w io.Writer, event string, payload any) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	if _, err := fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event, body); err != nil {
		return err
	}
	if f, ok := w.(http.Flusher); ok {
		f.Flush()
	}
	return nil
}
