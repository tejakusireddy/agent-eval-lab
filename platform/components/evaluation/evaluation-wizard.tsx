"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, ChevronRight, ChevronLeft, Check } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { AgentConfigForm } from "./agent-config-form";
import { ScenarioSelector } from "./scenario-selector";

const agentConfigSchema = z.object({
  provider: z.enum(["openai", "http_agent"]),
  model: z.string().min(1, "Model is required"),
  temperature: z.number().min(0).max(2),
  max_tokens: z.number().min(1).max(4096),
  base_url: z.string().optional(),
  http_agent_base_url: z.string().optional(),
});

type AgentConfig = z.infer<typeof agentConfigSchema>;

interface EvaluationWizardProps {
  scenarios: any[];
}

export function EvaluationWizard({ scenarios }: EvaluationWizardProps) {
  const router = useRouter();
  const { addToast } = useToast();
  const [step, setStep] = useState(1);
  const [selectedScenarios, setSelectedScenarios] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const form = useForm<AgentConfig>({
    resolver: zodResolver(agentConfigSchema),
    defaultValues: {
      provider: "openai",
      model: "gpt-4o-mini",
      temperature: 0.0,
      max_tokens: 512,
      http_agent_base_url: "http://localhost:8000",
    },
  });

  const handleNext = async () => {
    if (step === 2) {
      const isValid = await form.trigger();
      if (!isValid) {
        addToast({
          variant: "error",
          title: "Validation Error",
          description: "Please fix the form errors before continuing",
        });
        return;
      }
    }
    if (step < 3) {
      setStep(step + 1);
    }
  };

  const handleBack = () => {
    if (step > 1) {
      setStep(step - 1);
    }
  };

  const handleRun = async () => {
    if (selectedScenarios.length === 0) {
      addToast({
        variant: "error",
        title: "No Scenarios Selected",
        description: "Please select at least one scenario to run",
      });
      return;
    }

    setLoading(true);
    try {
      const formData = form.getValues();
      const response = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentType: formData.provider,
          agentConfig: {
            model: formData.model,
            temperature: formData.temperature,
            max_tokens: formData.max_tokens,
            max_concurrency: 3,
            timeout_seconds: 30.0,
            max_retries: 3,
            base_url: formData.base_url || null,
            http_agent: formData.provider === "http_agent" ? {
              base_url: formData.http_agent_base_url || "http://localhost:8000",
            } : undefined,
          },
          selectedScenarios,
          evaluationName: `Evaluation ${new Date().toLocaleString()}`,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to start evaluation");
      }

      const data = await response.json();
      addToast({
        variant: "success",
        title: "Evaluation Started",
        description: "Your evaluation is now running",
      });
      router.push(`/dashboard/evaluations/${data.evaluationId}`);
    } catch (error: any) {
      addToast({
        variant: "error",
        title: "Error",
        description: error.message || "Failed to start evaluation",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-gray-900">
          New Evaluation
        </h1>
        <p className="mt-2 text-sm text-gray-500">
          Run safety and reliability tests on your AI agent
        </p>
      </div>

      <div className="flex items-center justify-center gap-2 pb-8">
        {[1, 2, 3].map((s) => (
          <div key={s} className="flex items-center">
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full border-2 text-sm font-medium ${
                s < step
                  ? "border-green-500 bg-green-50 text-green-600"
                  : s === step
                  ? "border-gray-900 bg-gray-900 text-white"
                  : "border-gray-200 bg-white text-gray-400"
              }`}
            >
              {s < step ? <Check className="h-4 w-4" /> : s}
            </div>
            {s < 3 && (
              <div
                className={`h-0.5 w-12 ${
                  s < step ? "bg-green-500" : "bg-gray-200"
                }`}
              />
            )}
          </div>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            {step === 1 && "Choose Agent Type"}
            {step === 2 && "Configure Agent"}
            {step === 3 && "Select Scenarios"}
          </CardTitle>
          <CardDescription>
            {step === 1 && "Select the type of agent you want to evaluate"}
            {step === 2 && "Configure your agent settings"}
            {step === 3 && "Choose which scenarios to run"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {step === 1 && (
            <Tabs
              value={form.watch("provider")}
              onValueChange={(value) => form.setValue("provider", value as "openai" | "http_agent")}
            >
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="openai">OpenAI</TabsTrigger>
                <TabsTrigger value="http_agent">HTTP Agent</TabsTrigger>
              </TabsList>
              <TabsContent value="openai" className="mt-6">
                <div className="rounded-lg border border-gray-100 bg-gray-50 p-4">
                  <h3 className="font-medium text-gray-900">OpenAI API</h3>
                  <p className="mt-1 text-sm text-gray-500">
                    Evaluate models via OpenAI API or OpenAI-compatible endpoints
                  </p>
                </div>
              </TabsContent>
              <TabsContent value="http_agent" className="mt-6">
                <div className="rounded-lg border border-gray-100 bg-gray-50 p-4">
                  <h3 className="font-medium text-gray-900">HTTP Agent</h3>
                  <p className="mt-1 text-sm text-gray-500">
                    Evaluate custom HTTP-based agents (e.g., RAG services)
                  </p>
                </div>
              </TabsContent>
            </Tabs>
          )}

          {step === 2 && <AgentConfigForm form={form} />}

          {step === 3 && (
            <ScenarioSelector
              scenarios={scenarios}
              selectedScenarios={selectedScenarios}
              onSelectionChange={setSelectedScenarios}
            />
          )}

          <div className="flex justify-between border-t border-gray-100 pt-6">
            <Button
              variant="ghost"
              onClick={handleBack}
              disabled={step === 1}
            >
              <ChevronLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
            {step < 3 ? (
              <Button onClick={handleNext}>
                Next
                <ChevronRight className="ml-2 h-4 w-4" />
              </Button>
            ) : (
              <Button onClick={handleRun} disabled={loading || selectedScenarios.length === 0}>
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Starting...
                  </>
                ) : (
                  "Run Evaluation"
                )}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
