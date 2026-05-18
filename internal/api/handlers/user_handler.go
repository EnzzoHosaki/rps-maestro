package handlers

import (
	"net/http"
	"strconv"

	"github.com/EnzzoHosaki/rps-maestro/internal/models"
	"github.com/EnzzoHosaki/rps-maestro/internal/repository"
	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
)

type UserHandler struct {
	userRepo repository.UserRepository
}

func NewUserHandler(userRepo repository.UserRepository) *UserHandler {
	return &UserHandler{
		userRepo: userRepo,
	}
}

// callerID extrai o user_id do JWT do contexto. Retorna (0, false) se
// não estiver presente — proteção contra contexto não-autenticado vazando
// pra cá (não deve ocorrer dado o middleware, mas é cheap insurance).
func callerID(c *gin.Context) (int, bool) {
	v, exists := c.Get("user_id")
	if !exists {
		return 0, false
	}
	id, ok := v.(int)
	if !ok {
		return 0, false
	}
	return id, true
}

// CreateUser cria usuário. A senha vem em texto puro no payload e é
// hasheada aqui — o cliente nunca lida com hash. Role default = viewer.
func (h *UserHandler) CreateUser(c *gin.Context) {
	var req struct {
		Name     string `json:"name" binding:"required"`
		Email    string `json:"email" binding:"required,email"`
		Password string `json:"password" binding:"required,min=8"`
		Role     string `json:"role"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Dados inválidos: " + err.Error()})
		return
	}

	if req.Role == "" {
		req.Role = "viewer"
	}
	if req.Role != "admin" && req.Role != "operator" && req.Role != "viewer" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Role inválido: deve ser admin, operator ou viewer"})
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Erro ao processar senha"})
		return
	}

	user := models.User{
		Name:         req.Name,
		Email:        req.Email,
		PasswordHash: string(hash),
		Role:         req.Role,
	}

	if err := h.userRepo.Create(c.Request.Context(), &user); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Erro ao criar usuário: " + err.Error()})
		return
	}

	user.PasswordHash = ""
	c.JSON(http.StatusCreated, user)
}

func (h *UserHandler) GetUserByID(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ID inválido"})
		return
	}

	user, err := h.userRepo.GetByID(c.Request.Context(), id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Usuário não encontrado"})
		return
	}

	user.PasswordHash = ""
	c.JSON(http.StatusOK, user)
}

func (h *UserHandler) GetUserByEmail(c *gin.Context) {
	email := c.Query("email")
	if email == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Email é obrigatório"})
		return
	}

	user, err := h.userRepo.GetByEmail(c.Request.Context(), email)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Usuário não encontrado"})
		return
	}

	user.PasswordHash = ""
	c.JSON(http.StatusOK, user)
}

// GetAllUsers lista usuários. Por padrão só ativos; `?include_inactive=true`
// inclui desativados (tela admin que precisa reativar conta).
func (h *UserHandler) GetAllUsers(c *gin.Context) {
	includeInactive := c.Query("include_inactive") == "true"

	users, err := h.userRepo.GetAll(c.Request.Context(), includeInactive)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Erro ao buscar usuários: " + err.Error()})
		return
	}

	for i := range users {
		users[i].PasswordHash = ""
	}

	c.JSON(http.StatusOK, users)
}

// UpdateUser atualiza name/email/role. Senha NÃO entra aqui — pra trocar
// usa /auth/change-password (próprio user) ou /users/:id/reset-password
// (admin reseta alguém).
func (h *UserHandler) UpdateUser(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ID inválido"})
		return
	}

	existing, err := h.userRepo.GetByID(c.Request.Context(), id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Usuário não encontrado"})
		return
	}

	var req struct {
		Name  string `json:"name" binding:"required"`
		Email string `json:"email" binding:"required,email"`
		Role  string `json:"role" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Dados inválidos: " + err.Error()})
		return
	}

	if req.Role != "admin" && req.Role != "operator" && req.Role != "viewer" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Role inválido: deve ser admin, operator ou viewer"})
		return
	}

	existing.Name = req.Name
	existing.Email = req.Email
	existing.Role = req.Role

	if err := h.userRepo.Update(c.Request.Context(), existing); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Erro ao atualizar usuário: " + err.Error()})
		return
	}

	existing.PasswordHash = ""
	c.JSON(http.StatusOK, existing)
}

// DeactivateUser marca o usuário como inativo. Impede admin de se
// desativar — pega ele fora da gestão sem caminho de volta pelo painel.
func (h *UserHandler) DeactivateUser(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ID inválido"})
		return
	}

	caller, ok := callerID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "não autenticado"})
		return
	}
	if caller == id {
		c.JSON(http.StatusBadRequest, gin.H{"error": "você não pode desativar a própria conta"})
		return
	}

	if _, err := h.userRepo.GetByID(c.Request.Context(), id); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Usuário não encontrado"})
		return
	}

	if err := h.userRepo.SetActive(c.Request.Context(), id, false); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Erro ao desativar usuário: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "usuário desativado"})
}

func (h *UserHandler) ReactivateUser(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ID inválido"})
		return
	}

	if _, err := h.userRepo.GetByID(c.Request.Context(), id); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Usuário não encontrado"})
		return
	}

	if err := h.userRepo.SetActive(c.Request.Context(), id, true); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Erro ao reativar usuário: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "usuário reativado"})
}

// ResetUserPassword permite admin definir nova senha de outro usuário sem
// saber a senha atual — caminho pra recuperar conta cuja senha foi esquecida.
func (h *UserHandler) ResetUserPassword(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ID inválido"})
		return
	}

	var req struct {
		NewPassword string `json:"newPassword" binding:"required,min=8"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Nova senha (mín. 8 caracteres) é obrigatória"})
		return
	}

	if _, err := h.userRepo.GetByID(c.Request.Context(), id); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Usuário não encontrado"})
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Erro ao processar senha"})
		return
	}

	if err := h.userRepo.UpdatePassword(c.Request.Context(), id, string(hash)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Erro ao atualizar senha"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "senha resetada"})
}

// DeleteUser ainda existe pra hard-delete de conta órfã, mas o caminho
// recomendado é desativar (preserva FK em jobs). Mantido por compat e pra
// casos extremos de limpeza.
func (h *UserHandler) DeleteUser(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ID inválido"})
		return
	}

	caller, ok := callerID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "não autenticado"})
		return
	}
	if caller == id {
		c.JSON(http.StatusBadRequest, gin.H{"error": "você não pode remover a própria conta"})
		return
	}

	if _, err := h.userRepo.GetByID(c.Request.Context(), id); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Usuário não encontrado"})
		return
	}

	if err := h.userRepo.Delete(c.Request.Context(), id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Erro ao deletar usuário: " + err.Error()})
		return
	}

	c.Status(http.StatusNoContent)
}
