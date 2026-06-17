# Contrato de Integração — Worker ↔ RPS Maestro

> Como uma automação (worker) se integra ao RPS Maestro. O Maestro é o
> **orquestrador** (dono do banco de jobs, da fila e da UI); o worker é o
> **executor** (dono da lógica da automação). A costura é: **RabbitMQ**
> (Maestro publica job → worker consome) + **HTTP Worker API** (worker
> reporta progresso/resultado de volta).
>
> Referência de implementação completa: `bot-planilha-sefaz` e `bot-xml-gms`.
> O `examples/worker_example.py` cobre o protocolo descrito aqui.

## 1. Visão geral do fluxo

```
[UI/Schedule] → Maestro cria job (status=pending) → publica na fila RabbitMQ
                                                          ↓
                                              Worker consome a mensagem
                                                          ↓
   Worker → POST /start (status=running) → executa → logs/heartbeat → POST /finish (status terminal)
```

O Maestro **nunca chama o worker**. Toda comunicação de volta é o worker
fazendo HTTP no Maestro.

## 2. Registro da automação no Maestro

Antes de rodar, a automação precisa existir no Maestro. Cria-se via
`POST /api/v1/automations` (precisa de JWT admin) ou direto no banco. Campos
(JSON, **camelCase**):

```json
{
  "name": "Minha Automação SEFAZ",
  "description": "O que ela faz (opcional)",
  "scriptPath": "/app/run.py",
  "queueName": "minha_automacao_sefaz",
  "parameterSchema": [
    { "name": "cnpj",        "label": "CNPJ",        "type": "text",   "required": true },
    { "name": "data_inicio", "label": "Data início", "type": "date" },
    { "name": "headless",    "label": "Headless",    "type": "boolean" },
    { "name": "lojas",       "label": "Lojas",       "type": "list",   "itemType": "number" },
    { "name": "ambiente",    "label": "Ambiente",    "type": "select", "options": ["producao", "homologacao"] }
  ],
  "defaultParams": { "headless": true, "ambiente": "producao" }
}
```

- **`queueName`** — fila RabbitMQ que o worker vai consumir. **Tem que bater**
  com a `QUEUE_NAME` do worker. Se vazio, o Maestro usa `automation_jobs`.
- **`scriptPath`** — string repassada ao worker na mensagem (referência; o
  worker decide o que fazer com ela).
- **`parameterSchema`** — define os campos do formulário "Executar" na UI.
  Tipos: `text` · `date` · `number` · `select` (com `options`) · `boolean` ·
  `list` (com `itemType: "text" | "number"`). É **dado no banco**, não código
  — dá pra editar pela UI depois.
- **`defaultParams`** — valores pré-preenchidos quando o usuário abre
  "Executar" sem histórico.

## 3. Conexão RabbitMQ

```
RABBITMQ_URL = amqp://<user>:<pass>@<host>:5672/
```

**⚠️ Declaração da fila — atenção ao dead-letter:** o Maestro declara a fila
com o argumento `x-dead-letter-exchange = maestro.dlx`. O worker **precisa
declarar com o MESMO argumento**, senão o RabbitMQ rejeita com
`PRECONDITION_FAILED (406)` (args divergentes):

```python
channel.queue_declare(
    queue=QUEUE_NAME,
    durable=True,
    arguments={"x-dead-letter-exchange": "maestro.dlx"},  # OBRIGATÓRIO bater com o Maestro
)
channel.basic_qos(prefetch_count=1)   # um job por vez
```

- **`consumer_timeout` do broker = 4h.** Se a automação passar de 4h **sem dar
  `basic_ack`**, o broker fecha o canal e re-entrega a mensagem. Para jobs
  longos, dê o `ack` no `finally` (após reportar o finish) e use o heartbeat
  (seção 6) pra sinalizar vida.

## 4. A mensagem que o worker recebe

JSON publicado na fila (campos **snake_case**):

```json
{
  "job_id": "uuid-do-job",
  "automation_id": 7,
  "script_path": "/app/run.py",
  "parameters": { "cnpj": "...", "headless": true }
}
```

`parameters` são os valores que o usuário preencheu (ou os `defaultParams`).
O `job_id` é a chave de tudo nas chamadas HTTP de volta.

## 5. Worker API (HTTP de volta pro Maestro)

**Base URL** (`MAESTRO_URL`):

- Worker **no mesmo docker network** do Maestro → `http://maestro-backend:8000`
- Worker em **outro host/na LAN** → `http://192.168.10.46:8080`
  ⚠️ (no servidor, `:8000` cai num nginx — o backend Go é o `:8080`)

**Auth:** header `X-Worker-API-Key: <chave>` em toda chamada. A chave tem que
ser **idêntica** à `MAESTRO_WORKER_API_KEY` configurada no Maestro. (Se o
Maestro subir com a chave vazia, ele aceita sem auth — só em dev.)

| Método | Rota | Corpo | Quando |
|---|---|---|---|
| `POST` | `/api/v1/worker/jobs/{id}/start` | — | ao pegar o job → marca `running` |
| `POST` | `/api/v1/worker/jobs/{id}/log` | `{level, message, actionable?}` | a cada passo relevante |
| `POST` | `/api/v1/worker/jobs/{id}/finish` | `{status, result?}` | ao terminar (sucesso/falha/cancelado) |
| `GET`  | `/api/v1/worker/jobs/{id}/status` | — | **antes de processar** (idempotência) |
| `GET`  | `/api/v1/worker/jobs/{id}/cancellation` | — | **em loop durante a execução** (cancel + heartbeat) |

- **`/log`** — `level` ∈ `DEBUG · INFO · WARNING · WARN · ERROR · CRITICAL`.
  `actionable: true` destaca o log na UI (borda âmbar) pra avisar que precisa
  de ação humana (ex.: "CAPTCHA não resolvido").
- **`/finish`** — `status` ∈ `completed · completed_no_invoices · failed ·
  canceled`. `result` é um objeto livre (ver seção 7).

## 6. Ciclo de vida + cancelamento cooperativo + heartbeat

```python
def process_message(ch, method, _props, body):
    msg = json.loads(body)
    job_id, params = msg["job_id"], msg.get("parameters", {})
    try:
        # 6.1 IDEMPOTÊNCIA: se a mensagem foi re-entregue e o job já terminou, pula
        st = get(f"/worker/jobs/{job_id}/status").json()
        if st["terminal"]:
            return  # (ack no finally) — não reprocessa 30min à toa

        post(f"/worker/jobs/{job_id}/start")

        # 6.2 LOOP de trabalho com poll de cancelamento (= também o heartbeat)
        while not done:
            c = get(f"/worker/jobs/{job_id}/cancellation").json()
            if c["cancellation_requested"]:
                post(f"/worker/jobs/{job_id}/finish", json={"status": "canceled"})
                return
            ... faz um pedaço do trabalho ...

        post(f"/worker/jobs/{job_id}/finish", json={"status": "completed", "result": {...}})
    except Exception as e:
        post(f"/worker/jobs/{job_id}/log", json={"level": "ERROR", "message": str(e)})
        post(f"/worker/jobs/{job_id}/finish",
             json={"status": "failed", "result": {"error": str(e), "error_class": "UNKNOWN"}})
    finally:
        ch.basic_ack(delivery_tag=method.delivery_tag)
```

- **`GET /cancellation`** retorna `{"cancellation_requested": bool}` **e**
  atualiza o `last_heartbeat_at` do job (cada poll = sinal de vida). O detector
  de jobs travados do Maestro marca como "morto" se ficar **5 min sem
  heartbeat** → **pole mais rápido que isso** (ex.: a cada 30–60s, ou entre
  cada etapa).
- **`GET /status`** retorna `{status, terminal, started_at, completed_at,
  last_heartbeat_at, cancellation_requested_at, retry_count}`. `terminal=true`
  quando status ∈ {completed, completed_no_invoices, failed, canceled}. Use no
  início pra não reprocessar uma re-entrega.

## 7. Convenções do `result` (renderização rica na UI)

O `result` do `/finish` é livre, mas seguir estas convenções deixa a UI bonita.

**Falha simples:**

```json
{ "error": "Mensagem do erro", "error_class": "CREDENTIAL_INVALID", "error_type": "AuthError" }
```

**Resultado por item (quando a automação processa N empresas/lojas):**

```json
{
  "partial_success": true,
  "summary": {
    "ok":      ["Empresa A", "Empresa B"],
    "failed":  [{ "empresa": "Empresa C", "error_class": "PORTAL_DOWN", "message": "..." }],
    "no_data": ["Empresa D"],
    "skipped": ["Empresa E"]
  }
}
```

A UI mostra contadores OK/Falhas/Sem dados/Pulados, chip "parcial", e um chip
colorido por `error_class`.

**`error_class` canônico (10 valores)** — use um destes pra a UI colorir/filtrar
corretamente:

| Vermelho (acionável) | Âmbar (transitório) | Cinza |
|---|---|---|
| `CREDENTIAL_INVALID` | `RATE_LIMITED` | `UNKNOWN` |
| `IP_BLOCKED` | `PORTAL_DOWN` | |
| `CAPTCHA_FAILED` | `JOB_TIMEOUT` | |
| `INFRA_DESTINO_INDISPONIVEL` | `PARTIAL_FAILURE` | |
| `INVALID_PARAMETERS` | | |

## 8. Variáveis de ambiente do worker

```
MAESTRO_URL              http://maestro-backend:8000  (mesma rede) ou http://192.168.10.46:8080 (LAN)
MAESTRO_WORKER_API_KEY   <igual à do Maestro>
RABBITMQ_URL             amqp://user:pass@host:5672/
QUEUE_NAME               <igual ao queueName da automação>
```

## 9. Checklist de conformidade

- [ ] Automação registrada (`queueName` = `QUEUE_NAME` do worker)
- [ ] Fila declarada com `x-dead-letter-exchange: maestro.dlx` + `durable`
- [ ] `X-Worker-API-Key` em toda chamada; `MAESTRO_URL` no **:8080** (LAN) ou `:8000` (rede docker)
- [ ] `/status` checado antes de processar (idempotência em re-entrega)
- [ ] `/start` → trabalho → `/finish` com status terminal **sempre** (inclusive no erro)
- [ ] `/cancellation` em loop (< 5 min) — respeita cancel **e** mantém o heartbeat
- [ ] `basic_ack` só no `finally`, depois do `/finish`
- [ ] `result` com `error_class` canônico nas falhas

---

### Armadilhas conhecidas

1. `MAESTRO_URL` apontando pro `:8000` na LAN cai no nginx, não no backend Go
   → use `:8080` quando o worker está fora da rede docker do Maestro.
2. `MAESTRO_WORKER_API_KEY` que não bate com a do Maestro → o cancel/heartbeat
   falha silenciosamente (401) e o job é marcado como travado em 5 min.
