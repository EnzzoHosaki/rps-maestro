// Cliente da API do rps-xml-tracker (serviço separado do backend do maestro).
// Reusa o MESMO token JWT do maestro (SSO), mas aponta para a base URL própria
// do tracker (NEXT_PUBLIC_XML_API_URL). Mantido à parte do `api` do maestro
// porque é outro host/porta.
import axios from "axios";

const XML_BASE_URL =
  process.env.NEXT_PUBLIC_XML_API_URL ?? "http://localhost:8090/api/v1";

export const xmlApi = axios.create({ baseURL: XML_BASE_URL });

xmlApi.interceptors.request.use((config) => {
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

xmlApi.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401 && typeof window !== "undefined") {
      localStorage.removeItem("token");
      window.location.href = "/login";
    }
    return Promise.reject(err);
  }
);

// ── Types ────────────────────────────────────────────────────────────────────

export type DocType = "NFE" | "NFCE" | "CTE" | "NFS" | "EVENTO" | "UNKNOWN";

export type NotaStatus =
  | "arrived"
  | "synced"
  | "imported"
  | "import_ignored"
  | "pending_import"
  | "stuck"
  | "lost";

export interface Nota {
  chave_acesso: string;
  doc_type: DocType;
  status: NotaStatus;
  codigo_empresa?: number;
  codigo_filial?: number;
  nome_empresa?: string;
  cnpj_emitente?: string;
  nome_emitente?: string;
  cnpj_destinatario?: string;
  nome_destinatario?: string;
  import_ignored: boolean;
  motivo_ignorado?: string;
  data_emissao?: string;
  valor_total?: number;
  arrived_at?: string;
  synced_at?: string;
  imported_at?: string;
  lat_arrival_sync_s?: number;
  lat_sync_import_s?: number;
}

export interface Span {
  stage: "arrival" | "sync" | "import";
  event_type: string;
  observed_at: string;
  source: string;
  file_path?: string;
}

export interface NotaDetail extends Nota {
  spans: Span[];
}

export interface NotaListResponse {
  items: Nota[];
  total: number;
  limit: number;
  offset: number;
}

export interface Overview {
  arrived: number;
  synced: number;
  imported: number;
  import_ignored: number;
  pending_import: number;
  stuck: number;
  lost: number;
  in_transit: number;
  imported_today: number;
  lat_arrival_sync_p50_s?: number;
  lat_arrival_sync_p95_s?: number;
  lat_sync_import_p50_s?: number;
  lat_sync_import_p95_s?: number;
}

export interface EmpresaAgg {
  // Ausentes (omitempty) na linha "Sem empresa" — detectar com `codigo_empresa == null`.
  codigo_empresa?: number;
  codigo_filial?: number;
  nome_empresa?: string;
  in_transit: number;
  arrived: number;
  synced: number;
  imported: number;
  import_ignored: number;
  pending_import: number;
  stuck: number;
  lost: number;
}

export type DateField = "emissao" | "arrived" | "synced" | "imported";

// Série temporal do tracker (GET /metrics/timeseries). Contagens são "fluxo por
// evento no dia" (arrived = chegaram naquele dia, etc.); latências são percentis
// por coorte do evento de origem (chegada p/ arrival→sync, sync p/ sync→import).
// Latências vêm nullable: null = sem transição completa no dia (vira gap na
// linha). Os dias mais recentes podem ser parciais (viés de censura à direita:
// notas que chegaram mas ainda não sincronizaram saem do percentil).
export type TimeseriesRange = "7d" | "30d" | "90d";
export type TimeseriesBucket = "day" | "week";

export interface TimeseriesPoint {
  date: string; // YYYY-MM-DD no fuso local (America/Sao_Paulo); week = segunda-feira
  arrived: number;
  synced: number;
  imported: number;
  import_ignored: number;
  lat_arrival_sync_p50_s: number | null;
  lat_arrival_sync_p95_s: number | null;
  lat_sync_import_p50_s: number | null;
  lat_sync_import_p95_s: number | null;
}

export interface Timeseries {
  range: TimeseriesRange;
  bucket: TimeseriesBucket;
  tz: string;
  buckets: TimeseriesPoint[];
}

export interface NotaListFilter {
  status?: NotaStatus;
  doc_type?: DocType;
  codigo_empresa?: number;
  codigo_filial?: number;
  sem_empresa?: boolean; // notas com codigo_empresa IS NULL
  empresa?: string; // busca por nome
  cnpj?: string; // emitente ou destinatário
  q?: string; // chave
  date_field?: DateField;
  from?: string; // yyyy-mm-dd
  to?: string;
  limit?: number;
  offset?: number;
}

// ── Endpoints ────────────────────────────────────────────────────────────────

export const notasApi = {
  list: (f: NotaListFilter = {}) =>
    xmlApi.get<NotaListResponse>("/notas", { params: cleanParams(f) }),
  get: (chave: string) => xmlApi.get<NotaDetail>(`/notas/${chave}`),
};

export const xmlMetricsApi = {
  overview: () => xmlApi.get<Overview>("/metrics/overview"),
  timeseries: (range: TimeseriesRange = "30d", bucket: TimeseriesBucket = "day") =>
    xmlApi.get<Timeseries>("/metrics/timeseries", { params: { range, bucket } }),
};

export const empresasApi = {
  // limit=0 devolve TODAS as linhas (empresas/filiais + a linha "Sem empresa"),
  // pra ordenar por pendentes no cliente. `pendentes:true` filtra a contagem
  // (e exclui a linha "Sem empresa"), então não passamos isso na visão geral.
  list: (opts: { pendentes?: boolean; limit?: number } = {}) => {
    const params: Record<string, string | number> = {};
    if (opts.pendentes) params.pendentes = "true";
    if (opts.limit != null) params.limit = opts.limit;
    return xmlApi.get<{ items: EmpresaAgg[]; total: number }>("/empresas", { params });
  },
};

function cleanParams(f: NotaListFilter): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(f)) {
    if (v !== undefined && v !== "" && v !== null) out[k] = v as string | number;
  }
  return out;
}

// ── Labels / estilos de status (pt-BR) ───────────────────────────────────────

export const XML_STATUS_LABEL: Record<NotaStatus, string> = {
  arrived: "A Sincronizar",
  synced: "Sincronizada",
  imported: "Importada",
  import_ignored: "Ignorada",
  pending_import: "Aguardando Importação",
  stuck: "Travada",
  lost: "Sumida",
};

export const XML_STATUS_STYLE: Record<NotaStatus, string> = {
  arrived: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300",
  synced: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
  imported: "bg-rps-olive-soft text-rps-olive-dark",
  import_ignored: "bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
  pending_import: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  stuck: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
  lost: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
};

export const XML_DOC_TYPE_LABEL: Record<DocType, string> = {
  NFE: "NF-e",
  NFCE: "NFC-e",
  CTE: "CT-e",
  NFS: "NFS-e",
  EVENTO: "Evento",
  UNKNOWN: "—",
};
