export type HttpAgentPreset = {
  id: string;
  label: string;
  description: string;
  config: {
    endpointPath: string;
    healthPath: string;
    method: "GET" | "POST" | "PUT" | "PATCH";
    promptField: string;
    responsePath: string;
    authHeader: string;
    authScheme: string;
    authEnvVar?: string;
  };
};

export const HTTP_AGENT_PRESETS: HttpAgentPreset[] = [
  {
    id: "generic",
    label: "Generic JSON Agent",
    description: "POST /agent with query -> answer",
    config: {
      endpointPath: "/agent",
      healthPath: "/health",
      method: "POST",
      promptField: "query",
      responsePath: "answer",
      authHeader: "Authorization",
      authScheme: "Bearer",
    },
  },
  {
    id: "langchain-invoke",
    label: "LangChain /invoke",
    description: "Runnable endpoint using input -> output",
    config: {
      endpointPath: "/invoke",
      healthPath: "/health",
      method: "POST",
      promptField: "input",
      responsePath: "output",
      authHeader: "Authorization",
      authScheme: "Bearer",
    },
  },
  {
    id: "secure-api-key",
    label: "Secure API Key Agent",
    description: "x-api-key header with input -> result.text",
    config: {
      endpointPath: "/api/secure/respond",
      healthPath: "/status",
      method: "POST",
      promptField: "input",
      responsePath: "result.text",
      authHeader: "x-api-key",
      authScheme: "raw",
      authEnvVar: "MY_AGENT_API_KEY",
    },
  },
];

export function getHttpAgentPresetById(id: string | null | undefined): HttpAgentPreset | null {
  if (!id) {
    return null;
  }
  const normalized = id.trim().toLowerCase();
  return HTTP_AGENT_PRESETS.find((preset) => preset.id === normalized) || null;
}
