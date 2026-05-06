"use client";

import { ErrorBoundary } from "@/components/error-boundary";
import { LoadingBar } from "@/components/loading-bar";
import { Nav } from "@/components/nav";

export function AppLayout({
  children,
  initialEvaluationCountZero,
}: {
  children: React.ReactNode;
  /** When set (e.g. from dashboard server component), avoids a client fetch for nav Quick Start. */
  initialEvaluationCountZero?: boolean;
}) {
  return (
    <ErrorBoundary>
      <LoadingBar />
      <div className="min-h-screen bg-background">
        <Nav initialEvaluationCountZero={initialEvaluationCountZero} />
        <main className="page-shell">{children}</main>
      </div>
    </ErrorBoundary>
  );
}
