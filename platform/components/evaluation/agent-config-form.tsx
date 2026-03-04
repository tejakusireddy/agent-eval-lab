"use client";

import { UseFormReturn } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/components/ui/toast";

interface AgentConfigFormProps {
  form: UseFormReturn<{
    provider: "openai" | "http_agent";
    model: string;
    temperature: number;
    max_tokens: number;
    base_url?: string;
    http_agent_base_url?: string;
  }>;
}

export function AgentConfigForm({ form }: AgentConfigFormProps) {
  const { addToast } = useToast();
  const [testing, setTesting] = useState(false);
  const [testStatus, setTestStatus] = useState<"idle" | "success" | "error">("idle");
  const provider = form.watch("provider");

  const handleTestConnection = async () => {
    setTesting(true);
    setTestStatus("idle");

    try {
      const values = form.getValues();
      const response = await fetch("/api/agent/ping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: values.provider,
          base_url: values.base_url || null,
          http_agent_base_url: values.http_agent_base_url || null,
          timeout_seconds: 10,
        }),
      });

      const payload = await response.json();
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || "Connection test failed");
      }

      setTestStatus("success");
      addToast({
        variant: "success",
        title: "Connection Successful",
        description: payload?.message || "Agent is reachable and responding",
      });
    } catch (error: any) {
      setTestStatus("error");
      addToast({
        variant: "error",
        title: "Connection Failed",
        description:
          error?.message ||
          "Could not reach the agent. Please check your configuration.",
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-6">
      {provider === "openai" && (
        <>
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">
              Model
            </label>
            <input
              {...form.register("model")}
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
              placeholder="gpt-4o-mini"
            />
            {form.formState.errors.model && (
              <p className="mt-1 text-sm text-red-600">
                {form.formState.errors.model.message}
              </p>
            )}
            <p className="mt-1 text-xs text-gray-500">
              Model name (e.g., gpt-4o-mini, gpt-4, gpt-3.5-turbo)
            </p>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">
              Base URL (Optional)
            </label>
            <input
              {...form.register("base_url")}
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
              placeholder="https://api.openai.com/v1"
            />
            <p className="mt-1 text-xs text-gray-500">
              Custom OpenAI-compatible API endpoint (leave empty for default)
            </p>
          </div>
        </>
      )}

      {provider === "http_agent" && (
        <div>
          <label className="mb-2 block text-sm font-medium text-gray-700">
            Base URL
          </label>
          <input
            {...form.register("http_agent_base_url")}
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
            placeholder="http://localhost:8000"
          />
          {form.formState.errors.http_agent_base_url && (
            <p className="mt-1 text-sm text-red-600">
              {form.formState.errors.http_agent_base_url.message}
            </p>
          )}
          <p className="mt-1 text-xs text-gray-500">
            Base URL of your HTTP agent service
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-2 block text-sm font-medium text-gray-700">
            Temperature
          </label>
          <input
            type="number"
            step="0.1"
            {...form.register("temperature", { valueAsNumber: true })}
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
          />
          <p className="mt-1 text-xs text-gray-500">0.0 - 2.0 (lower = more deterministic)</p>
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-gray-700">
            Max Tokens
          </label>
          <input
            type="number"
            {...form.register("max_tokens", { valueAsNumber: true })}
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
          />
          <p className="mt-1 text-xs text-gray-500">Maximum response length</p>
        </div>
      </div>

      <div className="flex items-center gap-4 pt-4 border-t border-gray-200">
        <Button
          type="button"
          variant="outline"
          onClick={handleTestConnection}
          disabled={testing}
        >
          {testing ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Testing...
            </>
          ) : (
            "Test Connection"
          )}
        </Button>
        {testStatus === "success" && (
          <div className="flex items-center gap-2 text-sm text-green-600">
            <CheckCircle2 className="h-4 w-4" />
            Connection successful
          </div>
        )}
        {testStatus === "error" && (
          <div className="flex items-center gap-2 text-sm text-red-600">
            <XCircle className="h-4 w-4" />
            Connection failed
          </div>
        )}
      </div>
    </div>
  );
}
