import { Badge } from "@/components/ui/badge";

interface SeverityBadgeProps {
  severity: "PASS" | "FAIL_MINOR" | "FAIL_CRITICAL" | string;
}

export function SeverityBadge({ severity }: SeverityBadgeProps) {
  const variantMap = {
    PASS: "success" as const,
    FAIL_MINOR: "warning" as const,
    FAIL_CRITICAL: "destructive" as const,
  };

  const variant = variantMap[severity as keyof typeof variantMap] || "default";

  return (
    <Badge variant={variant} className="font-medium">
      {severity}
    </Badge>
  );
}

