# 📚 Configuração de Autenticação do PostgreSQL

## 🔐 Credenciais padrão

### Ambiente CI/CD (GitHub Actions)
```yaml
Usuario: postgres
Senha: postgres
Host: localhost
Port: 5432
Database: maestro_db
```

**Por quê?** O PostgreSQL fornece automaticamente o usuário `postgres` como superuser. Não é necessário criar usuários adicionais.

### Ambiente Local (Docker Compose)
```yaml
Usuario: user
Senha: password
Host: postgres
Port: 5432
Database: maestro_db
```

**Nota:** Este usuário é criado automaticamente pelo script `000000_init_users.sql`.

### Ambiente de Produção
Usar credenciais seguras definidas em variáveis de ambiente:
```bash
MAESTRO_DB_USER=<usuario_seguro>
MAESTRO_DB_PASSWORD=<senha_forte>
MAESTRO_DB_HOST=<seu_host_postgres>
```

---

## 🔧 Variáveis de Ambiente

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `MAESTRO_DB_HOST` | `postgres` | Host do PostgreSQL |
| `MAESTRO_DB_PORT` | `5432` | Porta do PostgreSQL |
| `MAESTRO_DB_USER` | `user` | Usuário do banco |
| `MAESTRO_DB_PASSWORD` | `password` | Senha do usuário |
| `MAESTRO_DB_NAME` | `maestro_db` | Nome do banco de dados |

---

## 📝 Scripts de Inicialização

Os scripts em `internal/database/init-db/` são executados **uma única vez** quando o container PostgreSQL é criado:

1. **`000000_init_users.sql`** - Cria usuários adicionais (se necessário)
2. **`000001_create_initial_tables.up.sql`** - Cria tabelas iniciais
3. **`000002_add_queue_name_to_automations.up.sql`** - Migração: adiciona coluna
4. **`000003_add_bot_xml_gms_support.up.sql`** - Migração: adiciona suporte

**⚠️ ATENÇÃO:** Se o container já foi criado, novos scripts **não serão executados**. Para reinicializar:
```bash
docker-compose down -v  # Remove volume de dados
docker-compose up       # Recria tudo
```

---

## 🐛 Troubleshooting

### Erro: "role "root" does not exist"
**Causa:** A aplicação tenta conectar como usuário `root`, mas esse usuário não existe.

**Solução:** Verificar `MAESTRO_DB_USER` e usar:
- CI/CD: `postgres`
- Local: `user` (criado pelo script)

### Erro: "permission denied for schema public"
**Causa:** O usuário não tem permissões na schema.

**Solução:** Executar como postgres:
```sql
ALTER DEFAULT PRIVILEGES FOR USER postgres IN SCHEMA public GRANT ALL PRIVILEGES ON TABLES TO "user";
```

### Banco de dados não existe
**Solução:** Verificar variável `MAESTRO_DB_NAME` ou criar manualmente:
```sql
CREATE DATABASE maestro_db;
```

---

## ✅ Verificar Conexão

```bash
# Local
psql -h localhost -U user -d maestro_db

# CI/CD
psql -h localhost -U postgres -d maestro_db

# Produção
psql -h <host> -U <usuario> -d maestro_db
```

Ao conectar, digite a senha quando solicitado.
