-- Rollback da migration 000003

-- Reverter para status originais
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_status_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_status_check 
    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'canceled'));

-- Reverter para níveis de log originais
ALTER TABLE job_logs DROP CONSTRAINT IF EXISTS job_logs_level_check;
ALTER TABLE job_logs ADD CONSTRAINT job_logs_level_check 
    CHECK (level IN ('INFO', 'WARN', 'ERROR', 'DEBUG'));
