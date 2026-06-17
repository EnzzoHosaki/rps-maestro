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

// rangeSpec descreve um período suportado pelo dashboard. Os valores de
// interval/bucket/step vão direto pra parâmetros SQL — por isso a whitelist:
// o usuário só escolhe a CHAVE ("24h"/"7d"/"30d"), nunca o conteúdo.
type rangeSpec struct {
	interval string // janela das métricas agregadas ("24 hours")
	bucket   string // unidade do date_trunc da série ("hour"/"day")
	buckets  int    // quantos buckets a série retorna
	step     string // passo do generate_series ("1 hour"/"1 day")
}

var rangeSpecs = map[string]rangeSpec{
	"24h": {interval: "24 hours", bucket: "hour", buckets: 24, step: "1 hour"},
	"7d":  {interval: "7 days", bucket: "day", buckets: 7, step: "1 day"},
	"30d": {interval: "30 days", bucket: "day", buckets: 30, step: "1 day"},
}

// parseRange resolve ?range= contra a whitelist. Default 24h (compatível com
// o comportamento original). Retorna ok=false pra valor desconhecido.
func parseRange(c *gin.Context) (rangeSpec, bool) {
	key := c.DefaultQuery("range", "24h")
	spec, ok := rangeSpecs[key]
	return spec, ok
}

// GetMetrics retorna um snapshot agregado de jobs para o dashboard.
//
// Aceita ?range=24h|7d|30d (default 24h). Resposta:
//
//	{
//	  "running":          0,    // snapshot atual (independe do range)
//	  "pending":          0,    // snapshot atual (independe do range)
//	  "completedToday":   0,    // dia corrente (independe do range)
//	  "failedLast24h":    0,    // no período pedido
//	  "canceledLast24h":  0,    // no período pedido
//	  "totalLast24h":     0,    // finalizados no período pedido
//	  "successRate24h":   0.95  // sucesso/total no período pedido
//	}
//
// Os nomes *Last24h/24h são mantidos por compatibilidade de contrato; os
// valores refletem o range pedido. Quando total = 0, successRate = 0.0
// (UI deve exibir "—").
func (h *MetricsHandler) GetMetrics(c *gin.Context) {
	spec, ok := parseRange(c)
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "range inválido; use 24h, 7d ou 30d"})
		return
	}

	metrics, err := h.jobRepo.GetMetrics(c.Request.Context(), spec.interval)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Erro ao calcular métricas: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, metrics)
}

// GetJobsPerHour retorna a série temporal de jobs finalizados pro gráfico do
// dashboard. Aceita ?range=24h|7d|30d (default 24h): 24h → 24 buckets de uma
// hora; 7d/30d → buckets de um dia. Bucket sem jobs vem com zero. O campo se
// chama "hour" por compatibilidade, mas é o timestamp de início do bucket
// (hora ou dia conforme o range). Resposta:
//
//	[{ "hour": "2026-05-18T18:00:00Z", "total": 4, "succeeded": 3, "failed": 1 }, ...]
func (h *MetricsHandler) GetJobsPerHour(c *gin.Context) {
	spec, ok := parseRange(c)
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "range inválido; use 24h, 7d ou 30d"})
		return
	}

	buckets, err := h.jobRepo.GetJobsSeries(c.Request.Context(), spec.bucket, spec.buckets, spec.step)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Erro ao agregar série de jobs: " + err.Error()})
		return
	}
	c.JSON(http.StatusOK, buckets)
}

// recentRuns é quantos status recentes a tabela de saúde mostra por automação
// (os "pontinhos" verde/vermelho do dashboard).
const recentRuns = 12

// GetAutomationHealth retorna a saúde agregada por automação no período pedido
// (?range=24h|7d|30d, default 24h): total/sucesso/falha/cancelado, taxa de
// sucesso, duração p50/p95, split manual×agendado, e os últimos status.
func (h *MetricsHandler) GetAutomationHealth(c *gin.Context) {
	spec, ok := parseRange(c)
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "range inválido; use 24h, 7d ou 30d"})
		return
	}

	health, err := h.jobRepo.GetAutomationHealth(c.Request.Context(), spec.interval, recentRuns)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Erro ao calcular saúde por automação: " + err.Error()})
		return
	}
	c.JSON(http.StatusOK, health)
}

// GetErrorClasses retorna a distribuição de jobs falhos por categoria de erro
// no período pedido (?range=24h|7d|30d, default 24h). Resposta:
//
//	[{ "errorClass": "CREDENTIAL_INVALID", "count": 12 }, ...]
func (h *MetricsHandler) GetErrorClasses(c *gin.Context) {
	spec, ok := parseRange(c)
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "range inválido; use 24h, 7d ou 30d"})
		return
	}

	dist, err := h.jobRepo.GetErrorClassDistribution(c.Request.Context(), spec.interval)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Erro ao agregar categorias de erro: " + err.Error()})
		return
	}
	c.JSON(http.StatusOK, dist)
}
