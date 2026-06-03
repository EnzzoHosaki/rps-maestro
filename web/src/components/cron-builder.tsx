"use client";

import {
  buildCron,
  parseCron,
  WEEKDAYS,
  type CronModel,
  type FrequencyMode,
} from "@/lib/cron";

const MODE_LABELS: { value: FrequencyMode; label: string }[] = [
  { value: "everyN", label: "A cada…" },
  { value: "daily", label: "Diariamente" },
  { value: "weekly", label: "Semanalmente" },
  { value: "monthly", label: "Mensalmente" },
];

const pad = (n: number) => String(n).padStart(2, "0");

function timeOf(model: CronModel | null): { hour: number; minute: number } {
  if (model && (model.mode === "daily" || model.mode === "weekly" || model.mode === "monthly")) {
    return { hour: model.hour, minute: model.minute };
  }
  return { hour: 8, minute: 0 };
}

function defaultModel(mode: FrequencyMode, t: { hour: number; minute: number }): CronModel {
  switch (mode) {
    case "everyN":
      return { mode: "everyN", unit: "minute", n: 30 };
    case "daily":
      return { mode: "daily", hour: t.hour, minute: t.minute };
    case "weekly":
      return { mode: "weekly", days: [1], hour: t.hour, minute: t.minute };
    case "monthly":
      return { mode: "monthly", day: 1, hour: t.hour, minute: t.minute };
  }
}

const labelCls = "block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1";
const fieldCls =
  "rounded border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-900 focus:border-rps-olive-dark focus:outline-none focus:ring-2 focus:ring-rps-olive-dark";

export function CronBuilder({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const model = parseCron(value);
  const isCustom = model === null;
  const t = timeOf(model);

  const emit = (m: CronModel) => onChange(buildCron(m));

  // Hora/minuto via <input type="time"> ("HH:MM").
  const timeValue = `${pad(t.hour)}:${pad(t.minute)}`;
  const onTimeChange = (v: string, base: CronModel) => {
    const [h, mm] = v.split(":").map((x) => parseInt(x, 10));
    if (Number.isNaN(h) || Number.isNaN(mm)) return;
    if (base.mode === "daily") emit({ ...base, hour: h, minute: mm });
    else if (base.mode === "weekly") emit({ ...base, hour: h, minute: mm });
    else if (base.mode === "monthly") emit({ ...base, hour: h, minute: mm });
  };

  return (
    <div className="rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 p-3 space-y-3">
      <div>
        <span className={labelCls}>Frequência</span>
        <div className="flex flex-wrap gap-1">
          {MODE_LABELS.map((opt) => {
            const active = !isCustom && model.mode === opt.value;
            return (
              <button
                type="button"
                key={opt.value}
                onClick={() => emit(defaultModel(opt.value, t))}
                className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                  active
                    ? "bg-rps-olive-dark text-white"
                    : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {isCustom && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          Expressão personalizada — edite direto no campo Cron abaixo, ou escolha uma frequência
          acima para usar o assistente.
        </p>
      )}

      {!isCustom && model.mode === "everyN" && (
        <div className="flex items-end gap-2">
          <div>
            <label className={labelCls}>A cada</label>
            <input
              type="number"
              min={1}
              max={model.unit === "minute" ? 59 : 23}
              value={model.n}
              onChange={(e) => {
                const n = Math.max(1, parseInt(e.target.value, 10) || 1);
                emit({ ...model, n });
              }}
              className={`${fieldCls} w-20`}
            />
          </div>
          <select
            value={model.unit}
            onChange={(e) => {
              const unit = e.target.value as "minute" | "hour";
              const max = unit === "minute" ? 59 : 23;
              emit({ ...model, unit, n: Math.min(model.n, max) });
            }}
            className={fieldCls}
          >
            <option value="minute">minuto(s)</option>
            <option value="hour">hora(s)</option>
          </select>
        </div>
      )}

      {!isCustom && model.mode === "daily" && (
        <div>
          <label className={labelCls}>Horário</label>
          <input
            type="time"
            value={timeValue}
            onChange={(e) => onTimeChange(e.target.value, model)}
            className={fieldCls}
          />
        </div>
      )}

      {!isCustom && model.mode === "weekly" && (
        <div className="space-y-2">
          <div>
            <span className={labelCls}>Dias da semana</span>
            <div className="flex flex-wrap gap-1">
              {WEEKDAYS.map((d) => {
                const on = model.days.includes(d.value);
                return (
                  <button
                    type="button"
                    key={d.value}
                    onClick={() => {
                      const days = on
                        ? model.days.filter((x) => x !== d.value)
                        : [...model.days, d.value];
                      if (days.length === 0) return; // mantém ao menos um dia
                      emit({ ...model, days });
                    }}
                    className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                      on
                        ? "bg-rps-olive-dark text-white"
                        : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
                    }`}
                  >
                    {d.short}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <label className={labelCls}>Horário</label>
            <input
              type="time"
              value={timeValue}
              onChange={(e) => onTimeChange(e.target.value, model)}
              className={fieldCls}
            />
          </div>
        </div>
      )}

      {!isCustom && model.mode === "monthly" && (
        <div className="flex items-end gap-2">
          <div>
            <label className={labelCls}>Dia do mês</label>
            <select
              value={model.day}
              onChange={(e) => emit({ ...model, day: parseInt(e.target.value, 10) })}
              className={fieldCls}
            >
              {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Horário</label>
            <input
              type="time"
              value={timeValue}
              onChange={(e) => onTimeChange(e.target.value, model)}
              className={fieldCls}
            />
          </div>
        </div>
      )}
    </div>
  );
}
