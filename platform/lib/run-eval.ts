import { ChildProcess, spawn } from "child_process";
import { join } from "path";

export interface EvaluationConfig {
  provider: string;
  release_mode?: "exploratory" | "release_candidate";
  release_policy?: {
    version_id?: string | null;
    name?: string | null;
    version?: number | null;
    source?: string | null;
  } | null;
  model?: string;
  temperature?: number;
  max_tokens?: number;
  max_concurrency?: number;
  timeout_seconds?: number;
  max_retries?: number;
  execution_timeout_seconds?: number;
  base_url?: string | null;
  http_agent_base_url?: string | null;
  http_agent_config?: Record<string, unknown> | null;
  defense_config?: {
    enabled: boolean;
    defenses: string[];
  } | null;
  /** When set, worker enables multi-step runs against this tool env. */
  tool_env_url?: string | null;
  /** Max tool/agent steps per multi-step scenario. */
  max_steps?: number;
}

export interface EvaluationResult {
  success: boolean;
  data?: {
    results: any[];
    summary: {
      total: number;
      passed: number;
      failed_minor: number;
      failed_critical: number;
      safety_score: number;
    };
    reports: {
      html: string;
      md: string;
      json: string;
    };
  };
  error?: string;
}

interface RunEvaluationOptions {
  onProcessStart?: (process: ChildProcess) => void;
}

function normalizeSuccessResult(result: any): EvaluationResult {
  return {
    success: true,
    data: {
      results: result.results || [],
      summary: result.summary || {},
      reports: result.reports || {},
    },
  };
}

async function runEvaluationViaRemoteRunner(
  config: EvaluationConfig,
  scenarioIds: string[],
  scenariosDir: string
): Promise<EvaluationResult> {
  const runnerUrl = process.env.EVAL_RUNNER_URL;
  if (!runnerUrl) {
    return {
      success: false,
      error: "EVAL_RUNNER_URL is not configured",
    };
  }

  const payload = {
    scenario_ids: scenarioIds,
    scenarios_dir:
      process.env.EVAL_RUNNER_SCENARIOS_DIR ||
      process.env.SCENARIO_DEFINITIONS_DIR ||
      scenariosDir,
    provider: config.provider,
    model: config.model || "gpt-4o-mini",
    temperature: config.temperature ?? 0.0,
    max_tokens: config.max_tokens || 512,
    max_concurrency: config.max_concurrency || 3,
    timeout_seconds: config.timeout_seconds || 30.0,
    max_retries: config.max_retries || 3,
    base_url: config.base_url || null,
    http_agent_base_url: config.http_agent_base_url || null,
    http_agent_config: config.http_agent_config || null,
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const token = process.env.EVAL_RUNNER_TOKEN?.trim();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const executionTimeoutSeconds = Math.max(
    30,
    Math.floor(config.execution_timeout_seconds || 600)
  );
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => {
    controller.abort();
  }, (executionTimeoutSeconds + 15) * 1000);

  try {
    const response = await fetch(runnerUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: controller.signal,
    });

    const result = await response.json().catch(() => null);
    if (!response.ok || !result) {
      const remoteError =
        result && typeof result.error === "string"
          ? result.error
          : `Remote evaluator failed with status ${response.status}`;
      return {
        success: false,
        error: remoteError,
      };
    }

    if (result.success) {
      return normalizeSuccessResult(result);
    }

    return {
      success: false,
      error: result.error || "Remote evaluator returned failure",
    };
  } catch (error: any) {
    const maybeAbort =
      error?.name === "AbortError"
        ? `Remote evaluator timed out after ${executionTimeoutSeconds} seconds`
        : `Remote evaluator request failed: ${error?.message || "unknown error"}`;
    return {
      success: false,
      error: maybeAbort,
    };
  } finally {
    clearTimeout(timeoutHandle);
  }
}

export async function runEvaluation(
  config: EvaluationConfig,
  scenarioIds: string[],
  scenariosDir: string,
  options?: RunEvaluationOptions
): Promise<EvaluationResult> {
  if (process.env.EVAL_RUNNER_URL) {
    return runEvaluationViaRemoteRunner(config, scenarioIds, scenariosDir);
  }

  return new Promise((resolve) => {
    const pythonPath = process.env.PYTHON_CLI_PATH || "python3.11";
    const agentEvalPath = join(process.cwd(), "..");

    // Prepare input JSON
    const inputData = {
      scenario_ids: scenarioIds,
      scenarios_dir: scenariosDir,
      provider: config.provider,
      model: config.model || "gpt-4o-mini",
      temperature: config.temperature ?? 0.0,
      max_tokens: config.max_tokens || 512,
      max_concurrency: config.max_concurrency || 3,
      timeout_seconds: config.timeout_seconds || 30.0,
      max_retries: config.max_retries || 3,
      base_url: config.base_url || null,
      http_agent_base_url: config.http_agent_base_url || null,
      http_agent_config: config.http_agent_config || null,
      defense_config: config.defense_config ?? null,
    };

    // Spawn Python process
    const pythonProcess = spawn(
      pythonPath,
      ["-m", "agent_eval_lab.runner.run"],
      {
        cwd: agentEvalPath,
        env: {
          ...process.env,
          OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
        },
        stdio: ["pipe", "pipe", "pipe"],
      }
    );
    options?.onProcessStart?.(pythonProcess);

    let stdout = "";
    let stderr = "";

    pythonProcess.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    pythonProcess.stderr.on("data", (data) => {
      stderr += data.toString();
      // Log to stderr only, don't capture for response
    });

    // Send input JSON to stdin
    pythonProcess.stdin.write(JSON.stringify(inputData));
    pythonProcess.stdin.end();

    // Enforce whole evaluation timeout budget
    const executionTimeoutSeconds = Math.max(
      30,
      Math.floor(config.execution_timeout_seconds || 600)
    );
    const timeout = setTimeout(() => {
      pythonProcess.kill("SIGKILL");
      resolve({
        success: false,
        error: `Evaluation timed out after ${executionTimeoutSeconds} seconds`,
      });
    }, executionTimeoutSeconds * 1000);

    pythonProcess.on("close", (code) => {
      clearTimeout(timeout);

      if (code !== 0) {
        resolve({
          success: false,
          error: stderr || `Process exited with code ${code}`,
        });
        return;
      }

      try {
        // Parse JSON output (stdout should only contain JSON)
        // Remove any potential log lines that might have leaked to stdout
        const jsonLines = stdout
          .split("\n")
          .filter((line) => line.trim().startsWith("{") || line.trim().startsWith("["));

        if (jsonLines.length === 0) {
          resolve({
            success: false,
            error: `No JSON output received. stderr: ${stderr.substring(0, 500)}`,
          });
          return;
        }

        // Parse the last JSON line (should be the final result)
        const result = JSON.parse(jsonLines[jsonLines.length - 1]);

        if (result.success) {
          resolve(normalizeSuccessResult(result));
        } else {
          resolve({
            success: false,
            error: result.error || "Evaluation failed",
          });
        }
      } catch (error: any) {
        resolve({
          success: false,
          error: `Failed to parse JSON result: ${error.message}. Last stdout: ${stdout.substring(0, 200)}`,
        });
      }
    });

    pythonProcess.on("error", (error) => {
      clearTimeout(timeout);
      resolve({
        success: false,
        error: `Failed to spawn Python process: ${error.message}`,
      });
    });
  });
}
