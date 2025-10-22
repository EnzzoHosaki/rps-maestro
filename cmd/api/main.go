// Local: rps-maestro/cmd/api/main.go
package main

import (
	"fmt"
	"log"

	"github.com/EnzzoHosaki/rps-maestro/internal/config"
	"github.com/EnzzoHosaki/rps-maestro/internal/repository"
)

func main() {
	cfg, err := config.LoadConfig("./configs")
	if err != nil {
		log.Fatalf("não foi possível carregar a configuração: %v", err)
	}

	fmt.Println("Backend do RPS Maestro iniciando...")
	fmt.Println("Configurações carregadas com sucesso.")

	repo, err := repository.NewPostgresRepository(cfg.Database)
	if err != nil {
		log.Fatalf("não foi possível conectar ao banco de dados: %v", err)
	}
	defer repo.Close()

	fmt.Println("Porta do servidor:", cfg.Server.Port)
	fmt.Println("Host do banco de dados:", cfg.Database.Host)
	fmt.Println("Senha do banco de dados usada:", cfg.Database.Password)

    fmt.Println("Aplicação iniciada. (Encerrando por enquanto)")
}