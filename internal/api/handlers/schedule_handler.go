package handlers

import (
	"context"
	"log"
	"net/http"
	"strconv"

	"github.com/EnzzoHosaki/rps-maestro/internal/models"
	"github.com/EnzzoHosaki/rps-maestro/internal/repository"
	"github.com/EnzzoHosaki/rps-maestro/internal/scheduler"
	"github.com/gin-gonic/gin"
)

// validateCron rejeita expressões cron inválidas antes de persistir, usando o
// mesmo parser do scheduler (scheduler.ParseSchedule — 5 campos padrão + `L`
// pro último dia do mês). Sem isso, uma expressão inválida seria salva e só
// falharia silenciosamente no Reload, deixando o agendamento cadastrado mas
// nunca executado.
func validateCron(expr string) error {
	_, err := scheduler.ParseSchedule(expr)
	return err
}

// ScheduleReloader é implementado pelo scheduler para sincronizar agendamentos após mudanças via API.
type ScheduleReloader interface {
	Reload(ctx context.Context) error
}

type ScheduleHandler struct {
	scheduleRepo repository.ScheduleRepository
	reloader     ScheduleReloader
}

func NewScheduleHandler(scheduleRepo repository.ScheduleRepository, reloader ScheduleReloader) *ScheduleHandler {
	return &ScheduleHandler{
		scheduleRepo: scheduleRepo,
		reloader:     reloader,
	}
}

func (h *ScheduleHandler) CreateSchedule(c *gin.Context) {
	var schedule models.Schedule

	if err := c.ShouldBindJSON(&schedule); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Dados inválidos: " + err.Error()})
		return
	}

	if err := validateCron(schedule.CronExpression); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Expressão cron inválida: " + err.Error()})
		return
	}

	if err := h.scheduleRepo.Create(c.Request.Context(), &schedule); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Erro ao criar agendamento: " + err.Error()})
		return
	}

	h.triggerReload(c.Request.Context())

	// Re-busca após o reload para devolver o next_run_at recém-calculado pelo scheduler.
	if fresh, err := h.scheduleRepo.GetByID(c.Request.Context(), schedule.ID); err == nil {
		c.JSON(http.StatusCreated, fresh)
		return
	}
	c.JSON(http.StatusCreated, schedule)
}

func (h *ScheduleHandler) GetScheduleByID(c *gin.Context) {
	idParam := c.Param("id")
	id, err := strconv.Atoi(idParam)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ID inválido"})
		return
	}

	schedule, err := h.scheduleRepo.GetByID(c.Request.Context(), id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Agendamento não encontrado"})
		return
	}

	c.JSON(http.StatusOK, schedule)
}

func (h *ScheduleHandler) GetAllEnabledSchedules(c *gin.Context) {
	schedules, err := h.scheduleRepo.GetAllEnabled(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Erro ao buscar agendamentos: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, schedules)
}

func (h *ScheduleHandler) UpdateSchedule(c *gin.Context) {
	idParam := c.Param("id")
	id, err := strconv.Atoi(idParam)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ID inválido"})
		return
	}

	var schedule models.Schedule
	if err := c.ShouldBindJSON(&schedule); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Dados inválidos: " + err.Error()})
		return
	}

	if err := validateCron(schedule.CronExpression); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Expressão cron inválida: " + err.Error()})
		return
	}

	schedule.ID = id
	if err := h.scheduleRepo.Update(c.Request.Context(), &schedule); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Erro ao atualizar agendamento: " + err.Error()})
		return
	}

	h.triggerReload(c.Request.Context())

	// Re-busca após o reload para devolver o next_run_at recém-calculado pelo scheduler.
	if fresh, err := h.scheduleRepo.GetByID(c.Request.Context(), id); err == nil {
		c.JSON(http.StatusOK, fresh)
		return
	}
	c.JSON(http.StatusOK, schedule)
}

func (h *ScheduleHandler) DeleteSchedule(c *gin.Context) {
	idParam := c.Param("id")
	id, err := strconv.Atoi(idParam)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ID inválido"})
		return
	}

	if err := h.scheduleRepo.Delete(c.Request.Context(), id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Erro ao deletar agendamento: " + err.Error()})
		return
	}

	h.triggerReload(c.Request.Context())
	c.Status(http.StatusNoContent)
}

func (h *ScheduleHandler) triggerReload(ctx context.Context) {
	if err := h.reloader.Reload(ctx); err != nil {
		log.Printf("[schedule_handler] erro ao recarregar scheduler: %v", err)
	}
}
