package middleware

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// RequireRole bloqueia a requisição com 403 se o role do JWT não estiver na
// lista de roles permitidos. Deve ser usado SEMPRE depois de JWTAuth na mesma
// chain, porque depende de c.Get("role") populado pelo middleware de auth.
//
// Se o role do contexto estiver vazio (caso de JWTAuth em modo dev com secret
// vazio), o middleware deixa passar — mesma política do JWTAuth, pra não
// quebrar o dev local. Em prod o secret é obrigatório (ver config.JWTConfig),
// então esse fallback nunca é atingido lá.
//
// Uso:
//
//	admin := protected.Group("", middleware.RequireRole("admin"))
//	operator := protected.Group("", middleware.RequireRole("admin", "operator"))
//
// A ordem dos allowed não importa — match é exato, case-sensitive (igual ao
// que sai do banco com a CHECK constraint).
func RequireRole(allowed ...string) gin.HandlerFunc {
	allowedSet := make(map[string]struct{}, len(allowed))
	for _, r := range allowed {
		allowedSet[r] = struct{}{}
	}

	return func(c *gin.Context) {
		v, exists := c.Get("role")
		if !exists {
			// JWTAuth em modo dev (secret vazio) não seta role. Deixa passar
			// pra manter dev funcional sem JWT.
			c.Next()
			return
		}

		role, _ := v.(string)
		if _, ok := allowedSet[role]; !ok {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
				"error": "permissão insuficiente para esta operação",
			})
			return
		}

		c.Next()
	}
}
