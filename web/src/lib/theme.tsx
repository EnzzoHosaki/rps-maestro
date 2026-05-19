"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore } from "react";

export type ThemePref = "light" | "dark" | "system";

const STORAGE_KEY = "theme";
const CHANGE_EVENT = "themechange";

// Subscribe pref: storage event (outras abas) + custom event (mesmo tab).
function subscribePref(cb: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY || e.key === null) cb();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(CHANGE_EVENT, cb);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(CHANGE_EVENT, cb);
  };
}

function getPref(): ThemePref {
  const v = localStorage.getItem(STORAGE_KEY);
  if (v === "light" || v === "dark" || v === "system") return v;
  return "system";
}

function getServerPref(): ThemePref {
  return "system";
}

// Subscribe pro media query do SO.
function subscribeSystemDark(cb: () => void): () => void {
  const mql = window.matchMedia("(prefers-color-scheme: dark)");
  mql.addEventListener("change", cb);
  return () => mql.removeEventListener("change", cb);
}

function getSystemDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function getServerSystemDark(): boolean {
  return false;
}

function resolveDark(pref: ThemePref, systemDark: boolean): boolean {
  if (pref === "dark") return true;
  if (pref === "light") return false;
  return systemDark;
}

interface ThemeState {
  pref: ThemePref;
  isDark: boolean;
  setPref: (p: ThemePref) => void;
  cycle: () => void;
}

const ThemeContext = createContext<ThemeState | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const pref = useSyncExternalStore(subscribePref, getPref, getServerPref);
  const systemDark = useSyncExternalStore(
    subscribeSystemDark,
    getSystemDark,
    getServerSystemDark
  );

  const isDark = resolveDark(pref, systemDark);

  // Aplica/remove `.dark` no <html>. Sync legítimo de React → DOM externo.
  useEffect(() => {
    const root = document.documentElement;
    if (isDark) {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
  }, [isDark]);

  const setPref = useCallback((p: ThemePref) => {
    localStorage.setItem(STORAGE_KEY, p);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  const cycle = useCallback(() => {
    const cur = getPref();
    const next: ThemePref = cur === "light" ? "dark" : cur === "dark" ? "system" : "light";
    localStorage.setItem(STORAGE_KEY, next);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  const value = useMemo<ThemeState>(
    () => ({ pref, isDark, setPref, cycle }),
    [pref, isDark, setPref, cycle]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeState {
  const ctx = useContext(ThemeContext);
  if (ctx === undefined) {
    throw new Error("useTheme deve ser usado dentro de <ThemeProvider>");
  }
  return ctx;
}
