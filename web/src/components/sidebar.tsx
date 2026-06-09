"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth";

type NavLink = { href: string; label: string; icon: string; adminOnly?: boolean };

const links: NavLink[] = [
  { href: "/", label: "Dashboard", icon: "▦" },
  { href: "/automations", label: "Automações", icon: "⚡" },
  { href: "/jobs", label: "Jobs", icon: "⚙" },
  { href: "/xml", label: "Rastreador XML", icon: "📄" },
  { href: "/schedules", label: "Agendamentos", icon: "⏱" },
  { href: "/users", label: "Usuários", icon: "◉", adminOnly: true },
];

export function Sidebar() {
  const pathname = usePathname();
  const { isAdmin } = useAuth();

  if (pathname === "/login") return null;

  const visibleLinks = links.filter((l) => !l.adminOnly || isAdmin);

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-950">
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
              className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                active
                  ? "bg-rps-olive-dark text-white"
                  : "text-gray-700 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-gray-800"
              }`}
            >
              <span className="text-base">{l.icon}</span>
              {l.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
