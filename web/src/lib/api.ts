import axios from "axios";
import { toast } from "sonner";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080/api/v1";

export const api = axios.create({ baseURL: BASE_URL });

api.interceptors.request.use((config) => {
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    const status = err.response?.status;
    if (status === 401 && typeof window !== "undefined") {
      localStorage.removeItem("token");
      window.location.href = "/login";
    } else if (status === 403) {
      // UI já esconde ações fora do role, mas se algo escapar (URL direta,
      // race com refresh de token, regressão), mostra erro claro em vez de
      // falha silenciosa.
      const msg =
        (err.response?.data as { error?: string } | undefined)?.error ??
        "Permissão insuficiente para esta operação.";
      toast.error(msg);
    }
    return Promise.reject(err);
  }
);

// ── Types ────────────────────────────────────────────────────────────────────

export type ParameterFieldType = "text" | "date" | "number" | "select" | "boolean" | "list";

export type ListItemType = "text" | "number";

export interface ParameterField {
  name: string;
  label: string;
  type: ParameterFieldType;
  required?: boolean;
  options?: string[];
  placeholder?: string;
  itemType?: ListItemType;
}

export type ParameterSchema = ParameterField[];

export interface Automation {
  id: number;
  name: string;
  description?: string;
  scriptPath: string;
  queueName: string;
  defaultParams?: Record<string, unknown>;
  parameterSchema?: ParameterSchema;
  createdAt: string;
  updatedAt: string;
}

export type JobStatus =
  | "pending"
  | "running"
  | "completed"
  | "completed_no_invoices"
  | "failed"
  | "canceled";

// Convenção de shape do result.summary quando a automação separa
// resultado por item processado (empresa, loja, conta etc.). Documentado em
// docs/automations.md. Workers podem omitir o summary inteiro ou usar uma
// shape totalmente diferente — o front renderiza tipado quando detecta
// qualquer um dos campos abaixo, e cai pra KV genérico caso contrário.
export interface TypedResultSummary {
  ok?: string[];
  failed?: Array<{
    empresa?: string;
    error_class?: string;
    error_type?: string;
    message?: string;
    [key: string]: unknown;
  }>;
  no_data?: string[];
  skipped?: string[];
  [key: string]: unknown;
}

export interface JobResult {
  partial_success?: boolean;
  summary?: TypedResultSummary | Record<string, unknown>;
  error?: string;
  error_type?: string;
  error_class?: string;
  [key: string]: unknown;
}

export interface Job {
  id: string;
  automationId: number;
  userId?: number;
  status: JobStatus;
  parameters?: Record<string, unknown>;
  result?: JobResult;
  startedAt?: string;
  completedAt?: string;
  cancellationRequestedAt?: string;
  createdAt: string;
  retryCount?: number;
}

export interface JobLog {
  id: number;
  jobId: string;
  timestamp: string;
  level: string;
  message: string;
  // Worker sinaliza linhas que demandam intervenção humana ("senha errada na
  // Sheet, corrija agora") vs. transitórias que ele mesmo está tratando
  // (retry automático). UI destaca actionable=true. Default false no DB.
  actionable?: boolean;
}

export interface JobListFilter {
  status?: JobStatus;
  automationId?: number;
  userId?: number;
  since?: string;
  until?: string;
  limit?: number;
  offset?: number;
}

export interface JobListResponse {
  items: Job[];
  total: number;
  limit: number;
  offset: number;
}

export interface JobMetrics {
  running: number;
  pending: number;
  completedToday: number;
  failedLast24h: number;
  canceledLast24h: number;
  totalLast24h: number;
  successRate24h: number;
}

export interface JobsPerHourBucket {
  hour: string;
  total: number;
  succeeded: number;
  failed: number;
}

// Saúde de uma automação no período (tabela do dashboard). Counts/duração/
// manual×agendado são do período; lastStatus/lastRunAt e recent são all-time.
export interface AutomationHealth {
  automationId: number;
  name: string;
  total: number;
  succeeded: number;
  failed: number;
  canceled: number;
  successRate: number;
  manual: number;
  scheduled: number;
  durationP50S?: number;
  durationP95S?: number;
  lastStatus?: JobStatus;
  lastRunAt?: string;
  recent: JobStatus[]; // últimos status, mais recente primeiro
}

// Distribuição de jobs falhos por categoria de erro no período.
export interface ErrorClassCount {
  errorClass: string;
  count: number;
}

export interface Schedule {
  id: number;
  automationId: number;
  cronExpression: string;
  parameters?: Record<string, unknown>;
  nextRunAt?: string;
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface User {
  id: number;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// ── Auth ─────────────────────────────────────────────────────────────────────

export const authApi = {
  login: (email: string, password: string) =>
    api.post<{ token: string; expires_in: number; user: User }>("/auth/login", { email, password }),
  refresh: () => api.post<{ token: string; expires_in: number }>("/auth/refresh"),
  me: () => api.get<User>("/auth/me"),
  changePassword: (currentPassword: string, newPassword: string) =>
    api.post<{ message: string }>("/auth/change-password", { currentPassword, newPassword }),
};

// ── Users (admin) ────────────────────────────────────────────────────────────

export interface CreateUserPayload {
  name: string;
  email: string;
  password: string;
  role: "admin" | "operator" | "viewer";
}

export interface UpdateUserPayload {
  name: string;
  email: string;
  role: "admin" | "operator" | "viewer";
}

export const usersApi = {
  list: (includeInactive = false) =>
    api.get<User[]>("/users", { params: includeInactive ? { include_inactive: "true" } : {} }),
  get: (id: number) => api.get<User>(`/users/${id}`),
  create: (data: CreateUserPayload) => api.post<User>("/users", data),
  update: (id: number, data: UpdateUserPayload) => api.put<User>(`/users/${id}`, data),
  deactivate: (id: number) => api.post<{ message: string }>(`/users/${id}/deactivate`),
  reactivate: (id: number) => api.post<{ message: string }>(`/users/${id}/reactivate`),
  resetPassword: (id: number, newPassword: string) =>
    api.post<{ message: string }>(`/users/${id}/reset-password`, { newPassword }),
};

// ── Automations ───────────────────────────────────────────────────────────────

export const automationsApi = {
  list: () => api.get<Automation[]>("/automations"),
  get: (id: number) => api.get<Automation>(`/automations/${id}`),
  create: (data: Omit<Automation, "id" | "createdAt" | "updatedAt">) =>
    api.post<Automation>("/automations", data),
  update: (id: number, data: Partial<Automation>) =>
    api.put<Automation>(`/automations/${id}`, data),
  delete: (id: number) => api.delete(`/automations/${id}`),
  execute: (id: number, params?: Record<string, unknown>) =>
    api.post<Job>(`/automations/${id}/execute`, params ?? {}),
  lastParams: (id: number) =>
    api.get<{ parameters: Record<string, unknown> | null }>(`/automations/${id}/last-params`),
};

// ── Jobs ──────────────────────────────────────────────────────────────────────

function jobListParams(filter: JobListFilter): Record<string, string | number> {
  const p: Record<string, string | number> = {};
  if (filter.status) p.status = filter.status;
  if (filter.automationId !== undefined) p.automation_id = filter.automationId;
  if (filter.userId !== undefined) p.user_id = filter.userId;
  if (filter.since) p.since = filter.since;
  if (filter.until) p.until = filter.until;
  if (filter.limit !== undefined) p.limit = filter.limit;
  if (filter.offset !== undefined) p.offset = filter.offset;
  return p;
}

export const jobsApi = {
  list: (filter: JobListFilter = {}) =>
    api.get<JobListResponse>("/jobs", { params: jobListParams(filter) }),
  get: (id: string) => api.get<Job>(`/jobs/${id}`),
  logs: (id: string) => api.get<JobLog[]>(`/jobs/${id}/logs`),
  cancel: (id: string) => api.post<Job>(`/jobs/${id}/cancel`),
  retry: (id: string) => api.post<Job>(`/jobs/${id}/retry`),
  /**
   * streamLogs abre uma conexão SSE em /jobs/:id/logs/stream e dispara
   * callbacks conforme os eventos `log`, `status`, `end` e `error` chegam.
   * EventSource não suporta headers, então o token JWT vai em `?token=`.
   * Retorna função de cleanup que fecha o EventSource — sempre chame no
   * unmount ou ao trocar de job pra não vazar conexão.
   */
  streamLogs: (
    id: string,
    callbacks: {
      onLog?: (log: JobLog) => void;
      onStatus?: (status: string) => void;
      onEnd?: (status: string) => void;
      onError?: (err: { error: string } | Event) => void;
    }
  ): (() => void) => {
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    const url = new URL(`${BASE_URL}/jobs/${id}/logs/stream`);
    if (token) url.searchParams.set("token", token);

    const es = new EventSource(url.toString());

    if (callbacks.onLog) {
      es.addEventListener("log", (e) => {
        try {
          callbacks.onLog!(JSON.parse((e as MessageEvent).data));
        } catch (err) {
          callbacks.onError?.({ error: `falha ao parsear log: ${String(err)}` });
        }
      });
    }
    if (callbacks.onStatus) {
      es.addEventListener("status", (e) => {
        try {
          const { status } = JSON.parse((e as MessageEvent).data);
          callbacks.onStatus!(status);
        } catch (err) {
          callbacks.onError?.({ error: `falha ao parsear status: ${String(err)}` });
        }
      });
    }
    if (callbacks.onEnd || callbacks.onStatus) {
      es.addEventListener("end", (e) => {
        try {
          const { status } = JSON.parse((e as MessageEvent).data);
          callbacks.onStatus?.(status);
          callbacks.onEnd?.(status);
        } catch (err) {
          callbacks.onError?.({ error: `falha ao parsear end: ${String(err)}` });
        } finally {
          es.close();
        }
      });
    }
    es.addEventListener("error", (e) => {
      // Pode ser tanto um event de erro de conexão (sem .data) quanto um
      // `event: error` enviado pelo servidor (com payload JSON em .data).
      const data = (e as MessageEvent).data;
      if (typeof data === "string" && data.length > 0) {
        try {
          callbacks.onError?.(JSON.parse(data));
          return;
        } catch {
          // fall through pra reportar como Event bruto
        }
      }
      callbacks.onError?.(e);
    });

    return () => es.close();
  },
};

// ── Metrics ───────────────────────────────────────────────────────────────────

// Período suportado pelos endpoints de métricas. 24h = buckets de hora;
// 7d/30d = buckets de dia. Os campos *Last24h do JobMetrics mantêm o nome
// por compatibilidade, mas refletem o período pedido.
export type MetricsRange = "24h" | "7d" | "30d";

export const metricsApi = {
  get: (range: MetricsRange = "24h") =>
    api.get<JobMetrics>("/metrics", { params: { range } }),
  jobsPerHour: (range: MetricsRange = "24h") =>
    api.get<JobsPerHourBucket[]>("/metrics/jobs-per-hour", { params: { range } }),
  automations: (range: MetricsRange = "24h") =>
    api.get<AutomationHealth[]>("/metrics/automations", { params: { range } }),
  errorClasses: (range: MetricsRange = "24h") =>
    api.get<ErrorClassCount[]>("/metrics/error-classes", { params: { range } }),
};

// ── Schedules ─────────────────────────────────────────────────────────────────

export const schedulesApi = {
  list: () => api.get<Schedule[]>("/schedules"),
  get: (id: number) => api.get<Schedule>(`/schedules/${id}`),
  create: (data: Omit<Schedule, "id" | "createdAt" | "updatedAt" | "nextRunAt">) =>
    api.post<Schedule>("/schedules", data),
  update: (id: number, data: Partial<Schedule>) =>
    api.put<Schedule>(`/schedules/${id}`, data),
  delete: (id: number) => api.delete(`/schedules/${id}`),
};
