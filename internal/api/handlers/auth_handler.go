package handlers

import (
	"net/http"
	"time"

	"github.com/EnzzoHosaki/rps-maestro/internal/api/middleware"
	"github.com/EnzzoHosaki/rps-maestro/internal/repository"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

type AuthHandler struct {
	userRepo  repository.UserRepository
	jwtSecret string
	expiresIn time.Duration
}

func NewAuthHandler(userRepo repository.UserRepository, jwtSecret string, expiresInHours int) *AuthHandler {
	return &AuthHandler{
		userRepo:  userRepo,
		jwtSecret: jwtSecret,
		expiresIn: time.Duration(expiresInHours) * time.Hour,
	}
}

func (h *AuthHandler) Login(c *gin.Context) {
	var req struct {
		Email    string `json:"email" binding:"required,email"`
		Password string `json:"password" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "email e senha são obrigatórios"})
		return
	}

	user, err := h.userRepo.GetByEmail(c.Request.Context(), req.Email)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "credenciais inválidas"})
		return
	}

	// Mensagem genérica intencionalmente — não distinguir entre "usuário não
	// existe", "senha errada" e "desativado" evita enumeração de contas.
	if !user.IsActive {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "credenciais inválidas"})
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password)); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "credenciais inválidas"})
		return
	}

	token, err := h.generateToken(user.ID, user.Email, user.Role)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "erro ao gerar token"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"token":      token,
		"expires_in": int(h.expiresIn.Seconds()),
		"user": gin.H{
			"id":    user.ID,
			"name":  user.Name,
			"email": user.Email,
			"role":  user.Role,
		},
	})
}

func (h *AuthHandler) Refresh(c *gin.Context) {
	userID, _ := c.Get("user_id")
	email, _ := c.Get("email")
	role, _ := c.Get("role")

	uid, _ := userID.(int)
	emailStr, _ := email.(string)
	roleStr, _ := role.(string)

	token, err := h.generateToken(uid, emailStr, roleStr)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "erro ao renovar token"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"token":      token,
		"expires_in": int(h.expiresIn.Seconds()),
	})
}

// Me retorna o perfil do usuário autenticado, lido fresco do banco (não do
// JWT) pra refletir alterações de role/nome/email feitas após o login.
func (h *AuthHandler) Me(c *gin.Context) {
	userIDRaw, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "não autenticado"})
		return
	}
	userID, ok := userIDRaw.(int)
	if !ok {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "user_id inválido no contexto"})
		return
	}

	user, err := h.userRepo.GetByID(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "usuário não encontrado"})
		return
	}

	user.PasswordHash = ""
	c.JSON(http.StatusOK, user)
}

// ChangePassword troca a senha do usuário autenticado. Exige a senha atual
// pra evitar abuso de token roubado — token sozinho não basta pra mudar a
// senha. Política mínima de 8 caracteres; sem regras de complexidade nesta
// versão (pode subir depois).
func (h *AuthHandler) ChangePassword(c *gin.Context) {
	userIDRaw, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "não autenticado"})
		return
	}
	userID, ok := userIDRaw.(int)
	if !ok {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "user_id inválido no contexto"})
		return
	}

	var req struct {
		CurrentPassword string `json:"currentPassword" binding:"required"`
		NewPassword     string `json:"newPassword" binding:"required,min=8"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "senha atual e nova senha (mín. 8 caracteres) são obrigatórias"})
		return
	}

	user, err := h.userRepo.GetByID(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "usuário não encontrado"})
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.CurrentPassword)); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "senha atual incorreta"})
		return
	}

	newHash, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "erro ao processar nova senha"})
		return
	}

	if err := h.userRepo.UpdatePassword(c.Request.Context(), userID, string(newHash)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "erro ao atualizar senha"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "senha atualizada"})
}

func (h *AuthHandler) generateToken(userID int, email, role string) (string, error) {
	claims := middleware.Claims{
		UserID: userID,
		Email:  email,
		Role:   role,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(h.expiresIn)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(h.jwtSecret))
}
