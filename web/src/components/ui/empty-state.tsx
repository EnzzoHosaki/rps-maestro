import { cn } from "@/lib/cn";

// EmptyState — mensagem neutra de "nada aqui". Duas formas: bloco de seção
// (EmptyState) e linha de tabela com colSpan (EmptyRow). Substitui os ~10
// parágrafos/células ad-hoc espalhados.

export function EmptyState({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p className={cn("py-8 text-center text-sm text-gray-500", className)}>{children}</p>
  );
}

export function EmptyRow({
  colSpan,
  children,
  className,
}: {
  colSpan: number;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <tr>
      <td
        colSpan={colSpan}
        className={cn("px-4 py-12 text-center text-sm text-gray-600 dark:text-gray-400", className)}
      >
        {children}
      </td>
    </tr>
  );
}
