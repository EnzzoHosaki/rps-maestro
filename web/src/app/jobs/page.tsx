"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  automationsApi,
  jobsApi,
  type Automation,
  type JobLog,
  type JobStatus,
} from "@/lib/api";

const PAGE_SIZE = 50;

const STATUS_FILTERS: { value: JobStatus | "all"; label: string }[] = [
  { value: "all", label: "Todos" },
  { value: "pending", label: "Pendente" },
  { value: "running", label: "Executando" },
  { value: "completed", label: "Concluído" },
  { value: "failed", label: "Falhou" },
  { value: "canceled", label: "Cancelado" },
];

const STATUS_LABEL: Record<JobStatus, string> = {
  pending: "Pendente",
  running: "Executando",
  completed: "Concluído",
  completed_no_invoices: "Concluído (sem NFs)",
  failed: "Falhou",
  canceled: "Cancelado",
};

const STATUS_STYLE: Record<JobStatus, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  running: "bg-rps-sage-soft text-rps-olive-dark",
  completed: "bg-rps-olive-soft text-rps-olive-dark",
  completed_no_invoices: "bg-rps-olive-soft text-rps-olive-dark",
  failed: "bg-red-100 text-red-800",
  canceled: "bg-gray-200 text-gray-700",
};

const LOG_COLOR: Record<string, string> = {
  ERROR: "text-red-400",
  WARN: "text-yellow-400",
  INFO: "text-gray-200",
  DEBUG: "text-gray-500",
};

const ACTIVE_STATUSES: JobStatus[] = ["pending", "running"];
const RETRYABLE_STATUSES: JobStatus[] = [
  "completed",
  "completed_no_invoices",
  "failed",
  "canceled",
];

function isActive(status: JobStatus) {
  return ACTIVE_STATUSES.includes(status);
}

function isRetryable(status: JobStatus) {
  return RETRYABLE_STATUSES.includes(status);
}

function errorMessage(err: unknown, fallback: string): string {
  if (typeof err === "object" && err && "response" in err) {
    const r = (err as { response?: { data?: { error?: string } } }).response;
    if (r?.data?.error) return r.data.error;
  }
  if (err instanceof Error) return err.message;
  return fallback;
}

function JobPanel({
  jobId,
  automations,
  onClose,
}: {
  jobId: string;
  automations: Automation[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [logs, setLogs] = useState<JobLog[]>([]);
  const [liveStatus, setLiveStatus] = useState<JobStatus | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  const { data: job } = useQuery({
    queryKey: ["jobs", jobId],
    queryFn: () => jobsApi.get(jobId).then((r) => r.data),
  });

  const status = liveStatus ?? job?.status ?? null;
  const automation = useMemo(
    () => automations.find((a) => a.id === job?.automationId),
    [automations, job?.automationId]
  );

  // SSE: stream logs em tempo real. JobPanel é remontado via `key={jobId}` no
  // parent, então o estado inicial já está limpo a cada troca — basta abrir
  // a conexão aqui e devolver o cleanup pro unmount.
  useEffect(() => {
    const cleanup = jobsApi.streamLogs(jobId, {
      onLog: (log) => setLogs((prev) => [...prev, log]),
      onStatus: (s) => setLiveStatus(s as JobStatus),
      onEnd: (s) => {
        setLiveStatus(s as JobStatus);
        queryClient.invalidateQueries({ queryKey: ["jobs"] });
      },
      onError: (err) => {
        if ("error" in (err as object)) {
          setStreamError((err as { error: string }).error);
        }
      },
    });

    return cleanup;
  }, [jobId, queryClient]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [logs.length]);

  const cancelMutation = useMutation({
    mutationFn: () => jobsApi.cancel(jobId).then((r) => r.data),
    onSuccess: () => {
      toast.success("Cancelamento solicitado");
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
    onError: (err) => toast.error(errorMessage(err, "Erro ao cancelar")),
  });

  const retryMutation = useMutation({
    mutationFn: () => jobsApi.retry(jobId).then((r) => r.data),
    onSuccess: (newJob) => {
      toast.success(`Reexecutado: ${newJob.id.slice(0, 8)}…`);
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
    onError: (err) => toast.error(errorMessage(err, "Erro ao reexecutar")),
  });

  return (
    <div className="fixed inset-y-0 right-0 z-50 flex w-[520px] flex-col border-l border-gray-200 bg-white shadow-2xl">
      <div className="flex items-start justify-between border-b border-gray-200 px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900">
            {automation?.name ?? "Job"}
          </p>
          <p className="truncate font-mono text-xs text-gray-400">{jobId}</p>
        </div>
        <button
          onClick={onClose}
          className="ml-3 shrink-0 text-xl leading-none text-gray-400 hover:text-gray-700"
          aria-label="Fechar"
        >
          ×
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-4 py-3 text-sm">
        {status && (
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[status]}`}
          >
            {STATUS_LABEL[status]}
          </span>
        )}
        {job?.startedAt && (
          <span className="text-xs text-gray-500">
            Iniciado{" "}
            {formatDistanceToNow(new Date(job.startedAt), {
              locale: ptBR,
              addSuffix: true,
            })}
          </span>
        )}
        {job?.retryCount && job.retryCount > 0 ? (
          <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
            retry #{job.retryCount}
          </span>
        ) : null}
        <div className="ml-auto flex gap-2">
          {status && isActive(status) && (
            <button
              onClick={() => cancelMutation.mutate()}
              disabled={cancelMutation.isPending}
              className="rounded bg-red-50 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
            >
              {cancelMutation.isPending ? "Cancelando…" : "Cancelar"}
            </button>
          )}
          {status && isRetryable(status) && (
            <button
              onClick={() => retryMutation.mutate()}
              disabled={retryMutation.isPending}
              className="rounded bg-rps-sage-soft px-3 py-1 text-xs font-medium text-rps-olive-dark hover:bg-rps-sage disabled:opacity-50"
            >
              {retryMutation.isPending ? "Enviando…" : "Reexecutar"}
            </button>
          )}
        </div>
      </div>

      {job?.parameters && Object.keys(job.parameters).length > 0 && (
        <details className="border-b border-gray-100 px-4 py-2 text-xs">
          <summary className="cursor-pointer text-gray-500 hover:text-gray-700">
            Parâmetros
          </summary>
          <pre className="mt-2 overflow-auto rounded bg-gray-50 p-2 text-xs text-gray-700">
            {JSON.stringify(job.parameters, null, 2)}
          </pre>
        </details>
      )}

      {streamError && (
        <div className="border-b border-red-100 bg-red-50 px-4 py-2 text-xs text-red-700">
          Stream interrompido: {streamError}
        </div>
      )}

      <div className="flex-1 overflow-auto bg-gray-900 p-4 font-mono text-xs">
        {logs.length === 0 ? (
          <p className="text-gray-500">
            {status && isActive(status)
              ? "Aguardando primeiro log…"
              : "Nenhum log gerado."}
          </p>
        ) : (
          logs.map((l) => (
            <div key={l.id} className="mb-1 flex gap-2">
              <span className="shrink-0 text-gray-600">
                {format(new Date(l.timestamp), "HH:mm:ss")}
              </span>
              <span
                className={`w-12 shrink-0 uppercase ${
                  LOG_COLOR[l.level.toUpperCase()] ?? "text-gray-300"
                }`}
              >
                {l.level.slice(0, 4)}
              </span>
              <span
                className={`whitespace-pre-wrap break-words ${
                  LOG_COLOR[l.level.toUpperCase()] ?? "text-gray-300"
                }`}
              >
                {l.message}
              </span>
            </div>
          ))
        )}
        <div ref={logEndRef} />
      </div>
    </div>
  );
}

export default function JobsPage() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<JobStatus | "all">("all");
  const [automationFilter, setAutomationFilter] = useState<number | "all">("all");
  const [offset, setOffset] = useState(0);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  const { data: automations = [] } = useQuery({
    queryKey: ["automations"],
    queryFn: () => automationsApi.list().then((r) => r.data),
    staleTime: 60_000,
  });

  const listQuery = useQuery({
    queryKey: ["jobs", "list", { statusFilter, automationFilter, offset }],
    queryFn: () =>
      jobsApi
        .list({
          status: statusFilter === "all" ? undefined : statusFilter,
          automationId:
            automationFilter === "all" ? undefined : automationFilter,
          limit: PAGE_SIZE,
          offset,
        })
        .then((r) => r.data),
    refetchInterval: (q) => {
      const data = q.state.data;
      const hasActive = data?.items.some((j) => isActive(j.status));
      return hasActive ? 5000 : false;
    },
    placeholderData: (prev) => prev,
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => jobsApi.cancel(id).then((r) => r.data),
    onSuccess: () => {
      toast.success("Cancelamento solicitado");
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
    onError: (err) => toast.error(errorMessage(err, "Erro ao cancelar")),
  });

  const retryMutation = useMutation({
    mutationFn: (id: string) => jobsApi.retry(id).then((r) => r.data),
    onSuccess: (newJob) => {
      toast.success(`Reexecutado: ${newJob.id.slice(0, 8)}…`);
      setSelectedJobId(newJob.id);
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
    onError: (err) => toast.error(errorMessage(err, "Erro ao reexecutar")),
  });

  const total = listQuery.data?.total ?? 0;
  const items = listQuery.data?.items ?? [];
  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Resetar paginação ao trocar de filtro vai direto nos handlers (em vez de
  // num useEffect), pra evitar render-em-cascata e o aviso do react-hooks.
  function changeStatusFilter(value: JobStatus | "all") {
    setStatusFilter(value);
    setOffset(0);
  }
  function changeAutomationFilter(value: number | "all") {
    setAutomationFilter(value);
    setOffset(0);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Jobs</h1>
        <span className="text-sm text-gray-500">
          {listQuery.isFetching ? "Atualizando…" : `${total} job${total === 1 ? "" : "s"}`}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-1.5">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s.value}
              onClick={() => changeStatusFilter(s.value)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                statusFilter === s.value
                  ? "bg-rps-olive text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        <select
          value={automationFilter}
          onChange={(e) =>
            changeAutomationFilter(e.target.value === "all" ? "all" : Number(e.target.value))
          }
          className="rounded border border-gray-300 bg-white px-2 py-1 text-sm focus:border-rps-olive focus:outline-none"
        >
          <option value="all">Todas automações</option>
          {automations.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr className="text-left text-xs font-medium uppercase tracking-wider text-gray-500">
              <th className="px-4 py-3">ID</th>
              <th className="px-4 py-3">Automação</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Criado</th>
              <th className="px-4 py-3 text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {items.map((j) => {
              const automation = automations.find((a) => a.id === j.automationId);
              return (
                <tr key={j.id} className="hover:bg-gray-50">
                  <td
                    className="cursor-pointer px-4 py-3 font-mono text-xs text-gray-500"
                    onClick={() => setSelectedJobId(j.id)}
                  >
                    {j.id.slice(0, 8)}…
                  </td>
                  <td
                    className="cursor-pointer px-4 py-3 text-gray-700"
                    onClick={() => setSelectedJobId(j.id)}
                  >
                    {automation?.name ?? j.automationId}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[j.status]}`}
                    >
                      {STATUS_LABEL[j.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-400">
                    {formatDistanceToNow(new Date(j.createdAt), {
                      locale: ptBR,
                      addSuffix: true,
                    })}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1.5">
                      <button
                        onClick={() => setSelectedJobId(j.id)}
                        className="rounded bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-200"
                      >
                        Ver logs
                      </button>
                      {isActive(j.status) && (
                        <button
                          onClick={() => cancelMutation.mutate(j.id)}
                          disabled={cancelMutation.isPending}
                          className="rounded bg-red-50 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
                        >
                          Cancelar
                        </button>
                      )}
                      {isRetryable(j.status) && (
                        <button
                          onClick={() => retryMutation.mutate(j.id)}
                          disabled={retryMutation.isPending}
                          className="rounded bg-rps-sage-soft px-2 py-1 text-xs font-medium text-rps-olive-dark hover:bg-rps-sage disabled:opacity-50"
                        >
                          Reexecutar
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {!listQuery.isLoading && items.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-sm text-gray-400">
                  Nenhum job encontrado com os filtros atuais.
                </td>
              </tr>
            )}
            {listQuery.isLoading && (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-sm text-gray-400">
                  Carregando…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {total > 0 && (
        <div className="flex items-center justify-between text-sm text-gray-600">
          <span>
            {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} de {total}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              disabled={offset === 0}
              className="rounded border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
            >
              Anterior
            </button>
            <span className="px-2 text-xs text-gray-500">
              {page} / {totalPages}
            </span>
            <button
              onClick={() => setOffset(offset + PAGE_SIZE)}
              disabled={offset + PAGE_SIZE >= total}
              className="rounded border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
            >
              Próximo
            </button>
          </div>
        </div>
      )}

      {selectedJobId && (
        <JobPanel
          key={selectedJobId}
          jobId={selectedJobId}
          automations={automations}
          onClose={() => setSelectedJobId(null)}
        />
      )}
    </div>
  );
}
