# Adicionando uma nova automação ao RPS Maestro

Guia de referência para integrar um worker (script Python, .NET, Node, qualquer linguagem) ao RPS Maestro. Cada automação é **uma unidade independente** — seu próprio repositório, sua própria fila no RabbitMQ — e o Maestro só conhece o contrato. Adicionar a 50ª automação tem o mesmo custo que adicionar a 2ª.

> Referência viva: o `bot-xml-gms` é a primeira automação produtiva. Quando algo neste documento estiver dúbio, olhe como ele resolve.

---

## 1. Visão geral da arquitetura

```
┌────────────┐  HTTP   ┌──────────────┐  AMQP   ┌──────────────────┐
│ UI / Cron  │ ──────► │ Maestro API  │ ──────► │ RabbitMQ (queue) │
└────────────┘         │  (Go/Gin)    │         └────────┬─────────┘
                       │  + Postgres  │                  │ consume
                       └──────▲───────┘                  ▼
                              │ POST /worker/jobs/...   ┌──────────────┐
                              └─────────────────────────│   Worker     │
                                                        │  (você)      │
                                                        └──────────────┘
```

**O que o Maestro faz por você:**
- Persiste a definição da automação (nome, fila, schema de parâmetros, defaults)
- Gera UI dinâmica de execução e agendamento (você não escreve formulário nenhum)
- Disponibiliza cron (`/schedules`) que dispara jobs com parâmetros — inclusive com **datas dinâmicas** (`{{yesterday}}` etc.) que ele expande no momento do disparo
- Mantém o estado do job (`pending` → `running` → `completed`/`failed`/`canceled`)
- Coleta logs em tempo real e expõe via SSE pra UI
- Detecta jobs travados (heartbeat) e re-enfileira
- Coordena cancelamento cooperativo

**O que você faz no worker:**
- Consome mensagens da sua fila
- Implementa o ciclo de vida via API de worker (`POST /worker/jobs/:id/start`, `/log`, `/finish`)
- Periodicamente faz polling de cancelamento e usa esse mesmo poll como heartbeat
- Checa idempotência antes de processar (re-delivery do RabbitMQ é normal)
- Reporta o status final correto

---

## 2. Checklist mínimo para uma nova automação

Use isto como roadmap. Detalhes de cada item vêm depois.

- [ ] **Repositório do worker** com Dockerfile e ponto de entrada
- [ ] **Fila do RabbitMQ** decidida (nome único, ex: `automation_xml_gms`)
- [ ] **Cadastro no Maestro** via `POST /automations` (admin) — feito hoje pela UI em `/automations`, "Nova automação"
  - `name` (humano)
  - `scriptPath` (informativo — não é executado pelo Maestro, só registrado)
  - `queueName` (case-sensitive, igual ao que o worker consome)
  - `parameterSchema` (lista de campos — gera o formulário automaticamente)
  - `defaultParams` (opcional — valores aplicados quando o usuário abre Executar e nunca rodou antes)
- [ ] **Worker implementa o contrato** descrito na seção 5
- [ ] **`MAESTRO_WORKER_API_KEY`** configurada no ambiente do worker — é como ele autentica nas rotas `/worker/...`
- [ ] **Polling de cancelamento** periódico durante operações longas (ver seção 6)
- [ ] **Idempotency check** logo ao receber a mensagem (ver seção 5.5)
- [ ] **Container subindo no docker-compose** do Maestro (ou em outro host que consiga falar com o broker e a API)

---

## 3. Definindo a automação no Maestro

Uma `Automation` é só um registro no banco que diz "essa fila + esse schema de input = essa automação". Você cria pela UI em `/automations` ou pela API:

```http
POST /api/v1/automations
Authorization: Bearer <jwt-admin>
Content-Type: application/json

{
  "name": "Download de XMLs (GMS)",
  "description": "Baixa NFe/NFCe do portal GMS",
  "scriptPath": "/app/main.py",
  "queueName": "automation_xml_gms",
  "parameterSchema": [
    {
      "name": "stores",
      "label": "Lojas",
      "type": "list",
      "itemType": "number",
      "required": true,
      "placeholder": "Ex: 4814, 6861, 11118"
    },
    {
      "name": "start_date",
      "label": "Data inicial",
      "type": "date",
      "required": true
    },
    {
      "name": "end_date",
      "label": "Data final",
      "type": "date",
      "required": true
    },
    {
      "name": "tipo",
      "label": "Tipo de documento",
      "type": "select",
      "options": ["nfe", "nfce"],
      "required": true
    },
    {
      "name": "headless",
      "label": "Rodar headless",
      "type": "boolean"
    }
  ],
  "defaultParams": {
    "headless": true,
    "tipo": "nfe"
  }
}
```

### 3.1 Tipos de campo suportados (`parameterSchema[].type`)

| `type`     | Como aparece na UI                              | Valor enviado ao worker |
|------------|--------------------------------------------------|--------------------------|
| `text`     | `<input type="text">`                            | `string`                 |
| `number`   | `<input type="number">`                          | `number`                 |
| `date`     | `<input type="date">` (ISO no UI → BR no payload)| `string` `"dd/MM/yyyy"`  |
| `select`   | `<select>` com `options[]`                       | `string` (um dos values) |
| `boolean`  | `<input type="checkbox">`                        | `bool`                   |
| `list`     | `<textarea>` (separado por vírgula ou newline)   | array (de `text` ou `number` conforme `itemType`) |

Campos opcionais por type:
- `placeholder?: string` — dica de input
- `required?: boolean`
- `options?: string[]` — obrigatório para `select`
- `itemType?: "text" | "number"` — obrigatório para `list`

### 3.2 `defaultParams`

Mapa `nome→valor` aplicado quando o usuário abre "Executar" e **nunca executou essa automação antes**. Tem precedência menor que `lastParams` (última execução do usuário). A cascata na UI é:

```
vazio → defaults (badge "valores padrão") → lastUserParams (badge verde "última execução")
```

---

## 4. Mensagem que chega na fila

O Maestro publica em RabbitMQ uma mensagem JSON no formato:

```json
{
  "job_id": "9e3b1f4c-8b1d-4c2a-9c87-2d4f3e1b9a0d",
  "automation_id": 7,
  "script_path": "/app/main.py",
  "parameters": {
    "stores": [4814, 6861],
    "start_date": "18/05/2026",
    "end_date": "19/05/2026",
    "tipo": "nfe",
    "headless": true
  }
}
```

**O `job_id` é UUID e é a chave de tudo.** Todas as chamadas à API de worker referenciam esse ID.

`parameters` já vem **com datas dinâmicas expandidas**: se o schedule tinha `start_date: "{{yesterday}}"`, o worker recebe `"18/05/2026"` direto. Você não precisa interpretar placeholders.

### Conexão / fila / dead-letter

- Fila declarada com `x-dead-letter-exchange: dead-letter`
- Mensagens são publicadas com `delivery_mode=2` (persistentes)
- Cabe ao worker fazer `basic_ack` após processar **ou** após detectar idempotência
- Se o worker travar e o canal cair (consumer timeout = 4h no broker), a mensagem volta pra fila — daí o cuidado com idempotência (seção 5.5)

---

## 5. Contrato do worker (API HTTP)

Todas as rotas `/api/v1/worker/...` exigem o header:

```
X-Worker-API-Key: <valor da env MAESTRO_WORKER_API_KEY>
```

Base URL: `${MAESTRO_API_URL}/api/v1` (em prod, `http://maestro-backend:8080/api/v1` dentro do docker-compose; expor via `MAESTRO_API_URL` no env do worker).

### 5.1 `POST /worker/jobs/:id/start`

Chame **quando começar a processar** (depois do idempotency check). Marca o job como `running` e dispara o `started_at`.

```http
POST /api/v1/worker/jobs/9e3b1f4c.../start
X-Worker-API-Key: ...
```

Resposta: `200 { "status": "running" }`

### 5.2 `POST /worker/jobs/:id/log`

Stream de logs. Chame **a cada linha** que você quer aparecer no painel SSE. Não bufferize demais — o usuário acompanha em tempo real.

```http
POST /api/v1/worker/jobs/9e3b1f4c.../log
Content-Type: application/json

{ "level": "INFO", "message": "Baixando XML 4 de 320" }
```

Levels válidos: `DEBUG`, `INFO`, `WARNING`, `WARN`, `ERROR`, `CRITICAL`.

### 5.3 `POST /worker/jobs/:id/finish`

Chame **uma única vez no fim**, com o status terminal.

```http
POST /api/v1/worker/jobs/9e3b1f4c.../finish
Content-Type: application/json

{
  "status": "completed",
  "result": { "files_downloaded": 240, "errors": 0 }
}
```

Status válidos:

| Status                    | Quando usar                                                                 |
|---------------------------|------------------------------------------------------------------------------|
| `completed`               | Sucesso total                                                                |
| `completed_no_invoices`   | Sucesso porém sem dados (ex: range de datas sem nota). Métrica trata como ok |
| `failed`                  | Exceção, erro do portal externo, etc.                                        |
| `canceled`                | Você detectou pedido de cancelamento e abortou com graça                     |

`result` é `map[string]any` livre — fica salvo no job e visível no painel.

### 5.4 `GET /worker/jobs/:id/cancellation`

Polling pra cancelamento cooperativo **e** sinal de heartbeat. Chame periodicamente (ver seção 6).

```http
GET /api/v1/worker/jobs/9e3b1f4c.../cancellation
X-Worker-API-Key: ...
```

Resposta: `200 { "cancellation_requested": false }`

Quando vier `true`, **aborte o que está fazendo**, faça cleanup, chame `/finish` com `status: "canceled"` e termine.

### 5.5 `GET /worker/jobs/:id/status` — idempotency check

**Chame isso ANTES de qualquer outra coisa**, logo após receber a mensagem da fila. Cobre o caso de redelivery.

```http
GET /api/v1/worker/jobs/9e3b1f4c.../status
X-Worker-API-Key: ...
```

Resposta:

```json
{
  "status": "running",
  "terminal": false,
  "started_at": "2026-05-19T14:00:00Z",
  "completed_at": null,
  "last_heartbeat_at": "2026-05-19T14:32:18Z",
  "cancellation_requested_at": null,
  "retry_count": 0
}
```

**Lógica do worker:**

```python
status = get_status(job_id)
if status["terminal"]:
    basic_ack()   # job já foi finalizado em outra entrega — descarte
    return
# senão: processe normalmente
```

Sem isso, um redelivery (consumer_timeout estourou, broker reiniciou, etc.) faz o worker repetir 40min de trabalho à toa e ainda sobrescrever o resultado anterior.

---

## 6. Heartbeat e cancelamento cooperativo

São duas features que **dividem o mesmo endpoint** — `/worker/jobs/:id/cancellation`. Cada chamada faz duas coisas:

1. Retorna se houve pedido de cancelamento
2. Atualiza `last_heartbeat_at` no banco (side effect)

**Por que importa:** o retry worker do Maestro detecta jobs travados via heartbeat. Se `last_heartbeat_at` ficar mais de N minutos sem atualizar (default 5min), o job é marcado como `failed` e re-enfileirado. Workers que não fazem polling caem num fallback de timeout mais longo, mas idealmente você implementa o poll.

**Frequência recomendada:** a cada **30 segundos** durante operações longas. Coloque a chamada dentro do loop principal do worker (por exemplo, entre cada loja processada, entre cada página paginada).

**Pseudocódigo:**

```python
last_poll = 0
for store in stores:
    for page in paginate(store):
        baixar_xmls(page)

        if time.time() - last_poll > 30:
            r = maestro.get(f"/worker/jobs/{job_id}/cancellation")
            if r.json()["cancellation_requested"]:
                cleanup()
                maestro.post(f"/worker/jobs/{job_id}/finish", json={"status": "canceled"})
                return
            last_poll = time.time()
```

---

## 7. Datas dinâmicas em agendamentos

Suportado nativamente pelo Maestro — **você não precisa fazer nada no worker**. O scheduler expande placeholders no momento de disparar o job, antes de publicar na fila. O worker recebe data já formatada em `dd/MM/yyyy`.

Tokens disponíveis (usar em qualquer campo de string nos parâmetros do schedule):

| Token                       | Resolve para                                |
|-----------------------------|----------------------------------------------|
| `{{today}}`                 | Hoje                                         |
| `{{yesterday}}`             | Ontem (= `{{today-1}}`)                      |
| `{{tomorrow}}`              | Amanhã (= `{{today+1}}`)                     |
| `{{today-N}}`               | N dias atrás (N inteiro)                     |
| `{{today+N}}`               | N dias à frente                              |
| `{{first_of_month}}`        | 1º dia do mês corrente                       |
| `{{last_of_month}}`         | Último dia do mês corrente                   |
| `{{first_of_last_month}}`   | 1º dia do mês anterior                       |
| `{{last_of_last_month}}`    | Último dia do mês anterior                   |

Combinar é OK: `"{{today-2}} a {{yesterday}}"` vira `"17/05/2026 a 18/05/2026"`. Expansão é recursiva (funciona dentro de arrays e objetos aninhados nos parâmetros). Tokens de mês **não aceitam offset** (`{{first_of_last_month-3}}` não é interpretado — fica literal).

> Caso clássico: agendar "todo dia 1 às 6h" com `start_date: "{{first_of_last_month}}"` e `end_date: "{{last_of_last_month}}"` baixa o mês fechado anterior sem o worker precisar implementar lógica de calendário.

**Na UI**, em campos `date` e `number` (que renderizam input nativo restritivo), clique no botão **fx** ao lado do campo para alternar pra texto livre e digitar o placeholder.

**Importante:** placeholders só são expandidos em **schedules**. Em execução manual (`/automations` → Executar), o valor é literal. Faz sentido — execução manual é "agora, com esses valores", não relativa.

---

## 8. Ciclo de vida de um job

```
            ┌───────────┐
            │  pending  │  ← enfileirado, esperando worker
            └─────┬─────┘
                  │ worker → /start
                  ▼
            ┌───────────┐
            │  running  │  ← worker processando, faz heartbeats
            └─────┬─────┘
                  │ worker → /finish
                  ▼
   ┌──────────────┼──────────────────┬──────────────┐
   ▼              ▼                  ▼              ▼
completed   completed_      failed          canceled
            no_invoices
```

Transições só são feitas pelo worker via API. O Maestro nunca decide "sozinho" mudar de `running` pra `failed` — exceto pelo retry worker que faz isso quando detecta heartbeat morto.

### Retry

Botão **Reexecutar** na UI ou `POST /jobs/:id/retry` cria um **novo job** (novo UUID) com os mesmos parâmetros. O job original mantém seu status. Não é "resume" — é "reroda do zero".

---

## 9. Convenções de logging

- **Use levels semânticos**: `INFO` pra eventos normais, `WARNING` pra anormalidades não-fatais, `ERROR` pra falha que vai te levar a `status=failed`. O painel colore por level.
- **Uma linha = um evento**. Não envie blocos multi-linha — quebra a UX de scroll.
- **Sem dados sensíveis** (senhas, tokens, cookies). Logs são visíveis pra qualquer role com acesso a `/jobs`.
- **Mensagens em português** por padrão (matchea a UI), mas inglês também passa.

---

## 10. Variáveis de ambiente do worker

Mínimo necessário:

| Env                          | Pra que serve                                            |
|-----------------------------|----------------------------------------------------------|
| `MAESTRO_API_URL`           | Base URL da API, ex: `http://maestro-backend:8080/api/v1`|
| `MAESTRO_WORKER_API_KEY`    | Auth nas rotas `/worker/...`                             |
| `RABBITMQ_URL`              | DSN AMQP, ex: `amqp://user:pass@rabbitmq:5672/`          |
| `RABBITMQ_QUEUE`            | Nome da fila que o worker consome                        |

Específicas da automação (credenciais do portal alvo, etc.) ficam a critério do projeto. Mantenha em `.env` separado, não comite.

---

## 11. Desacoplamento e escala

Sobre o medo de "como gerencio 50 automações?":

- **Cada automação é um repositório/container independente.** O Maestro não sabe nada sobre o que ela faz; só sobre o contrato.
- **A UI é 100% gerada do `parameterSchema`.** Adicionar uma automação nunca toca código de frontend.
- **A fila isola completamente.** Workers diferentes em filas diferentes não disputam recursos uns dos outros.
- **Schemas evoluem por edição.** Admin abre `/automations`, edita o schema (ou cola um JSON de exemplo via "Colar JSON" no editor) e os formulários se atualizam instantaneamente.
- **Versionamento:** mudou o contrato de input do worker? Atualize o `parameterSchema` no Maestro e o worker simultaneamente. Como `parameters` é JSON livre, vale a regra geral de compatibilidade: campos novos opcionais não quebram nada; remover ou renomear campos exige migração coordenada.

**Padrão recomendado para uma nova automação:**

```
repos/
├── bot-xml-gms/              # automação 1
│   ├── Dockerfile
│   ├── src/
│   └── README.md             # diz qual queue ela consome e o que espera de parâmetros
├── bot-novo-portal/          # automação 2
│   ├── ...
└── rps-maestro/              # o orquestrador (este repo)
```

O Maestro **não importa** nada dos repos de automação. A integração é via contrato HTTP + AMQP.

---

## 12. Referência rápida — rotas de worker

| Método | Rota                                          | Quando usar                                |
|--------|-----------------------------------------------|---------------------------------------------|
| GET    | `/worker/jobs/:id/status`                     | Antes de processar — idempotency check      |
| POST   | `/worker/jobs/:id/start`                      | Antes de começar o trabalho                 |
| POST   | `/worker/jobs/:id/log`                        | Cada linha de log                           |
| GET    | `/worker/jobs/:id/cancellation`               | A cada ~30s durante operações longas        |
| POST   | `/worker/jobs/:id/finish`                     | No fim, uma única vez                       |

Todas exigem `X-Worker-API-Key`.

---

## 13. Olhe o bot-xml-gms quando estiver em dúvida

O `bot-xml-gms` é a referência viva — primeira automação produtiva, valida o contrato. Padrões a copiar dele:

- Estrutura do main loop (consume → status check → start → process com heartbeat → finish)
- Como lida com erros de portal (retry com backoff antes de marcar `failed`)
- Como faz o heartbeat dentro do loop de processamento
- Como propaga `job_id` pra todos os logs internos

Quando este documento divergir do código do bot, **o código vence**. Reporte a divergência pra atualizar o doc.
