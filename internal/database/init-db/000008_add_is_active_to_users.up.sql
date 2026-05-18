-- Adiciona soft delete pra users. Em vez de DELETE (perde rastreabilidade
-- via FK user_id em jobs), o admin "desativa" — is_active=false bloqueia
-- login e tira o user da lista por padrão, preservando o histórico de
-- quem disparou cada job.
--
-- Default TRUE garante que todos os users existentes (incluindo o admin
-- semeado) continuam ativos sem intervenção manual.

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
