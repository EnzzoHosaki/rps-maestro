package middleware

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

type Claims struct {
	UserID int    `json:"user_id"`
	Email  string `json:"email"`
	Role   string `json:"role"`
	jwt.RegisteredClaims
}

// JWTAuth valida Bearer tokens em todos os endpoints protegidos.
// Se o secret estiver vazio (dev), a requisição passa sem validação.
//
// Aceita o token de duas formas, em ordem de prioridade:
//  1. Header "Authorization: Bearer <token>" — preferido sempre que possível.
//  2. Query string "?token=<token>" — necessário pra SSE no navegador
//     (EventSource não suporta headers customizados). Cuidado: tokens em
//     query string podem aparecer em logs de proxy. Usar apenas em rotas
//     de longa duração onde é a única opção (ex.: /jobs/:id/logs/stream).
func JWTAuth(secret string) gin.HandlerFunc {
	return func(c *gin.Context) {
		if secret == "" {
			c.Next()
			return
		}

		var tokenStr string
		if h := c.GetHeader("Authorization"); strings.HasPrefix(h, "Bearer ") {
			tokenStr = strings.TrimPrefix(h, "Bearer ")
		} else if q := c.Query("token"); q != "" {
			tokenStr = q
		} else {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "token não fornecido"})
			return
		}

		claims := &Claims{}
		token, err := jwt.ParseWithClaims(tokenStr, claims, func(t *jwt.Token) (interface{}, error) {
			if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, jwt.ErrSignatureInvalid
			}
			return []byte(secret), nil
		})

		if err != nil || !token.Valid {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "token inválido"})
			return
		}

		c.Set("user_id", claims.UserID)
		c.Set("email", claims.Email)
		c.Set("role", claims.Role)
		c.Next()
	}
}
