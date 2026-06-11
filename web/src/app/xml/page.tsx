"use client";

import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  notasApi,
  xmlMetricsApi,
  XML_STATUS_LABEL,
  XML_STATUS_STYLE,
  XML_DOC_TYPE_LABEL,
  type NotaStatus,
  type DocType,
  type DateField,
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
  const [statusFilter, setStatusFilter] = useState<NotaStatus | "all">("all");
  const [docFilter, setDocFilter] = useState<DocType | "all">("all");
  const [q, setQ] = useState("");
  const [empresa, setEmpresa] = useState("");
  const [cnpj, setCnpj] = useState("");
  const [dateField, setDateField] = useState<DateField>("imported");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);

  const overview = useQuery({
    queryKey: ["xml", "overview"],
    queryFn: () => xmlMetricsApi.overview().then((r) => r.data),
    refetchInterval: 10_000,
  });

  const list = useQuery({
    queryKey: ["xml", "notas", { statusFilter, docFilter, q, empresa, cnpj, dateField, from, to, offset }],
    queryFn: () =>
      notasApi
        .list({
          status: statusFilter === "all" ? undefined : statusFilter,
          doc_type: docFilter === "all" ? undefined : docFilter,
          q: q || undefined,
          empresa: empresa || undefined,
          cnpj: cnpj || undefined,
          date_field: from || to ? dateField : undefined,
          from: from || undefined,
          to: to || undefined,
          limit: PAGE_SIZE,
          offset,
        })
        .then((r) => r.data),
    refetchInterval: 15_000,
    placeholderData: (prev) => prev,
  });

  const ov = overview.data;
  const total = list.data?.total ?? 0;
  const items = list.data?.items ?? [];
  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function reset<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      setOffset(0);
    };
  }

  return (
    <div className="space-y-5">
      {/* Cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <StatCard label="Em trânsito" value={ov?.in_transit ?? "—"} tone={ov?.in_transit ? "warning" : "neutral"} loading={overview.isLoading} />
        <StatCard label="Chegaram" value={ov?.arrived ?? "—"} loading={overview.isLoading} />
        <StatCard label="Importadas hoje" value={ov?.imported_today ?? "—"} tone="success" loading={overview.isLoading} />
        <StatCard label="Import. ignoradas" value={ov?.import_ignored ?? "—"} loading={overview.isLoading} />
        <StatCard label="Travadas" value={ov?.stuck ?? "—"} tone={ov?.stuck ? "danger" : "neutral"} loading={overview.isLoading} />
        <StatCard label="Sumidas" value={ov?.lost ?? "—"} tone={ov?.lost ? "danger" : "neutral"} loading={overview.isLoading} />
      </div>
      {ov && (
        <div className="flex flex-wrap gap-4 text-xs text-gray-500">
          <span>Latência chegada→sync: p50 <b className="text-gray-700 dark:text-gray-300">{fmtDur(ov.lat_arrival_sync_p50_s)}</b> · p95 {fmtDur(ov.lat_arrival_sync_p95_s)}</span>
          <span>Latência sync→import: p50 <b className="text-gray-700 dark:text-gray-300">{fmtDur(ov.lat_sync_import_p50_s)}</b> · p95 {fmtDur(ov.lat_sync_import_p95_s)}</span>
        </div>
      )}

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
                {n.nome_empresa || (n.codigo_empresa ? `#${n.codigo_empresa}-${n.codigo_filial ?? 1}` : "—")}
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

      {selected && <NotaDetailModal chave={selected} onClose={() => setSelected(null)} />}
    </div>
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
