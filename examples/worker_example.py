"""
Exemplo de worker Python para integração com o RPS Maestro.

Implementa o contrato completo (ver docs/worker-contract.md):
  1. Consome mensagens da fila RabbitMQ (declarada com o dead-letter do Maestro)
  2. Idempotência: checa /status antes de processar (cobre re-entrega)
  3. Reporta start → logs → finish via HTTP
  4. Cancelamento cooperativo + heartbeat: pole /cancellation durante a execução

Variáveis de ambiente necessárias:
  MAESTRO_URL            - URL base do Maestro. Mesma rede docker:
                           http://maestro-backend:8000. Outro host/LAN:
                           http://192.168.10.46:8080 (no servidor, :8000 é nginx).
  MAESTRO_WORKER_API_KEY - Chave de auth (idêntica à configurada no Maestro).
  RABBITMQ_URL           - amqp://guest:guest@rabbitmq:5672/
  QUEUE_NAME             - Fila a consumir (= queueName da automação no Maestro).
"""

import json
import os
import time

import pika
import requests

MAESTRO_URL = os.environ.get("MAESTRO_URL", "http://maestro-backend:8000")
WORKER_API_KEY = os.environ.get("MAESTRO_WORKER_API_KEY", "")
RABBITMQ_URL = os.environ.get("RABBITMQ_URL", "amqp://guest:guest@rabbitmq:5672/")
QUEUE_NAME = os.environ.get("QUEUE_NAME", "automation_jobs")

# O detector de jobs travados do Maestro marca "morto" após 5 min sem
# heartbeat. Cada GET /cancellation atualiza o heartbeat — pole abaixo disso.
HEARTBEAT_INTERVAL_S = 30


def _headers() -> dict:
    headers = {"Content-Type": "application/json"}
    if WORKER_API_KEY:
        headers["X-Worker-API-Key"] = WORKER_API_KEY
    return headers


def _post(job_id: str, action: str, payload: dict | None = None) -> requests.Response:
    url = f"{MAESTRO_URL}/api/v1/worker/jobs/{job_id}/{action}"
    resp = requests.post(url, headers=_headers(), json=payload or {}, timeout=10)
    resp.raise_for_status()
    return resp


def get_status(job_id: str) -> dict:
    url = f"{MAESTRO_URL}/api/v1/worker/jobs/{job_id}/status"
    resp = requests.get(url, headers=_headers(), timeout=10)
    resp.raise_for_status()
    return resp.json()


def is_cancellation_requested(job_id: str) -> bool:
    """GET /cancellation: retorna se o usuário pediu cancelamento E atualiza o
    heartbeat do job (cada chamada é um sinal de vida)."""
    url = f"{MAESTRO_URL}/api/v1/worker/jobs/{job_id}/cancellation"
    resp = requests.get(url, headers=_headers(), timeout=10)
    resp.raise_for_status()
    return bool(resp.json().get("cancellation_requested"))


def report_start(job_id: str) -> None:
    _post(job_id, "start")


def report_log(job_id: str, level: str, message: str, actionable: bool = False) -> None:
    # level ∈ DEBUG · INFO · WARNING · WARN · ERROR · CRITICAL
    # actionable=True destaca o log na UI (precisa de ação humana).
    _post(job_id, "log", {"level": level, "message": message, "actionable": actionable})


def report_finish(job_id: str, status: str, result: dict | None = None) -> None:
    # status ∈ completed · completed_no_invoices · failed · canceled
    payload: dict = {"status": status}
    if result:
        payload["result"] = result
    _post(job_id, "finish", payload)


def execute_automation(job_id: str, parameters: dict) -> dict:
    """
    Implemente aqui a lógica da automação.

    O loop abaixo é o modelo recomendado: trabalho em pedaços, com poll de
    cancelamento entre eles (que também mantém o heartbeat vivo). Em falhas,
    use a convenção de `result` com `error_class` canônico (ver contrato §7).
    """
    total_steps = int(parameters.get("steps", 5))
    done: list[str] = []

    for step in range(total_steps):
        if is_cancellation_requested(job_id):
            report_log(job_id, "WARN", "Cancelamento solicitado — abortando com graça")
            raise _Canceled()

        # ... faz um pedaço do trabalho ...
        time.sleep(1)
        done.append(f"etapa-{step + 1}")
        report_log(job_id, "INFO", f"Etapa {step + 1}/{total_steps} concluída")

    return {"ok": done}


class _Canceled(Exception):
    """Sinaliza cancelamento cooperativo (status terminal = canceled)."""


def process_message(channel, method, _properties, body: bytes) -> None:
    message = json.loads(body)
    job_id = message["job_id"]
    parameters = message.get("parameters", {})

    print(f"[{job_id}] Recebido.")
    try:
        # Idempotência: re-entrega de um job já finalizado não é reprocessada.
        if get_status(job_id).get("terminal"):
            print(f"[{job_id}] Já está em estado terminal — pulando.")
            return

        report_start(job_id)
        report_log(job_id, "INFO", "Worker iniciado")

        result = execute_automation(job_id, parameters)

        report_log(job_id, "INFO", "Concluído com sucesso")
        report_finish(job_id, "completed", result)
        print(f"[{job_id}] Concluído.")

    except _Canceled:
        report_finish(job_id, "canceled")
        print(f"[{job_id}] Cancelado.")

    except Exception as exc:
        print(f"[{job_id}] Erro: {exc}")
        try:
            report_log(job_id, "ERROR", str(exc))
            report_finish(job_id, "failed", {"error": str(exc), "error_class": "UNKNOWN"})
        except Exception:
            pass  # Maestro pode estar fora do ar; a mensagem será re-entregue

    finally:
        # ack só aqui, depois do finish — evita o consumer_timeout (4h) re-entregar
        channel.basic_ack(delivery_tag=method.delivery_tag)


def main() -> None:
    print(f"Conectando ao RabbitMQ: {RABBITMQ_URL}")
    connection = pika.BlockingConnection(pika.URLParameters(RABBITMQ_URL))
    channel = connection.channel()

    # A fila precisa ser declarada com o MESMO dead-letter-exchange do Maestro,
    # senão o broker rejeita com PRECONDITION_FAILED (406).
    channel.queue_declare(
        queue=QUEUE_NAME,
        durable=True,
        arguments={"x-dead-letter-exchange": "maestro.dlx"},
    )
    channel.basic_qos(prefetch_count=1)
    channel.basic_consume(queue=QUEUE_NAME, on_message_callback=process_message)

    print(f"Aguardando jobs na fila '{QUEUE_NAME}'...")
    channel.start_consuming()


if __name__ == "__main__":
    main()
