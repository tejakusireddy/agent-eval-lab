import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatGateOutcome } from "@/lib/formatting";
import { Hourglass, ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";

import type { GateStatus } from "@/lib/release-gate";

interface GateBadgeProps {
  status: GateStatus;
  className?: string;
}

export function GateBadge({ status, className }: GateBadgeProps) {
  const config = {
    go: {
      label: formatGateOutcome("go"),
      icon: ShieldCheck,
      variant: "success" as const,
      className: "",
    },
    block: {
      label: formatGateOutcome("block"),
      icon: ShieldAlert,
      variant: "destructive" as const,
      className: "",
    },
    pending: {
      label: formatGateOutcome("pending"),
      icon: Hourglass,
      variant: "warning" as const,
      className: "",
    },
    unavailable: {
      label: formatGateOutcome("unavailable"),
      icon: ShieldQuestion,
      variant: "secondary" as const,
      className: "",
    },
  };

  const gate = config[status];
  const Icon = gate.icon;

  return (
    <Badge
      variant={gate.variant}
      className={cn("font-medium", gate.className, className)}
    >
      <Icon className="h-3.5 w-3.5" />
      {gate.label}
    </Badge>
  );
}
