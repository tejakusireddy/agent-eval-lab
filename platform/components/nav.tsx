"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Terminal, LayoutDashboard, Plus, FileText, Settings } from "lucide-react";
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

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/dashboard/evaluations/new", label: "New Evaluation", icon: Plus },
  { href: "/scenarios", label: "Scenarios", icon: FileText },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <nav className="border-b border-gray-100 bg-white">
      <div className="mx-auto max-w-7xl px-6">
        <div className="flex h-16 items-center justify-between">
          <div className="flex items-center gap-8">
            <Link href="/dashboard" className="flex items-center gap-2">
              <Terminal className="h-5 w-5 text-gray-900" />
              <span className="text-lg font-semibold text-gray-900">
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
                      "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                      isActive
                        ? "bg-gray-100 text-gray-900"
                        : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
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
