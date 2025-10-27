// Local: rps-maestro/internal/repository/job_repository.go
package repository

import (
	"context"
	"fmt"
	"github.com/EnzzoHosaki/rps-maestro/internal/models"
	"github.com/google/uuid"
)

func (r *PostgresJobRepository) Create(ctx context.Context, job *models.Job) error {
	sql := `INSERT INTO jobs (automation_id, user_id, status, parameters)
	        VALUES ($1, $2, $3, $4)
	        RETURNING id, created_at`

	err := r.db.QueryRow(ctx, sql,
		job.AutomationID,
		job.UserID,
		job.Status,
		job.Parameters,
	).Scan(&job.ID, &job.CreatedAt)

	if err != nil {
		return fmt.Errorf("erro ao criar job: %w", err)
	}
	return nil
}

func (r *PostgresJobRepository) GetByID(ctx context.Context, id uuid.UUID) (*models.Job, error) {
	sql := `SELECT id, automation_id, user_id, status, parameters, result,
	               started_at, completed_at, created_at
	        FROM jobs WHERE id = $1`

	j := &models.Job{}
	err := r.db.QueryRow(ctx, sql, id).Scan(
		&j.ID,
		&j.AutomationID,
		&j.UserID,
		&j.Status,
		&j.Parameters,
		&j.Result,
		&j.StartedAt,
		&j.CompletedAt,
		&j.CreatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("erro ao buscar job por ID: %w", err)
	}
	return j, nil
}

func (r *PostgresJobRepository) UpdateStatus(ctx context.Context, id uuid.UUID, status string) error {
	sql := `UPDATE jobs SET status = $1 WHERE id = $2`
	
	cmdTag, err := r.db.Exec(ctx, sql, status, id)
	if err != nil {
		return fmt.Errorf("erro ao atualizar status do job: %w", err)
	}
	if cmdTag.RowsAffected() == 0 {
		return fmt.Errorf("nenhum job encontrado para atualizar status com ID %s", id)
	}
	return nil
}

func (r *PostgresJobRepository) SetResult(ctx context.Context, id uuid.UUID, result []byte) error {
	sql := `UPDATE jobs SET result = $1 WHERE id = $2`

	cmdTag, err := r.db.Exec(ctx, sql, result, id)
	if err != nil {
		return fmt.Errorf("erro ao definir resultado do job: %w", err)
	}
	if cmdTag.RowsAffected() == 0 {
		return fmt.Errorf("nenhum job encontrado para definir resultado com ID %s", id)
	}
	return nil
}

func (r *PostgresJobRepository) SetStarted(ctx context.Context, id uuid.UUID) error {
	sql := `UPDATE jobs SET started_at = NOW(), status = 'running' WHERE id = $1`
	
	cmdTag, err := r.db.Exec(ctx, sql, id)
	if err != nil {
		return fmt.Errorf("erro ao marcar job como iniciado: %w", err)
	}
	if cmdTag.RowsAffected() == 0 {
		return fmt.Errorf("nenhum job encontrado para iniciar com ID %s", id)
	}
	return nil
}

func (r *PostgresJobRepository) SetCompleted(ctx context.Context, id uuid.UUID) error {
	sql := `UPDATE jobs SET completed_at = NOW() WHERE id = $1`
	
	cmdTag, err := r.db.Exec(ctx, sql, id)
	if err != nil {
		return fmt.Errorf("erro ao marcar job como completado: %w", err)
	}
	if cmdTag.RowsAffected() == 0 {
		return fmt.Errorf("nenhum job encontrado para completar com ID %s", id)
	}
	return nil
}