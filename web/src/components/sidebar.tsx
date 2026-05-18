"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth";

type NavLink = { href: string; label: string; icon: string; adminOnly?: boolean };

const links: NavLink[] = [
  { href: "/", label: "Dashboard", icon: "▦" },
  { href: "/automations", label: "Automações", icon: "⚡" },
  { href: "/jobs", label: "Jobs", icon: "⚙" },
  { href: "/schedules", label: "Agendamentos", icon: "⏱" },
  { href: "/users", label: "Usuários", icon: "◉", adminOnly: true },
];

const ROLE_LABEL: Record<string, string> = {
  admin: "Admin",
  operator: "Operador",
  viewer: "Leitor",
};

export function Sidebar() {
  const pathname = usePathname();
  const { email, role, isAdmin, logout } = useAuth();

  if (pathname === "/login") return null;

  const visibleLinks = links.filter((l) => !l.adminOnly || isAdmin);

  return (
    <aside className="w-56 shrink-0 border-r border-gray-200 bg-gray-50 min-h-screen flex flex-col">
      <div className="px-4 py-5 border-b border-gray-200">
        <span className="text-lg font-bold tracking-tight">RPS Maestro</span>
      </div>
      <nav className="flex-1 p-3 space-y-1">
        {visibleLinks.map((l) => {
          const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                active
                  ? "bg-rps-olive-dark text-white"
                  : "text-gray-700 hover:bg-gray-200"
              }`}
            >
              <span className="text-base">{l.icon}</span>
              {l.label}
            </Link>
          );
        })}
      </nav>
      <div className="p-4 border-t border-gray-200 space-y-2">
        {email && (
          <Link
            href="/me"
            className="block text-xs text-gray-600 hover:text-gray-900 transition-colors"
          >
            <p className="truncate font-medium text-gray-700">{email}</p>
            {role && <p className="text-gray-500">{ROLE_LABEL[role] ?? role}</p>}
          </Link>
        )}
        <button
          onClick={logout}
          className="w-full text-left text-sm text-gray-600 hover:text-gray-900 transition-colors"
        >
          Sair
        </button>
      </div>
    </aside>
  );
}
