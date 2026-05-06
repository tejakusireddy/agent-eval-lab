"use client";

import { UseFormReturn } from "react-hook-form";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Wand2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { useState } from "react";
import { useToast } from "@/components/ui/toast";
import {
  HTTP_AGENT_PRESETS,
  getHttpAgentPresetById,
} from "@/lib/http-agent-presets";

interface AgentConfigFormProps {
  form: UseFormReturn<{
    provider: "openai" | "http_agent";
    model: string;
    temperature: number;
    max_tokens: number;
    base_url?: string;
    http_agent_base_url?: string;
    http_agent_endpoint_path?: string;
    http_agent_health_path?: string;
    http_agent_method?: "GET" | "POST" | "PUT" | "PATCH";
    http_agent_prompt_field?: string;
    http_agent_response_path?: string;
    http_agent_auth_header?: string;
    http_agent_auth_env_var?: string;
    http_agent_auth_scheme?: string;
  }>;
}

export function AgentConfigForm({ form }: AgentConfigFormProps) {
  const { addToast } = useToast();
  const [testing, setTesting] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [showAdvancedHttp, setShowAdvancedHttp] = useState(false);
  const [selectedPresetId, setSelectedPresetId] = useState("generic");
  const [testStatus, setTestStatus] = useState<"idle" | "success" | "error">("idle");
  const provider = form.watch("provider");
  const httpMethod = form.watch("http_agent_method") || "POST";
  const httpEndpointPath = form.watch("http_agent_endpoint_path") || "/agent";
  const httpPromptField = form.watch("http_agent_prompt_field") || "query";
  const httpResponsePath = form.watch("http_agent_response_path") || "answer";

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
          http_agent_endpoint_path: values.http_agent_endpoint_path || "/agent",
          http_agent_health_path: values.http_agent_health_path || "/health",
          http_agent_method: values.http_agent_method || "POST",
          http_agent_prompt_field: values.http_agent_prompt_field || "query",
          http_agent_response_path: values.http_agent_response_path || "answer",
          http_agent_auth_header: values.http_agent_auth_header || "Authorization",
          http_agent_auth_env_var: values.http_agent_auth_env_var || null,
          http_agent_auth_scheme: values.http_agent_auth_scheme || "Bearer",
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

  const handleAutoDetectHttpConfig = async () => {
    setDiscovering(true);
    try {
      const values = form.getValues();
      const response = await fetch("/api/agent/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          base_url: values.http_agent_base_url || null,
          endpoint_path: values.http_agent_endpoint_path || null,
          health_path: values.http_agent_health_path || null,
          method: values.http_agent_method || null,
          prompt_field: values.http_agent_prompt_field || null,
          response_path: values.http_agent_response_path || null,
          auth_header: values.http_agent_auth_header || "Authorization",
          auth_token_env_var: values.http_agent_auth_env_var || null,
          auth_scheme: values.http_agent_auth_scheme || "Bearer",
          timeout_seconds: 8,
        }),
      });

      const payload = await response.json();
      if (!response.ok || !payload?.success || !payload?.recommended) {
        throw new Error(payload?.error || "Auto-detection failed");
      }

      form.setValue("http_agent_endpoint_path", payload.recommended.endpoint_path, {
        shouldDirty: true,
      });
      if (payload.recommended.health_path) {
        form.setValue("http_agent_health_path", payload.recommended.health_path, {
          shouldDirty: true,
        });
      }
      form.setValue("http_agent_method", payload.recommended.method, {
        shouldDirty: true,
      });
      form.setValue("http_agent_prompt_field", payload.recommended.prompt_field, {
        shouldDirty: true,
      });
      form.setValue("http_agent_response_path", payload.recommended.response_path, {
        shouldDirty: true,
      });
      setShowAdvancedHttp(true);

      addToast({
        variant: "success",
        title: "Auto-detect Complete",
        description: `Detected ${payload.recommended.method} ${payload.recommended.endpoint_path} (confidence ${payload.recommended.confidence}%).`,
      });
    } catch (error: any) {
      addToast({
        variant: "error",
        title: "Auto-detect Failed",
        description: error?.message || "Could not auto-detect HTTP agent contract.",
      });
    } finally {
      setDiscovering(false);
    }
  };

  const handleApplyPreset = () => {
    const preset = getHttpAgentPresetById(selectedPresetId);
    if (!preset) {
      return;
    }
    form.setValue("http_agent_endpoint_path", preset.config.endpointPath, {
      shouldDirty: true,
    });
    form.setValue("http_agent_health_path", preset.config.healthPath, {
      shouldDirty: true,
    });
    form.setValue("http_agent_method", preset.config.method, {
      shouldDirty: true,
    });
    form.setValue("http_agent_prompt_field", preset.config.promptField, {
      shouldDirty: true,
    });
    form.setValue("http_agent_response_path", preset.config.responsePath, {
      shouldDirty: true,
    });
    form.setValue("http_agent_auth_header", preset.config.authHeader, {
      shouldDirty: true,
    });
    form.setValue("http_agent_auth_scheme", preset.config.authScheme, {
      shouldDirty: true,
    });
    if (preset.config.authEnvVar) {
      form.setValue("http_agent_auth_env_var", preset.config.authEnvVar, {
        shouldDirty: true,
      });
    }
    setShowAdvancedHttp(true);
    addToast({
      variant: "success",
      title: "Preset Applied",
      description: `${preset.label} contract loaded.`,
    });
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
        <div className="space-y-4">
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

          <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs text-gray-600">
                Contract: <span className="font-medium text-gray-900">{httpMethod} {httpEndpointPath}</span>
                {" · "}
                prompt: <span className="font-medium text-gray-900">{httpPromptField}</span>
                {" · "}
                response: <span className="font-medium text-gray-900">{httpResponsePath}</span>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowAdvancedHttp((current) => !current)}
              >
                {showAdvancedHttp ? (
                  <>
                    <ChevronUp className="mr-2 h-3.5 w-3.5" />
                    Hide Advanced
                  </>
                ) : (
                  <>
                    <ChevronDown className="mr-2 h-3.5 w-3.5" />
                    Edit Contract
                  </>
                )}
              </Button>
            </div>
            <div className="mt-2 text-xs text-gray-500">
              Fast path: keep defaults and click <strong>Auto-detect HTTP Config</strong>, then run test.
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <select
                value={selectedPresetId}
                onChange={(event) => setSelectedPresetId(event.target.value)}
                className="h-8 min-w-[220px] rounded-md border border-gray-300 bg-white px-2 text-xs text-gray-900 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
              >
                {HTTP_AGENT_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.label}
                  </option>
                ))}
              </select>
              <Button type="button" variant="outline" size="sm" onClick={handleApplyPreset}>
                Apply Preset
              </Button>
            </div>
          </div>

          {showAdvancedHttp && (
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">
                  Endpoint Path
                </label>
                <input
                  {...form.register("http_agent_endpoint_path")}
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
                  placeholder="/agent"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">
                  Health Path
                </label>
                <input
                  {...form.register("http_agent_health_path")}
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
                  placeholder="/health"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">
                  HTTP Method
                </label>
                <select
                  {...form.register("http_agent_method")}
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
                >
                  <option value="POST">POST</option>
                  <option value="GET">GET</option>
                  <option value="PUT">PUT</option>
                  <option value="PATCH">PATCH</option>
                </select>
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">
                  Prompt Field
                </label>
                <input
                  {...form.register("http_agent_prompt_field")}
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
                  placeholder="query"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">
                  Response Path
                </label>
                <input
                  {...form.register("http_agent_response_path")}
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
                  placeholder="answer"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Dot path supported (example: data.output.text)
                </p>
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">
                  Auth Header
                </label>
                <input
                  {...form.register("http_agent_auth_header")}
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
                  placeholder="Authorization"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">
                  Auth Token Env Var (Optional)
                </label>
                <input
                  {...form.register("http_agent_auth_env_var")}
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
                  placeholder="MY_AGENT_API_KEY"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">
                  Auth Scheme
                </label>
                <input
                  {...form.register("http_agent_auth_scheme")}
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
                  placeholder="Bearer"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Use <code>raw</code> for headers like <code>x-api-key: token</code>
                </p>
              </div>
            </div>
          )}
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
        {provider === "http_agent" && (
          <Button
            type="button"
            variant="outline"
            onClick={handleAutoDetectHttpConfig}
            disabled={discovering}
          >
            {discovering ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Detecting...
              </>
            ) : (
              <>
                <Wand2 className="mr-2 h-4 w-4" />
                Auto-detect HTTP Config
              </>
            )}
          </Button>
        )}
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
