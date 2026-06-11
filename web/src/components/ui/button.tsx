"use client";

import { forwardRef } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

// Button — primitivo único pras 7 variantes catalogadas no app. Encapsula
// cor/hover/disabled/foco; o caller só escolhe variant + size. Override
// pontual via className (resolvido por cn/tailwind-merge).
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 rounded font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rps-olive-dark focus-visible:ring-offset-1 disabled:opacity-50 disabled:pointer-events-none",
  {
    variants: {
      variant: {
        // CTA primário — olive-dark passa WCAG AA com texto branco (ver PR #4).
        primary: "bg-rps-olive-dark text-white hover:bg-rps-olive-darker",
        // Ação secundária de destaque (executar/reativar) — verde suave.
        soft: "bg-rps-sage-soft text-rps-olive-dark hover:bg-rps-sage",
        // Neutra (ver logs/editar).
        secondary:
          "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700",
        // Destrutiva (remover/desativar/cancelar).
        danger: "bg-red-50 text-red-700 hover:bg-red-100",
        // Contornada (paginação).
        outline:
          "border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800",
        // Sem fundo — ícones/links de ação leves.
        ghost:
          "text-gray-500 hover:text-gray-900 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-100 dark:hover:bg-gray-800",
      },
      size: {
        sm: "px-2 py-1 text-xs",
        md: "px-4 py-2 text-sm",
        icon: "p-1",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  }
);

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  )
);
Button.displayName = "Button";

export { buttonVariants };
