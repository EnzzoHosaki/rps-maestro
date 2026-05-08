-- Adiciona suporte a cancelamento cooperativo de jobs.
-- O usuário marca cancellation_requested_at via POST /jobs/:id/cancel.
-- O worker faz poll em GET /worker/jobs/:id/cancellation e respeita.
-- O status 'canceled' já é permitido pela constraint criada em 000003.

ALTER TABLE jobs
    ADD COLUMN IF NOT EXISTS cancellation_requested_at TIMESTAMPTZ;

-- Índice composto pra listagem eficiente por (status, created_at DESC) — usado
-- na rota GET /jobs com filtros e paginação.
CREATE INDEX IF NOT EXISTS idx_jobs_status_created_at
    ON jobs(status, created_at DESC);

-- Índice em automation_id pra filtros por automação.
CREATE INDEX IF NOT EXISTS idx_jobs_automation_id
    ON jobs(automation_id);
