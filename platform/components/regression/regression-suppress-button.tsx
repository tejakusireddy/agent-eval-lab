"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

interface RegressionSuppressButtonProps {
  entryId: string;
}

export function RegressionSuppressButton({
  entryId,
}: RegressionSuppressButtonProps): React.ReactElement {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function onSuppress(): Promise<void> {
    const ok = window.confirm(
      "Suppress this regression? It will no longer be auto-injected into evaluations."
    );
    if (!ok) {
      return;
    }
    setPending(true);
    try {
      const res = await fetch(`/api/v1/regression/${entryId}/suppress`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        window.alert(data?.error ?? `Request failed (${res.status})`);
        return;
      }
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() => void onSuppress()}
    >
      {pending ? "…" : "Suppress"}
    </Button>
  );
}
