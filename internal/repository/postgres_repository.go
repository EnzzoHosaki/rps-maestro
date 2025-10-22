// Local: rps-maestro/internal/repository/postgres_repository.go
package repository

import (
	"context"
	"fmt"
  // "time"
	"github.com/EnzzoHosaki/rps-maestro/internal/config"
  "github.com/EnzzoHosaki/rps-maestro/internal/models"
	// "github.com/google/uuid"
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

	func (r *PostgresRepository) GetByID(ctx context.Context, id int) (*models.User, error) {
		sql := `SELECT id, name, email, password_hash, role, created_at, updated_at FROM users WHERE id = $1`
		user := &models.User{}
		err := r.db.QueryRow(ctx, sql, id).Scan(
			&user.ID,
			&user.Name,
			&user.Email,
			&user.PasswordHash,
			&user.Role,
			&user.CreatedAt,
			&user.UpdatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("erro ao buscar usuário por ID: %w", err)
		}
		return user, nil
	}

	func (r *PostgresRepository) GetByEmail(ctx context.Context, email string) (*models.User, error) {
		sql := `SELECT id, name, email, password_hash, role, created_at, updated_at FROM users WHERE email = $1`
		user := &models.User{}
		err := r.db.QueryRow(ctx, sql, email).Scan(
			&user.ID,
			&user.Name,
			&user.Email,
			&user.PasswordHash,
			&user.Role,
			&user.CreatedAt,
			&user.UpdatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("erro ao buscar usuário por email: %w", err)
		}
		return user, nil
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

func (r *PostgresRepository) Create(ctx context.Context, user *models.User) error {
	sql := `INSERT INTO users (name, email, password_hash, role)
	        VALUES ($1, $2, $3, $4)
	        RETURNING id, created_at, updated_at`

	err := r.db.QueryRow(ctx, sql,
		user.Name,
		user.Email,
		user.PasswordHash,
		user.Role,
	).Scan(&user.ID, &user.CreatedAt, &user.UpdatedAt)

	if err != nil {
		return fmt.Errorf("erro ao criar utilizador: %w", err)
	}

	return nil
}