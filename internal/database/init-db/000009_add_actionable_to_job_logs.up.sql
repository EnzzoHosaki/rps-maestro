-- Adiciona campo actionable ao job_logs pra que o worker sinalize linhas
-- que demandam intervenção humana (vs. transitórias que ele mesmo está
-- tratando). O painel destaca linhas actionable=true com borda lateral
-- âmbar e ícone, separando "ERROR que o operador precisa atender agora"
-- de "ERROR que vai sumir no próximo retry".
--
-- Campo opcional com default false: workers existentes (incluindo
-- bot-xml-gms) continuam funcionando sem mudança. Backward compatible.
--
-- ⚠ AMBIENTES EXISTENTES — aplicar manualmente antes do deploy do backend:
--
--   docker exec -i maestro_postgres psql -U user -d maestro_db -c "ALTER TABLE job_logs ADD COLUMN IF NOT EXISTS actionable BOOLEAN NOT NULL DEFAULT false;"
--
-- A pasta init-db/ é montada como docker-entrypoint-initdb.d do Postgres,
-- que só executa scripts uma vez (boot inicial com volume vazio). DBs já
-- populados ignoram esta migration — daí o ALTER manual. Zero-downtime:
-- coluna com default false é invisível pro backend antigo, então pode
-- rodar antes do `docker compose up` do backend novo sem janela.
--
-- Refactor futuro (não bloqueia este PR): mover init-db/ pra um runner
-- de migration de verdade (golang-migrate ou similar) que aplica deltas
-- contra DB existente.

ALTER TABLE job_logs
    ADD COLUMN IF NOT EXISTS actionable BOOLEAN NOT NULL DEFAULT false;
