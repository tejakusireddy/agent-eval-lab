"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { z } from "zod";

import { AppLayout } from "@/components/layout/app-layout";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

const SuccessSchema = z.object({
  spec_version: z.literal("1.0"),
  evaluation_id: z.string(),
  status: z.literal("running"),
  poll_url: z.string(),
  project_name: z.string(),
  submitted_at: z.string(),
});

export default function LangSmithImportPage(): React.ReactElement {
  const router = useRouter();
  const { addToast } = useToast();
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [limit, setLimit] = useState(50);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const res = await fetch("/api/v1/import/langsmith", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          langsmith_api_key: apiKey,
          project_name: projectName,
          limit,
        }),
      });
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const errObj = data as { error?: string } | null;
        setError(errObj?.error ?? `Request failed (${res.status})`);
        return;
      }
      const parsed = SuccessSchema.safeParse(data);
      if (!parsed.success) {
        setError("Unexpected response from server");
        return;
      }
      addToast({
        variant: "success",
        title: "Import started",
        description: "Traces will appear shortly on the evaluation page.",
      });
      router.push(`/dashboard/evaluations/${parsed.data.evaluation_id}`);
    } catch {
      setError("Network error — try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <AppLayout>
      <div className="mx-auto max-w-lg">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-gray-900">
            Import from LangSmith
          </h1>
          <p className="mt-2 text-sm text-gray-600">
            Pull your existing traces into Agent Eval Lab for grading and
            analysis
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Connection</CardTitle>
            <CardDescription>
              Uses your LangSmith credentials for a one-time pull only.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-2">
                <label
                  htmlFor="langsmith-key"
                  className="text-sm font-medium text-gray-900"
                >
                  LangSmith API Key
                </label>
                <div className="relative">
                  <Input
                    id="langsmith-key"
                    name="langsmith_api_key"
                    type={showKey ? "text" : "password"}
                    autoComplete="off"
                    value={apiKey}
                    onChange={(ev) => setApiKey(ev.target.value)}
                    placeholder="lsv2_…"
                    className="pr-10"
                    required
                  />
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                    onClick={() => setShowKey((v) => !v)}
                    aria-label={showKey ? "Hide API key" : "Show API key"}
                  >
                    {showKey ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
                <p className="text-xs text-gray-500">
                  Your LangSmith API key from smith.langchain.com/settings
                </p>
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="project-name"
                  className="text-sm font-medium text-gray-900"
                >
                  Project name
                </label>
                <Input
                  id="project-name"
                  name="project_name"
                  type="text"
                  value={projectName}
                  onChange={(ev) => setProjectName(ev.target.value)}
                  placeholder="my-project"
                  required
                />
                <p className="text-xs text-gray-500">
                  The LangSmith project containing your traces
                </p>
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="trace-limit"
                  className="text-sm font-medium text-gray-900"
                >
                  Trace limit
                </label>
                <Input
                  id="trace-limit"
                  name="limit"
                  type="number"
                  min={1}
                  max={200}
                  value={limit}
                  onChange={(ev) => {
                    const n = Number(ev.target.value);
                    if (!Number.isFinite(n)) {
                      return;
                    }
                    setLimit(Math.min(200, Math.max(1, Math.floor(n))));
                  }}
                />
                <p className="text-xs text-gray-500">
                  How many recent traces to import (max 200)
                </p>
              </div>

              {error ? (
                <p className="text-sm text-red-600" role="alert">
                  {error}
                </p>
              ) : null}

              <Button type="submit" className="w-full" disabled={pending}>
                {pending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Submitting…
                  </>
                ) : (
                  "Import traces"
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        <div
          className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"
          role="note"
        >
          <strong className="font-medium">Security:</strong> Your LangSmith API
          key is sent directly to our worker and used only for this import. It is
          not stored.
        </div>

        <p className="mt-8 text-center text-sm">
          <Link
            href="/dashboard"
            className="text-indigo-600 hover:text-indigo-500"
          >
            ← Back to Dashboard
          </Link>
        </p>
      </div>
    </AppLayout>
  );
}
