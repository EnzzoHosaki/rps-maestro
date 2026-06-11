import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

// Badge — só a forma/tamanho do chip. A COR vem do caller via `className`,
// porque os tons são dados de domínio que já vivem em maps dedicados
// (STATUS_STYLE/XML_STATUS_STYLE/ERROR_CLASS_STYLE em lib/, CountBadge etc.).
// Isso mata a repetição do wrapper `rounded-full px-2 py-0.5 text-xs font-medium`
// sem centralizar paleta que pertence ao domínio.
const badgeVariants = cva("inline-block font-medium", {
  variants: {
    shape: { pill: "rounded-full", square: "rounded" },
    size: { sm: "px-2 py-0.5 text-xs", xs: "px-1.5 py-0.5 text-[10px]" },
  },
  defaultVariants: { shape: "pill", size: "sm" },
});

export type BadgeProps = React.HTMLAttributes<HTMLSpanElement> &
  VariantProps<typeof badgeVariants>;

export function Badge({ className, shape, size, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ shape, size }), className)} {...props} />;
}
