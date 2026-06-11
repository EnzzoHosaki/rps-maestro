"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";

// Modal compartilhado (Radix Dialog). Substitui os modais artesanais
// duplicados em automations/schedules/users/xml. De graça vêm: focus trap,
// scroll lock no body, fechar com ESC e clique no overlay, e a11y correta
// (role/aria-modal + título associado).
//
// Mantém o padrão de montagem condicional dos callers: enquanto montado,
// o dialog fica aberto; fechar (ESC/overlay/X) chama onClose, e o caller
// desmonta. Use `dismissable={false}` em formulários onde fechar por clique
// fora seria perda de dados acidental — ESC continua valendo.
export function Modal({
  title,
  onClose,
  children,
  wide,
  dismissable = true,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
  dismissable?: boolean;
}) {
  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content
          aria-describedby={undefined}
          onPointerDownOutside={(e) => !dismissable && e.preventDefault()}
          className={`fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] ${
            wide ? "max-w-2xl" : "max-w-md"
          } max-h-[90vh] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg bg-white p-6 shadow-xl focus:outline-none dark:bg-gray-900`}
        >
          <div className="mb-4 flex items-center justify-between">
            <Dialog.Title className="text-lg font-semibold">{title}</Dialog.Title>
            <Dialog.Close
              aria-label="Fechar"
              className="rounded text-gray-500 hover:text-gray-900 dark:text-gray-100"
            >
              <X className="h-5 w-5" aria-hidden />
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
