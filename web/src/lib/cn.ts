import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// Junta classes condicionais (clsx) e resolve conflitos de Tailwind
// (tailwind-merge) — `cn("px-2", cond && "px-4")` vira "px-4". Base de todos
// os primitivos de UI e de qualquer override via prop `className`.
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
