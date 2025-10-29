-- Migration para adicionar suporte aos novos status e níveis de log do bot-xml-gms

ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_status_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_status_check 
    CHECK (status IN ('pending', 'running', 'completed', 'completed_no_invoices', 'failed', 'canceled'));

ALTER TABLE job_logs DROP CONSTRAINT IF EXISTS job_logs_level_check;
ALTER TABLE job_logs ADD CONSTRAINT job_logs_level_check 
    CHECK (level IN ('DEBUG', 'INFO', 'WARNING', 'WARN', 'ERROR', 'CRITICAL'));
