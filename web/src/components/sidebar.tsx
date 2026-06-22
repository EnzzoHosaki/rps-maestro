"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Clock,
  FileSearch,
  LayoutDashboard,
  Users,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useNav } from "@/lib/nav";
import { cn } from "@/lib/cn";

type NavLink = { href: string; label: string; icon: LucideIcon; adminOnly?: boolean };

const links: NavLink[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/automations", label: "Automações", icon: Zap },
  { href: "/jobs", label: "Jobs", icon: Activity },
  { href: "/xml", label: "Rastreador XML", icon: FileSearch },
  { href: "/schedules", label: "Agendamentos", icon: Clock },
  { href: "/users", label: "Usuários", icon: Users, adminOnly: true },
];

export function Sidebar() {
  const pathname = usePathname();
  const { isAdmin } = useAuth();
  const { open, close } = useNav();

  // Fecha o drawer com ESC quando aberto (paridade com o backdrop).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  if (pathname === "/login") return null;

  const visibleLinks = links.filter((l) => !l.adminOnly || isAdmin);

  return (
    <>
      {/* Backdrop — só no mobile com o drawer aberto. Clique fora fecha. */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          aria-hidden
          onClick={close}
        />
      )}

      {/*
        Desktop (lg+): coluna fixa estática no fluxo. Mobile (< lg): drawer
        fixo que desliza da esquerda, controlado pelo hambúrguer do header.
      */}
      <aside
        className={cn(
          "flex w-56 shrink-0 flex-col border-r border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-950",
          "max-lg:fixed max-lg:inset-y-0 max-lg:left-0 max-lg:z-50 max-lg:shadow-xl max-lg:transition-transform",
          open ? "max-lg:translate-x-0" : "max-lg:-translate-x-full"
        )}
      >
        <div className="border-b border-gray-200 px-4 py-5 dark:border-gray-800">
          <span className="text-lg font-bold tracking-tight text-gray-900 dark:text-gray-100">
            RPS Maestro
          </span>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {visibleLinks.map((l) => {
            const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                onClick={close}
                className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  active
                    ? "bg-rps-olive-dark text-white"
                    : "text-gray-700 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-gray-800"
                }`}
              >
                <l.icon className="h-4 w-4 shrink-0" aria-hidden />
                {l.label}
              </Link>
            );
          })}
        </nav>
      </aside>
    </>
  );
}
