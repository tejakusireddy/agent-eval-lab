import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium leading-none tracking-[0.01em] transition-colors",
  {
    variants: {
      variant: {
        default: "border-border bg-neutral-badge text-foreground-muted",
        secondary: "border-border bg-panel-muted text-foreground-muted",
        destructive: "border-danger/15 bg-danger/10 text-danger",
        success: "border-success/15 bg-success/10 text-success",
        warning: "border-warning/20 bg-warning/10 text-warning",
        outline: "border-border bg-panel text-foreground-muted",
        info: "border-accent/10 bg-accent/5 text-accent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
