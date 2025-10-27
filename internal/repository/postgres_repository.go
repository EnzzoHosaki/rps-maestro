// Local: rps-maestro/internal/repository/postgres_repository.go
package repository

import (
	"context"
	"fmt"
	"github.com/EnzzoHosaki/rps-maestro/internal/config"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Struct base para todos os repositórios
type baseRepository struct {
	db *pgxpool.Pool
}

// User Repository
type PostgresUserRepository struct {
	baseRepository
}

var _ UserRepository = (*PostgresUserRepository)(nil)

// Automation Repository
type PostgresAutomationRepository struct {
	baseRepository
}

var _ AutomationRepository = (*PostgresAutomationRepository)(nil)

// Job Repository
type PostgresJobRepository struct {
	baseRepository
}

var _ JobRepository = (*PostgresJobRepository)(nil)

// Job Log Repository
type PostgresJobLogRepository struct {
	baseRepository
}

var _ JobLogRepository = (*PostgresJobLogRepository)(nil)

// Schedule Repository
type PostgresScheduleRepository struct {
	baseRepository
}

var _ ScheduleRepository = (*PostgresScheduleRepository)(nil)

// Holder de conexão para todos os repositórios
type PostgresConnection struct {
	db *pgxpool.Pool
}

func NewPostgresRepository(cfg config.DatabaseConfig) (*PostgresConnection, error) {
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

	return &PostgresConnection{db: pool}, nil
}

func (pc *PostgresConnection) GetUserRepository() UserRepository {
	return &PostgresUserRepository{
		baseRepository: baseRepository{db: pc.db},
	}
}

func (pc *PostgresConnection) GetAutomationRepository() AutomationRepository {
	return &PostgresAutomationRepository{
		baseRepository: baseRepository{db: pc.db},
	}
}

func (pc *PostgresConnection) GetJobRepository() JobRepository {
	return &PostgresJobRepository{
		baseRepository: baseRepository{db: pc.db},
	}
}

func (pc *PostgresConnection) GetJobLogRepository() JobLogRepository {
	return &PostgresJobLogRepository{
		baseRepository: baseRepository{db: pc.db},
	}
}

func (pc *PostgresConnection) GetScheduleRepository() ScheduleRepository {
	return &PostgresScheduleRepository{
		baseRepository: baseRepository{db: pc.db},
	}
}

func (pc *PostgresConnection) Close() {
	if pc.db != nil {
		pc.db.Close()
		fmt.Println("Conexão com o PostgreSQL fechada.")
	}
}