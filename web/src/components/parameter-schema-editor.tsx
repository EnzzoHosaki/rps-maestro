"use client";

import { useState } from "react";
import type {
  ListItemType,
  ParameterField,
  ParameterFieldType,
  ParameterSchema,
} from "@/lib/api";

const TYPE_OPTIONS: { value: ParameterFieldType; label: string }[] = [
  { value: "text", label: "Texto" },
  { value: "number", label: "Número" },
  { value: "date", label: "Data" },
  { value: "select", label: "Seleção" },
  { value: "boolean", label: "Booleano" },
  { value: "list", label: "Lista" },
];

const DATE_DDMMYYYY = /^\d{2}\/\d{2}\/\d{4}$/;
const DATE_ISO = /^\d{4}-\d{2}-\d{2}$/;

const inputCls =
  "rounded border border-gray-300 dark:border-gray-700 bg-white px-2 py-1 text-xs text-gray-900 dark:text-gray-100 placeholder-gray-500 focus:border-rps-olive-dark focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500";

function snakeToLabel(name: string): string {
  return name
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function inferField(name: string, value: unknown): ParameterField {
  const label = snakeToLabel(name) || name;
  const base: Pick<ParameterField, "name" | "label" | "required"> = {
    name,
    label,
    required: false,
  };

  if (typeof value === "boolean") return { ...base, type: "boolean" };
  if (typeof value === "number") return { ...base, type: "number" };
  if (typeof value === "string") {
    if (DATE_DDMMYYYY.test(value) || DATE_ISO.test(value)) {
      return { ...base, type: "date" };
    }
    return { ...base, type: "text", placeholder: value };
  }
  if (Array.isArray(value)) {
    const itemType: ListItemType = value.every((v) => typeof v === "number")
      ? "number"
      : "text";
    return { ...base, type: "list", itemType };
  }
  return { ...base, type: "text" };
}

function schemaFromJson(raw: string): ParameterSchema {
  const parsed = JSON.parse(raw);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("O JSON deve ser um objeto.");
  }
  return Object.entries(parsed as Record<string, unknown>).map(([k, v]) =>
    inferField(k, v),
  );
}

export function ParameterSchemaEditor({
  value,
  onChange,
}: {
  value: ParameterSchema;
  onChange: (next: ParameterSchema) => void;
}) {
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState("");
  const [pasteErr, setPasteErr] = useState<string | null>(null);

  const update = (idx: number, patch: Partial<ParameterField>) => {
    onChange(value.map((f, i) => (i === idx ? { ...f, ...patch } : f)));
  };

  const remove = (idx: number) => onChange(value.filter((_, i) => i !== idx));

  const add = () =>
    onChange([
      ...value,
      { name: "", label: "", type: "text", required: false } as ParameterField,
    ]);

  const applyPaste = (mode: "replace" | "append") => {
    try {
      const inferred = schemaFromJson(pasted);
      onChange(mode === "replace" ? inferred : [...value, ...inferred]);
      setPasted("");
      setPasteErr(null);
      setPasting(false);
    } catch (e) {
      setPasteErr(e instanceof Error ? e.message : "JSON inválido");
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Schema de parâmetros</label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              setPasting((p) => !p);
              setPasteErr(null);
            }}
            className="rounded bg-gray-100 dark:bg-gray-800 px-2 py-1 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
          >
            {pasting ? "Cancelar" : "Colar JSON de exemplo"}
          </button>
          <button
            type="button"
            onClick={add}
            className="rounded bg-gray-100 dark:bg-gray-800 px-2 py-1 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
          >
            + Adicionar campo
          </button>
        </div>
      </div>

      {pasting && (
        <div className="rounded border border-rps-sage bg-rps-sage-soft p-2 space-y-2">
          <p className="text-xs text-rps-olive-dark">
            Cole um JSON de exemplo do payload da automação. Os tipos serão inferidos automaticamente
            (você pode ajustar depois).
          </p>
          <textarea
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            rows={6}
            placeholder='{ "stores": [4814, 6861], "start_date": "26/04/2026", "headless": true }'
            className="w-full rounded border border-gray-300 dark:border-gray-700 px-2 py-1 text-xs font-mono text-gray-900 dark:text-gray-100 placeholder-gray-500"
          />
          {pasteErr && <p className="text-xs text-red-700">{pasteErr}</p>}
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => applyPaste("append")}
              disabled={!pasted.trim()}
              className="rounded bg-gray-200 dark:bg-gray-700 px-2 py-1 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50"
            >
              Adicionar aos existentes
            </button>
            <button
              type="button"
              onClick={() => applyPaste("replace")}
              disabled={!pasted.trim()}
              className="rounded bg-rps-olive-dark px-2 py-1 text-xs text-white hover:bg-rps-olive-darker disabled:opacity-50"
            >
              Substituir schema
            </button>
          </div>
        </div>
      )}

      {value.length === 0 && !pasting && (
        <p className="text-xs text-gray-600 dark:text-gray-400">
          Nenhum campo. Adicione campos que o worker espera (ex.: stores, start_date).
        </p>
      )}

      {value.map((f, idx) => (
        <div key={idx} className="rounded border border-gray-200 dark:border-gray-800 p-2 space-y-2 bg-gray-50 dark:bg-gray-800">
          <div className="grid grid-cols-2 gap-2">
            <input
              required
              placeholder="name (ex: stores)"
              value={f.name}
              onChange={(e) => update(idx, { name: e.target.value })}
              className={`${inputCls} font-mono`}
            />
            <input
              required
              placeholder="Label (ex: Lojas)"
              value={f.label}
              onChange={(e) => update(idx, { label: e.target.value })}
              className={inputCls}
            />
          </div>
          <div className="grid grid-cols-3 gap-2 items-center">
            <select
              value={f.type}
              onChange={(e) => update(idx, { type: e.target.value as ParameterFieldType })}
              className={inputCls}
            >
              {TYPE_OPTIONS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1 text-xs text-gray-700 dark:text-gray-300">
              <input
                type="checkbox"
                checked={!!f.required}
                onChange={(e) => update(idx, { required: e.target.checked })}
              />
              Obrigatório
            </label>
            <button
              type="button"
              onClick={() => remove(idx)}
              className="rounded bg-red-100 px-2 py-1 text-xs text-red-700 hover:bg-red-200"
            >
              Remover
            </button>
          </div>
          {f.type === "select" && (
            <input
              placeholder="Opções separadas por vírgula"
              value={(f.options ?? []).join(", ")}
              onChange={(e) =>
                update(idx, {
                  options: e.target.value
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
              className={`w-full ${inputCls}`}
            />
          )}
          {f.type === "list" && (
            <select
              value={f.itemType ?? "text"}
              onChange={(e) => update(idx, { itemType: e.target.value as ListItemType })}
              className={`w-full ${inputCls}`}
            >
              <option value="text">Itens: texto</option>
              <option value="number">Itens: número</option>
            </select>
          )}
          {f.type !== "boolean" && (
            <input
              placeholder="Placeholder (opcional)"
              value={f.placeholder ?? ""}
              onChange={(e) => update(idx, { placeholder: e.target.value || undefined })}
              className={`w-full ${inputCls}`}
            />
          )}
        </div>
      ))}
    </div>
  );
}
