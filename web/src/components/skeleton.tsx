type SkeletonProps = {
  className?: string;
};

// Skeleton genérico com pulse — usar em lugar de "Carregando…" pra preencher
// espaço enquanto a query roda. Sem texto, sem efeitos extras: só uma faixa
// cinza animada que respeita o layout pretendido.
export function Skeleton({ className = "" }: SkeletonProps) {
  return (
    <div
      className={`animate-pulse rounded bg-gray-200 dark:bg-gray-800 ${className}`}
      aria-hidden="true"
    />
  );
}

// Linha de tabela skeleton. Usar dentro de <tbody> enquanto os dados
// carregam — replica o shape de uma linha sem fingir conteúdo específico.
export function SkeletonRow({ cols }: { cols: number }) {
  return (
    <tr>
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <Skeleton className="h-4 w-full max-w-[180px]" />
        </td>
      ))}
    </tr>
  );
}
