// Local: rps-maestro/internal/repository/user_repository.go
package repository

import (
	"context"
	"fmt"
	"github.com/EnzzoHosaki/rps-maestro/internal/models"
)

func (r *PostgresUserRepository) Create(ctx context.Context, user *models.User) error {
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

func (r *PostgresUserRepository) GetByID(ctx context.Context, id int) (*models.User, error) {
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

func (r *PostgresUserRepository) GetByEmail(ctx context.Context, email string) (*models.User, error) {
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

func (r *PostgresUserRepository) GetAll(ctx context.Context) ([]models.User, error) {
	sql := `SELECT id, name, email, password_hash, role, created_at, updated_at FROM users ORDER BY id`
	rows, err := r.db.Query(ctx, sql)
	if err != nil {
		return nil, fmt.Errorf("erro ao buscar usuários: %w", err)
	}
	defer rows.Close()

	var users []models.User
	for rows.Next() {
		var user models.User
		err := rows.Scan(
			&user.ID,
			&user.Name,
			&user.Email,
			&user.PasswordHash,
			&user.Role,
			&user.CreatedAt,
			&user.UpdatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("erro ao escanear usuário: %w", err)
		}
		users = append(users, user)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("erro ao iterar usuários: %w", err)
	}

	return users, nil
}

func (r *PostgresUserRepository) Update(ctx context.Context, user *models.User) error {
	sql := `UPDATE users 
	        SET name = $1, email = $2, password_hash = $3, role = $4, updated_at = NOW()
	        WHERE id = $5
	        RETURNING updated_at`

	err := r.db.QueryRow(ctx, sql,
		user.Name,
		user.Email,
		user.PasswordHash,
		user.Role,
		user.ID,
	).Scan(&user.UpdatedAt)

	if err != nil {
		return fmt.Errorf("erro ao atualizar usuário: %w", err)
	}

	return nil
}

func (r *PostgresUserRepository) Delete(ctx context.Context, id int) error {
	sql := `DELETE FROM users WHERE id = $1`

	result, err := r.db.Exec(ctx, sql, id)
	if err != nil {
		return fmt.Errorf("erro ao deletar usuário: %w", err)
	}

	rowsAffected := result.RowsAffected()
	if rowsAffected == 0 {
		return fmt.Errorf("usuário não encontrado")
	}

	return nil
}
