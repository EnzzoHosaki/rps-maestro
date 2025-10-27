// Local: rps-maestro/internal/repository/schedule_repository.go
package repository

import (
	"context"
	"fmt"
	"time"
	"github.com/EnzzoHosaki/rps-maestro/internal/models"
	"github.com/jackc/pgx/v5"
)

func (r *PostgresScheduleRepository) Create(ctx context.Context, schedule *models.Schedule) error {
	sql := `INSERT INTO schedules (automation_id, cron_expression, parameters, next_run_at, is_enabled)
	        VALUES ($1, $2, $3, $4, $5)
	        RETURNING id, created_at, updated_at`

	err := r.db.QueryRow(ctx, sql,
		schedule.AutomationID,
		schedule.CronExpression,
		schedule.Parameters,
		schedule.NextRunAt,
		schedule.IsEnabled,
	).Scan(&schedule.ID, &schedule.CreatedAt, &schedule.UpdatedAt)

	if err != nil {
		return fmt.Errorf("erro ao criar agendamento: %w", err)
	}
	return nil
}

func (r *PostgresScheduleRepository) GetByID(ctx context.Context, id int) (*models.Schedule, error) {
	sql := `SELECT id, automation_id, cron_expression, parameters, next_run_at, 
	               is_enabled, created_at, updated_at
	        FROM schedules WHERE id = $1`

	s := &models.Schedule{}
	err := r.db.QueryRow(ctx, sql, id).Scan(
		&s.ID,
		&s.AutomationID,
		&s.CronExpression,
		&s.Parameters,
		&s.NextRunAt,
		&s.IsEnabled,
		&s.CreatedAt,
		&s.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("erro ao buscar agendamento por ID: %w", err)
	}
	return s, nil
}

func (r *PostgresScheduleRepository) GetAllEnabled(ctx context.Context) ([]models.Schedule, error) {
	sql := `SELECT id, automation_id, cron_expression, parameters, next_run_at, 
	               is_enabled, created_at, updated_at
	        FROM schedules
	        WHERE is_enabled = TRUE
	        ORDER BY next_run_at`

	rows, err := r.db.Query(ctx, sql)
	if err != nil {
		return nil, fmt.Errorf("erro ao buscar todos os agendamentos ativos: %w", err)
	}

	schedules, err := pgx.CollectRows(rows, pgx.RowToStructByPos[models.Schedule])
	if err != nil {
		return nil, fmt.Errorf("erro ao processar linhas de agendamentos: %w", err)
	}

	return schedules, nil
}

func (r *PostgresScheduleRepository) UpdateNextRun(ctx context.Context, id int, nextRun *time.Time) error {
	sql := `UPDATE schedules SET next_run_at = $1, updated_at = NOW() WHERE id = $2`

	cmdTag, err := r.db.Exec(ctx, sql, nextRun, id)
	if err != nil {
		return fmt.Errorf("erro ao atualizar próxima execução do agendamento: %w", err)
	}
	if cmdTag.RowsAffected() == 0 {
		return fmt.Errorf("nenhum agendamento encontrado para atualizar com ID %d", id)
	}
	return nil
}

func (r *PostgresScheduleRepository) Update(ctx context.Context, schedule *models.Schedule) error {
	sql := `UPDATE schedules
	        SET automation_id = $1, cron_expression = $2, parameters = $3, 
	            next_run_at = $4, is_enabled = $5, updated_at = NOW()
	        WHERE id = $6
	        RETURNING updated_at`

	err := r.db.QueryRow(ctx, sql,
		schedule.AutomationID,
		schedule.CronExpression,
		schedule.Parameters,
		schedule.NextRunAt,
		schedule.IsEnabled,
		schedule.ID,
	).Scan(&schedule.UpdatedAt)

	if err != nil {
		return fmt.Errorf("erro ao atualizar agendamento: %w", err)
	}
	return nil
}

func (r *PostgresScheduleRepository) Delete(ctx context.Context, id int) error {
	sql := `DELETE FROM schedules WHERE id = $1`

	cmdTag, err := r.db.Exec(ctx, sql, id)
	if err != nil {
		return fmt.Errorf("erro ao deletar agendamento: %w", err)
	}
	if cmdTag.RowsAffected() == 0 {
		return fmt.Errorf("nenhum agendamento encontrado para deletar com ID %d", id)
	}
	return nil
}