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
  | { mode: "monthly"; days: number[]; lastDay: boolean; hour: number; minute: number };

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

  // Mensalmente: m h <dia(s)> * * — aceita lista "8,15,22" e o token L
  // (último dia do mês), ex.: "8,15,22,L".
  if (!isStar(dom) && isStar(dow)) {
    const parsed = parseMonthDays(dom);
    if (!parsed) return null;
    return { mode: "monthly", days: parsed.days, lastDay: parsed.lastDay, hour: h, minute: m };
  }

  return null;
}

// Expande "8", "8,15,22", "8,15,L" em { dias do mês (1-31), lastDay }.
// Não aceita ranges (dias do mês não leem bem como "8-22").
function parseMonthDays(field: string): { days: number[]; lastDay: boolean } | null {
  const days = new Set<number>();
  let lastDay = false;
  for (const part of field.split(",")) {
    if (part === "L" || part === "l") {
      lastDay = true;
      continue;
    }
    if (!/^\d+$/.test(part)) return null;
    const d = parseInt(part, 10);
    if (d < 1 || d > 31) return null;
    days.add(d);
  }
  if (days.size === 0 && !lastDay) return null;
  return { days: [...days].sort((a, b) => a - b), lastDay };
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
    case "monthly": {
      const parts = [...new Set(model.days)].sort((a, b) => a - b).map(String);
      if (model.lastDay) parts.push("L");
      if (parts.length === 0) parts.push("1"); // guarda: nunca emitir campo vazio
      return `${model.minute} ${model.hour} ${parts.join(",")} * *`;
    }
  }
}

// ── Ocorrência por dia (pro calendário de agendamentos) ──────────────────────
// Casa UM campo de cron contra um valor, em nível de dia. Suporta "*", listas
// (a,b), ranges (a-b), passos (*/n, a-b/n, a/n) e o token "L" (último dia, só
// faz sentido no dia-do-mês). Ignora minuto/hora — pro calendário só importa SE
// dispara naquele dia.
function fieldMatches(field: string, value: number, min: number, max: number, isLast = false): boolean {
  for (const part of field.split(",")) {
    if (part === "*") return true;
    if (part === "L" || part === "l") {
      if (isLast) return true;
      continue;
    }
    const [range, stepStr] = part.split("/");
    const step = stepStr ? parseInt(stepStr, 10) : 1;
    if (!step || step < 1) continue;
    let lo: number, hi: number;
    if (range === "*") {
      lo = min; hi = max;
    } else if (range.includes("-")) {
      const [a, b] = range.split("-").map((x) => parseInt(x, 10));
      lo = a; hi = b;
    } else {
      const a = parseInt(range, 10);
      if (Number.isNaN(a)) continue;
      lo = a;
      hi = stepStr ? max : a; // "a/n" = de a até o fim, de n em n
    }
    if (Number.isNaN(lo) || Number.isNaN(hi)) continue;
    if (value < lo || value > hi) continue;
    if ((value - lo) % step === 0) return true;
  }
  return false;
}

// Diz se uma expressão cron de 5 campos dispara em algum momento da data dada
// (granularidade de dia). Aplica a regra clássica do cron: se dia-do-mês E
// dia-da-semana estão ambos restritos, dispara se QUALQUER um casar (OR).
export function cronFiresOnDate(expr: string, date: Date): boolean {
  if (!expr || !expr.trim()) return false;
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [, , dom, month, dow] = parts;
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const wd = date.getDay(); // 0 = domingo
  const lastDay = d === new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();

  if (!fieldMatches(month, m, 1, 12)) return false;

  const domStar = dom.trim() === "*";
  const dowStar = dow.trim() === "*";
  const domOk = fieldMatches(dom, d, 1, 31, lastDay);
  // dow aceita 7 como domingo → testa 0 e 7.
  const dowOk = fieldMatches(dow, wd, 0, 7) || (wd === 0 && fieldMatches(dow, 7, 0, 7));

  if (domStar && dowStar) return true;
  if (!domStar && dowStar) return domOk;
  if (domStar && !dowStar) return dowOk;
  return domOk || dowOk;
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
