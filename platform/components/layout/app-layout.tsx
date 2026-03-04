"use client";

import { ToastProvider } from "@/components/ui/toast";
import { ErrorBoundary } from "@/components/error-boundary";
import { LoadingBar } from "@/components/loading-bar";
import { Nav } from "@/components/nav";

export function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <LoadingBar />
        <div className="min-h-screen bg-white">
          <Nav />
          <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
        </div>
      </ToastProvider>
    </ErrorBoundary>
  );
}
