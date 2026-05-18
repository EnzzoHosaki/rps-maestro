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
	        RETURNING id, is_active, created_at, updated_at`

	err := r.db.QueryRow(ctx, sql,
		user.Name,
		user.Email,
		user.PasswordHash,
		user.Role,
	).Scan(&user.ID, &user.IsActive, &user.CreatedAt, &user.UpdatedAt)

	if err != nil {
		return fmt.Errorf("erro ao criar utilizador: %w", err)
	}

	return nil
}

func (r *PostgresUserRepository) GetByID(ctx context.Context, id int) (*models.User, error) {
	sql := `SELECT id, name, email, password_hash, role, is_active, created_at, updated_at FROM users WHERE id = $1`
	user := &models.User{}
	err := r.db.QueryRow(ctx, sql, id).Scan(
		&user.ID,
		&user.Name,
		&user.Email,
		&user.PasswordHash,
		&user.Role,
		&user.IsActive,
		&user.CreatedAt,
		&user.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("erro ao buscar usuário por ID: %w", err)
	}
	return user, nil
}

func (r *PostgresUserRepository) GetByEmail(ctx context.Context, email string) (*models.User, error) {
	sql := `SELECT id, name, email, password_hash, role, is_active, created_at, updated_at FROM users WHERE email = $1`
	user := &models.User{}
	err := r.db.QueryRow(ctx, sql, email).Scan(
		&user.ID,
		&user.Name,
		&user.Email,
		&user.PasswordHash,
		&user.Role,
		&user.IsActive,
		&user.CreatedAt,
		&user.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("erro ao buscar usuário por email: %w", err)
	}
	return user, nil
}

// GetAll lista usuários. Por padrão filtra apenas ativos; passe
// includeInactive=true pra ver desativados também (uso na tela admin de
// usuários, com toggle "mostrar inativos").
func (r *PostgresUserRepository) GetAll(ctx context.Context, includeInactive bool) ([]models.User, error) {
	sql := `SELECT id, name, email, password_hash, role, is_active, created_at, updated_at FROM users`
	if !includeInactive {
		sql += ` WHERE is_active = TRUE`
	}
	sql += ` ORDER BY id`

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
			&user.IsActive,
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

// Update atualiza name/email/role. NÃO mexe em password_hash nem is_active —
// pra isso existem UpdatePassword e SetActive, que evitam que um PUT genérico
// vaze hash ou re-ative usuário sem querer.
func (r *PostgresUserRepository) Update(ctx context.Context, user *models.User) error {
	sql := `UPDATE users
	        SET name = $1, email = $2, role = $3, updated_at = NOW()
	        WHERE id = $4
	        RETURNING updated_at`

	err := r.db.QueryRow(ctx, sql,
		user.Name,
		user.Email,
		user.Role,
		user.ID,
	).Scan(&user.UpdatedAt)

	if err != nil {
		return fmt.Errorf("erro ao atualizar usuário: %w", err)
	}

	return nil
}

func (r *PostgresUserRepository) UpdatePassword(ctx context.Context, id int, passwordHash string) error {
	sql := `UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`
	result, err := r.db.Exec(ctx, sql, passwordHash, id)
	if err != nil {
		return fmt.Errorf("erro ao atualizar senha: %w", err)
	}
	if result.RowsAffected() == 0 {
		return fmt.Errorf("usuário não encontrado")
	}
	return nil
}

func (r *PostgresUserRepository) SetActive(ctx context.Context, id int, isActive bool) error {
	sql := `UPDATE users SET is_active = $1, updated_at = NOW() WHERE id = $2`
	result, err := r.db.Exec(ctx, sql, isActive, id)
	if err != nil {
		return fmt.Errorf("erro ao alterar status do usuário: %w", err)
	}
	if result.RowsAffected() == 0 {
		return fmt.Errorf("usuário não encontrado")
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
