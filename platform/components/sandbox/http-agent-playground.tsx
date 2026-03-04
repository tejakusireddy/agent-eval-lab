"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { Loader2, CheckCircle2, XCircle, Send, Activity } from "lucide-react";

interface QueryResult {
  answer: string;
  details?: {
    endpoint?: string;
    latencyMs?: number;
    context_snippets?: string[];
    metadata?: Record<string, unknown>;
  };
}

export function HttpAgentPlayground() {
  const { addToast } = useToast();
  const [baseUrl, setBaseUrl] = useState("http://127.0.0.1:8000");
  const [query, setQuery] = useState("What does this knowledge base contain?");
  const [testing, setTesting] = useState(false);
  const [querying, setQuerying] = useState(false);
  const [healthStatus, setHealthStatus] = useState<"idle" | "ok" | "error">("idle");
  const [healthMessage, setHealthMessage] = useState("");
  const [result, setResult] = useState<QueryResult | null>(null);

  const handleTestConnection = async () => {
    setTesting(true);
    setHealthStatus("idle");
    setHealthMessage("");

    try {
      const response = await fetch("/api/agent/ping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "http_agent",
          http_agent_base_url: baseUrl.trim(),
          timeout_seconds: 10,
        }),
      });

      const payload = await response.json();
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || "Connection test failed");
      }

      setHealthStatus("ok");
      const message = payload?.message || "HTTP agent is reachable";
      setHealthMessage(message);
      addToast({
        variant: "success",
        title: "Agent Reachable",
        description: message,
      });
    } catch (error: any) {
      setHealthStatus("error");
      const message = error?.message || "Could not reach HTTP agent";
      setHealthMessage(message);
      addToast({
        variant: "error",
        title: "Connection Failed",
        description: message,
      });
    } finally {
      setTesting(false);
    }
  };

  const handleRunQuery = async () => {
    if (!query.trim()) {
      addToast({
        variant: "error",
        title: "Query Required",
        description: "Please enter a prompt for the agent.",
      });
      return;
    }

    setQuerying(true);
    setResult(null);

    try {
      const response = await fetch("/api/agent/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          base_url: baseUrl.trim(),
          query: query.trim(),
          timeout_seconds: 20,
        }),
      });

      const payload = await response.json();
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || "Agent query failed");
      }

      setResult({
        answer: payload.answer,
        details: payload.details,
      });
    } catch (error: any) {
      addToast({
        variant: "error",
        title: "Query Failed",
        description: error?.message || "Could not get a response from agent.",
      });
    } finally {
      setQuerying(false);
    }
  };

  return (
    <Card className="border-gray-200">
      <CardHeader>
        <CardTitle className="text-xl">HTTP Agent Playground</CardTitle>
        <CardDescription>
          Validate your agent behavior before running red-team scenarios.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <label className="mb-2 block text-sm font-medium text-gray-700">Agent Base URL</label>
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
            placeholder="http://127.0.0.1:8000"
          />
          <p className="mt-1 text-xs text-gray-500">Expected endpoints: GET /health and POST /agent</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" onClick={handleTestConnection} disabled={testing}>
            {testing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Testing...
              </>
            ) : (
              <>
                <Activity className="mr-2 h-4 w-4" />
                Test Agent Health
              </>
            )}
          </Button>
          {healthStatus === "ok" && (
            <div className="flex items-center gap-2 text-sm text-green-700">
              <CheckCircle2 className="h-4 w-4" />
              {healthMessage}
            </div>
          )}
          {healthStatus === "error" && (
            <div className="flex items-center gap-2 text-sm text-red-700">
              <XCircle className="h-4 w-4" />
              {healthMessage}
            </div>
          )}
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-gray-700">Try a Prompt</label>
          <textarea
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            rows={4}
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
            placeholder="Ask your agent a question..."
          />
        </div>

        <div>
          <Button onClick={handleRunQuery} disabled={querying}>
            {querying ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Querying...
              </>
            ) : (
              <>
                <Send className="mr-2 h-4 w-4" />
                Send Prompt to Agent
              </>
            )}
          </Button>
        </div>

        {result && (
          <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-4">
            <div>
              <div className="text-sm font-medium text-gray-900">Agent Response</div>
              <pre className="mt-2 whitespace-pre-wrap text-sm text-gray-700">{result.answer}</pre>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-md border border-gray-200 bg-white p-3 text-xs text-gray-600">
                <div><strong>Endpoint:</strong> {result.details?.endpoint || "N/A"}</div>
                <div><strong>Latency:</strong> {result.details?.latencyMs ?? "N/A"} ms</div>
              </div>
              <div className="rounded-md border border-gray-200 bg-white p-3 text-xs text-gray-600">
                <div className="mb-1 font-medium text-gray-700">Metadata</div>
                <pre className="whitespace-pre-wrap">
                  {JSON.stringify(result.details?.metadata || {}, null, 2)}
                </pre>
              </div>
            </div>

            {result.details?.context_snippets && result.details.context_snippets.length > 0 && (
              <div className="rounded-md border border-gray-200 bg-white p-3">
                <div className="mb-2 text-xs font-medium text-gray-700">Context Snippets</div>
                <ul className="space-y-2 text-xs text-gray-600">
                  {result.details.context_snippets.map((snippet, idx) => (
                    <li key={idx} className="rounded bg-gray-50 p-2">
                      {snippet}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

