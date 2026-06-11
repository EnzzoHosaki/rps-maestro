import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

// ErrorState — o que faltava no app inteiro: até agora NENHUMA tela tratava
// isError, então uma falha de API deixava o skeleton girando pra sempre.
// Duas formas: bloco de seção (ErrorState) e linha de tabela com colSpan
// (ErrorRow). `onRetry` (normalmente o refetch da query) mostra "Tentar de novo".

const DEFAULT_MESSAGE = "Não foi possível carregar. Verifique a conexão e tente de novo.";

function ErrorBody({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
      <AlertCircle className="h-6 w-6 text-red-500" aria-hidden />
      <p>{message ?? DEFAULT_MESSAGE}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry} className="mt-1">
          Tentar de novo
        </Button>
      )}
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
  className,
}: {
  message?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div className={cn("py-8", className)}>
      <ErrorBody message={message} onRetry={onRetry} />
    </div>
  );
}

export function ErrorRow({
  colSpan,
  message,
  onRetry,
}: {
  colSpan: number;
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-12">
        <ErrorBody message={message} onRetry={onRetry} />
      </td>
    </tr>
  );
}
