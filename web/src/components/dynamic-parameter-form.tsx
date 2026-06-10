"use client";

import { useMemo, useState } from "react";
import { RotateCcw } from "lucide-react";
import type { ParameterField, ParameterSchema } from "@/lib/api";

type Values = Record<string, string | boolean>;

const inputCls =
  "w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-500 focus:border-rps-olive-dark focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500";

function isoToBr(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

function brToIso(br: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(br);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : br;
}

function looksLikePlaceholder(v: unknown): boolean {
  return typeof v === "string" && v.includes("{{");
}

function initialDisplay(field: ParameterField, initial: unknown): string | boolean {
  if (initial === undefined || initial === null) {
    return field.type === "boolean" ? false : "";
  }
  if (field.type === "boolean") return Boolean(initial);
  if (field.type === "list" && Array.isArray(initial)) return initial.join(", ");
  // Placeholder dinâmico chega como string — passa direto, sem tentar
  // converter pra ISO/etc. O usuário verá o {{...}} no input de texto.
  if (looksLikePlaceholder(initial)) return String(initial);
  if (field.type === "date" && typeof initial === "string") return brToIso(initial);
  return String(initial);
}

function parseList(raw: string, itemType: ParameterField["itemType"]): unknown[] {
  const items = raw
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (itemType === "number") {
    return items.map((s) => Number(s)).filter((n) => !Number.isNaN(n));
  }
  return items;
}

function coerce(field: ParameterField, raw: string | boolean): unknown {
  if (field.type === "boolean") return Boolean(raw);
  const s = String(raw);
  if (s === "") return undefined;
  // Placeholder dinâmico passa cru — quem expande é o backend no scheduler.
  if (s.includes("{{")) return s;
  if (field.type === "number") {
    const n = Number(s);
    return Number.isNaN(n) ? s : n;
  }
  if (field.type === "date") return isoToBr(s);
  if (field.type === "list") return parseList(s, field.itemType);
  return s;
}

export function DynamicParameterForm({
  schema,
  initial,
  submitLabel,
  onSubmit,
  loading,
  allowDynamicPlaceholders = false,
}: {
  schema: ParameterSchema;
  initial?: Record<string, unknown>;
  submitLabel: string;
  onSubmit: (values: Record<string, unknown>) => void;
  loading?: boolean;
  /**
   * Quando true, campos `date` e `number` ganham um botão "fx" que
   * converte o input pra texto livre — pra digitar placeholders tipo
   * {{yesterday}} que o scheduler expande na execução. Default false
   * (execução manual não suporta placeholders).
   */
  allowDynamicPlaceholders?: boolean;
}) {
  const [values, setValues] = useState<Values>(() => {
    const v: Values = {};
    for (const f of schema) v[f.name] = initialDisplay(f, initial?.[f.name]);
    return v;
  });

  // Detecta valores iniciais que já vêm como placeholder pra entrar em
  // modo dinâmico automaticamente, sem precisar do usuário clicar.
  const initialDynamic = useMemo(() => {
    const s = new Set<string>();
    if (!allowDynamicPlaceholders || !initial) return s;
    for (const f of schema) {
      if ((f.type === "date" || f.type === "number") && looksLikePlaceholder(initial[f.name])) {
        s.add(f.name);
      }
    }
    return s;
  }, [schema, initial, allowDynamicPlaceholders]);

  const [dynamicFields, setDynamicFields] = useState<Set<string>>(initialDynamic);

  const isDynamic = (name: string) => dynamicFields.has(name);
  const setDynamic = (name: string, on: boolean) => {
    setDynamicFields((prev) => {
      const next = new Set(prev);
      if (on) next.add(name);
      else next.delete(name);
      return next;
    });
    // Ao trocar de modo, limpa o valor — formatos não se traduzem entre
    // input nativo (ISO/number) e texto livre (placeholder), e tentar
    // converter geraria valores estranhos.
    setValues((v) => ({ ...v, [name]: "" }));
  };

  const set = (name: string, raw: string | boolean) =>
    setValues((v) => ({ ...v, [name]: raw }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const out: Record<string, unknown> = {};
    for (const f of schema) {
      const coerced = coerce(f, values[f.name] ?? "");
      if (coerced === undefined) continue;
      if (Array.isArray(coerced) && coerced.length === 0 && !f.required) continue;
      out[f.name] = coerced;
    }
    onSubmit(out);
  };

  function renderField(f: ParameterField) {
    const canToggleDynamic =
      allowDynamicPlaceholders && (f.type === "date" || f.type === "number");
    const dyn = isDynamic(f.name);

    if (dyn) {
      return (
        <div className="flex gap-2">
          <input
            required={f.required}
            type="text"
            placeholder="ex: {{yesterday}}, {{today-2}}, {{first_of_last_month}}"
            value={String(values[f.name] ?? "")}
            onChange={(e) => set(f.name, e.target.value)}
            className={`${inputCls} font-mono`}
          />
          <button
            type="button"
            onClick={() => setDynamic(f.name, false)}
            title="Voltar pro input normal"
            aria-label="Voltar pro input normal"
            className="shrink-0 rounded border border-gray-300 bg-white px-2 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      );
    }

    if (f.type === "select") {
      return (
        <select
          required={f.required}
          value={String(values[f.name] ?? "")}
          onChange={(e) => set(f.name, e.target.value)}
          className={inputCls}
        >
          <option value="">Selecione…</option>
          {(f.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    }

    if (f.type === "list") {
      return (
        <textarea
          required={f.required}
          placeholder={
            f.placeholder ??
            (f.itemType === "number"
              ? "Ex: 4814, 6861, 11118 (separe por vírgula ou linha)"
              : "Um item por linha ou separados por vírgula")
          }
          value={String(values[f.name] ?? "")}
          onChange={(e) => set(f.name, e.target.value)}
          rows={3}
          className={`${inputCls} font-mono`}
        />
      );
    }

    const nativeInput = (
      <input
        required={f.required}
        type={f.type === "date" ? "date" : f.type === "number" ? "number" : "text"}
        placeholder={f.placeholder}
        value={String(values[f.name] ?? "")}
        onChange={(e) => set(f.name, e.target.value)}
        className={inputCls}
      />
    );

    if (canToggleDynamic) {
      return (
        <div className="flex gap-2">
          {nativeInput}
          <button
            type="button"
            onClick={() => setDynamic(f.name, true)}
            title="Usar placeholder dinâmico ({{yesterday}}, {{today-N}}, {{first_of_month}}…)"
            className="shrink-0 rounded border border-gray-300 bg-white px-2 text-xs font-mono text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
          >
            fx
          </button>
        </div>
      );
    }

    return nativeInput;
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {schema.length === 0 && (
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Nenhum parâmetro definido para esta automação.
        </p>
      )}

      {schema.map((f) => (
        <div key={f.name}>
          {f.type !== "boolean" && (
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
              {f.label}
              {f.required && <span className="text-red-500 ml-0.5">*</span>}
            </label>
          )}
          {f.type === "boolean" ? (
            <label className="flex items-center gap-2 text-sm text-gray-900 dark:text-gray-100">
              <input
                type="checkbox"
                checked={Boolean(values[f.name])}
                onChange={(e) => set(f.name, e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 dark:border-gray-700"
              />
              {f.label}
              {f.required && <span className="text-red-500">*</span>}
            </label>
          ) : (
            renderField(f)
          )}
        </div>
      ))}

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded bg-rps-olive-dark py-2 text-sm font-medium text-white hover:bg-rps-olive-darker disabled:opacity-50"
      >
        {loading ? "Enviando…" : submitLabel}
      </button>
    </form>
  );
}
