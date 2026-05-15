package repository

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/EnzzoHosaki/rps-maestro/internal/models"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// jobSelectColumns mantém a ordem de colunas alinhada com o struct models.Job.
// Qualquer SELECT que use pgx.RowToStructByPos[models.Job] precisa usar esta
// ordem exata.
const jobSelectColumns = `id, automation_id, user_id, status, parameters, result,
	retry_count, started_at, completed_at, cancellation_requested_at, last_heartbeat_at, created_at`

func (r *PostgresJobRepository) Create(ctx context.Context, job *models.Job) error {
	sql := `INSERT INTO jobs (automation_id, user_id, status, parameters)
	        VALUES ($1, $2, $3, $4)
	        RETURNING id, created_at`

	err := r.db.QueryRow(ctx, sql,
		job.AutomationID, job.UserID, job.Status, job.Parameters,
	).Scan(&job.ID, &job.CreatedAt)
	if err != nil {
		return fmt.Errorf("erro ao criar job: %w", err)
	}
	return nil
}

func (r *PostgresJobRepository) GetByID(ctx context.Context, id uuid.UUID) (*models.Job, error) {
	sql := `SELECT ` + jobSelectColumns + ` FROM jobs WHERE id = $1`

	j := &models.Job{}
	err := r.db.QueryRow(ctx, sql, id).Scan(
		&j.ID, &j.AutomationID, &j.UserID, &j.Status,
		&j.Parameters, &j.Result, &j.RetryCount,
		&j.StartedAt, &j.CompletedAt, &j.CancellationRequestedAt, &j.LastHeartbeatAt, &j.CreatedAt,
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
		return fmt.Errorf("nenhum job encontrado com ID %s", id)
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
		return fmt.Errorf("nenhum job encontrado com ID %s", id)
	}
	return nil
}

func (r *PostgresJobRepository) SetStarted(ctx context.Context, id uuid.UUID) error {
	// last_heartbeat_at também é setado aqui pra o retry worker não considerar
	// o job stuck no primeiro tick antes do worker ter chance de polar.
	//
	// cancellation_requested_at é zerado pra cada tentativa começar limpa:
	// um cancelamento solicitado na tentativa N não deve abortar
	// instantaneamente a tentativa N+1 (retry manual ou re-enqueue do retry
	// worker). Se o usuário quiser cancelar de novo, basta clicar Cancelar
	// outra vez — o flag volta a ser setado e o watcher pega no próximo poll.
	sql := `UPDATE jobs
	        SET started_at = NOW(),
	            last_heartbeat_at = NOW(),
	            status = 'running',
	            cancellation_requested_at = NULL
	        WHERE id = $1`
	cmdTag, err := r.db.Exec(ctx, sql, id)
	if err != nil {
		return fmt.Errorf("erro ao marcar job como iniciado: %w", err)
	}
	if cmdTag.RowsAffected() == 0 {
		return fmt.Errorf("nenhum job encontrado com ID %s", id)
	}
	return nil
}

// UpdateHeartbeat marca o instante atual em last_heartbeat_at. Chamado como
// side effect do GET /worker/jobs/:id/cancellation — cada poll do worker é
// também um sinal de vida.
func (r *PostgresJobRepository) UpdateHeartbeat(ctx context.Context, id uuid.UUID) error {
	sql := `UPDATE jobs SET last_heartbeat_at = NOW() WHERE id = $1 AND status = 'running'`
	if _, err := r.db.Exec(ctx, sql, id); err != nil {
		return fmt.Errorf("erro ao atualizar heartbeat: %w", err)
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
		return fmt.Errorf("nenhum job encontrado com ID %s", id)
	}
	return nil
}

// GetStuckJobs retorna jobs em status "running" cujo worker provavelmente
// morreu, usando dois timeouts:
//
//   - heartbeatTimeout: aplicado a jobs com last_heartbeat_at populado.
//     Workers modernos polam GET /worker/jobs/:id/cancellation e atualizam
//     esse campo a cada poll; perder esse sinal por mais que heartbeatTimeout
//     significa worker morto. Threshold curto (~5min) → recuperação rápida.
//
//   - noHeartbeatTimeout: fallback pra jobs com last_heartbeat_at NULL
//     (workers antigos que ainda não fazem o poll). Threshold longo (~2h)
//     pra não falsificar jobs legítimos de duração média.
//
// Quando todos os workers migrarem pro polling, noHeartbeatTimeout pode ser
// retirado e o threshold fica apenas em heartbeatTimeout.
func (r *PostgresJobRepository) GetStuckJobs(ctx context.Context, heartbeatTimeout, noHeartbeatTimeout time.Duration) ([]models.Job, error) {
	sql := `SELECT ` + jobSelectColumns + `
	        FROM jobs
	        WHERE status = 'running'
	          AND (
	              (last_heartbeat_at IS NOT NULL AND last_heartbeat_at < NOW() - $1::interval)
	              OR
	              (last_heartbeat_at IS NULL AND started_at < NOW() - $2::interval)
	          )`

	rows, err := r.db.Query(ctx, sql, heartbeatTimeout.String(), noHeartbeatTimeout.String())
	if err != nil {
		return nil, fmt.Errorf("erro ao buscar stuck jobs: %w", err)
	}

	jobs, err := pgx.CollectRows(rows, pgx.RowToStructByPos[models.Job])
	if err != nil {
		return nil, fmt.Errorf("erro ao processar stuck jobs: %w", err)
	}
	return jobs, nil
}

// IncrementRetryCount incrementa o contador de tentativas de um job.
func (r *PostgresJobRepository) IncrementRetryCount(ctx context.Context, id uuid.UUID) error {
	sql := `UPDATE jobs SET retry_count = retry_count + 1 WHERE id = $1`
	cmdTag, err := r.db.Exec(ctx, sql, id)
	if err != nil {
		return fmt.Errorf("erro ao incrementar retry_count: %w", err)
	}
	if cmdTag.RowsAffected() == 0 {
		return fmt.Errorf("nenhum job encontrado com ID %s", id)
	}
	return nil
}

// List retorna jobs paginados aplicando os filtros opcionais. Retorna também o
// total (sem aplicar limit/offset) pra UI poder paginar.
func (r *PostgresJobRepository) List(ctx context.Context, filter models.JobListFilter) ([]models.Job, int, error) {
	conditions := []string{}
	args := []any{}
	argIdx := 1

	if filter.Status != nil && *filter.Status != "" {
		conditions = append(conditions, fmt.Sprintf("status = $%d", argIdx))
		args = append(args, *filter.Status)
		argIdx++
	}
	if filter.AutomationID != nil {
		conditions = append(conditions, fmt.Sprintf("automation_id = $%d", argIdx))
		args = append(args, *filter.AutomationID)
		argIdx++
	}
	if filter.UserID != nil {
		conditions = append(conditions, fmt.Sprintf("user_id = $%d", argIdx))
		args = append(args, *filter.UserID)
		argIdx++
	}
	if filter.Since != nil {
		conditions = append(conditions, fmt.Sprintf("created_at >= $%d", argIdx))
		args = append(args, *filter.Since)
		argIdx++
	}
	if filter.Until != nil {
		conditions = append(conditions, fmt.Sprintf("created_at <= $%d", argIdx))
		args = append(args, *filter.Until)
		argIdx++
	}

	where := ""
	if len(conditions) > 0 {
		where = "WHERE " + strings.Join(conditions, " AND ")
	}

	limit := filter.Limit
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	offset := filter.Offset
	if offset < 0 {
		offset = 0
	}

	// Total (sem paginação) para a UI saber quantas páginas existem.
	countSQL := "SELECT COUNT(*) FROM jobs " + where
	var total int
	if err := r.db.QueryRow(ctx, countSQL, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("erro ao contar jobs: %w", err)
	}

	listSQL := fmt.Sprintf(
		"SELECT %s FROM jobs %s ORDER BY created_at DESC LIMIT $%d OFFSET $%d",
		jobSelectColumns, where, argIdx, argIdx+1,
	)
	args = append(args, limit, offset)

	rows, err := r.db.Query(ctx, listSQL, args...)
	if err != nil {
		return nil, 0, fmt.Errorf("erro ao listar jobs: %w", err)
	}

	jobs, err := pgx.CollectRows(rows, pgx.RowToStructByPos[models.Job])
	if err != nil {
		return nil, 0, fmt.Errorf("erro ao processar lista de jobs: %w", err)
	}
	return jobs, total, nil
}

// RequestCancellation marca cancellation_requested_at e, se o job ainda estiver
// em pending, já move pra status='canceled' (não vai sair da fila pra worker).
// Para jobs em running, só sinaliza — o worker decide quando parar.
func (r *PostgresJobRepository) RequestCancellation(ctx context.Context, id uuid.UUID) error {
	sql := `
		UPDATE jobs
		SET cancellation_requested_at = NOW(),
		    status = CASE
		        WHEN status = 'pending' THEN 'canceled'
		        ELSE status
		    END,
		    completed_at = CASE
		        WHEN status = 'pending' THEN NOW()
		        ELSE completed_at
		    END
		WHERE id = $1
		  AND status IN ('pending', 'running')
	`
	cmdTag, err := r.db.Exec(ctx, sql, id)
	if err != nil {
		return fmt.Errorf("erro ao solicitar cancelamento: %w", err)
	}
	if cmdTag.RowsAffected() == 0 {
		return fmt.Errorf("job não encontrado ou já finalizado")
	}
	return nil
}

// IsCancellationRequested informa ao worker se o usuário pediu cancelamento.
func (r *PostgresJobRepository) IsCancellationRequested(ctx context.Context, id uuid.UUID) (bool, error) {
	sql := `SELECT cancellation_requested_at IS NOT NULL FROM jobs WHERE id = $1`
	var requested bool
	if err := r.db.QueryRow(ctx, sql, id).Scan(&requested); err != nil {
		return false, fmt.Errorf("erro ao consultar cancelamento: %w", err)
	}
	return requested, nil
}

// GetLastParamsForUser retorna os parâmetros do job mais recente que o usuário
// executou para essa automação. Retorna (nil, nil) se o usuário nunca executou
// — assim o handler pode devolver `parameters: null` sem precisar de 404.
func (r *PostgresJobRepository) GetLastParamsForUser(ctx context.Context, automationID, userID int) ([]byte, error) {
	sql := `SELECT parameters FROM jobs
	        WHERE automation_id = $1 AND user_id = $2
	        ORDER BY created_at DESC
	        LIMIT 1`

	var params []byte
	err := r.db.QueryRow(ctx, sql, automationID, userID).Scan(&params)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("erro ao buscar últimos parâmetros: %w", err)
	}
	return params, nil
}

// GetMetrics consulta agregados úteis para o dashboard em uma única query.
func (r *PostgresJobRepository) GetMetrics(ctx context.Context) (*models.JobMetrics, error) {
	sql := `
		SELECT
		    COUNT(*) FILTER (WHERE status = 'running')                                      AS running,
		    COUNT(*) FILTER (WHERE status = 'pending')                                      AS pending,
		    COUNT(*) FILTER (
		        WHERE status IN ('completed', 'completed_no_invoices')
		          AND completed_at >= date_trunc('day', NOW())
		    )                                                                               AS completed_today,
		    COUNT(*) FILTER (WHERE status = 'failed'   AND completed_at >= NOW() - INTERVAL '24 hours') AS failed_24h,
		    COUNT(*) FILTER (WHERE status = 'canceled' AND completed_at >= NOW() - INTERVAL '24 hours') AS canceled_24h,
		    COUNT(*) FILTER (
		        WHERE status IN ('completed', 'completed_no_invoices', 'failed', 'canceled')
		          AND completed_at >= NOW() - INTERVAL '24 hours'
		    )                                                                               AS finished_24h,
		    COUNT(*) FILTER (
		        WHERE status IN ('completed', 'completed_no_invoices')
		          AND completed_at >= NOW() - INTERVAL '24 hours'
		    )                                                                               AS succeeded_24h
		FROM jobs
	`

	var (
		running, pending                                   int
		completedToday                                     int
		failed24h, canceled24h, finished24h, succeeded24h int
	)
	err := r.db.QueryRow(ctx, sql).Scan(
		&running, &pending,
		&completedToday,
		&failed24h, &canceled24h, &finished24h, &succeeded24h,
	)
	if err != nil {
		return nil, fmt.Errorf("erro ao calcular métricas: %w", err)
	}

	rate := 0.0
	if finished24h > 0 {
		rate = float64(succeeded24h) / float64(finished24h)
	}

	return &models.JobMetrics{
		Running:         running,
		Pending:         pending,
		CompletedToday:  completedToday,
		FailedLast24h:   failed24h,
		CanceledLast24h: canceled24h,
		TotalLast24h:    finished24h,
		SuccessRate24h:  rate,
	}, nil
}
