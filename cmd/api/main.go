// Local: rps-maestro/cmd/api/main.go
package main

import (
	"context"
	"fmt"
	"log"

	"github.com/EnzzoHosaki/rps-maestro/internal/config"
	"github.com/EnzzoHosaki/rps-maestro/internal/models"
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

	fmt.Println("Conexão com o PostgreSQL estabelecida com sucesso!")

	ctx := context.Background()

	novoUtilizador := &models.User{
		Name:         "Utilizador Teste",
		Email:        "teste@rpscontabilidade.com.br",
		PasswordHash: "senha_insegura_hash_temporario",
		Role:         "admin",
	}

	err = repo.Create(ctx, novoUtilizador)
	if err != nil {
		log.Printf("ERRO ao criar utilizador: %v", err)
	} else {
		fmt.Printf("Utilizador criado com sucesso! ID: %d, Email: %s, Criado em: %s\n",
			novoUtilizador.ID,
			novoUtilizador.Email,
			novoUtilizador.CreatedAt.Format("2006-01-02 15:04:05"),
		)
	}

	fmt.Println("Aplicação iniciada e teste concluído. (Encerrando por enquanto)")
}