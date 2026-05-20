"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { automationsApi, jobsApi, type JobStatus } from "@/lib/api";
import {
  STATUS_LABEL,
  STATUS_STYLE,
  ERROR_CLASSES,
  errorClassLabel,
  errorClassStyle,
  getJobErrorClass,
  isActiveStatus,
  isRetryableStatus,
  jobErrorMessage,
} from "@/lib/jobs";
import { useAuth } from "@/lib/auth";
import { JobPanel } from "@/components/job-panel";
import { SkeletonRow } from "@/components/skeleton";

const PAGE_SIZE = 50;

const STATUS_FILTERS: { value: JobStatus | "all"; label: string }[] = [
  { value: "all", label: "Todos" },
  { value: "pending", label: "Pendente" },
  { value: "running", label: "Executando" },
  { value: "completed", label: "Concluído" },
  { value: "failed", label: "Falhou" },
  { value: "canceled", label: "Cancelado" },
];

export default function JobsPage() {
  const queryClient = useQueryClient();
  const { isOperatorPlus } = useAuth();
  const [statusFilter, setStatusFilter] = useState<JobStatus | "all">("all");
  const [automationFilter, setAutomationFilter] = useState<number | "all">("all");
  const [errorClassFilter, setErrorClassFilter] = useState<string | "all">("all");
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
      const hasActive = data?.items.some((j) => isActiveStatus(j.status));
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
    onError: (err) => toast.error(jobErrorMessage(err, "Erro ao cancelar")),
  });

  const retryMutation = useMutation({
    mutationFn: (id: string) => jobsApi.retry(id).then((r) => r.data),
    onSuccess: (newJob) => {
      toast.success(`Reexecutado: ${newJob.id.slice(0, 8)}…`);
      setSelectedJobId(newJob.id);
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
    onError: (err) => toast.error(jobErrorMessage(err, "Erro ao reexecutar")),
  });

  const total = listQuery.data?.total ?? 0;
  const allItems = listQuery.data?.items ?? [];
  // Filtro de error_class é client-side por enquanto: o backend não indexa
  // por chave dentro do JSONB de result. Volume hoje é baixo (centenas/dia)
  // então filtrar a página atual em memória cobre. Se virar gargalo,
  // promove pra query param + WHERE result->>'error_class' = $1.
  const items =
    errorClassFilter === "all"
      ? allItems
      : allItems.filter((j) => getJobErrorClass(j) === errorClassFilter);
  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

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
      <div className="flex items-baseline justify-end">
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
                  ? "bg-rps-olive-dark text-white"
                  : "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
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
          className="rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1 text-sm focus:border-rps-olive-dark focus:outline-none"
        >
          <option value="all">Todas automações</option>
          {automations.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>

        <select
          value={errorClassFilter}
          onChange={(e) => setErrorClassFilter(e.target.value)}
          title="Filtra por categoria de erro na página atual"
          className="rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1 text-sm focus:border-rps-olive-dark focus:outline-none"
        >
          <option value="all">Toda categoria</option>
          {ERROR_CLASSES.map((c) => (
            <option key={c} value={c}>
              {errorClassLabel(c)}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-800">
            <tr className="text-left text-xs font-medium uppercase tracking-wider text-gray-500">
              <th className="px-4 py-3">ID</th>
              <th className="px-4 py-3">Automação</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Criado</th>
              <th className="px-4 py-3 text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {items.map((j) => {
              const automation = automations.find((a) => a.id === j.automationId);
              const errCls = getJobErrorClass(j);
              return (
                <tr key={j.id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                  <td
                    className="cursor-pointer px-4 py-3 font-mono text-xs text-gray-500"
                    onClick={() => setSelectedJobId(j.id)}
                  >
                    {j.id.slice(0, 8)}…
                  </td>
                  <td
                    className="cursor-pointer px-4 py-3 text-gray-700 dark:text-gray-300"
                    onClick={() => setSelectedJobId(j.id)}
                  >
                    {automation?.name ?? j.automationId}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[j.status]}`}
                      >
                        {STATUS_LABEL[j.status]}
                      </span>
                      {errCls && (
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${errorClassStyle(errCls)}`}
                          title={errCls}
                        >
                          {errorClassLabel(errCls)}
                        </span>
                      )}
                      {j.result?.partial_success === true && (
                        <span
                          className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                          title="Parte dos itens processou com sucesso"
                        >
                          parcial
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {formatDistanceToNow(new Date(j.createdAt), {
                      locale: ptBR,
                      addSuffix: true,
                    })}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1.5">
                      <button
                        onClick={() => setSelectedJobId(j.id)}
                        className="rounded bg-gray-100 dark:bg-gray-800 px-2 py-1 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
                      >
                        Ver logs
                      </button>
                      {isOperatorPlus && isActiveStatus(j.status) && (
                        <button
                          onClick={() => cancelMutation.mutate(j.id)}
                          disabled={cancelMutation.isPending}
                          className="rounded bg-red-50 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
                        >
                          Cancelar
                        </button>
                      )}
                      {isOperatorPlus && isRetryableStatus(j.status) && (
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
                <td colSpan={5} className="px-4 py-12 text-center text-sm text-gray-600 dark:text-gray-400">
                  Nenhum job encontrado com os filtros atuais.
                </td>
              </tr>
            )}
            {listQuery.isLoading &&
              Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} cols={5} />)}
          </tbody>
        </table>
      </div>

      {total > 0 && (
        <div className="flex items-center justify-between text-sm text-gray-600 dark:text-gray-400">
          <span>
            {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} de {total}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              disabled={offset === 0}
              className="rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40"
            >
              Anterior
            </button>
            <span className="px-2 text-xs text-gray-500">
              {page} / {totalPages}
            </span>
            <button
              onClick={() => setOffset(offset + PAGE_SIZE)}
              disabled={offset + PAGE_SIZE >= total}
              className="rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40"
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
