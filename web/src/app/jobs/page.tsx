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
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, THead, Th, TBody, Tr, Td } from "@/components/ui/table";
import { EmptyRow } from "@/components/ui/empty-state";
import { ErrorRow } from "@/components/ui/error-state";

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

      <Table>
        <THead>
          <Th>ID</Th>
          <Th>Automação</Th>
          <Th>Status</Th>
          <Th>Criado</Th>
          <Th className="text-right">Ações</Th>
        </THead>
        <TBody>
          {items.map((j) => {
            const automation = automations.find((a) => a.id === j.automationId);
            const errCls = getJobErrorClass(j);
            return (
              <Tr key={j.id}>
                <Td
                  className="cursor-pointer font-mono text-xs text-gray-500"
                  onClick={() => setSelectedJobId(j.id)}
                >
                  {j.id.slice(0, 8)}…
                </Td>
                <Td
                  className="cursor-pointer text-gray-700 dark:text-gray-300"
                  onClick={() => setSelectedJobId(j.id)}
                >
                  {automation?.name ?? j.automationId}
                </Td>
                <Td>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge className={STATUS_STYLE[j.status]}>{STATUS_LABEL[j.status]}</Badge>
                    {errCls && (
                      <Badge size="xs" className={errorClassStyle(errCls)} title={errCls}>
                        {errorClassLabel(errCls)}
                      </Badge>
                    )}
                    {j.result?.partial_success === true && (
                      <Badge
                        size="xs"
                        className="bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                        title="Parte dos itens processou com sucesso"
                      >
                        parcial
                      </Badge>
                    )}
                  </div>
                </Td>
                <Td className="text-gray-500">
                  {formatDistanceToNow(new Date(j.createdAt), {
                    locale: ptBR,
                    addSuffix: true,
                  })}
                </Td>
                <Td>
                  <div className="flex justify-end gap-1.5">
                    <Button variant="secondary" size="sm" onClick={() => setSelectedJobId(j.id)}>
                      Ver logs
                    </Button>
                    {isOperatorPlus && isActiveStatus(j.status) && (
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => cancelMutation.mutate(j.id)}
                        disabled={cancelMutation.isPending}
                      >
                        Cancelar
                      </Button>
                    )}
                    {isOperatorPlus && isRetryableStatus(j.status) && (
                      <Button
                        variant="soft"
                        size="sm"
                        onClick={() => retryMutation.mutate(j.id)}
                        disabled={retryMutation.isPending}
                      >
                        Reexecutar
                      </Button>
                    )}
                  </div>
                </Td>
              </Tr>
            );
          })}
          {listQuery.isError && items.length === 0 && (
            <ErrorRow colSpan={5} onRetry={() => listQuery.refetch()} />
          )}
          {!listQuery.isLoading && !listQuery.isError && items.length === 0 && (
            <EmptyRow colSpan={5}>Nenhum job encontrado com os filtros atuais.</EmptyRow>
          )}
          {listQuery.isLoading &&
            Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} cols={5} />)}
        </TBody>
      </Table>

      {total > 0 && (
        <div className="flex items-center justify-between text-sm text-gray-600 dark:text-gray-400">
          <span>
            {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} de {total}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              disabled={offset === 0}
            >
              Anterior
            </Button>
            <span className="px-2 text-xs text-gray-500">
              {page} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setOffset(offset + PAGE_SIZE)}
              disabled={offset + PAGE_SIZE >= total}
            >
              Próximo
            </Button>
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
