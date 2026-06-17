// Utilitários de cron compartilhados pela tela de Agendamentos.
//
// - describeCron: tradução humana em PT-BR (via cronstrue), cobre qualquer
//   expressão válida de 5 campos.
// - parseCron / buildCron: round-trip entre uma expressão e um dos modos
//   "amigáveis" do builder visual. parseCron devolve null quando a expressão
//   não mapeia para nenhum modo simples (modo "personalizado").
import cronstrue from "cronstrue/i18n";

export type FrequencyMode = "everyN" | "daily" | "weekly" | "monthly";

export type CronModel =
  | { mode: "everyN"; unit: "minute" | "hour"; n: number }
  | { mode: "daily"; hour: number; minute: number }
  | { mode: "weekly"; days: number[]; hour: number; minute: number }
  | { mode: "monthly"; days: number[]; hour: number; minute: number };

// Domingo = 0, … Sábado = 6 (convenção cron padrão / robfig).
export const WEEKDAYS = [
  { value: 1, short: "Seg" },
  { value: 2, short: "Ter" },
  { value: 3, short: "Qua" },
  { value: 4, short: "Qui" },
  { value: 5, short: "Sex" },
  { value: 6, short: "Sáb" },
  { value: 0, short: "Dom" },
];

function isStar(s: string): boolean {
  return s === "*";
}

function asInt(s: string): number | null {
  return /^\d+$/.test(s) ? parseInt(s, 10) : null;
}

function asStep(s: string): number | null {
  const m = /^\*\/(\d+)$/.exec(s);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return n > 0 ? n : null;
}

// Expande "1-5", "1,3,5", "6,0", "2" em uma lista de dias 0-6.
function parseDays(field: string): number[] | null {
  const days = new Set<number>();
  for (const part of field.split(",")) {
    const range = /^(\d+)-(\d+)$/.exec(part);
    if (range) {
      const a = parseInt(range[1], 10);
      const b = parseInt(range[2], 10);
      if (a > b || b > 7) return null;
      for (let d = a; d <= b; d++) days.add(d % 7); // 7 → 0 (domingo)
    } else if (/^\d+$/.test(part)) {
      const d = parseInt(part, 10);
      if (d > 7) return null;
      days.add(d % 7);
    } else {
      return null;
    }
  }
  const arr = [...days].sort((x, y) => x - y);
  return arr.length ? arr : null;
}

// Gera o campo de dia-da-semana de forma compacta (range contíguo vira "a-b").
function buildDaysField(days: number[]): string {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  if (sorted.length === 0) return "*";
  const contiguous = sorted.every((d, i) => i === 0 || d === sorted[i - 1] + 1);
  if (contiguous && sorted.length > 1) {
    return `${sorted[0]}-${sorted[sorted.length - 1]}`;
  }
  return sorted.join(",");
}

export function parseCron(expr: string): CronModel | null {
  if (!expr) return null;
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [min, hour, dom, month, dow] = parts;

  // A cada N minutos: */n * * * *
  const minStep = asStep(min);
  if (minStep !== null && isStar(hour) && isStar(dom) && isStar(month) && isStar(dow)) {
    return { mode: "everyN", unit: "minute", n: minStep };
  }

  // A cada N horas: 0 */n * * *
  const hourStep = asStep(hour);
  if (asInt(min) === 0 && hourStep !== null && isStar(dom) && isStar(month) && isStar(dow)) {
    return { mode: "everyN", unit: "hour", n: hourStep };
  }

  // Toda hora (0 * * * *) — equivale a "a cada 1 hora".
  if (asInt(min) === 0 && isStar(hour) && isStar(dom) && isStar(month) && isStar(dow)) {
    return { mode: "everyN", unit: "hour", n: 1 };
  }

  // Daqui pra baixo, minuto e hora precisam ser inteiros e o mês precisa ser "*".
  const m = asInt(min);
  const h = asInt(hour);
  if (m === null || h === null || m > 59 || h > 23 || !isStar(month)) return null;

  // Diariamente: m h * * *
  if (isStar(dom) && isStar(dow)) {
    return { mode: "daily", hour: h, minute: m };
  }

  // Semanalmente: m h * * <dias>
  if (isStar(dom) && !isStar(dow)) {
    const days = parseDays(dow);
    if (!days) return null;
    return { mode: "weekly", days, hour: h, minute: m };
  }

  // Mensalmente: m h <dia(s)> * * — aceita lista "8,15,22".
  if (!isStar(dom) && isStar(dow)) {
    const days = parseMonthDays(dom);
    if (!days) return null;
    return { mode: "monthly", days, hour: h, minute: m };
  }

  return null;
}

// Expande "8", "8,15,22" em lista de dias do mês (1-31), ordenada e sem
// duplicatas. Não aceita ranges (dias do mês não leem bem como "8-22").
function parseMonthDays(field: string): number[] | null {
  const days = new Set<number>();
  for (const part of field.split(",")) {
    if (!/^\d+$/.test(part)) return null;
    const d = parseInt(part, 10);
    if (d < 1 || d > 31) return null;
    days.add(d);
  }
  const arr = [...days].sort((a, b) => a - b);
  return arr.length ? arr : null;
}

export function buildCron(model: CronModel): string {
  switch (model.mode) {
    case "everyN":
      return model.unit === "minute"
        ? `*/${model.n} * * * *`
        : `0 */${model.n} * * *`;
    case "daily":
      return `${model.minute} ${model.hour} * * *`;
    case "weekly":
      return `${model.minute} ${model.hour} * * ${buildDaysField(model.days)}`;
    case "monthly":
      return `${model.minute} ${model.hour} ${[...new Set(model.days)].sort((a, b) => a - b).join(",")} * *`;
  }
}

export function describeCron(expr: string): string {
  if (!expr || !expr.trim()) return "";
  try {
    return cronstrue.toString(expr.trim(), {
      locale: "pt_BR",
      use24HourTimeFormat: true,
    });
  } catch {
    return "Expressão inválida";
  }
}
