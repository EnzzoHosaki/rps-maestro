// Local: rps-maestro/cmd/api/main.go
 package main

 import (
 	"fmt"
 	"github.com/EnzzoHosaki/rps-maestro/internal/config"
 	"log"
 )

 func main() {
 	cfg, err := config.LoadConfig("./configs")
 	if err != nil {
 		log.Fatalf("não foi possível carregar a configuração: %v", err)
 	}

 	fmt.Println("Backend do RPS Maestro iniciando na porta:", cfg.Server.Port)
 	fmt.Println("Conectando ao banco de dados:", cfg.Database.Host)
 	fmt.Println("Senha do banco de dados carregada:", cfg.Database.Password)
 }