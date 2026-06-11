"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";
import { Modal } from "@/components/ui/modal";

// Confirmação imperativa, promise-based — substitui o `confirm()` nativo do
// browser (que não respeita tema, não é estilizável e bloqueia a thread).
//
// Uso:
//   const confirm = useConfirm();
//   if (await confirm({ title: "Remover", message: "...", tone: "danger" })) {
//     mutate();
//   }
//
// Um único <ConfirmProvider> em providers.tsx hospeda a instância do dialog;
// cada chamada resolve a promise com true (confirmou) ou false (cancelou/ESC).

type ConfirmOptions = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
};

type ConfirmContextValue = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

export function useConfirm(): ConfirmContextValue {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm precisa estar dentro de <ConfirmProvider>");
  return ctx;
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmContextValue>((opts) => {
    setState(opts);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const settle = useCallback((value: boolean) => {
    resolver.current?.(value);
    resolver.current = null;
    setState(null);
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && (
        <Modal title={state.title} onClose={() => settle(false)}>
          <p className="text-sm text-gray-600 dark:text-gray-400">{state.message}</p>
          <div className="mt-6 flex justify-end gap-2">
            <button
              onClick={() => settle(false)}
              className="rounded-md px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              {state.cancelLabel ?? "Cancelar"}
            </button>
            <button
              autoFocus
              onClick={() => settle(true)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium text-white ${
                state.tone === "danger"
                  ? "bg-red-600 hover:bg-red-700"
                  : "bg-rps-olive-dark hover:bg-rps-olive-darker"
              }`}
            >
              {state.confirmLabel ?? "Confirmar"}
            </button>
          </div>
        </Modal>
      )}
    </ConfirmContext.Provider>
  );
}
