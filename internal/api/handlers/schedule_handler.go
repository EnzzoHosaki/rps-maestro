package handlers

import (
	"net/http"
	"strconv"

	"github.com/EnzzoHosaki/rps-maestro/internal/models"
	"github.com/EnzzoHosaki/rps-maestro/internal/repository"
	"github.com/gin-gonic/gin"
)

type ScheduleHandler struct {
	scheduleRepo repository.ScheduleRepository
}

func NewScheduleHandler(scheduleRepo repository.ScheduleRepository) *ScheduleHandler {
	return &ScheduleHandler{scheduleRepo: scheduleRepo}
}

func (h *ScheduleHandler) CreateSchedule(c *gin.Context) {
	var schedule models.Schedule
	
	if err := c.ShouldBindJSON(&schedule); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Dados inválidos: " + err.Error()})
		return
	}

	if err := h.scheduleRepo.Create(c.Request.Context(), &schedule); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Erro ao criar agendamento: " + err.Error()})
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

	schedule.ID = id
	if err := h.scheduleRepo.Update(c.Request.Context(), &schedule); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Erro ao atualizar agendamento: " + err.Error()})
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

	c.Status(http.StatusNoContent)
}
