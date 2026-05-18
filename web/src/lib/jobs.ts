import type { JobStatus } from "@/lib/api";

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
