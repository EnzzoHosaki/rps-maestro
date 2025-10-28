-- Script de inicialização: criar usuário 'user' com permissões necessárias
-- Este script é executado apenas uma vez, na primeira inicialização do PostgreSQL

-- Criar o usuário 'user' com senha
CREATE USER "user" WITH PASSWORD 'password';

-- Conceder permissões ao usuário
ALTER USER "user" CREATEDB;
GRANT CONNECT ON DATABASE maestro_db TO "user";
GRANT USAGE ON SCHEMA public TO "user";
GRANT CREATE ON SCHEMA public TO "user";

-- Se necessário, conceder todas as permissões na tabela
ALTER DEFAULT PRIVILEGES FOR USER postgres IN SCHEMA public GRANT ALL PRIVILEGES ON TABLES TO "user";
ALTER DEFAULT PRIVILEGES FOR USER postgres IN SCHEMA public GRANT ALL PRIVILEGES ON SEQUENCES TO "user";
