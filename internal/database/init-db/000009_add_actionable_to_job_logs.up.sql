-- Adiciona campo actionable ao job_logs pra que o worker sinalize linhas
-- que demandam intervenção humana (vs. transitórias que ele mesmo está
-- tratando). O painel destaca linhas actionable=true com borda lateral
-- âmbar e ícone, separando "ERROR que o operador precisa atender agora"
-- de "ERROR que vai sumir no próximo retry".
--
-- Campo opcional com default false: workers existentes (incluindo
-- bot-xml-gms) continuam funcionando sem mudança. Backward compatible.

ALTER TABLE job_logs
    ADD COLUMN IF NOT EXISTS actionable BOOLEAN NOT NULL DEFAULT false;
