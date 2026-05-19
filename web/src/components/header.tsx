"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useAuth } from "@/lib/auth";

const PAGE_TITLES: Array<{ match: (p: string) => boolean; title: string }> = [
  { match: (p) => p === "/", title: "Dashboard" },
  { match: (p) => p.startsWith("/automations"), title: "Automações" },
  { match: (p) => p.startsWith("/jobs"), title: "Jobs" },
  { match: (p) => p.startsWith("/schedules"), title: "Agendamentos" },
  { match: (p) => p.startsWith("/users"), title: "Usuários" },
  { match: (p) => p.startsWith("/me"), title: "Meu perfil" },
];

const ROLE_LABEL: Record<string, string> = {
  admin: "Admin",
  operator: "Operador",
  viewer: "Leitor",
};

function pageTitle(pathname: string): string {
  return PAGE_TITLES.find((p) => p.match(pathname))?.title ?? "";
}

export function Header() {
  const pathname = usePathname();
  const { email, role, logout } = useAuth();

  if (pathname === "/login") return null;

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-gray-200 bg-white px-6 dark:border-gray-800 dark:bg-gray-900">
      <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
        {pageTitle(pathname)}
      </h1>

      {email && (
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-gray-700 transition-colors hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
              aria-label="Menu do usuário"
            >
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-rps-olive-dark text-xs font-semibold text-white">
                {email.charAt(0).toUpperCase()}
              </div>
              <div className="hidden text-left sm:block">
                <p className="text-xs font-medium leading-tight text-gray-900 dark:text-gray-100">
                  {email}
                </p>
                {role && (
                  <p className="text-[10px] leading-tight text-gray-500 dark:text-gray-400">
                    {ROLE_LABEL[role] ?? role}
                  </p>
                )}
              </div>
              <span className="text-xs text-gray-400">▾</span>
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={4}
              className="z-50 min-w-[180px] overflow-hidden rounded-md border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800"
            >
              <DropdownMenu.Item asChild>
                <Link
                  href="/me"
                  className="block cursor-pointer px-3 py-1.5 text-sm text-gray-700 outline-none hover:bg-gray-100 focus:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700 dark:focus:bg-gray-700"
                >
                  Meu perfil
                </Link>
              </DropdownMenu.Item>
              <DropdownMenu.Separator className="my-1 h-px bg-gray-200 dark:bg-gray-700" />
              <DropdownMenu.Item
                onSelect={logout}
                className="cursor-pointer px-3 py-1.5 text-sm text-gray-700 outline-none hover:bg-gray-100 focus:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700 dark:focus:bg-gray-700"
              >
                Sair
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      )}
    </header>
  );
}
