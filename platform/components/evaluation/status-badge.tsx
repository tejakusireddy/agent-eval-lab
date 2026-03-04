"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Clock, CheckCircle2, XCircle, Loader2 } from "lucide-react";

interface StatusBadgeProps {
  status: "queued" | "running" | "completed" | "failed";
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = {
    queued: {
      label: "QUEUED",
      icon: Clock,
      variant: "warning" as const,
      className: "bg-yellow-50 text-yellow-700 border-yellow-200",
    },
    running: {
      label: "RUNNING",
      icon: Loader2,
      variant: "warning" as const,
      className: "bg-blue-50 text-blue-700 border-blue-200 animate-pulse",
    },
    completed: {
      label: "COMPLETED",
      icon: CheckCircle2,
      variant: "success" as const,
      className: "bg-green-50 text-green-700 border-green-200",
    },
    failed: {
      label: "FAILED",
      icon: XCircle,
      variant: "destructive" as const,
      className: "bg-red-50 text-red-700 border-red-200",
    },
  };

  const { label, icon: Icon, className: statusClassName } = config[status];

  return (
    <Badge
      variant={config[status].variant}
      className={cn("inline-flex items-center gap-1.5 font-medium", statusClassName, className)}
    >
      <Icon className="h-3 w-3" />
      {label}
    </Badge>
  );
}

