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

// dashboardTZ é o fuso usado pra cortar buckets de DIA nas agregações do
// dashboard (date_trunc de 3 args, PG14+). Sem ele o corte sai em dia UTC e
// jobs finalizados entre 21h e 00h BRT aparecem no "dia seguinte" do gráfico
// (e o completedToday vira "hoje em UTC", rolando às 21h locais). Sistema é
// on-prem single-tenant da RPS (Brasil), então uma constante basta.
const dashboardTZ = "America/Sao_Paulo"

// GetMetrics consulta agregados úteis para o dashboard em uma única query.
// `interval` é uma string de intervalo do Postgres ("24 hours", "7 days",
// "30 days") vinda de uma whitelist no handler — nunca de input direto do
// usuário. Os campos *Last24h do modelo mantêm o nome por compatibilidade de
// JSON, mas refletem o intervalo pedido. running/pending/completedToday são
// independentes do intervalo (snapshot atual / dia corrente em dashboardTZ).
func (r *PostgresJobRepository) GetMetrics(ctx context.Context, interval string) (*models.JobMetrics, error) {
	sql := `
		SELECT
		    COUNT(*) FILTER (WHERE status = 'running')                                      AS running,
		    COUNT(*) FILTER (WHERE status = 'pending')                                      AS pending,
		    COUNT(*) FILTER (
		        WHERE status IN ('completed', 'completed_no_invoices')
		          AND completed_at >= date_trunc('day', NOW(), $2)
		    )                                                                               AS completed_today,
		    COUNT(*) FILTER (WHERE status = 'failed'   AND completed_at >= NOW() - $1::interval) AS failed_period,
		    COUNT(*) FILTER (WHERE status = 'canceled' AND completed_at >= NOW() - $1::interval) AS canceled_period,
		    COUNT(*) FILTER (
		        WHERE status IN ('completed', 'completed_no_invoices', 'failed', 'canceled')
		          AND completed_at >= NOW() - $1::interval
		    )                                                                               AS finished_period,
		    COUNT(*) FILTER (
		        WHERE status IN ('completed', 'completed_no_invoices')
		          AND completed_at >= NOW() - $1::interval
		    )                                                                               AS succeeded_period
		FROM jobs
	`

	var (
		running, pending                                   int
		completedToday                                     int
		failed24h, canceled24h, finished24h, succeeded24h int
	)
	err := r.db.QueryRow(ctx, sql, interval, dashboardTZ).Scan(
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

// GetJobsSeries retorna `buckets` buckets contínuos terminando agora
// (incluindo buckets sem jobs, com counts zerados). Bucket por completed_at
// pra evitar contar jobs que ainda não terminaram.
//
// `bucket` é a unidade do date_trunc ("hour"/"day") e `step` o passo do
// generate_series ("1 hour"/"1 day") — ambos vêm de whitelist no handler,
// nunca de input direto do usuário. 24h→24×hour, 7d→7×day, 30d→30×day.
// Buckets cortados em dashboardTZ (dias = dia local, não dia UTC; pra hora
// não muda nada, BRT é offset inteiro).
func (r *PostgresJobRepository) GetJobsSeries(ctx context.Context, bucket string, buckets int, step string) ([]models.JobsPerHourBucket, error) {
	sql := `
		SELECT
		    h.bucket,
		    COUNT(j.id) FILTER (
		        WHERE j.status IN ('completed', 'completed_no_invoices', 'failed', 'canceled')
		    ) AS total,
		    COUNT(j.id) FILTER (
		        WHERE j.status IN ('completed', 'completed_no_invoices')
		    ) AS succeeded,
		    COUNT(j.id) FILTER (WHERE j.status = 'failed') AS failed
		FROM generate_series(
		    date_trunc($1, NOW(), $4) - ($2::int - 1) * $3::interval,
		    date_trunc($1, NOW(), $4),
		    $3::interval
		) AS h(bucket)
		LEFT JOIN jobs j ON date_trunc($1, j.completed_at, $4) = h.bucket
		GROUP BY h.bucket
		ORDER BY h.bucket
	`

	rows, err := r.db.Query(ctx, sql, bucket, buckets, step, dashboardTZ)
	if err != nil {
		return nil, fmt.Errorf("erro ao agregar série de jobs: %w", err)
	}
	defer rows.Close()

	out := make([]models.JobsPerHourBucket, 0, buckets)
	for rows.Next() {
		var b models.JobsPerHourBucket
		if err := rows.Scan(&b.Hour, &b.Total, &b.Succeeded, &b.Failed); err != nil {
			return nil, fmt.Errorf("erro ao escanear bucket: %w", err)
		}
		out = append(out, b)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("erro ao iterar buckets: %w", err)
	}

	return out, nil
}

// GetAutomationHealth agrega saúde por automação no período `interval` (string
// de intervalo do Postgres vinda de whitelist no handler). Faz duas queries —
// uma de agregação por automação no período, outra dos últimos `recentN` status
// (all-time) — e mescla em Go por automation_id. LEFT JOIN preserva automações
// sem jobs no período (vêm zeradas).
func (r *PostgresJobRepository) GetAutomationHealth(ctx context.Context, interval string, recentN int) ([]models.AutomationHealth, error) {
	const finished = "('completed','completed_no_invoices','failed','canceled')"

	aggSQL := `
		SELECT
		    a.id, a.name,
		    COUNT(j.id)                                                          AS total,
		    COUNT(j.id) FILTER (WHERE j.status IN ('completed','completed_no_invoices')) AS succeeded,
		    COUNT(j.id) FILTER (WHERE j.status = 'failed')                       AS failed,
		    COUNT(j.id) FILTER (WHERE j.status = 'canceled')                     AS canceled,
		    COUNT(j.id) FILTER (WHERE j.user_id IS NOT NULL)                     AS manual,
		    COUNT(j.id) FILTER (WHERE j.user_id IS NULL)                         AS scheduled,
		    percentile_cont(0.5) WITHIN GROUP (
		        ORDER BY EXTRACT(EPOCH FROM (j.completed_at - j.started_at))
		    ) FILTER (WHERE j.started_at IS NOT NULL)                            AS p50,
		    percentile_cont(0.95) WITHIN GROUP (
		        ORDER BY EXTRACT(EPOCH FROM (j.completed_at - j.started_at))
		    ) FILTER (WHERE j.started_at IS NOT NULL)                            AS p95
		FROM automations a
		LEFT JOIN jobs j
		    ON j.automation_id = a.id
		   AND j.status IN ` + finished + `
		   AND j.completed_at >= NOW() - $1::interval
		GROUP BY a.id, a.name
		ORDER BY a.name`

	rows, err := r.db.Query(ctx, aggSQL, interval)
	if err != nil {
		return nil, fmt.Errorf("erro ao agregar saúde por automação: %w", err)
	}
	defer rows.Close()

	byID := make(map[int]*models.AutomationHealth)
	out := make([]models.AutomationHealth, 0)
	for rows.Next() {
		var h models.AutomationHealth
		if err := rows.Scan(
			&h.AutomationID, &h.Name, &h.Total, &h.Succeeded, &h.Failed,
			&h.Canceled, &h.Manual, &h.Scheduled, &h.DurationP50S, &h.DurationP95S,
		); err != nil {
			return nil, fmt.Errorf("erro ao escanear saúde por automação: %w", err)
		}
		finishedCount := h.Succeeded + h.Failed + h.Canceled
		if finishedCount > 0 {
			h.SuccessRate = float64(h.Succeeded) / float64(finishedCount)
		}
		h.Recent = []string{}
		out = append(out, h)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("erro ao iterar saúde por automação: %w", err)
	}
	for i := range out {
		byID[out[i].AutomationID] = &out[i]
	}

	// Últimos recentN status por automação (all-time), mais recente primeiro.
	// O primeiro de cada automação também vira LastStatus/LastRunAt.
	recentSQL := `
		SELECT automation_id, status, completed_at
		FROM (
		    SELECT automation_id, status, completed_at,
		           row_number() OVER (PARTITION BY automation_id ORDER BY completed_at DESC) AS rn
		    FROM jobs
		    WHERE completed_at IS NOT NULL AND status IN ` + finished + `
		) t
		WHERE rn <= $1
		ORDER BY automation_id, completed_at DESC`

	rrows, err := r.db.Query(ctx, recentSQL, recentN)
	if err != nil {
		return nil, fmt.Errorf("erro ao buscar runs recentes: %w", err)
	}
	defer rrows.Close()

	for rrows.Next() {
		var aid int
		var status string
		var completedAt time.Time
		if err := rrows.Scan(&aid, &status, &completedAt); err != nil {
			return nil, fmt.Errorf("erro ao escanear run recente: %w", err)
		}
		h := byID[aid]
		if h == nil {
			continue
		}
		if h.LastStatus == nil { // primeiro da automação = mais recente
			s, t := status, completedAt
			h.LastStatus = &s
			h.LastRunAt = &t
		}
		h.Recent = append(h.Recent, status)
	}
	if err := rrows.Err(); err != nil {
		return nil, fmt.Errorf("erro ao iterar runs recentes: %w", err)
	}

	return out, nil
}
