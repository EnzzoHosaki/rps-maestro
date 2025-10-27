// Local: rps-maestro/internal/repository/automation_repository.go
package repository

import (
	"context"
	"fmt"
	"github.com/EnzzoHosaki/rps-maestro/internal/models"
	"github.com/jackc/pgx/v5"
)

func (r *PostgresAutomationRepository) Create(ctx context.Context, automation *models.Automation) error {
	sql := `INSERT INTO automations (name, description, script_path, default_params)
	        VALUES ($1, $2, $3, $4)
	        RETURNING id, created_at, updated_at`

	err := r.db.QueryRow(ctx, sql,
		automation.Name,
		automation.Description,
		automation.ScriptPath,
		automation.DefaultParams,
	).Scan(&automation.ID, &automation.CreatedAt, &automation.UpdatedAt)

	if err != nil {
		return fmt.Errorf("erro ao criar automação: %w", err)
	}
	return nil
}

func (r *PostgresAutomationRepository) GetByID(ctx context.Context, id int) (*models.Automation, error) {
	sql := `SELECT id, name, description, script_path, default_params, created_at, updated_at
	        FROM automations WHERE id = $1`

	a := &models.Automation{}
	err := r.db.QueryRow(ctx, sql, id).Scan(
		&a.ID,
		&a.Name,
		&a.Description,
		&a.ScriptPath,
		&a.DefaultParams,
		&a.CreatedAt,
		&a.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("erro ao buscar automação por ID: %w", err)
	}
	return a, nil
}

func (r *PostgresAutomationRepository) GetByName(ctx context.Context, name string) (*models.Automation, error) {
	sql := `SELECT id, name, description, script_path, default_params, created_at, updated_at
	        FROM automations WHERE name = $1`

	a := &models.Automation{}
	err := r.db.QueryRow(ctx, sql, name).Scan(
		&a.ID,
		&a.Name,
		&a.Description,
		&a.ScriptPath,
		&a.DefaultParams,
		&a.CreatedAt,
		&a.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("erro ao buscar automação por nome: %w", err)
	}
	return a, nil
}

func (r *PostgresAutomationRepository) GetAll(ctx context.Context) ([]models.Automation, error) {
	sql := `SELECT id, name, description, script_path, default_params, created_at, updated_at
	        FROM automations ORDER BY name`

	rows, err := r.db.Query(ctx, sql)
	if err != nil {
		return nil, fmt.Errorf("erro ao buscar todas as automações: %w", err)
	}

	automations, err := pgx.CollectRows(rows, pgx.RowToStructByPos[models.Automation])
	if err != nil {
		return nil, fmt.Errorf("erro ao processar linhas de automações: %w", err)
	}

	return automations, nil
}

func (r *PostgresAutomationRepository) Update(ctx context.Context, automation *models.Automation) error {
	sql := `UPDATE automations
	        SET name = $1, description = $2, script_path = $3, default_params = $4, updated_at = NOW()
	        WHERE id = $5
	        RETURNING updated_at`

	err := r.db.QueryRow(ctx, sql,
		automation.Name,
		automation.Description,
		automation.ScriptPath,
		automation.DefaultParams,
		automation.ID,
	).Scan(&automation.UpdatedAt)

	if err != nil {
		return fmt.Errorf("erro ao atualizar automação: %w", err)
	}
	return nil
}

func (r *PostgresAutomationRepository) Delete(ctx context.Context, id int) error {
	sql := `DELETE FROM automations WHERE id = $1`

	cmdTag, err := r.db.Exec(ctx, sql, id)
	if err != nil {
		return fmt.Errorf("erro ao deletar automação: %w", err)
	}
	if cmdTag.RowsAffected() == 0 {
		return fmt.Errorf("nenhuma automação encontrada para deletar com ID %d", id)
	}
	return nil
}