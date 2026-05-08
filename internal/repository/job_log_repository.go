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

// ListSince retorna logs de um job com id estritamente maior que lastID.
// Usado pelo SSE em /jobs/:id/logs/stream pra fazer polling incremental sem
// reler o histórico inteiro a cada iteração. Limit protege o servidor de
// dumps acidentais (ex.: cliente chega com lastID=0 num job longo).
func (r *PostgresJobLogRepository) ListSince(ctx context.Context, jobID uuid.UUID, lastID int64, limit int) ([]models.JobLog, error) {
	if limit <= 0 || limit > 1000 {
		limit = 500
	}

	sql := `SELECT id, job_id, timestamp, level, message
	        FROM job_logs
	        WHERE job_id = $1 AND id > $2
	        ORDER BY id ASC
	        LIMIT $3`

	rows, err := r.db.Query(ctx, sql, jobID, lastID, limit)
	if err != nil {
		return nil, fmt.Errorf("erro ao buscar logs incrementalmente: %w", err)
	}

	logs, err := pgx.CollectRows(rows, pgx.RowToStructByPos[models.JobLog])
	if err != nil {
		return nil, fmt.Errorf("erro ao processar logs incrementais: %w", err)
	}

	return logs, nil
}