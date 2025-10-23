// Local: rps-maestro/internal/repository/repository.go
package repository

import (
	"context"
	"github.com/EnzzoHosaki/rps-maestro/internal/models" 
	"github.com/google/uuid"
	"time"
)

type UserRepository interface {
	Create(ctx context.Context, user *models.User) error
	GetByID(ctx context.Context, id int) (*models.User, error)
	GetByEmail(ctx context.Context, email string) (*models.User, error)
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
}

type JobLogRepository interface {
	Create(ctx context.Context, log *models.JobLog) error
	GetByJobID(ctx context.Context, jobID uuid.UUID) ([]models.JobLog, error)
}

type ScheduleRepository interface {
	Create(ctx context.Context, schedule *models.Schedule) error
	GetByID(ctx context.Context, id int) (*models.Schedule, error)
	GetAllEnabled(ctx context.Context) ([]models.Schedule, error)
	UpdateNextRun(ctx context.Context, id int, nextRun *time.Time) error
	Update(ctx context.Context, schedule *models.Schedule) error
	Delete(ctx context.Context, id int) error
}