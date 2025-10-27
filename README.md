# RPS Maestro 🎯

Sistema de orquestração e gerenciamento de automações RPA (Robotic Process Automation) construído em Go, com suporte completo para workers Python.

## 🚀 Características

- **Gerenciamento de Automações**: CRUD completo de automações
- **Sistema de Filas**: Integração com RabbitMQ para distribuição de jobs
- **Execução Assíncrona**: Jobs executados em background por workers
- **Logs em Tempo Real**: Workers reportam logs durante execução
- **API do Worker**: Endpoints HTTP para workers reportarem status e progresso
- **Agendamento**: Suporte para execução agendada via cron expressions
- **Filas Dinâmicas**: Cada automação pode ter sua própria fila RabbitMQ
- **Rastreamento Completo**: Histórico de execução e logs armazenados

## 🏗️ Arquitetura

```
┌─────────────────┐      ┌──────────────┐      ┌─────────────────┐
│   Frontend      │─────>│  Maestro API │─────>│   PostgreSQL    │
│   (Futuro)      │      │  (Go/Gin)    │      │   (Database)    │
└─────────────────┘      └──────────────┘      └─────────────────┘
                                │
                                │ Publica Jobs
                                ▼
                         ┌──────────────┐
                         │  RabbitMQ    │
                         │   (Queue)    │
                         └──────────────┘
                                │
                                │ Consome Jobs
                                ▼
                         ┌──────────────┐
                         │   Workers    │
                         │  (Python)    │◄─── Reporta Status via HTTP
                         └──────────────┘
```

## 📋 Pré-requisitos

- Docker e Docker Compose
- Go 1.23+ (para desenvolvimento local)
- PostgreSQL 15+
- RabbitMQ 3.13+

## 🚀 Início Rápido

### 1. Clone o repositório

```bash
git clone https://github.com/EnzzoHosaki/rps-maestro.git
cd rps-maestro
```

### 2. Configure as variáveis de ambiente

```bash
cp .env.example .env
# Edite .env com suas configurações
```

### 3. Suba os serviços

```bash
docker-compose up -d
```

### 4. Verifique a saúde do sistema

```bash
curl http://localhost:8080/api/v1/health
# Resposta esperada: {"status":"ok"}
```

### 5. Crie sua primeira automação

```bash
curl -X POST http://localhost:8080/api/v1/automations \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Minha Primeira Automação",
    "description": "Descrição da automação",
    "script_path": "/app/automation.py",
    "queue_name": "automation_jobs"
  }'
```

### 6. Execute a automação

```bash
curl -X POST http://localhost:8080/api/v1/automations/1/execute \
  -H "Content-Type: application/json" \
  -d '{
    "parametro1": "valor1",
    "parametro2": "valor2"
  }'
```

## 📚 Documentação

- **[Guia Rápido](docs/QUICK_START.md)** - Primeiros passos
- **[API do Worker](docs/WORKER_API.md)** - Especificação completa dos endpoints
- **[Guia de Integração](docs/INTEGRATION_GUIDE.md)** - Como integrar workers Python
- **[Análise do Projeto](docs/PROJECT_ANALYSIS.md)** - Análise técnica completa
- **[Ajustes Bot XML GMS](docs/BOT_XML_GMS_ADJUSTMENTS.md)** - Integração com bot-xml-gms

## 🔌 API Endpoints

### Automações

- `POST /api/v1/automations` - Criar automação
- `GET /api/v1/automations` - Listar todas
- `GET /api/v1/automations/:id` - Buscar por ID
- `PUT /api/v1/automations/:id` - Atualizar
- `DELETE /api/v1/automations/:id` - Deletar
- `POST /api/v1/automations/:id/execute` - Executar

### Jobs

- `GET /api/v1/jobs/:id` - Buscar job por ID
- `GET /api/v1/jobs/:id/logs` - Buscar logs do job

### API do Worker (Workers Python)

- `POST /api/v1/worker/jobs/:id/start` - Sinalizar início
- `POST /api/v1/worker/jobs/:id/log` - Enviar log
- `POST /api/v1/worker/jobs/:id/finish` - Sinalizar conclusão

### Agendamentos

- `POST /api/v1/schedules` - Criar agendamento
- `GET /api/v1/schedules` - Listar agendamentos ativos
- `GET /api/v1/schedules/:id` - Buscar por ID
- `PUT /api/v1/schedules/:id` - Atualizar
- `DELETE /api/v1/schedules/:id` - Deletar

## 🐍 Integração com Workers Python

### Exemplo Básico

```python
import requests

MAESTRO_URL = "http://maestro_backend:8000/api/v1/worker"

def process_job(job_id, parameters):
    # 1. Sinalizar início
    requests.post(f"{MAESTRO_URL}/jobs/{job_id}/start")
    
    # 2. Enviar logs durante execução
    requests.post(
        f"{MAESTRO_URL}/jobs/{job_id}/log",
        json={"level": "INFO", "message": "Iniciando processamento..."}
    )
    
    try:
        # Sua lógica aqui
        result = execute_automation(parameters)
        
        # 3. Finalizar com sucesso
        requests.post(
            f"{MAESTRO_URL}/jobs/{job_id}/finish",
            json={"status": "completed", "result": result}
        )
    except Exception as e:
        # 3. Finalizar com falha
        requests.post(
            f"{MAESTRO_URL}/jobs/{job_id}/finish",
            json={"status": "failed", "result": {"error": str(e)}}
        )
```

Ver [examples/worker_example.py](examples/worker_example.py) para exemplo completo.

## 🔧 Desenvolvimento

### Rodar localmente (sem Docker)

```bash
# Instalar dependências
go mod download

# Rodar migrations
# (PostgreSQL e RabbitMQ devem estar rodando)

# Iniciar servidor
cd cmd/api
go run main.go
```

### Rodar testes

```bash
go test ./...
```

### Build

```bash
go build -o rps-maestro ./cmd/api
```

## 📊 Status de Jobs

- `pending` - Job criado, aguardando worker
- `running` - Job em execução
- `completed` - Concluído com sucesso
- `completed_no_invoices` - Concluído sem resultados
- `failed` - Falhou durante execução
- `canceled` - Cancelado manualmente

## 📝 Níveis de Log

- `DEBUG` - Informações detalhadas para debugging
- `INFO` - Informações normais de progresso
- `WARNING` / `WARN` - Avisos
- `ERROR` - Erros recuperáveis
- `CRITICAL` - Erros críticos

## 🗂️ Estrutura do Projeto

```
rps-maestro/
├── cmd/
│   └── api/
│       └── main.go              # Entry point da aplicação
├── configs/
│   └── config.yaml              # Configurações
├── internal/
│   ├── api/
│   │   ├── server.go            # Servidor HTTP
│   │   └── handlers/            # Handlers das rotas
│   │       ├── automation_handler.go
│   │       ├── job_handler.go
│   │       ├── schedule_handler.go
│   │       └── worker_handler.go
│   ├── config/
│   │   └── config.go            # Carregamento de config
│   ├── database/
│   │   └── migrations/          # SQL migrations
│   ├── models/
│   │   └── models.go            # Modelos de dados
│   ├── queue/
│   │   └── rabbitmq.go          # Cliente RabbitMQ
│   └── repository/
│       └── *.go                 # Repositories (DAO)
├── docs/                        # Documentação
├── examples/                    # Exemplos
│   ├── worker_example.py        # Worker Python completo
│   └── requirements.txt         # Dependências Python
├── scripts/
│   └── test_worker_api.sh       # Script de testes
├── docker-compose.yml           # Docker compose principal
├── docker-compose.automations.yml  # Docker compose para workers
├── Dockerfile                   # Build do Maestro
└── go.mod                       # Dependências Go
```

## 🐳 Docker Services

### Maestro Stack (docker-compose.yml)

- **postgres** - Banco de dados PostgreSQL (porta 5432)
- **rabbitmq** - Message broker (portas 5672, 15672)
- **maestro-backend** - API Go (porta 8080)

### Workers (docker-compose.automations.yml)

- **gms-xml-worker** - Exemplo de worker Python
- (Adicione seus workers aqui)

## 🔐 Segurança

⚠️ **IMPORTANTE**: Os endpoints da API do Worker não estão protegidos por autenticação.

Para produção, recomenda-se:
- Implementar API Key authentication
- Usar HTTPS
- Restringir acesso por IP
- Rate limiting

## 🤝 Contribuindo

1. Fork o projeto
2. Crie uma branch para sua feature (`git checkout -b feature/MinhaFeature`)
3. Commit suas mudanças (`git commit -m 'Adiciona MinhaFeature'`)
4. Push para a branch (`git push origin feature/MinhaFeature`)
5. Abra um Pull Request

## 📄 Licença

Este projeto está sob a licença MIT. Ver arquivo `LICENSE` para mais detalhes.

## 👥 Autores

- **Enzzo Maciel** - [EnzzoHosaki](https://github.com/EnzzoHosaki)

## 🙏 Agradecimentos

- Gin Web Framework
- PostgreSQL
- RabbitMQ
- Docker

## 📞 Suporte

Para questões e suporte:
- Abra uma [issue](https://github.com/EnzzoHosaki/rps-maestro/issues)
- Consulte a [documentação](docs/)

---

**Feito com ❤️ em Go**
