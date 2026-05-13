-- Adiciona heartbeat de worker pra detecção precisa de jobs travados.
--
-- O retry worker antes usava started_at < NOW() - 30min como sinal de "stuck",
-- o que marcava como failed jobs legítimos de longa duração (ex: bot-xml-gms
-- com ~45min). Agora o sinal vem do worker: cada GET /worker/jobs/:id/cancellation
-- atualiza last_heartbeat_at como side effect, e o retry worker olha pra esse
-- timestamp ao invés do started_at original.
--
-- Workers que ainda não fazem o polling de cancelamento ficam com NULL e caem
-- num fallback de timeout mais longo (ver GetStuckJobs).

ALTER TABLE jobs
    ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMPTZ;

-- Índice parcial usado pelo retry worker pra escanear apenas jobs em running.
CREATE INDEX IF NOT EXISTS idx_jobs_running_heartbeat
    ON jobs(last_heartbeat_at)
    WHERE status = 'running';
