"use client";

import { createContext, useCallback, useContext, useState } from "react";

// Estado do menu lateral em telas estreitas (< lg). No desktop a sidebar é
// fixa e esse estado é ignorado; no mobile ela vira drawer e o hambúrguer do
// header controla este `open`. Header e Sidebar são componentes separados no
// layout, então o estado precisa morar num contexto compartilhado.
type NavState = { open: boolean; toggle: () => void; close: () => void };

const NavContext = createContext<NavState | null>(null);

export function NavProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((o) => !o), []);
  const close = useCallback(() => setOpen(false), []);
  return <NavContext.Provider value={{ open, toggle, close }}>{children}</NavContext.Provider>;
}

export function useNav(): NavState {
  const ctx = useContext(NavContext);
  if (!ctx) throw new Error("useNav precisa estar dentro de <NavProvider>");
  return ctx;
}
