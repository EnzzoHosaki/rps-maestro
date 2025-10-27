// Local: rps-maestro/internal/repository/job_log_repository.go
package repository

import (
	"context"
	"fmt"
	"github.com/EnzzoHosaki/rps-maestro/internal/models"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func (r *PostgresJobLogRepository) Create(ctx context.Context, log *models.JobLog) error {
	sql := `INSERT INTO job_logs (job_id, level, message)
	        VALUES ($1, $2, $3)
	        RETURNING id, timestamp`

	err := r.db.QueryRow(ctx, sql,
		log.JobID,
		log.Level,
		log.Message,
	).Scan(&log.ID, &log.Timestamp)

	if err != nil {
		return fmt.Errorf("erro ao criar log de job: %w", err)
	}
	return nil
}

func (r *PostgresJobLogRepository) GetByJobID(ctx context.Context, jobID uuid.UUID) ([]models.JobLog, error) {
	sql := `SELECT id, job_id, timestamp, level, message
	        FROM job_logs
	        WHERE job_id = $1
	        ORDER BY timestamp ASC`

	rows, err := r.db.Query(ctx, sql, jobID)
	if err != nil {
		return nil, fmt.Errorf("erro ao buscar logs por Job ID: %w", err)
	}

	logs, err := pgx.CollectRows(rows, pgx.RowToStructByPos[models.JobLog])
	if err != nil {
		return nil, fmt.Errorf("erro ao processar linhas de logs: %w", err)
	}

	return logs, nil
}