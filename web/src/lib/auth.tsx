"use client";

import { createContext, useCallback, useContext, useMemo, useSyncExternalStore } from "react";

export type Role = "admin" | "operator" | "viewer";

interface JWTClaims {
  user_id: number;
  email: string;
  role: Role;
  exp: number;
  iat: number;
}

function decodeJWT(token: string): JWTClaims | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const claims = JSON.parse(atob(padded)) as JWTClaims;
    if (!claims || typeof claims !== "object") return null;
    if (typeof claims.exp === "number" && claims.exp * 1000 <= Date.now()) {
      return null;
    }
    return claims;
  } catch {
    return null;
  }
}

// Store externo do token — o navegador é a fonte da verdade (localStorage).
// React consome via useSyncExternalStore pra evitar setState em useEffect e
// pra hidratar limpo. O `storage` event nativo pega logout em outras abas;
// no mesmo tab, login()/logout() notificam manualmente.
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

function getToken(): string | null {
  return localStorage.getItem("token");
}

function getServerToken(): string | null {
  return null;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === "token" || e.key === null) cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

interface AuthState {
  email: string | null;
  userId: number | null;
  role: Role | null;
  isAdmin: boolean;
  isOperatorPlus: boolean;
  login: (token: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const token = useSyncExternalStore(subscribe, getToken, getServerToken);
  const claims = useMemo(() => (token ? decodeJWT(token) : null), [token]);

  const login = useCallback((newToken: string) => {
    localStorage.setItem("token", newToken);
    notify();
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem("token");
    notify();
    window.location.href = "/login";
  }, []);

  const role = claims?.role ?? null;
  const value: AuthState = {
    email: claims?.email ?? null,
    userId: claims?.user_id ?? null,
    role,
    isAdmin: role === "admin",
    isOperatorPlus: role === "admin" || role === "operator",
    login,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (ctx === undefined) {
    throw new Error("useAuth deve ser usado dentro de <AuthProvider>");
  }
  return ctx;
}
