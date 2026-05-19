import type { Job, JobStatus } from "@/lib/api";

export const STATUS_LABEL: Record<JobStatus, string> = {
  pending: "Pendente",
  running: "Executando",
  completed: "Concluído",
  completed_no_invoices: "Concluído (sem NFs)",
  failed: "Falhou",
  canceled: "Cancelado",
};

export const STATUS_STYLE: Record<JobStatus, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  running: "bg-rps-sage-soft text-rps-olive-dark",
  completed: "bg-rps-olive-soft text-rps-olive-dark",
  completed_no_invoices: "bg-rps-olive-soft text-rps-olive-dark",
  failed: "bg-red-100 text-red-800",
  canceled: "bg-gray-200 text-gray-700",
};

const ACTIVE_STATUSES: JobStatus[] = ["pending", "running"];
const RETRYABLE_STATUSES: JobStatus[] = [
  "completed",
  "completed_no_invoices",
  "failed",
  "canceled",
];

export function isActiveStatus(status: JobStatus) {
  return ACTIVE_STATUSES.includes(status);
}

export function isRetryableStatus(status: JobStatus) {
  return RETRYABLE_STATUSES.includes(status);
}

export function jobErrorMessage(err: unknown, fallback: string): string {
  if (typeof err === "object" && err && "response" in err) {
    const r = (err as { response?: { data?: { error?: string } } }).response;
    if (r?.data?.error) return r.data.error;
  }
  if (err instanceof Error) return err.message;
  return fallback;
}

// ── error_class (convenção JSON, documentada em docs/automations.md) ─────────

// Lista canônica. Workers que adotam categorizam falhas usando uma dessas
// strings em `result.error_class` (top-level do result). Strings fora da
// lista ainda aparecem na UI, mas sem label amigável nem tone dedicado —
// melhor ficar na lista pra consistência cross-automação.
export const ERROR_CLASSES = [
  "CREDENTIAL_INVALID",
  "IP_BLOCKED",
  "CAPTCHA_FAILED",
  "INFRA_DESTINO_INDISPONIVEL",
  "RATE_LIMITED",
  "PORTAL_DOWN",
  "JOB_TIMEOUT",
  "INVALID_PARAMETERS",
  "PARTIAL_FAILURE",
  "UNKNOWN",
] as const;

export type ErrorClass = (typeof ERROR_CLASSES)[number];

export const ERROR_CLASS_LABEL: Record<ErrorClass, string> = {
  CREDENTIAL_INVALID: "Credencial inválida",
  IP_BLOCKED: "IP bloqueado",
  CAPTCHA_FAILED: "Captcha falhou",
  INFRA_DESTINO_INDISPONIVEL: "Destino indisponível",
  RATE_LIMITED: "Rate limit",
  PORTAL_DOWN: "Portal externo fora",
  JOB_TIMEOUT: "Timeout",
  INVALID_PARAMETERS: "Parâmetros inválidos",
  PARTIAL_FAILURE: "Falha parcial",
  UNKNOWN: "Não categorizado",
};

// Paleta unificada — três tonalidades pra não virar arco-íris:
// - red:   bloqueia operação, requer ação do operador/TI
// - amber: transitório ou parcial — não exige ação imediata
// - gray:  desconhecido/genérico
const ERROR_CLASS_TONE: Record<ErrorClass, "red" | "amber" | "gray"> = {
  CREDENTIAL_INVALID: "red",
  IP_BLOCKED: "red",
  CAPTCHA_FAILED: "red",
  INFRA_DESTINO_INDISPONIVEL: "red",
  RATE_LIMITED: "amber",
  PORTAL_DOWN: "amber",
  JOB_TIMEOUT: "amber",
  INVALID_PARAMETERS: "red",
  PARTIAL_FAILURE: "amber",
  UNKNOWN: "gray",
};

export const ERROR_CLASS_STYLE: Record<ErrorClass, string> = {} as Record<ErrorClass, string>;
{
  const toneCls: Record<"red" | "amber" | "gray", string> = {
    red: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
    amber: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
    gray: "bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
  };
  for (const c of ERROR_CLASSES) {
    ERROR_CLASS_STYLE[c] = toneCls[ERROR_CLASS_TONE[c]];
  }
}

export function isKnownErrorClass(v: unknown): v is ErrorClass {
  return typeof v === "string" && (ERROR_CLASSES as readonly string[]).includes(v);
}

// Extrai error_class top-level do result. Não inspeciona summary.failed[] —
// é o sinal semântico do job como um todo, não dos itens individuais.
export function getJobErrorClass(job: Job | undefined | null): string | undefined {
  const raw = job?.result?.error_class;
  return typeof raw === "string" && raw.length > 0 ? raw : undefined;
}

export function errorClassLabel(cls: string): string {
  return isKnownErrorClass(cls) ? ERROR_CLASS_LABEL[cls] : cls;
}

export function errorClassStyle(cls: string): string {
  return isKnownErrorClass(cls)
    ? ERROR_CLASS_STYLE[cls]
    : "bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-400";
}
