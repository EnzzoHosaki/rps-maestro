"use client";

import { Suspense, useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { AlertTriangle, X } from "lucide-react";
import {
  notasApi,
  xmlMetricsApi,
  empresasApi,
  XML_STATUS_LABEL,
  XML_STATUS_STYLE,
  XML_DOC_TYPE_LABEL,
  type NotaStatus,
  type DocType,
  type DateField,
  type EmpresaAgg,
} from "@/lib/xml-api";
import { Modal } from "@/components/ui/modal";
import { Skeleton, SkeletonRow } from "@/components/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, THead, Th, TBody, Tr, Td } from "@/components/ui/table";
import { EmptyRow } from "@/components/ui/empty-state";
import { ErrorRow } from "@/components/ui/error-state";

const PAGE_SIZE = 50;

const STATUS_FILTERS: { value: NotaStatus | "all"; label: string }[] = [
  { value: "all", label: "Todos" },
  { value: "arrived", label: "Chegou" },
  { value: "synced", label: "Sincronizado" },
  { value: "imported", label: "Importado" },
  { value: "import_ignored", label: "Ignorada" },
  { value: "stuck", label: "Travada" },
  { value: "lost", label: "Sumida" },
];

const DOC_TYPES: (DocType | "all")[] = ["all", "NFE", "NFCE", "CTE"];

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

function fmtDur(s?: number): string {
  if (s == null) return "—";
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return m ? `${h}h ${m}min` : `${h}h`;
}

function fmtTs(s?: string): string {
  return s ? format(new Date(s), "dd/MM/yyyy HH:mm:ss") : "—";
}

function fmtBRL(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmtParty(nome?: string, doc?: string): string {
  if (nome && doc) return `${nome} (${doc})`;
  return nome || doc || "—";
}

export default function XmlPage() {
  // useSearchParams precisa de fronteira de Suspense no app router (senão o
  // prerender estático quebra). O conteúdo real fica no XmlPageContent.
  return (
    <Suspense fallback={<div className="text-sm text-gray-500">Carregando…</div>}>
      <XmlPageContent />
    </Suspense>
  );
}

function XmlPageContent() {
  const sp = useSearchParams();
  // Estado inicial vem da URL (deep-link/drill-down); depois espelhamos de
  // volta pra URL via replaceState a cada mudança de filtro.
  const [statusFilter, setStatusFilter] = useState<NotaStatus | "all">(
    () => (sp.get("status") as NotaStatus) || "all"
  );
  const [docFilter, setDocFilter] = useState<DocType | "all">(
    () => (sp.get("doc_type") as DocType) || "all"
  );
  const [view, setView] = useState<"notas" | "empresas">(
    () => (sp.get("view") === "empresas" ? "empresas" : "notas")
  );
  const [q, setQ] = useState(() => sp.get("q") ?? "");
  const [empresa, setEmpresa] = useState(() => sp.get("empresa") ?? "");
  const [cnpj, setCnpj] = useState(() => sp.get("cnpj") ?? "");
  const [codigoEmpresa, setCodigoEmpresa] = useState<number | null>(() => {
    const v = sp.get("codigo_empresa");
    return v ? Number(v) : null;
  });
  const [codigoFilial, setCodigoFilial] = useState<number | null>(() => {
    const v = sp.get("codigo_filial");
    return v ? Number(v) : null;
  });
  const [semEmpresa, setSemEmpresa] = useState(() => sp.get("sem_empresa") === "true");
  const [dateField, setDateField] = useState<DateField>(
    () => (sp.get("date_field") as DateField) || "imported"
  );
  const [from, setFrom] = useState(() => sp.get("from") ?? "");
  const [to, setTo] = useState(() => sp.get("to") ?? "");
  const [offset, setOffset] = useState(() => Number(sp.get("offset")) || 0);
  const [selected, setSelected] = useState<string | null>(null);

  // Espelha os filtros na URL (sem navegar/refetch): URL compartilhável e
  // base pro drill-down por empresa do Bloco C1.
  useEffect(() => {
    const p = new URLSearchParams();
    if (view === "empresas") p.set("view", "empresas");
    if (statusFilter !== "all") p.set("status", statusFilter);
    if (docFilter !== "all") p.set("doc_type", docFilter);
    if (q) p.set("q", q);
    if (empresa) p.set("empresa", empresa);
    if (cnpj) p.set("cnpj", cnpj);
    if (semEmpresa) p.set("sem_empresa", "true");
    if (codigoEmpresa != null) p.set("codigo_empresa", String(codigoEmpresa));
    if (codigoFilial != null) p.set("codigo_filial", String(codigoFilial));
    if (from || to) {
      p.set("date_field", dateField);
      if (from) p.set("from", from);
      if (to) p.set("to", to);
    }
    if (offset) p.set("offset", String(offset));
    const qs = p.toString();
    window.history.replaceState(null, "", qs ? `/xml?${qs}` : "/xml");
  }, [view, statusFilter, docFilter, q, empresa, cnpj, semEmpresa, codigoEmpresa, codigoFilial, dateField, from, to, offset]);

  const overview = useQuery({
    queryKey: ["xml", "overview"],
    queryFn: () => xmlMetricsApi.overview().then((r) => r.data),
    refetchInterval: 10_000,
  });

  const list = useQuery({
    queryKey: ["xml", "notas", { statusFilter, docFilter, q, empresa, cnpj, semEmpresa, codigoEmpresa, codigoFilial, dateField, from, to, offset }],
    queryFn: () =>
      notasApi
        .list({
          status: statusFilter === "all" ? undefined : statusFilter,
          doc_type: docFilter === "all" ? undefined : docFilter,
          q: q || undefined,
          empresa: empresa || undefined,
          cnpj: cnpj || undefined,
          sem_empresa: semEmpresa || undefined,
          codigo_empresa: codigoEmpresa ?? undefined,
          codigo_filial: codigoFilial ?? undefined,
          date_field: from || to ? dateField : undefined,
          from: from || undefined,
          to: to || undefined,
          limit: PAGE_SIZE,
          offset,
        })
        .then((r) => r.data),
    refetchInterval: 15_000,
    placeholderData: (prev) => prev,
    enabled: view === "notas",
  });

  const ov = overview.data;
  const total = list.data?.total ?? 0;
  const items = list.data?.items ?? [];
  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // "Pendente" = mesma definição do tracker (arrived+synced+pending_import+stuck;
  // stuck conta, lost não, terminais fora). Mantém cards e filtro alinhados.
  const pendentes = ov ? ov.arrived + ov.synced + ov.pending_import + ov.stuck : 0;
  const showStuck = overview.isLoading || (ov?.stuck ?? 0) > 0;
  const showLost = overview.isLoading || (ov?.lost ?? 0) > 0;

  function reset<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      setOffset(0);
    };
  }

  // Limpa o filtro de empresa (código, filial e o bucket "sem empresa").
  function clearEmpresaFilter() {
    setCodigoEmpresa(null);
    setCodigoFilial(null);
    setSemEmpresa(false);
    setOffset(0);
  }

  // Drill-down da visão por empresa → abre a aba Notas filtrada por aquela
  // (empresa, filial), ou pelo bucket "sem empresa".
  function drillToEmpresa(row: EmpresaAgg) {
    setStatusFilter("all");
    setOffset(0);
    if (row.codigo_empresa == null) {
      setSemEmpresa(true);
      setCodigoEmpresa(null);
      setCodigoFilial(null);
    } else {
      setSemEmpresa(false);
      setCodigoEmpresa(row.codigo_empresa);
      setCodigoFilial(row.codigo_filial ?? null);
    }
    setView("notas");
  }

  const empresaFilterLabel = semEmpresa
    ? "Sem empresa"
    : codigoEmpresa != null
      ? `#${codigoEmpresa}${codigoFilial != null ? `-${codigoFilial}` : ""}`
      : null;

  return (
    <div className="space-y-5">
      {/* Banner: tracker indisponível/instável */}
      {(overview.isError || list.isError) && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
          <span>Rastreador XML indisponível ou instável — os dados podem estar desatualizados.</span>
          <button
            onClick={() => {
              overview.refetch();
              list.refetch();
            }}
            className="ml-auto rounded bg-amber-100 px-2 py-1 text-xs font-medium text-amber-900 hover:bg-amber-200 dark:bg-amber-900/40 dark:text-amber-200 dark:hover:bg-amber-900/60"
          >
            Tentar de novo
          </button>
        </div>
      )}

      {/* Cards do pipeline (Travadas/Sumidas só aparecem quando > 0) */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <StatCard label="A sincronizar" value={ov?.arrived ?? "—"} tone={ov?.arrived ? "warning" : "neutral"} loading={overview.isLoading} />
        <StatCard label="Sincronizadas" value={ov?.synced ?? "—"} loading={overview.isLoading} />
        <StatCard label="Aguardando import." value={ov?.pending_import ?? "—"} loading={overview.isLoading} />
        <StatCard label="Importadas hoje" value={ov?.imported_today ?? "—"} tone="success" loading={overview.isLoading} />
        <StatCard label="Ignoradas" value={ov?.import_ignored ?? "—"} loading={overview.isLoading} />
        {showStuck && (
          <StatCard label="Travadas" value={ov?.stuck ?? "—"} tone="danger" loading={overview.isLoading} />
        )}
        {showLost && (
          <StatCard label="Sumidas" value={ov?.lost ?? "—"} tone="danger" loading={overview.isLoading} />
        )}
      </div>
      {ov && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
          <span>
            <b className="text-gray-700 dark:text-gray-300">{pendentes}</b> pendentes
            <span className="text-gray-400"> (chegou + sincronizado + aguardando + travada)</span>
            {" · "}
            {ov.in_transit} em trânsito
          </span>
          <span title="Calculadas só sobre notas rastreadas em tempo real; exclui backfill histórico.">
            Latência chegada→sync: p50 <b className="text-gray-700 dark:text-gray-300">{fmtDur(ov.lat_arrival_sync_p50_s)}</b> · p95 {fmtDur(ov.lat_arrival_sync_p95_s)}
          </span>
          <span title="Calculadas só sobre notas rastreadas em tempo real; exclui backfill histórico.">
            Latência sync→import: p50 <b className="text-gray-700 dark:text-gray-300">{fmtDur(ov.lat_sync_import_p50_s)}</b> · p95 {fmtDur(ov.lat_sync_import_p95_s)}
          </span>
        </div>
      )}

      {/* Toggle de visão: Notas (lista) × Empresas (agregado) */}
      <div className="flex gap-1.5">
        {(["notas", "empresas"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              view === v
                ? "bg-rps-olive-dark text-white"
                : "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
            }`}
          >
            {v === "notas" ? "Notas" : "Empresas"}
          </button>
        ))}
      </div>

      {view === "empresas" ? (
        <EmpresasView onDrill={drillToEmpresa} />
      ) : (
        <>
      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-1.5">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s.value}
              onClick={() => reset(setStatusFilter)(s.value)}
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
          value={docFilter}
          onChange={(e) => reset(setDocFilter)(e.target.value as DocType | "all")}
          className="rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1 text-sm focus:border-rps-olive-dark focus:outline-none"
        >
          {DOC_TYPES.map((d) => (
            <option key={d} value={d}>{d === "all" ? "Todos os tipos" : XML_DOC_TYPE_LABEL[d]}</option>
          ))}
        </select>
        <input
          value={q}
          onChange={(e) => reset(setQ)(e.target.value.trim())}
          placeholder="Buscar por chave de acesso…"
          className="min-w-[280px] flex-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm placeholder-gray-500 focus:border-rps-olive-dark focus:outline-none"
        />
        <span className="text-sm text-gray-500">
          {list.isFetching ? "Atualizando…" : `${total} nota${total === 1 ? "" : "s"}`}
        </span>
      </div>

      {/* Filtros: empresa, cnpj, data */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          value={empresa}
          onChange={(e) => reset(setEmpresa)(e.target.value)}
          placeholder="Empresa (nome)…"
          className="w-48 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm placeholder-gray-500 focus:border-rps-olive-dark focus:outline-none"
        />
        <input
          value={cnpj}
          onChange={(e) => reset(setCnpj)(e.target.value.trim())}
          placeholder="CNPJ emit/dest…"
          className="w-44 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm placeholder-gray-500 focus:border-rps-olive-dark focus:outline-none"
        />
        <div className="flex items-center gap-1.5 text-sm text-gray-500">
          <select
            value={dateField}
            onChange={(e) => reset(setDateField)(e.target.value as DateField)}
            className="rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1 text-sm focus:border-rps-olive-dark focus:outline-none"
          >
            <option value="emissao">Data emissão</option>
            <option value="arrived">Data chegada</option>
            <option value="synced">Data sincronização</option>
            <option value="imported">Data importação</option>
          </select>
          <input type="date" value={from} onChange={(e) => reset(setFrom)(e.target.value)}
            className="rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1 text-sm focus:border-rps-olive-dark focus:outline-none" />
          <span>até</span>
          <input type="date" value={to} onChange={(e) => reset(setTo)(e.target.value)}
            className="rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1 text-sm focus:border-rps-olive-dark focus:outline-none" />
        </div>
      </div>

      {/* Filtro ativo de empresa (vindo de drill-down / URL) */}
      {empresaFilterLabel != null && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-gray-500">Filtrando por empresa:</span>
          <Badge shape="square" className="inline-flex items-center gap-1 bg-rps-sage-soft text-rps-olive-dark">
            {empresaFilterLabel}
            <button
              onClick={clearEmpresaFilter}
              aria-label="Remover filtro de empresa"
              className="rounded hover:text-rps-olive-darker"
            >
              <X className="h-3 w-3" aria-hidden />
            </button>
          </Badge>
        </div>
      )}

      {/* Tabela */}
      <Table>
        <THead>
          <Th>Chave</Th>
          <Th>Tipo</Th>
          <Th>Empresa</Th>
          <Th>Emitente</Th>
          <Th>Status</Th>
          <Th>Importação</Th>
        </THead>
        <TBody>
          {items.map((n) => (
            <Tr
              key={n.chave_acesso}
              className="cursor-pointer"
              onClick={() => setSelected(n.chave_acesso)}
            >
              <Td className="font-mono text-xs text-gray-600 dark:text-gray-400" title={n.chave_acesso}>
                …{n.chave_acesso.slice(-12)}
              </Td>
              <Td className="text-gray-700 dark:text-gray-300">{XML_DOC_TYPE_LABEL[n.doc_type]}</Td>
              <Td className="max-w-[220px] truncate text-gray-700 dark:text-gray-300" title={n.nome_empresa}>
                {n.codigo_empresa ? (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setSemEmpresa(false);
                      setCodigoFilial(null);
                      reset(setCodigoEmpresa)(n.codigo_empresa!);
                    }}
                    className="truncate text-left hover:text-rps-olive-dark hover:underline"
                    title="Filtrar por esta empresa"
                  >
                    {n.nome_empresa || `#${n.codigo_empresa}-${n.codigo_filial ?? 1}`}
                  </button>
                ) : (
                  n.nome_empresa || "—"
                )}
              </Td>
              <Td className="max-w-[220px] truncate text-gray-600 dark:text-gray-400" title={n.nome_emitente}>
                {n.nome_emitente || n.cnpj_emitente || "—"}
              </Td>
              <Td>
                <Badge className={XML_STATUS_STYLE[n.status]}>{XML_STATUS_LABEL[n.status]}</Badge>
              </Td>
              <Td className="text-xs text-gray-500">{fmtTs(n.imported_at)}</Td>
            </Tr>
          ))}
          {list.isError && items.length === 0 && (
            <ErrorRow colSpan={6} onRetry={() => list.refetch()} />
          )}
          {!list.isLoading && !list.isError && items.length === 0 && (
            <EmptyRow colSpan={6}>Nenhuma nota encontrada com os filtros atuais.</EmptyRow>
          )}
          {list.isLoading && Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} cols={6} />)}
        </TBody>
      </Table>

      {total > 0 && (
        <div className="flex items-center justify-between text-sm text-gray-600 dark:text-gray-400">
          <span>{offset + 1}–{Math.min(offset + PAGE_SIZE, total)} de {total}</span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              disabled={offset === 0}
            >
              Anterior
            </Button>
            <span className="px-2 text-xs text-gray-500">{page} / {totalPages}</span>
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
        </>
      )}

      {selected && <NotaDetailModal chave={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

// Visão por empresa: uma linha por (empresa, filial) + a linha "Sem empresa",
// ordenada por pendentes desc (sem-empresa fixada por último). Drill-down
// reusa os filtros de URL da aba Notas.
function EmpresasView({ onDrill }: { onDrill: (row: EmpresaAgg) => void }) {
  const q = useQuery({
    queryKey: ["xml", "empresas"],
    queryFn: () => empresasApi.list({ limit: 0 }).then((r) => r.data),
    refetchInterval: 30_000,
  });

  const pend = (e: EmpresaAgg) => e.arrived + e.synced + e.pending_import + e.stuck;
  const rows = [...(q.data?.items ?? [])].sort((a, b) => {
    const aNo = a.codigo_empresa == null;
    const bNo = b.codigo_empresa == null;
    if (aNo !== bNo) return aNo ? 1 : -1; // "Sem empresa" sempre por último
    return pend(b) - pend(a);
  });

  const numCols = 8;
  const cell = (n: number, tone?: "danger" | "warn") =>
    n === 0 ? (
      <span className="text-gray-300 dark:text-gray-600">0</span>
    ) : (
      <span className={tone === "danger" ? "font-medium text-red-600 dark:text-red-400" : tone === "warn" ? "text-amber-700 dark:text-amber-400" : ""}>{n}</span>
    );

  return (
    <Table>
      <THead>
        <Th>Empresa</Th>
        <Th className="text-right" title="Chegou + sincronizado + aguardando + travada">Pendentes</Th>
        <Th className="text-right">A sinc.</Th>
        <Th className="text-right">Sincr.</Th>
        <Th className="text-right">Aguard.</Th>
        <Th className="text-right">Travadas</Th>
        <Th className="text-right">Sumidas</Th>
        <Th className="text-right">Importadas</Th>
      </THead>
      <TBody>
        {rows.map((e) => {
          const isNoEmpresa = e.codigo_empresa == null;
          return (
            <Tr
              key={isNoEmpresa ? "sem-empresa" : `${e.codigo_empresa}-${e.codigo_filial ?? "x"}`}
              className="cursor-pointer"
              onClick={() => onDrill(e)}
            >
              <Td className="max-w-[280px] truncate text-gray-700 dark:text-gray-300" title={e.nome_empresa}>
                {isNoEmpresa ? (
                  <span className="italic text-gray-500">Sem empresa</span>
                ) : (
                  e.nome_empresa || `#${e.codigo_empresa}-${e.codigo_filial ?? 1}`
                )}
              </Td>
              <Td className="text-right font-semibold text-gray-900 dark:text-gray-100">{pend(e)}</Td>
              <Td className="text-right">{cell(e.arrived, "warn")}</Td>
              <Td className="text-right">{cell(e.synced)}</Td>
              <Td className="text-right">{cell(e.pending_import)}</Td>
              <Td className="text-right">{cell(e.stuck, "danger")}</Td>
              <Td className="text-right">{cell(e.lost, "danger")}</Td>
              <Td className="text-right text-gray-500">{e.imported}</Td>
            </Tr>
          );
        })}
        {q.isError && rows.length === 0 && <ErrorRow colSpan={numCols} onRetry={() => q.refetch()} />}
        {!q.isLoading && !q.isError && rows.length === 0 && (
          <EmptyRow colSpan={numCols}>Nenhuma empresa com notas rastreadas.</EmptyRow>
        )}
        {q.isLoading && Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} cols={numCols} />)}
      </TBody>
    </Table>
  );
}

const STAGE_LABEL: Record<string, string> = {
  arrival: "Chegada",
  sync: "Sincronização",
  import: "Importação",
};

function NotaDetailModal({ chave, onClose }: { chave: string; onClose: () => void }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["xml", "nota", chave],
    queryFn: () => notasApi.get(chave).then((r) => r.data),
  });

  return (
    <Modal title="Nota fiscal" onClose={onClose} wide>
      <p className="mb-4 break-all font-mono text-xs text-gray-500">{chave}</p>

      {isLoading && <Skeleton className="h-32 w-full" />}
      {isError && <p className="text-sm text-red-600">Falha ao carregar a nota.</p>}

      {data && (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <Field label="Tipo" value={XML_DOC_TYPE_LABEL[data.doc_type]} />
            <Field label="Status">
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${XML_STATUS_STYLE[data.status]}`}>
                {XML_STATUS_LABEL[data.status]}
              </span>
            </Field>
            <Field label="Empresa" value={data.nome_empresa || (data.codigo_empresa ? `#${data.codigo_empresa}-${data.codigo_filial ?? 1}` : "—")} />
            <Field label="Emissão" value={data.data_emissao ?? "—"} />
            <Field label="Valor" value={data.valor_total != null ? fmtBRL(data.valor_total) : "—"} />
            <Field label="Emitente" value={fmtParty(data.nome_emitente, data.cnpj_emitente)} />
            <Field label="Destinatário" value={fmtParty(data.nome_destinatario, data.cnpj_destinatario)} />
            <Field label="Latência chegada→sync" value={fmtDur(data.lat_arrival_sync_s)} />
            <Field label="Latência sync→import" value={fmtDur(data.lat_sync_import_s)} />
          </div>

          {data.motivo_ignorado && (
            <div className="mb-5 rounded border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800 p-3 text-xs text-gray-600 dark:text-gray-400">
              <b>Motivo da importação ignorada:</b> {data.motivo_ignorado}
            </div>
          )}

          <h3 className="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-300">Linha do tempo</h3>
          <ol className="relative space-y-3 border-l border-gray-200 pl-5 dark:border-gray-700">
            {data.spans.length === 0 && <li className="text-sm text-gray-500">Sem eventos.</li>}
            {data.spans.map((s, i) => (
              <li key={i} className="relative">
                <span className="absolute -left-[23px] top-1 h-2.5 w-2.5 rounded-full bg-rps-olive-dark" />
                <p className="text-sm font-medium text-gray-800 dark:text-gray-200">
                  {STAGE_LABEL[s.stage] ?? s.stage} <span className="text-xs font-normal text-gray-500">· {s.event_type}</span>
                </p>
                <p className="text-xs text-gray-500">{fmtTs(s.observed_at)} · {s.source}</p>
                {s.file_path && <p className="break-all text-[11px] text-gray-400">{s.file_path}</p>}
              </li>
            ))}
          </ol>
        </>
      )}
    </Modal>
  );
}

function Field({ label, value, children }: { label: string; value?: string; children?: ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wider text-gray-400">{label}</p>
      <div className="mt-0.5 text-gray-800 dark:text-gray-200">{children ?? value}</div>
    </div>
  );
}
