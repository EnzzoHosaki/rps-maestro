package handlers

import (
	"net/http"

	"github.com/EnzzoHosaki/rps-maestro/internal/repository"
	"github.com/gin-gonic/gin"
)

type MetricsHandler struct {
	jobRepo repository.JobRepository
}

func NewMetricsHandler(jobRepo repository.JobRepository) *MetricsHandler {
	return &MetricsHandler{jobRepo: jobRepo}
}

// GetMetrics retorna um snapshot agregado de jobs para o dashboard.
//
// Resposta:
//
//	{
//	  "running":          0,
//	  "pending":          0,
//	  "completedToday":   0,
//	  "failedLast24h":    0,
//	  "canceledLast24h":  0,
//	  "totalLast24h":     0,
//	  "successRate24h":   0.95
//	}
//
// successRate24h é calculado como sucesso / total nas últimas 24h. Quando
// total = 0, retorna 0.0 (UI deve exibir "—").
func (h *MetricsHandler) GetMetrics(c *gin.Context) {
	metrics, err := h.jobRepo.GetMetrics(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Erro ao calcular métricas: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, metrics)
}
