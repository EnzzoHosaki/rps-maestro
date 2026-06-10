"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { AlertTriangle, X } from "lucide-react";
import { jobsApi, type Automation, type JobLog, type JobStatus } from "@/lib/api";
import {
  STATUS_LABEL,
  STATUS_STYLE,
  isActiveStatus,
  isRetryableStatus,
  jobErrorMessage,
} from "@/lib/jobs";
import { useAuth } from "@/lib/auth";
import { JobResultSummary } from "@/components/job-result-summary";

const LOG_COLOR: Record<string, string> = {
  ERROR: "text-red-400",
  WARN: "text-yellow-400",
  INFO: "text-gray-200",
  DEBUG: "text-gray-500",
};

// JobPanel é o painel lateral fixo que mostra dados do job + logs em tempo
// real via SSE. Usado em /jobs, no dashboard, e ao executar uma automação.
//
// O parent é responsável por remontar via `key={jobId}` ao trocar de job —
// isso garante que o estado interno (logs, status, erro) resete a cada
// troca sem precisar de useEffect explícito de reset.
export function JobPanel({
  jobId,
  automations,
  onClose,
}: {
  jobId: string;
  automations: Automation[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { isOperatorPlus } = useAuth();
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
    onError: (err) => toast.error(jobErrorMessage(err, "Erro ao cancelar")),
  });

  const retryMutation = useMutation({
    mutationFn: () => jobsApi.retry(jobId).then((r) => r.data),
    onSuccess: (newJob) => {
      toast.success(`Reexecutado: ${newJob.id.slice(0, 8)}…`);
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
    onError: (err) => toast.error(jobErrorMessage(err, "Erro ao reexecutar")),
  });

  return (
    <div className="fixed inset-y-0 right-0 z-50 flex w-[520px] flex-col border-l border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-2xl">
      <div className="flex items-start justify-between border-b border-gray-200 dark:border-gray-800 px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {automation?.name ?? "Job"}
          </p>
          <p className="truncate font-mono text-xs text-gray-500">{jobId}</p>
        </div>
        <button
          onClick={onClose}
          className="ml-3 shrink-0 rounded text-gray-500 hover:text-gray-900 dark:text-gray-100"
          aria-label="Fechar"
        >
          <X className="h-5 w-5" aria-hidden />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 dark:border-gray-800 px-4 py-3 text-sm">
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
          <span className="rounded bg-gray-100 dark:bg-gray-800 px-2 py-0.5 text-xs text-gray-600 dark:text-gray-400">
            retry #{job.retryCount}
          </span>
        ) : null}
        {job?.result?.partial_success === true && (
          <span
            className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
            title="Parte dos itens processou com sucesso; veja o resultado para detalhes."
          >
            parcial
          </span>
        )}
        <div className="ml-auto flex gap-2">
          {isOperatorPlus && status && isActiveStatus(status) && (
            <button
              onClick={() => cancelMutation.mutate()}
              disabled={cancelMutation.isPending}
              className="rounded bg-red-50 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
            >
              {cancelMutation.isPending ? "Cancelando…" : "Cancelar"}
            </button>
          )}
          {isOperatorPlus && status && isRetryableStatus(status) && (
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
        <details className="border-b border-gray-100 dark:border-gray-800 px-4 py-2 text-xs">
          <summary className="cursor-pointer text-gray-500 hover:text-gray-700 dark:text-gray-300">
            Parâmetros
          </summary>
          <pre className="mt-2 overflow-auto rounded bg-gray-50 dark:bg-gray-800 p-2 text-xs text-gray-700 dark:text-gray-300">
            {JSON.stringify(job.parameters, null, 2)}
          </pre>
        </details>
      )}

      {job?.result && <JobResultSummary result={job.result} />}

      {streamError && (
        <div className="border-b border-red-100 bg-red-50 px-4 py-2 text-xs text-red-700">
          Stream interrompido: {streamError}
        </div>
      )}

      <div className="flex-1 overflow-auto bg-gray-900 p-4 font-mono text-xs">
        {logs.length === 0 ? (
          <p className="text-gray-500">
            {status && isActiveStatus(status)
              ? "Aguardando primeiro log…"
              : "Nenhum log gerado."}
          </p>
        ) : (
          logs.map((l) => (
            <div
              key={l.id}
              className={`mb-1 flex gap-2 ${
                l.actionable
                  ? "border-l-2 border-amber-400 bg-amber-500/10 py-0.5 pl-2"
                  : ""
              }`}
            >
              <span className="shrink-0 text-gray-600 dark:text-gray-400">
                {format(new Date(l.timestamp), "HH:mm:ss")}
              </span>
              <span
                className={`w-12 shrink-0 uppercase ${
                  LOG_COLOR[l.level.toUpperCase()] ?? "text-gray-300"
                }`}
              >
                {l.level.slice(0, 4)}
              </span>
              {l.actionable && (
                <span
                  className="shrink-0 text-amber-400"
                  title="Requer ação do operador"
                  aria-label="Requer ação do operador"
                >
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                </span>
              )}
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
