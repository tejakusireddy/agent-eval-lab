"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  Terminal,
  LayoutDashboard,
  Plus,
  FileText,
  Settings,
  Layers3,
  Plug,
  Rocket,
} from "lucide-react";
import { cn } from "@/lib/utils";

const clerkEnabled =
  typeof window !== "undefined" &&
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY &&
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY !== "pk_test_..." &&
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY.startsWith("pk_");

let UserButton: any = () => null;
if (clerkEnabled) {
  try {
    const clerk = require("@clerk/nextjs");
    UserButton = clerk.UserButton;
  } catch {
    // Clerk not available
  }
}

const staticNavItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/dashboard/evaluations/new", label: "New Evaluation", icon: Plus },
  { href: "/dashboard/batches", label: "Batches", icon: Layers3 },
  { href: "/sandbox", label: "Agent Playground", icon: Terminal },
  { href: "/integrations", label: "Integrate Agent", icon: Plug },
  { href: "/scenarios", label: "Scenarios", icon: FileText },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

export function Nav({
  initialEvaluationCountZero,
}: {
  initialEvaluationCountZero?: boolean;
} = {}) {
  const pathname = usePathname();
  const [showQuickStart, setShowQuickStart] = useState<boolean>(() =>
    initialEvaluationCountZero === true
  );

  useEffect(() => {
    if (initialEvaluationCountZero !== undefined) {
      setShowQuickStart(initialEvaluationCountZero === true);
      return;
    }
    let cancelled = false;
    fetch("/api/dashboard/evaluation-count")
      .then((r) => r.json())
      .then((data: { count?: number }) => {
        if (cancelled) return;
        const c = data.count;
        if (typeof c === "number" && c >= 0) {
          setShowQuickStart(c === 0);
        } else {
          setShowQuickStart(false);
        }
      })
      .catch(() => {
        if (!cancelled) setShowQuickStart(false);
      });
    return () => {
      cancelled = true;
    };
  }, [initialEvaluationCountZero]);

  const navItems = useMemo(() => {
    if (!showQuickStart) return staticNavItems;
    const quickStart = {
      href: "/dashboard/onboarding",
      label: "Quick Start",
      icon: Rocket,
    };
    return [staticNavItems[0], quickStart, ...staticNavItems.slice(1)];
  }, [showQuickStart]);

  return (
    <nav className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/90">
      <div className="mx-auto max-w-7xl px-6">
        <div className="flex h-16 items-center justify-between">
          <div className="flex items-center gap-8">
            <Link href="/dashboard" className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-border bg-panel shadow-panel">
                <Terminal className="h-4 w-4 text-foreground" />
              </div>
              <span className="text-lg font-semibold tracking-tight text-foreground">
                Agent Eval Lab
              </span>
            </Link>
            <div className="hidden md:flex items-center gap-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive =
                  pathname === item.href || pathname?.startsWith(item.href + "/");
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-colors",
                      isActive
                        ? "bg-panel text-foreground shadow-panel"
                        : "text-foreground-muted hover:bg-panel-muted hover:text-foreground"
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
          <UserButton afterSignOutUrl="/" />
        </div>
      </div>
    </nav>
  );
}
