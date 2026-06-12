package middleware

import (
	"crypto/subtle"
	"net/http"

	"github.com/gin-gonic/gin"
)

// WorkerAPIKey protege os endpoints de callback dos workers.
// Se a chave estiver vazia (dev local), a requisição passa sem validação.
func WorkerAPIKey(apiKey string) gin.HandlerFunc {
	return func(c *gin.Context) {
		if apiKey == "" {
			c.Next()
			return
		}
		// Comparação em tempo constante pra não vazar a chave por timing.
		got := c.GetHeader("X-Worker-API-Key")
		if subtle.ConstantTimeCompare([]byte(got), []byte(apiKey)) != 1 {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "API key inválida"})
			return
		}
		c.Next()
	}
}
