"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatStatusLabel } from "@/lib/formatting";
import { Clock, CheckCircle2, XCircle, Loader2 } from "lucide-react";

interface StatusBadgeProps {
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = {
    queued: {
      label: formatStatusLabel("queued"),
      icon: Clock,
      variant: "warning" as const,
      className: "",
    },
    running: {
      label: formatStatusLabel("running"),
      icon: Loader2,
      variant: "info" as const,
      className: "",
    },
    completed: {
      label: formatStatusLabel("completed"),
      icon: CheckCircle2,
      variant: "success" as const,
      className: "",
    },
    failed: {
      label: formatStatusLabel("failed"),
      icon: XCircle,
      variant: "destructive" as const,
      className: "",
    },
    cancelled: {
      label: formatStatusLabel("cancelled"),
      icon: XCircle,
      variant: "secondary" as const,
      className: "",
    },
  };

  const { label, icon: Icon, className: statusClassName } = config[status];

  return (
    <Badge
      variant={config[status].variant}
      className={cn("font-medium", statusClassName, className)}
    >
      <Icon className={cn("h-3.5 w-3.5", status === "running" && "animate-spin")} />
      {label}
    </Badge>
  );
}
