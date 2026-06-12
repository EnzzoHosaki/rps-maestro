package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/EnzzoHosaki/rps-maestro/internal/models"
	"github.com/EnzzoHosaki/rps-maestro/internal/queue"
	"github.com/EnzzoHosaki/rps-maestro/internal/repository"
	"github.com/gin-gonic/gin"
)

// validateAutomationPayload aplica regras mínimas de sanidade em create/update.
// Hoje só rejeita script_path vazio (já vimos "teste" e "" entrarem em prod
// sem warning). Validações mais fortes (formato de caminho, lista permitida,
// etc.) ficam pra depois se necessário.
func validateAutomationPayload(a *models.Automation) string {
	if strings.TrimSpace(a.Name) == "" {
		return "name é obrigatório"
	}
	if strings.TrimSpace(a.ScriptPath) == "" {
		return "script_path é obrigatório"
	}
	return ""
}

type AutomationHandler struct {
	automationRepo repository.AutomationRepository
	jobRepo        repository.JobRepository
	queueClient    *queue.RabbitMQClient
}

func NewAutomationHandler(
	automationRepo repository.AutomationRepository,
	jobRepo repository.JobRepository,
	queueClient *queue.RabbitMQClient,
) *AutomationHandler {
	return &AutomationHandler{
		automationRepo: automationRepo,
		jobRepo:        jobRepo,
		queueClient:    queueClient,
	}
}

func (h *AutomationHandler) CreateAutomation(c *gin.Context) {
	var automation models.Automation

	if err := c.ShouldBindJSON(&automation); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Dados inválidos: " + err.Error()})
		return
	}

	if msg := validateAutomationPayload(&automation); msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
		return
	}

	if err := h.automationRepo.Create(c.Request.Context(), &automation); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Erro ao criar automação: " + err.Error()})
		return
	}

	c.JSON(http.StatusCreated, automation)
}

func (h *AutomationHandler) GetAutomationByID(c *gin.Context) {
	idParam := c.Param("id")
	id, err := strconv.Atoi(idParam)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ID inválido"})
		return
	}

	automation, err := h.automationRepo.GetByID(c.Request.Context(), id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Automação não encontrada"})
		return
	}

	c.JSON(http.StatusOK, automation)
}

func (h *AutomationHandler) GetAllAutomations(c *gin.Context) {
	automations, err := h.automationRepo.GetAll(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Erro ao buscar automações: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, automations)
}

func (h *AutomationHandler) UpdateAutomation(c *gin.Context) {
	idParam := c.Param("id")
	id, err := strconv.Atoi(idParam)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ID inválido"})
		return
	}

	var automation models.Automation
	if err := c.ShouldBindJSON(&automation); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Dados inválidos: " + err.Error()})
		return
	}

	if msg := validateAutomationPayload(&automation); msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
		return
	}

	automation.ID = id
	if err := h.automationRepo.Update(c.Request.Context(), &automation); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Erro ao atualizar automação: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, automation)
}

func (h *AutomationHandler) DeleteAutomation(c *gin.Context) {
	idParam := c.Param("id")
	id, err := strconv.Atoi(idParam)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ID inválido"})
		return
	}

	if err := h.automationRepo.Delete(c.Request.Context(), id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Erro ao deletar automação: " + err.Error()})
		return
	}

	c.Status(http.StatusNoContent)
}

// GetLastParamsForUser retorna os parâmetros do job mais recente que o usuário
// autenticado executou para essa automação. Retorna `parameters: null` se nunca
// executou — o frontend usa pra montar a cascata defaults → lastParams → vazio.
func (h *AutomationHandler) GetLastParamsForUser(c *gin.Context) {
	idParam := c.Param("id")
	automationID, err := strconv.Atoi(idParam)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ID inválido"})
		return
	}

	uid, ok := c.Get("user_id")
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Usuário não autenticado"})
		return
	}
	userID, ok := uid.(int)
	if !ok {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ID de usuário inválido"})
		return
	}

	rawParams, err := h.jobRepo.GetLastParamsForUser(c.Request.Context(), automationID, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Erro ao buscar últimos parâmetros: " + err.Error()})
		return
	}

	if rawParams == nil {
		c.JSON(http.StatusOK, gin.H{"parameters": nil})
		return
	}

	var params map[string]interface{}
	if err := json.Unmarshal(rawParams, &params); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Erro ao decodificar parâmetros: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"parameters": params})
}

func (h *AutomationHandler) ExecuteAutomation(c *gin.Context) {
	idParam := c.Param("id")
	automationID, err := strconv.Atoi(idParam)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ID inválido"})
		return
	}

	automation, err := h.automationRepo.GetByID(c.Request.Context(), automationID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Automação não encontrada"})
		return
	}

	var params map[string]interface{}
	if err := c.ShouldBindJSON(&params); err != nil {
		params = make(map[string]interface{})
	}

	paramsJSON, err := json.Marshal(params)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Erro ao processar parâmetros: " + err.Error()})
		return
	}

	var userID *int
	if uid, ok := c.Get("user_id"); ok {
		if id, ok := uid.(int); ok {
			userID = &id
		}
	}

	job := &models.Job{
		AutomationID: automationID,
		UserID:       userID,
		Status:       "pending",
		Parameters:   paramsJSON,
	}

	if err := h.jobRepo.Create(c.Request.Context(), job); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Erro ao criar job: " + err.Error()})
		return
	}

	queueMsg := queue.JobMessage{
		JobID:        job.ID.String(),
		AutomationID: automationID,
		ScriptPath:   automation.ScriptPath,
		Parameters:   params,
	}

	queueName := automation.QueueName
	if queueName == "" {
		queueName = "automation_jobs"
	}

	if err := h.queueClient.PublishJob(c.Request.Context(), queueName, queueMsg); err != nil {
		// Compensação: o job já foi criado como 'pending'. Sem isto ele ficaria
		// ÓRFÃO — o retry worker só resgata jobs 'running' (GetStuckJobs), então
		// um 'pending' sem mensagem na fila nunca seria reprocessado nem
		// marcado falho. Marca failed pra ficar visível e retentável à mão.
		failResult, _ := json.Marshal(map[string]string{"error": "Falha ao enfileirar o job no broker: " + err.Error()})
		_ = h.jobRepo.SetResult(c.Request.Context(), job.ID, failResult)
		_ = h.jobRepo.UpdateStatus(c.Request.Context(), job.ID, "failed")
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Erro ao enfileirar job: " + err.Error()})
		return
	}

	c.JSON(http.StatusAccepted, job)
}
