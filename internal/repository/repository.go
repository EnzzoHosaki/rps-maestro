package repository

import (
	"context"
	"time"

	"github.com/EnzzoHosaki/rps-maestro/internal/models"
	"github.com/google/uuid"
)

type UserRepository interface {
	Create(ctx context.Context, user *models.User) error
	GetByID(ctx context.Context, id int) (*models.User, error)
	GetByEmail(ctx context.Context, email string) (*models.User, error)
	GetAll(ctx context.Context, includeInactive bool) ([]models.User, error)
	Update(ctx context.Context, user *models.User) error
	UpdatePassword(ctx context.Context, id int, passwordHash string) error
	SetActive(ctx context.Context, id int, isActive bool) error
	Delete(ctx context.Context, id int) error
}

type AutomationRepository interface {
	Create(ctx context.Context, automation *models.Automation) error
	GetByID(ctx context.Context, id int) (*models.Automation, error)
	GetByName(ctx context.Context, name string) (*models.Automation, error)
	GetAll(ctx context.Context) ([]models.Automation, error)
	Update(ctx context.Context, automation *models.Automation) error
	Delete(ctx context.Context, id int) error
}

type JobRepository interface {
	Create(ctx context.Context, job *models.Job) error
	GetByID(ctx context.Context, id uuid.UUID) (*models.Job, error)
	UpdateStatus(ctx context.Context, id uuid.UUID, status string) error
	SetResult(ctx context.Context, id uuid.UUID, result []byte) error
	SetStarted(ctx context.Context, id uuid.UUID) error
	SetCompleted(ctx context.Context, id uuid.UUID) error
	GetStuckJobs(ctx context.Context, heartbeatTimeout, noHeartbeatTimeout time.Duration) ([]models.Job, error)
	IncrementRetryCount(ctx context.Context, id uuid.UUID) error
	UpdateHeartbeat(ctx context.Context, id uuid.UUID) error
	List(ctx context.Context, filter models.JobListFilter) ([]models.Job, int, error)
	RequestCancellation(ctx context.Context, id uuid.UUID) error
	IsCancellationRequested(ctx context.Context, id uuid.UUID) (bool, error)
	GetMetrics(ctx context.Context, interval string) (*models.JobMetrics, error)
	GetJobsSeries(ctx context.Context, bucket string, buckets int, step string) ([]models.JobsPerHourBucket, error)
	GetAutomationHealth(ctx context.Context, interval string, recentN int) ([]models.AutomationHealth, error)
	GetErrorClassDistribution(ctx context.Context, interval string) ([]models.ErrorClassCount, error)
	GetLastParamsForUser(ctx context.Context, automationID, userID int) ([]byte, error)
}

type JobLogRepository interface {
	Create(ctx context.Context, log *models.JobLog) error
	GetByJobID(ctx context.Context, jobID uuid.UUID) ([]models.JobLog, error)
	ListSince(ctx context.Context, jobID uuid.UUID, lastID int64, limit int) ([]models.JobLog, error)
}

type ScheduleRepository interface {
	Create(ctx context.Context, schedule *models.Schedule) error
	GetByID(ctx context.Context, id int) (*models.Schedule, error)
	GetAllEnabled(ctx context.Context) ([]models.Schedule, error)
	UpdateNextRun(ctx context.Context, id int, nextRun *time.Time) error
	Update(ctx context.Context, schedule *models.Schedule) error
	Delete(ctx context.Context, id int) error
}
