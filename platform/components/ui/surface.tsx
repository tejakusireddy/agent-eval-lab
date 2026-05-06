import { AlertCircle, ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
  className,
}: {
  title: string;
  description?: string;
  eyebrow?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-4 md:flex-row md:items-end md:justify-between", className)}>
      <div className="min-w-0">
        {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
        <h1 className="page-title">{title}</h1>
        {description ? <p className="page-description">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function SectionHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-3 md:flex-row md:items-end md:justify-between", className)}>
      <div>
        <h2 className="section-title">{title}</h2>
        {description ? <p className="section-description">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function MetricCard({
  label,
  value,
  detail,
  tone = "default",
  icon,
}: {
  label: string;
  value: React.ReactNode;
  detail?: React.ReactNode;
  tone?: "default" | "success" | "warning" | "danger";
  icon?: React.ReactNode;
}) {
  const toneClass =
    tone === "success"
      ? "text-success"
      : tone === "warning"
        ? "text-warning"
        : tone === "danger"
          ? "text-danger"
          : "text-foreground";

  return (
    <Card>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium text-foreground-muted">{label}</div>
          {icon ? <div className="text-foreground-subtle">{icon}</div> : null}
        </div>
        <div className={cn("text-3xl font-semibold tracking-tight", toneClass)}>{value}</div>
        {detail ? <div className="text-sm text-foreground-subtle">{detail}</div> : null}
      </CardContent>
    </Card>
  );
}

export function MetadataGrid({
  items,
  columns = 3,
}: {
  items: Array<{ label: string; value: React.ReactNode }>;
  columns?: 2 | 3 | 4;
}) {
  const gridClass =
    columns === 4
      ? "md:grid-cols-4"
      : columns === 2
        ? "md:grid-cols-2"
        : "md:grid-cols-3";

  return (
    <div className={cn("grid gap-3", gridClass)}>
      {items.map((item) => (
        <div key={item.label} className="rounded-xl border border-border bg-panel-muted/60 p-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-foreground-subtle">
            {item.label}
          </div>
          <div className="mt-2 text-sm font-medium text-foreground">{item.value}</div>
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <Card variant="muted">
      <CardContent className="flex flex-col items-center justify-center gap-3 py-12 text-center">
        <div className="text-lg font-semibold text-foreground">{title}</div>
        {description ? <div className="max-w-xl text-sm leading-6 text-foreground-muted">{description}</div> : null}
        {action ? <div className="pt-2">{action}</div> : null}
      </CardContent>
    </Card>
  );
}

export function ErrorState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <Card className="border-danger/15 bg-danger/5">
      <CardContent className="flex flex-col items-center justify-center gap-3 py-12 text-center">
        <AlertCircle className="h-8 w-8 text-danger" />
        <div className="text-lg font-semibold text-foreground">{title}</div>
        {description ? <div className="max-w-xl text-sm leading-6 text-foreground-muted">{description}</div> : null}
        {action ? <div className="pt-2">{action}</div> : null}
      </CardContent>
    </Card>
  );
}

export function DisclosurePanel({
  title,
  description,
  children,
  defaultOpen = false,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details
      className="rounded-2xl border border-border bg-panel shadow-panel open:bg-panel"
      open={defaultOpen}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4">
        <div>
          <div className="text-sm font-semibold text-foreground">{title}</div>
          {description ? <div className="mt-1 text-sm text-foreground-muted">{description}</div> : null}
        </div>
        <Button type="button" variant="ghost" size="sm" className="pointer-events-none shrink-0">
          <ChevronDown className="h-4 w-4" />
        </Button>
      </summary>
      <div className="border-t border-border px-5 py-5">{children}</div>
    </details>
  );
}

export function ReportPanel({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle>{title}</CardTitle>
            {description ? <CardDescription>{description}</CardDescription> : null}
          </div>
          {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
