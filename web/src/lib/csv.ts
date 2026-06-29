// Geração e download de CSV client-side. Usa ';' como separador e BOM UTF-8
// porque o Excel pt-BR abre assim sem bagunçar acentos nem colunas (vírgula é
// separador decimal aqui).
type Cell = string | number | null | undefined;

function escapeCell(v: Cell): string {
  if (v == null) return "";
  const s = String(v);
  // Aspas duplas, separador, quebras de linha → envolve em aspas e duplica aspas.
  if (/[";\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(headers: string[], rows: Cell[][]): string {
  const lines = [headers, ...rows].map((r) => r.map(escapeCell).join(";"));
  return lines.join("\r\n");
}

// Dispara o download de um CSV. Prefixa BOM pro Excel reconhecer UTF-8.
export function downloadCsv(filename: string, content: string): void {
  const blob = new Blob(["﻿" + content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
