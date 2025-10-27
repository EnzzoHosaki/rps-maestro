package handlers

import (
	"net/http"

	"github.com/EnzzoHosaki/rps-maestro/internal/repository"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type JobHandler struct {
	jobRepo    repository.JobRepository
	jobLogRepo repository.JobLogRepository
}

func NewJobHandler(jobRepo repository.JobRepository, jobLogRepo repository.JobLogRepository) *JobHandler {
	return &JobHandler{
		jobRepo:    jobRepo,
		jobLogRepo: jobLogRepo,
	}
}

func (h *JobHandler) GetJobByID(c *gin.Context) {
	idParam := c.Param("id")
	jobID, err := uuid.Parse(idParam)
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
	idParam := c.Param("id")
	jobID, err := uuid.Parse(idParam)
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
