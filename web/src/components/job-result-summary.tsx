"use client";

import { useState } from "react";
import type { JobResult, TypedResultSummary } from "@/lib/api";

const TYPED_KEYS = ["ok", "failed", "no_data", "skipped"] as const;

function isTypedSummary(s: unknown): s is TypedResultSummary {
  if (!s || typeof s !== "object") return false;
  const obj = s as Record<string, unknown>;
  return TYPED_KEYS.some((k) => Array.isArray(obj[k]));
}

function asStringList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

type FailedItem = NonNullable<TypedResultSummary["failed"]>[number];

function asFailedList(v: unknown): FailedItem[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is FailedItem => typeof x === "object" && x !== null);
}

function CountBadge({ label, n, tone }: { label: string; n: number; tone: "ok" | "fail" | "warn" | "muted" }) {
  const toneCls = {
    ok: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
    fail: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
    warn: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
    muted: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
  }[tone];
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${toneCls}`}>
      {label}: {n}
    </span>
  );
}

function TypedSummary({ summary }: { summary: TypedResultSummary }) {
  const ok = asStringList(summary.ok);
  const failed = asFailedList(summary.failed);
  const noData = asStringList(summary.no_data);
  const skipped = asStringList(summary.skipped);

  const [openOk, setOpenOk] = useState(false);
  const [openFailed, setOpenFailed] = useState(failed.length > 0);
  const [openNoData, setOpenNoData] = useState(false);
  const [openSkipped, setOpenSkipped] = useState(false);

  // Campos não-canônicos do summary ainda aparecem como KV abaixo, pra não
  // esconder dados que o worker decidiu reportar.
  const extras = Object.fromEntries(
    Object.entries(summary).filter(([k]) => !TYPED_KEYS.includes(k as (typeof TYPED_KEYS)[number]))
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        <CountBadge label="OK" n={ok.length} tone="ok" />
        <CountBadge label="Falhas" n={failed.length} tone="fail" />
        <CountBadge label="Sem dados" n={noData.length} tone="warn" />
        <CountBadge label="Pulados" n={skipped.length} tone="muted" />
      </div>

      {ok.length > 0 && (
        <details open={openOk} onToggle={(e) => setOpenOk((e.target as HTMLDetailsElement).open)}>
          <summary className="cursor-pointer text-xs font-medium text-green-700 dark:text-green-400">
            ✓ Sucessos ({ok.length})
          </summary>
          <ul className="mt-1 ml-4 list-disc text-xs text-gray-700 dark:text-gray-300">
            {ok.map((name, i) => (
              <li key={`${name}-${i}`} className="font-mono">
                {name}
              </li>
            ))}
          </ul>
        </details>
      )}

      {failed.length > 0 && (
        <details
          open={openFailed}
          onToggle={(e) => setOpenFailed((e.target as HTMLDetailsElement).open)}
        >
          <summary className="cursor-pointer text-xs font-medium text-red-700 dark:text-red-400">
            ✗ Falhas ({failed.length})
          </summary>
          <ul className="mt-1 ml-2 space-y-1 text-xs">
            {failed.map((f, i) => (
              <li
                key={i}
                className="rounded border border-red-100 bg-red-50 p-2 dark:border-red-900/40 dark:bg-red-950/20"
              >
                <div className="font-mono font-medium text-red-900 dark:text-red-200">
                  {f.empresa ?? "(sem identificação)"}
                </div>
                {f.error_class && (
                  <div className="mt-0.5 inline-block rounded bg-red-200 px-1.5 py-0.5 font-mono text-[10px] text-red-900 dark:bg-red-900/60 dark:text-red-200">
                    {f.error_class}
                  </div>
                )}
                {f.message && (
                  <div className="mt-1 text-red-800 dark:text-red-300">{f.message}</div>
                )}
                {f.error_type && !f.message && (
                  <div className="mt-1 font-mono text-red-700 dark:text-red-400">{f.error_type}</div>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      {noData.length > 0 && (
        <details
          open={openNoData}
          onToggle={(e) => setOpenNoData((e.target as HTMLDetailsElement).open)}
        >
          <summary className="cursor-pointer text-xs font-medium text-amber-700 dark:text-amber-400">
            ◌ Sem dados ({noData.length})
          </summary>
          <ul className="mt-1 ml-4 list-disc text-xs text-gray-700 dark:text-gray-300">
            {noData.map((name, i) => (
              <li key={`${name}-${i}`} className="font-mono">
                {name}
              </li>
            ))}
          </ul>
        </details>
      )}

      {skipped.length > 0 && (
        <details
          open={openSkipped}
          onToggle={(e) => setOpenSkipped((e.target as HTMLDetailsElement).open)}
        >
          <summary className="cursor-pointer text-xs font-medium text-gray-600 dark:text-gray-400">
            ⊘ Pulados ({skipped.length})
          </summary>
          <ul className="mt-1 ml-4 list-disc text-xs text-gray-700 dark:text-gray-300">
            {skipped.map((name, i) => (
              <li key={`${name}-${i}`} className="font-mono">
                {name}
              </li>
            ))}
          </ul>
        </details>
      )}

      {Object.keys(extras).length > 0 && (
        <details className="border-t border-gray-100 pt-2 dark:border-gray-800">
          <summary className="cursor-pointer text-xs text-gray-500">Detalhes adicionais</summary>
          <pre className="mt-2 overflow-auto rounded bg-gray-50 p-2 text-[11px] text-gray-700 dark:bg-gray-800 dark:text-gray-300">
            {JSON.stringify(extras, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}

function GenericSummary({ summary }: { summary: Record<string, unknown> }) {
  return (
    <pre className="overflow-auto rounded bg-gray-50 p-2 text-[11px] text-gray-700 dark:bg-gray-800 dark:text-gray-300">
      {JSON.stringify(summary, null, 2)}
    </pre>
  );
}

export function JobResultSummary({ result }: { result: JobResult }) {
  const hasError = typeof result.error === "string" && result.error.length > 0;
  const hasSummary = result.summary && typeof result.summary === "object";

  if (!hasError && !hasSummary) return null;

  return (
    <details
      open
      className="border-b border-gray-100 dark:border-gray-800 px-4 py-2 text-xs"
    >
      <summary className="cursor-pointer text-gray-500 hover:text-gray-700 dark:text-gray-300">
        Resultado
      </summary>

      <div className="mt-2 space-y-2">
        {hasError && (
          <div className="rounded border border-red-200 bg-red-50 p-2 dark:border-red-900/50 dark:bg-red-950/30">
            <div className="font-medium text-red-900 dark:text-red-200">Erro</div>
            <div className="mt-1 whitespace-pre-wrap text-red-800 dark:text-red-300">
              {result.error}
            </div>
            {result.error_class && (
              <div className="mt-1 inline-block rounded bg-red-200 px-1.5 py-0.5 font-mono text-[10px] text-red-900 dark:bg-red-900/60 dark:text-red-200">
                {result.error_class}
              </div>
            )}
            {result.error_type && (
              <div className="mt-1 ml-1 inline-block font-mono text-[10px] text-red-700 dark:text-red-400">
                ({result.error_type})
              </div>
            )}
          </div>
        )}

        {hasSummary &&
          (isTypedSummary(result.summary)
            ? <TypedSummary summary={result.summary as TypedResultSummary} />
            : <GenericSummary summary={result.summary as Record<string, unknown>} />)}
      </div>
    </details>
  );
}
