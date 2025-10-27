# Rede Docker do Maestro

A rede Docker do Maestro permite a comunicação entre todos os containers do sistema, incluindo:
- Backend do Maestro
- PostgreSQL
- RabbitMQ
- Containers de automações

## Arquitetura de Rede

```
┌─────────────────────────────────────────────────────────┐
│                   maestro-network (bridge)               │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │   Maestro    │  │  PostgreSQL  │  │   RabbitMQ   │  │
│  │   Backend    │  │              │  │              │  │
│  │ :8000        │  │ :5432        │  │ :5672        │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
│         │                  │                 │          │
│         └──────────────────┴─────────────────┘          │
│                            │                            │
│  ┌─────────────────────────┴────────────────────────┐  │
│  │                                                   │  │
│  │  ┌──────────────┐  ┌──────────────┐             │  │
│  │  │ Automation 1 │  │ Automation 2 │  ...        │  │
│  │  │ Container    │  │ Container    │             │  │
│  │  └──────────────┘  └──────────────┘             │  │
│  │                                                   │  │
│  └───────────────────────────────────────────────────┘  │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

## Como Usar

### 1. Iniciar os Serviços Principais

```bash
# Iniciar PostgreSQL, RabbitMQ e Maestro Backend
docker-compose up -d
```

Isso criará a rede `maestro-network` automaticamente.

### 2. Conectar Automações à Rede

#### Opção A: Usando docker-compose.automations.yml

```bash
# Iniciar automações que se conectam à rede do Maestro
docker-compose -f docker-compose.automations.yml up -d
```

#### Opção B: Conectar container individual

```bash
# Conectar um container existente à rede
docker network connect maestro-network <nome-do-container>

# Ou iniciar um novo container já conectado à rede
docker run --network maestro-network \
  -e POSTGRES_HOST=maestro_postgres \
  -e RABBITMQ_HOST=maestro_rabbitmq \
  -e MAESTRO_API_URL=http://maestro_backend:8000 \
  <imagem-da-automacao>
```

## Variáveis de Ambiente para Automações

As automações devem usar as seguintes variáveis de ambiente para se conectar aos serviços:

### PostgreSQL
```env
POSTGRES_HOST=maestro_postgres
POSTGRES_PORT=5432
POSTGRES_USER=user
POSTGRES_PASSWORD=password
POSTGRES_DB=maestro_db
```

### RabbitMQ
```env
RABBITMQ_HOST=maestro_rabbitmq
RABBITMQ_PORT=5672
RABBITMQ_USER=guest
RABBITMQ_PASSWORD=guest
```

### API do Maestro
```env
MAESTRO_API_URL=http://maestro_backend:8000
```

## Exemplo de Automação Python

Veja o exemplo completo em `automations/example/main.py` que demonstra como:
- Conectar ao PostgreSQL
- Conectar ao RabbitMQ
- Fazer requisições à API do Maestro
- Criar logs no banco de dados

## Comandos Úteis

```bash
# Listar redes Docker
docker network ls

# Inspecionar a rede maestro-network
docker network inspect maestro-network

# Ver containers conectados à rede
docker network inspect maestro-network | grep -A 5 "Containers"

# Desconectar um container da rede
docker network disconnect maestro-network <nome-do-container>

# Remover a rede (requer parar todos os containers primeiro)
docker network rm maestro-network
```

## Resolução de Nomes

Dentro da rede `maestro-network`, os containers podem se comunicar usando os seguintes nomes:

- `maestro_postgres` - Banco de dados PostgreSQL
- `maestro_rabbitmq` - Servidor RabbitMQ
- `maestro_backend` - Backend da API do Maestro

Exemplo de conexão em Python:
```python
# Conectar ao PostgreSQL
conn = psycopg2.connect(
    host="maestro_postgres",
    port=5432,
    user="user",
    password="password",
    database="maestro_db"
)

# Conectar ao RabbitMQ
connection = pika.BlockingConnection(
    pika.ConnectionParameters(host="maestro_rabbitmq")
)

# Fazer requisição à API
response = requests.get("http://maestro_backend:8000/api/v1/health")
```

## Segurança

⚠️ **Importante**: As credenciais padrão são para desenvolvimento. Em produção:
1. Use variáveis de ambiente seguras
2. Configure secrets do Docker
3. Use senhas fortes
4. Limite o acesso às portas expostas
5. Configure firewall adequadamente

## Troubleshooting

### Container não consegue se conectar ao PostgreSQL
```bash
# Verificar se o PostgreSQL está rodando
docker ps | grep maestro_postgres

# Verificar logs do PostgreSQL
docker logs maestro_postgres

# Testar conexão de dentro do container
docker exec -it <container-automacao> ping maestro_postgres
```

### Container não consegue se conectar ao RabbitMQ
```bash
# Verificar se o RabbitMQ está rodando
docker ps | grep maestro_rabbitmq

# Verificar logs do RabbitMQ
docker logs maestro_rabbitmq

# Testar conexão
docker exec -it <container-automacao> ping maestro_rabbitmq
```

### Container não está na rede
```bash
# Verificar em qual rede o container está
docker inspect <container-name> | grep -A 10 "Networks"

# Conectar à rede maestro-network
docker network connect maestro-network <container-name>
```
