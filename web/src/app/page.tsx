"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  automationsApi,
  jobsApi,
  metricsApi,
  schedulesApi,
  type Job,
  type JobStatus,
  type JobsPerHourBucket,
  type MetricsRange,
  type AutomationHealth,
  type ErrorClassCount,
} from "@/lib/api";
import { describeCron } from "@/lib/cron";
import { STATUS_LABEL, STATUS_STYLE, errorClassLabel, errorClassStyle } from "@/lib/jobs";
import { JobPanel } from "@/components/job-panel";
import { Skeleton, SkeletonRow } from "@/components/skeleton";
import { Badge } from "@/components/ui/badge";
import { Table, THead, Th, TBody, Tr, Td } from "@/components/ui/table";
import { EmptyState, EmptyRow } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";

function StatCard({
  label,
  value,
  hint,
  tone = "neutral",
  loading = false,
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "neutral" | "success" | "warning" | "danger";
  loading?: boolean;
}) {
  const accent =
    tone === "success"
      ? "text-rps-olive-dark"
      : tone === "warning"
        ? "text-yellow-700"
        : tone === "danger"
          ? "text-red-700"
          : "text-gray-900 dark:text-gray-100";
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wider text-gray-500">{label}</p>
      {loading ? (
        <Skeleton className="mt-2 h-7 w-16" />
      ) : (
        <p className={`mt-1 text-2xl font-bold ${accent}`}>{value}</p>
      )}
      {hint && <p className="mt-0.5 text-xs text-gray-500">{hint}</p>}
    </div>
  );
}

// Configuração dos períodos do dashboard. label aparece nos pills e no
// sufixo dos cards; chartTitle no cabeçalho do gráfico. O modo do gráfico
// (hora × dia) deriva do range: 24h é horário, o resto é diário.
const RANGES: { value: MetricsRange; label: string; chartTitle: string }[] = [
  { value: "24h", label: "24h", chartTitle: "Jobs por hora · últimas 24h" },
  { value: "7d", label: "7 dias", chartTitle: "Jobs por dia · últimos 7 dias" },
  { value: "30d", label: "30 dias", chartTitle: "Jobs por dia · últimos 30 dias" },
];

function JobsPerHourChart({ buckets, mode }: { buckets: JobsPerHourBucket[]; mode: "hour" | "day" }) {
  if (buckets.length === 0) {
    return <EmptyState>Sem dados.</EmptyState>;
  }

  const max = Math.max(1, ...buckets.map((b) => b.total));
  const W = 720;
  const H = 140;
  const P = { top: 8, right: 8, bottom: 24, left: 28 };
  const chartW = W - P.left - P.right;
  const chartH = H - P.top - P.bottom;
  const slotW = chartW / buckets.length;
  const barW = Math.max(2, slotW - 3);

  // Densidade de rótulos no eixo X: horas a cada 4; dias todos (7d) ou a
  // cada 5 (30d) pra não amontoar.
  const tickStep = mode === "hour" ? 4 : buckets.length <= 7 ? 1 : 5;
  const tickFmt = mode === "hour" ? "HH'h'" : "dd/MM";
  const tooltipFmt = mode === "hour" ? "HH:00" : "dd/MM";

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      role="img"
      aria-label={mode === "hour" ? "Jobs por hora no período" : "Jobs por dia no período"}
    >
      <line
        x1={P.left}
        x2={W - P.right}
        y1={P.top + chartH}
        y2={P.top + chartH}
        className="stroke-gray-200 dark:stroke-gray-700"
        strokeWidth={1}
      />
      <text x={P.left - 4} y={P.top + 8} fontSize="10" className="fill-gray-500" textAnchor="end">
        {max}
      </text>
      <text x={P.left - 4} y={P.top + chartH} fontSize="10" className="fill-gray-500" textAnchor="end">
        0
      </text>

      {buckets.map((b, i) => {
        const succH = (b.succeeded / max) * chartH;
        const failH = (b.failed / max) * chartH;
        const otherH = ((b.total - b.succeeded - b.failed) / max) * chartH;
        const x = P.left + i * slotW + (slotW - barW) / 2;
        const baseY = P.top + chartH;
        return (
          <g key={b.hour}>
            <rect
              x={x}
              y={baseY - succH - failH - otherH}
              width={barW}
              height={Math.max(0, otherH)}
              className="fill-gray-300 dark:fill-gray-600"
            />
            <rect
              x={x}
              y={baseY - succH - failH}
              width={barW}
              height={Math.max(0, succH)}
              className="fill-rps-sage"
            />
            <rect
              x={x}
              y={baseY - failH}
              width={barW}
              height={Math.max(0, failH)}
              className="fill-red-300"
            />
            <title>
              {`${format(new Date(b.hour), tooltipFmt)} — ${b.total} jobs (${b.succeeded} ok, ${b.failed} falhas)`}
            </title>
          </g>
        );
      })}

      {buckets
        .map((b, i) => ({ b, i }))
        .filter(({ i }) => i % tickStep === 0)
        .map(({ b, i }) => (
          <text
            key={b.hour}
            x={P.left + i * slotW + slotW / 2}
            y={H - 6}
            fontSize="10"
            className="fill-gray-500"
            textAnchor="middle"
          >
            {format(new Date(b.hour), tickFmt)}
          </text>
        ))}
    </svg>
  );
}

function ChartLegend() {
  return (
    <div className="mt-2 flex flex-wrap gap-3 text-xs text-gray-600 dark:text-gray-400">
      <span className="flex items-center gap-1">
        <span className="inline-block h-2 w-2 rounded-sm bg-rps-sage" /> sucesso
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-block h-2 w-2 rounded-sm bg-red-300" /> falha
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-block h-2 w-2 rounded-sm bg-gray-300" /> outros
      </span>
    </div>
  );
}

// Distribuição de falhas por categoria de erro (D3) — barras horizontais com
// chip colorido + contagem. Some quando não há falha no período.
function ErrorClassBreakdown({ range }: { range: MetricsRange }) {
  const q = useQuery({
    queryKey: ["metrics", "errorClasses", range],
    queryFn: () => metricsApi.errorClasses(range).then((r) => r.data),
    refetchInterval: 30_000,
    placeholderData: (prev) => prev,
  });
  const rows: ErrorClassCount[] = q.data ?? [];
  const max = Math.max(1, ...rows.map((r) => r.count));

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold text-gray-700 dark:text-gray-300">Falhas por categoria</h2>
      {q.isError ? (
        <ErrorState onRetry={() => q.refetch()} />
      ) : q.isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : rows.length === 0 ? (
        <EmptyState className="py-4">Nenhuma falha no período. 🎉</EmptyState>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.errorClass} className="flex items-center gap-3">
              <Badge size="xs" className={`${errorClassStyle(r.errorClass)} w-40 shrink-0 truncate text-center`}>
                {errorClassLabel(r.errorClass)}
              </Badge>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                <div className="h-full rounded-full bg-red-400" style={{ width: `${(r.count / max) * 100}%` }} />
              </div>
              <span className="w-8 shrink-0 text-right text-sm font-medium tabular-nums text-gray-700 dark:text-gray-300">
                {r.count}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function fmtDuration(s?: number): string {
  if (s == null) return "—";
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.round(s / 60)}min`;
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return m ? `${h}h${m}min` : `${h}h`;
}

// Cor do "pontinho" de um run recente na tabela de saúde.
function dotClass(status: JobStatus): string {
  if (status === "completed" || status === "completed_no_invoices") return "bg-rps-sage";
  if (status === "failed") return "bg-red-400";
  return "bg-gray-300 dark:bg-gray-600"; // canceled / outros
}

// Tabela "Saúde por automação" — uma linha por automação no período: taxa de
// sucesso, falhas, duração p50/p95, split manual×agendado, últimos runs como
// pontinhos e a última execução. onPick abre o JobPanel do último run.
function AutomationHealthTable({ range }: { range: MetricsRange }) {
  const q = useQuery({
    queryKey: ["metrics", "automations", range],
    queryFn: () => metricsApi.automations(range).then((r) => r.data),
    refetchInterval: 30_000,
    placeholderData: (prev) => prev,
  });
  const rows = q.data ?? [];

  return (
    <Table>
      <THead>
        <Th>Automação</Th>
        <Th className="text-right">Sucesso</Th>
        <Th className="text-right">Runs</Th>
        <Th className="text-right">Falhas</Th>
        <Th className="text-right">Duração p50/p95</Th>
        <Th>Últimos</Th>
        <Th>Última execução</Th>
      </THead>
      <TBody>
        {q.isLoading && Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} cols={7} />)}
        {!q.isLoading && rows.length === 0 && (
          <EmptyRow colSpan={7}>Nenhuma automação cadastrada.</EmptyRow>
        )}
        {rows.map((a: AutomationHealth) => {
          const rateTone =
            a.total === 0
              ? "text-gray-400"
              : a.successRate >= 0.9
                ? "text-rps-olive-dark"
                : a.successRate >= 0.6
                  ? "text-yellow-700 dark:text-yellow-500"
                  : "text-red-600 dark:text-red-400";
          return (
            <Tr key={a.automationId}>
              <Td className="font-medium text-gray-900 dark:text-gray-100">{a.name}</Td>
              <Td className={`text-right font-semibold ${rateTone}`}>
                {a.total === 0 ? "—" : `${Math.round(a.successRate * 100)}%`}
              </Td>
              <Td className="text-right text-gray-700 dark:text-gray-300">
                {a.total}
                {a.total > 0 && (
                  <span className="ml-1 text-xs text-gray-400" title="manual / agendado">
                    ({a.manual}m·{a.scheduled}a)
                  </span>
                )}
              </Td>
              <Td className="text-right">
                {a.failed > 0 ? (
                  <span className="font-medium text-red-600 dark:text-red-400">{a.failed}</span>
                ) : (
                  <span className="text-gray-300 dark:text-gray-600">0</span>
                )}
              </Td>
              <Td className="text-right text-xs text-gray-500">
                {fmtDuration(a.durationP50S)} / {fmtDuration(a.durationP95S)}
              </Td>
              <Td>
                <div className="flex items-center gap-0.5">
                  {a.recent.length === 0 && <span className="text-xs text-gray-400">—</span>}
                  {/* recent vem mais-recente-primeiro; inverte pra ler como linha do tempo */}
                  {[...a.recent].reverse().map((s, i) => (
                    <span
                      key={i}
                      className={`inline-block h-2.5 w-2.5 rounded-sm ${dotClass(s)}`}
                      title={STATUS_LABEL[s]}
                    />
                  ))}
                </div>
              </Td>
              <Td>
                {a.lastStatus ? (
                  <div className="flex items-center gap-2">
                    <Badge className={STATUS_STYLE[a.lastStatus]}>{STATUS_LABEL[a.lastStatus]}</Badge>
                    {a.lastRunAt && (
                      <span className="text-xs text-gray-500">
                        {formatDistanceToNow(new Date(a.lastRunAt), { locale: ptBR, addSuffix: true })}
                      </span>
                    )}
                  </div>
                ) : (
                  <span className="text-xs text-gray-400">nunca executou</span>
                )}
              </Td>
            </Tr>
          );
        })}
      </TBody>
    </Table>
  );
}

export default function DashboardPage() {
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [range, setRange] = useState<MetricsRange>("24h");
  const rangeCfg = RANGES.find((r) => r.value === range) ?? RANGES[0];

  const { data: metrics, isLoading: metricsLoading } = useQuery({
    queryKey: ["metrics", range],
    queryFn: () => metricsApi.get(range).then((r) => r.data),
    refetchInterval: 5000,
    // mantém os números anteriores na troca de período (sem flash de skeleton)
    placeholderData: (prev) => prev,
  });

  const { data: chart = [], isError: chartError, refetch: refetchChart } = useQuery({
    queryKey: ["metrics", "jobsPerHour", range],
    queryFn: () => metricsApi.jobsPerHour(range).then((r) => r.data),
    refetchInterval: 60_000,
    placeholderData: (prev) => prev,
  });

  const { data: automations = [] } = useQuery({
    queryKey: ["automations"],
    queryFn: () => automationsApi.list().then((r) => r.data),
    staleTime: 60_000,
  });

  // "Rodando agora" combina pending+running. Backend não aceita lista de
  // status, então duas queries paralelas e mescla — barato pelo limit baixo.
  const { data: pendingItems = [], isError: pendingError, refetch: refetchPending } = useQuery({
    queryKey: ["jobs", "list", "active", "pending"],
    queryFn: () =>
      jobsApi.list({ status: "pending", limit: 20 }).then((r) => r.data.items),
    refetchInterval: 5000,
  });
  const { data: runningItems = [], isError: runningError, refetch: refetchRunning } = useQuery({
    queryKey: ["jobs", "list", "active", "running"],
    queryFn: () =>
      jobsApi.list({ status: "running", limit: 20 }).then((r) => r.data.items),
    refetchInterval: 5000,
  });

  const activeJobs: Job[] = useMemo(
    () =>
      [...runningItems, ...pendingItems].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      ),
    [runningItems, pendingItems]
  );

  const { data: recentFailures = [], isError: failuresError, refetch: refetchFailures } = useQuery({
    queryKey: ["jobs", "list", "failed", "recent"],
    queryFn: () =>
      jobsApi.list({ status: "failed", limit: 8 }).then((r) => r.data.items),
    refetchInterval: 30_000,
  });

  // Próximas execuções agendadas — o dashboard mostra o que VAI acontecer,
  // não só o que aconteceu. next_run_at vem do scheduler.
  const { data: schedules = [], isError: schedulesError, refetch: refetchSchedules } = useQuery({
    queryKey: ["schedules"],
    queryFn: () => schedulesApi.list().then((r) => r.data),
    refetchInterval: 60_000,
  });

  const upcoming = useMemo(
    () =>
      schedules
        .filter((s) => s.isEnabled && s.nextRunAt)
        .sort((a, b) => new Date(a.nextRunAt!).getTime() - new Date(b.nextRunAt!).getTime())
        .slice(0, 8),
    [schedules]
  );

  const activeError = pendingError || runningError;

  const automationName = (id: number) =>
    automations.find((a) => a.id === id)?.name ?? `#${id}`;

  const successRateLabel =
    metrics && metrics.totalLast24h > 0
      ? `${Math.round(metrics.successRate24h * 100)}%`
      : "—";

  return (
    <div className="space-y-6">
      {/* Seletor de período — vale pros cards de falha/cancelado/sucesso e pro gráfico */}
      <div className="flex items-center justify-end gap-1.5">
        <span className="mr-1 text-xs text-gray-500">Período:</span>
        {RANGES.map((r) => (
          <button
            key={r.value}
            onClick={() => setRange(r.value)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              range === r.value
                ? "bg-rps-olive-dark text-white"
                : "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <StatCard
          label="Rodando"
          value={metrics?.running ?? "—"}
          tone={metrics?.running ? "success" : "neutral"}
          loading={metricsLoading}
        />
        <StatCard label="Pendentes" value={metrics?.pending ?? "—"} loading={metricsLoading} />
        <StatCard label="Concluídos hoje" value={metrics?.completedToday ?? "—"} loading={metricsLoading} />
        <StatCard
          label={`Falhas ${rangeCfg.label}`}
          value={metrics?.failedLast24h ?? "—"}
          tone={metrics?.failedLast24h ? "danger" : "neutral"}
          loading={metricsLoading}
        />
        <StatCard label={`Cancelados ${rangeCfg.label}`} value={metrics?.canceledLast24h ?? "—"} loading={metricsLoading} />
        <StatCard
          label={`Sucesso ${rangeCfg.label}`}
          value={successRateLabel}
          hint={metrics ? `${metrics.totalLast24h} finalizados` : undefined}
          loading={metricsLoading}
        />
      </div>

      <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 shadow-sm">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">{rangeCfg.chartTitle}</h2>
          <span className="text-xs text-gray-500">
            {metrics ? `${metrics.totalLast24h} no período` : "—"}
          </span>
        </div>
        {chartError && chart.length === 0 ? (
          <ErrorState onRetry={() => refetchChart()} />
        ) : (
          <>
            <JobsPerHourChart buckets={chart} mode={range === "24h" ? "hour" : "day"} />
            <ChartLegend />
          </>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
        <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 shadow-sm">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Rodando agora</h2>
            <span className="text-xs text-gray-500">
              {activeJobs.length === 0
                ? "Nenhum job ativo"
                : `${activeJobs.length} ativo${activeJobs.length === 1 ? "" : "s"}`}
            </span>
          </div>
          {activeError && activeJobs.length === 0 ? (
            <ErrorState onRetry={() => { refetchPending(); refetchRunning(); }} />
          ) : activeJobs.length === 0 ? (
            <EmptyState className="py-4">Sem jobs em andamento no momento.</EmptyState>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-gray-800">
              {activeJobs.map((j) => (
                <li
                  key={j.id}
                  className="flex cursor-pointer items-center gap-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800"
                  onClick={() => setSelectedJobId(j.id)}
                >
                  <Badge className={STATUS_STYLE[j.status]}>{STATUS_LABEL[j.status]}</Badge>
                  <span className="flex-1 truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                    {automationName(j.automationId)}
                  </span>
                  <span className="font-mono text-xs text-gray-500">
                    {j.id.slice(0, 8)}…
                  </span>
                  <span className="text-xs text-gray-500">
                    {formatDistanceToNow(new Date(j.createdAt), {
                      locale: ptBR,
                      addSuffix: true,
                    })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 shadow-sm">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Últimas falhas</h2>
            <Link href="/jobs?status=failed" className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-300">
              ver tudo
            </Link>
          </div>
          {failuresError && recentFailures.length === 0 ? (
            <ErrorState onRetry={() => refetchFailures()} />
          ) : recentFailures.length === 0 ? (
            <EmptyState className="py-4">Nenhuma falha recente.</EmptyState>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-gray-800">
              {recentFailures.map((j) => (
                <li
                  key={j.id}
                  className="flex cursor-pointer items-center gap-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800"
                  onClick={() => setSelectedJobId(j.id)}
                >
                  <Badge className="bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300">
                    Falhou
                  </Badge>
                  <span className="flex-1 truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                    {automationName(j.automationId)}
                  </span>
                  <span className="font-mono text-xs text-gray-500">
                    {j.id.slice(0, 8)}…
                  </span>
                  <span className="text-xs text-gray-500">
                    {j.completedAt
                      ? formatDistanceToNow(new Date(j.completedAt), {
                          locale: ptBR,
                          addSuffix: true,
                        })
                      : formatDistanceToNow(new Date(j.createdAt), {
                          locale: ptBR,
                          addSuffix: true,
                        })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 shadow-sm">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Próximas execuções</h2>
            <Link href="/schedules" className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-300">
              ver agendamentos
            </Link>
          </div>
          {schedulesError && upcoming.length === 0 ? (
            <ErrorState onRetry={() => refetchSchedules()} />
          ) : upcoming.length === 0 ? (
            <EmptyState className="py-4">Nenhum agendamento ativo.</EmptyState>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-gray-800">
              {upcoming.map((s) => (
                <li key={s.id} className="flex items-center gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                      {automationName(s.automationId)}
                    </p>
                    <p className="truncate text-xs text-gray-500">{describeCron(s.cronExpression)}</p>
                  </div>
                  <span className="shrink-0 text-xs font-medium text-rps-olive-dark">
                    {formatDistanceToNow(new Date(s.nextRunAt!), { locale: ptBR, addSuffix: true })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <ErrorClassBreakdown range={range} />

      <div>
        <h2 className="mb-3 text-sm font-semibold text-gray-700 dark:text-gray-300">
          Saúde por automação · {rangeCfg.label}
        </h2>
        <AutomationHealthTable range={range} />
      </div>

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
