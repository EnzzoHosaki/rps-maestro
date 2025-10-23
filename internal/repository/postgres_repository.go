// Local: rps-maestro/internal/repository/postgres_repository.go
package repository

import (
	"context"
	"fmt"
  // "time"
	"github.com/EnzzoHosaki/rps-maestro/internal/config"
  "github.com/EnzzoHosaki/rps-maestro/internal/models" 
	// "github.com/google/uuid" // Mantém comentado
	"github.com/jackc/pgx/v5/pgxpool"
)

var _ UserRepository = (*PostgresRepository)(nil)
// var _ AutomationRepository = (*PostgresRepository)(nil)
// var _ JobRepository = (*PostgresRepository)(nil)
// var _ JobLogRepository = (*PostgresRepository)(nil)
// var _ ScheduleRepository = (*PostgresRepository)(nil)

type PostgresRepository struct {
	db *pgxpool.Pool
}

func NewPostgresRepository(cfg config.DatabaseConfig) (*PostgresRepository, error) {
	dsn := fmt.Sprintf("postgres://%s:%s@%s:%d/%s?sslmode=disable",
		cfg.User,
		cfg.Password,
		cfg.Host,
		cfg.Port,
		cfg.DBName,
	)

	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		return nil, fmt.Errorf("não foi possível conectar ao banco de dados: %w", err)
	}

	if err := pool.Ping(context.Background()); err != nil {
		pool.Close()
		return nil, fmt.Errorf("não foi possível pingar o banco de dados: %w", err)
	}

	fmt.Println("Conexão com o PostgreSQL estabelecida com sucesso!")

	return &PostgresRepository{db: pool}, nil
}

func (r *PostgresRepository) Close() {
	if r.db != nil {
		r.db.Close()
		fmt.Println("Conexão com o PostgreSQL fechada.")
	}
}