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
  type Job,
  type JobsPerHourBucket,
} from "@/lib/api";
import { STATUS_LABEL, STATUS_STYLE } from "@/lib/jobs";
import { JobPanel } from "@/components/job-panel";

function StatCard({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "neutral" | "success" | "warning" | "danger";
}) {
  const accent =
    tone === "success"
      ? "text-rps-olive-dark"
      : tone === "warning"
        ? "text-yellow-700"
        : tone === "danger"
          ? "text-red-700"
          : "text-gray-900";
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wider text-gray-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${accent}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-gray-500">{hint}</p>}
    </div>
  );
}

function JobsPerHourChart({ buckets }: { buckets: JobsPerHourBucket[] }) {
  if (buckets.length === 0) {
    return <p className="py-8 text-center text-sm text-gray-500">Sem dados.</p>;
  }

  const max = Math.max(1, ...buckets.map((b) => b.total));
  const W = 720;
  const H = 140;
  const P = { top: 8, right: 8, bottom: 24, left: 28 };
  const chartW = W - P.left - P.right;
  const chartH = H - P.top - P.bottom;
  const slotW = chartW / buckets.length;
  const barW = Math.max(2, slotW - 3);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Jobs por hora nas últimas 24h">
      <line
        x1={P.left}
        x2={W - P.right}
        y1={P.top + chartH}
        y2={P.top + chartH}
        stroke="#e5e7eb"
        strokeWidth={1}
      />
      <text x={P.left - 4} y={P.top + 8} fontSize="10" fill="#6b7280" textAnchor="end">
        {max}
      </text>
      <text x={P.left - 4} y={P.top + chartH} fontSize="10" fill="#6b7280" textAnchor="end">
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
              fill="#d1d5db"
            />
            <rect
              x={x}
              y={baseY - succH - failH}
              width={barW}
              height={Math.max(0, succH)}
              fill="#a7baa6"
            />
            <rect
              x={x}
              y={baseY - failH}
              width={barW}
              height={Math.max(0, failH)}
              fill="#fca5a5"
            />
            <title>
              {`${format(new Date(b.hour), "HH:00")} — ${b.total} jobs (${b.succeeded} ok, ${b.failed} falhas)`}
            </title>
          </g>
        );
      })}

      {buckets
        .map((b, i) => ({ b, i }))
        .filter(({ i }) => i % 4 === 0)
        .map(({ b, i }) => (
          <text
            key={b.hour}
            x={P.left + i * slotW + slotW / 2}
            y={H - 6}
            fontSize="10"
            fill="#6b7280"
            textAnchor="middle"
          >
            {format(new Date(b.hour), "HH'h'")}
          </text>
        ))}
    </svg>
  );
}

function ChartLegend() {
  return (
    <div className="mt-2 flex flex-wrap gap-3 text-xs text-gray-600">
      <span className="flex items-center gap-1">
        <span className="inline-block h-2 w-2 rounded-sm bg-[#a7baa6]" /> sucesso
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-block h-2 w-2 rounded-sm bg-[#fca5a5]" /> falha
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-block h-2 w-2 rounded-sm bg-gray-300" /> outros
      </span>
    </div>
  );
}

export default function DashboardPage() {
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  const { data: metrics } = useQuery({
    queryKey: ["metrics"],
    queryFn: () => metricsApi.get().then((r) => r.data),
    refetchInterval: 5000,
  });

  const { data: chart = [] } = useQuery({
    queryKey: ["metrics", "jobsPerHour"],
    queryFn: () => metricsApi.jobsPerHour().then((r) => r.data),
    refetchInterval: 60_000,
  });

  const { data: automations = [] } = useQuery({
    queryKey: ["automations"],
    queryFn: () => automationsApi.list().then((r) => r.data),
    staleTime: 60_000,
  });

  // "Rodando agora" combina pending+running. Backend não aceita lista de
  // status, então duas queries paralelas e mescla — barato pelo limit baixo.
  const { data: pendingItems = [] } = useQuery({
    queryKey: ["jobs", "list", "active", "pending"],
    queryFn: () =>
      jobsApi.list({ status: "pending", limit: 20 }).then((r) => r.data.items),
    refetchInterval: 5000,
  });
  const { data: runningItems = [] } = useQuery({
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

  const { data: recentFailures = [] } = useQuery({
    queryKey: ["jobs", "list", "failed", "recent"],
    queryFn: () =>
      jobsApi.list({ status: "failed", limit: 8 }).then((r) => r.data.items),
    refetchInterval: 30_000,
  });

  const automationName = (id: number) =>
    automations.find((a) => a.id === id)?.name ?? `#${id}`;

  const successRateLabel =
    metrics && metrics.totalLast24h > 0
      ? `${Math.round(metrics.successRate24h * 100)}%`
      : "—";

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <StatCard
          label="Rodando"
          value={metrics?.running ?? "—"}
          tone={metrics?.running ? "success" : "neutral"}
        />
        <StatCard label="Pendentes" value={metrics?.pending ?? "—"} />
        <StatCard label="Concluídos hoje" value={metrics?.completedToday ?? "—"} />
        <StatCard
          label="Falhas 24h"
          value={metrics?.failedLast24h ?? "—"}
          tone={metrics?.failedLast24h ? "danger" : "neutral"}
        />
        <StatCard label="Cancelados 24h" value={metrics?.canceledLast24h ?? "—"} />
        <StatCard
          label="Sucesso 24h"
          value={successRateLabel}
          hint={metrics ? `${metrics.totalLast24h} finalizados` : undefined}
        />
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-gray-700">Jobs por hora · últimas 24h</h2>
          <span className="text-xs text-gray-500">
            {metrics ? `${metrics.totalLast24h} no período` : "—"}
          </span>
        </div>
        <JobsPerHourChart buckets={chart} />
        <ChartLegend />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-gray-700">Rodando agora</h2>
            <span className="text-xs text-gray-500">
              {activeJobs.length === 0
                ? "Nenhum job ativo"
                : `${activeJobs.length} ativo${activeJobs.length === 1 ? "" : "s"}`}
            </span>
          </div>
          {activeJobs.length === 0 ? (
            <p className="py-4 text-sm text-gray-500">Sem jobs em andamento no momento.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {activeJobs.map((j) => (
                <li
                  key={j.id}
                  className="flex cursor-pointer items-center gap-3 py-2 hover:bg-gray-50"
                  onClick={() => setSelectedJobId(j.id)}
                >
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[j.status]}`}
                  >
                    {STATUS_LABEL[j.status]}
                  </span>
                  <span className="flex-1 truncate text-sm font-medium text-gray-900">
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

        <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-gray-700">Últimas falhas</h2>
            <Link href="/jobs?status=failed" className="text-xs text-gray-500 hover:text-gray-700">
              ver tudo
            </Link>
          </div>
          {recentFailures.length === 0 ? (
            <p className="py-4 text-sm text-gray-500">Nenhuma falha recente. 🎉</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {recentFailures.map((j) => (
                <li
                  key={j.id}
                  className="flex cursor-pointer items-center gap-3 py-2 hover:bg-gray-50"
                  onClick={() => setSelectedJobId(j.id)}
                >
                  <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
                    Falhou
                  </span>
                  <span className="flex-1 truncate text-sm font-medium text-gray-900">
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
