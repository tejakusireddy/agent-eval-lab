"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Code2, Rocket } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const PYTHON_FASTAPI_SNIPPET = `from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI()

class AgentRequest(BaseModel):
    query: str

@app.get("/health")
def health():
    return {"ok": True}

@app.post("/agent")
def agent(req: AgentRequest):
    # Replace with your agent call
    return {"answer": f"Echo: {req.query}"}
`;

const NODE_EXPRESS_SNIPPET = `import express from "express";

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/agent", (req, res) => {
  const prompt = req.body?.query || "";
  // Replace with your agent call
  res.json({ answer: \`Echo: \${prompt}\` });
});

app.listen(8000, () => {
  console.log("Agent listening on http://127.0.0.1:8000");
});
`;

const CURL_HEALTH = `curl -X GET "http://127.0.0.1:8000/health"`;
const CURL_AGENT = `curl -X POST "http://127.0.0.1:8000/agent" \\
  -H "Content-Type: application/json" \\
  -d '{"query":"What can you do?"}'`;

export function IntegrationQuickstart() {
  const [templateTab, setTemplateTab] = useState("python");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-gray-900">
          Connect Your Agent
        </h1>
        <p className="mt-2 text-sm text-gray-600">
          Minimal setup: expose one endpoint, validate with two curls, then run instant evaluation.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">3-Step Integration</CardTitle>
          <CardDescription>Any custom agent can onboard in minutes.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
            <div className="flex items-center gap-2 text-sm font-medium text-gray-900">
              <CheckCircle2 className="h-4 w-4" />
              Step 1
            </div>
            <div className="mt-1 text-xs text-gray-600">
              Expose `POST /agent` that accepts a prompt field and returns a text response.
            </div>
          </div>
          <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
            <div className="flex items-center gap-2 text-sm font-medium text-gray-900">
              <CheckCircle2 className="h-4 w-4" />
              Step 2
            </div>
            <div className="mt-1 text-xs text-gray-600">
              Optionally expose `GET /health` so our platform can test readiness.
            </div>
          </div>
          <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
            <div className="flex items-center gap-2 text-sm font-medium text-gray-900">
              <CheckCircle2 className="h-4 w-4" />
              Step 3
            </div>
            <div className="mt-1 text-xs text-gray-600">
              Open Agent Playground, auto-detect contract, and run quick evaluation.
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Contract Specification</CardTitle>
          <CardDescription>Default contract expected by the platform.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-xs text-gray-700">
          <div className="rounded-md border border-gray-200 bg-white p-3">
            <div className="font-medium text-gray-900">Request</div>
            <pre className="mt-1 overflow-x-auto whitespace-pre-wrap">{`POST /agent
Content-Type: application/json
{
  "query": "your prompt"
}`}</pre>
          </div>
          <div className="rounded-md border border-gray-200 bg-white p-3">
            <div className="font-medium text-gray-900">Response</div>
            <pre className="mt-1 overflow-x-auto whitespace-pre-wrap">{`200 OK
{
  "answer": "text output"
}`}</pre>
          </div>
          <div className="rounded-md border border-gray-200 bg-white p-3">
            <div className="font-medium text-gray-900">Health (optional)</div>
            <pre className="mt-1 overflow-x-auto whitespace-pre-wrap">{`GET /health -> 200`}</pre>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Code2 className="h-4 w-4" />
            Starter Templates
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs value={templateTab} onValueChange={setTemplateTab}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="python">Python / FastAPI</TabsTrigger>
              <TabsTrigger value="node">Node / Express</TabsTrigger>
            </TabsList>
            <TabsContent value="python" className="mt-3">
              <pre className="overflow-x-auto rounded-md border border-gray-200 bg-gray-50 p-3 text-xs text-gray-800">
                {PYTHON_FASTAPI_SNIPPET}
              </pre>
            </TabsContent>
            <TabsContent value="node" className="mt-3">
              <pre className="overflow-x-auto rounded-md border border-gray-200 bg-gray-50 p-3 text-xs text-gray-800">
                {NODE_EXPRESS_SNIPPET}
              </pre>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sanity Checks</CardTitle>
          <CardDescription>Run these before opening the playground.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <pre className="overflow-x-auto rounded-md border border-gray-200 bg-gray-50 p-3 text-xs text-gray-800">
            {CURL_HEALTH}
          </pre>
          <pre className="overflow-x-auto rounded-md border border-gray-200 bg-gray-50 p-3 text-xs text-gray-800">
            {CURL_AGENT}
          </pre>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button asChild>
              <Link href="/sandbox?preset=generic">
                <Rocket className="mr-2 h-4 w-4" />
                Open Agent Playground
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/dashboard/evaluations/new">
                Open Evaluation Wizard
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
