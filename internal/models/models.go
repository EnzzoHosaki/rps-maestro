// Local: rps-maestro/internal/models/models.go
package models

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

type User struct {
	ID           int       `db:"id" json:"id"`
	Name         string    `db:"name" json:"name"`
	Email        string    `db:"email" json:"email"`
	PasswordHash string    `db:"password_hash" json:"-"`
	Role         string    `db:"role" json:"role"`
	IsActive     bool      `db:"is_active" json:"isActive"`
	CreatedAt    time.Time `db:"created_at" json:"createdAt"`
	UpdatedAt    time.Time `db:"updated_at" json:"updatedAt"`
}

type Automation struct {
	ID              int             `db:"id" json:"id"`
	Name            string          `db:"name" json:"name"`
	Description     *string         `db:"description" json:"description,omitempty"`
	ScriptPath      string          `db:"script_path" json:"scriptPath"`
	QueueName       string          `db:"queue_name" json:"queueName"`
	DefaultParams   json.RawMessage `db:"default_params" json:"defaultParams,omitempty"`
	ParameterSchema json.RawMessage `db:"parameter_schema" json:"parameterSchema,omitempty"`
	CreatedAt       time.Time       `db:"created_at" json:"createdAt"`
	UpdatedAt       time.Time       `db:"updated_at" json:"updatedAt"`
}

type Job struct {
	ID                      uuid.UUID       `db:"id" json:"id"`
	AutomationID            int             `db:"automation_id" json:"automationId"`
	UserID                  *int            `db:"user_id" json:"userId,omitempty"`
	Status                  string          `db:"status" json:"status"`
	Parameters              json.RawMessage `db:"parameters" json:"parameters,omitempty"`
	Result                  json.RawMessage `db:"result" json:"result,omitempty"`
	RetryCount              int             `db:"retry_count" json:"retryCount"`
	StartedAt               *time.Time      `db:"started_at" json:"startedAt,omitempty"`
	CompletedAt             *time.Time      `db:"completed_at" json:"completedAt,omitempty"`
	CancellationRequestedAt *time.Time      `db:"cancellation_requested_at" json:"cancellationRequestedAt,omitempty"`
	LastHeartbeatAt         *time.Time      `db:"last_heartbeat_at" json:"lastHeartbeatAt,omitempty"`
	CreatedAt               time.Time       `db:"created_at" json:"createdAt"`
}

// JobMetrics agrega contadores de jobs em janelas de tempo úteis para o dashboard.
type JobMetrics struct {
	Running         int     `json:"running"`
	Pending         int     `json:"pending"`
	CompletedToday  int     `json:"completedToday"`
	FailedLast24h   int     `json:"failedLast24h"`
	CanceledLast24h int     `json:"canceledLast24h"`
	TotalLast24h    int     `json:"totalLast24h"`
	SuccessRate24h  float64 `json:"successRate24h"`
}

// JobsPerHourBucket é o agregado de jobs finalizados em uma hora — usado pelo
// mini-gráfico do dashboard. Sempre vem em séries de 24 buckets contínuos,
// incluindo horas sem jobs (total=0).
type JobsPerHourBucket struct {
	Hour      time.Time `json:"hour"`
	Total     int       `json:"total"`
	Succeeded int       `json:"succeeded"`
	Failed    int       `json:"failed"`
}

// JobListFilter agrega os filtros suportados por JobRepository.List.
type JobListFilter struct {
	Status       *string
	AutomationID *int
	UserID       *int
	Since        *time.Time
	Until        *time.Time
	Limit        int
	Offset       int
}

type JobLog struct {
	ID        int64     `db:"id" json:"id"`
	JobID     uuid.UUID `db:"job_id" json:"jobId"`
	Timestamp time.Time `db:"timestamp" json:"timestamp"`
	Level     string    `db:"level" json:"level"`
	Message   string    `db:"message" json:"message"`
}

type Schedule struct {
	ID             int             `db:"id" json:"id"`
	AutomationID   int             `db:"automation_id" json:"automationId"`
	CronExpression string          `db:"cron_expression" json:"cronExpression"`
	Parameters     json.RawMessage `db:"parameters" json:"parameters,omitempty"`
	NextRunAt      *time.Time      `db:"next_run_at" json:"nextRunAt,omitempty"`
	IsEnabled      bool            `db:"is_enabled" json:"isEnabled"`
	CreatedAt      time.Time       `db:"created_at" json:"createdAt"`
	UpdatedAt      time.Time       `db:"updated_at" json:"updatedAt"`
}
