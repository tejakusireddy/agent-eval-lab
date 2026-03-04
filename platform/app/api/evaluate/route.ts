import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { evaluationQueue, hashConfig } from "@/lib/evaluation-queue";
import { validateHttpAgentUrl } from "@/lib/url-validator";
import { sanitizeConfigForStorage } from "@/lib/secret-redaction";
import { prisma } from "@/lib/db";
import { join } from "path";
import { existsSync } from "fs";

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const MAX_SCENARIOS = 20;

export async function POST(request: NextRequest) {
  try {
    const { userId, orgId } = getAuth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const {
      agentType,
      agentConfig,
      selectedScenarios,
      projectId,
      evaluationName,
    } = body;

    // Validate input
    if (!agentType || !agentConfig || !selectedScenarios || !Array.isArray(selectedScenarios)) {
      return NextResponse.json(
        { error: "Missing required fields: agentType, agentConfig, selectedScenarios" },
        { status: 400 }
      );
    }

    if (selectedScenarios.length === 0) {
      return NextResponse.json(
        { error: "At least one scenario must be selected" },
        { status: 400 }
      );
    }

    // Enforce scenario limit
    if (selectedScenarios.length > MAX_SCENARIOS) {
      return NextResponse.json(
        { error: `Maximum ${MAX_SCENARIOS} scenarios allowed per evaluation` },
        { status: 400 }
      );
    }

    // Validate HTTP agent URL if applicable
    if (agentType === "http_agent" && agentConfig.http_agent?.base_url) {
      const urlValidation = validateHttpAgentUrl(agentConfig.http_agent.base_url);
      if (!urlValidation.valid) {
        return NextResponse.json(
          { error: urlValidation.error },
          { status: 400 }
        );
      }
    }

    // Find scenarios directory
    const possiblePaths = [
      join(process.cwd(), "..", "scenario_definitions"),
      join(process.cwd(), "scenario_definitions"),
      join(process.cwd(), "..", "..", "scenario_definitions"),
    ];

    let scenariosDir = "";
    for (const path of possiblePaths) {
      if (existsSync(path)) {
        scenariosDir = path;
        break;
      }
    }

    if (!scenariosDir) {
      return NextResponse.json(
        { error: "scenario_definitions directory not found" },
        { status: 500 }
      );
    }

    // Get or create project
    let project;
    if (projectId) {
      project = await prisma.project.findUnique({
        where: { id: projectId },
      });
    }

    if (!project && orgId) {
      // Get or create organization
      let organization = await prisma.organization.findUnique({
        where: { clerkId: orgId },
      });

      if (!organization) {
        organization = await prisma.organization.create({
          data: {
            clerkId: orgId,
            name: "Default Organization",
          },
        });
      }

      // Create default project if none exists
      project = await prisma.project.findFirst({
        where: { organizationId: organization.id },
      });

      if (!project) {
        project = await prisma.project.create({
          data: {
            organizationId: organization.id,
            name: "Default Project",
          },
        });
      }
    }

    if (!project) {
      return NextResponse.json(
        { error: "Could not create or find project" },
        { status: 500 }
      );
    }

    // Sanitize config for storage (remove secrets)
    const sanitizedConfig = sanitizeConfigForStorage(agentConfig);
    const configHash = hashConfig(agentConfig);

    // Determine initial status based on queue
    const runningCount = evaluationQueue.getRunningCount();
    const initialStatus = runningCount >= 2 ? "queued" : "running";

    // Create evaluation record
    const evaluation = await prisma.evaluation.create({
      data: {
        projectId: project.id,
        name: evaluationName || "Untitled Evaluation",
        status: initialStatus,
        scenarios: selectedScenarios,
        config: sanitizedConfig,
        configHash: configHash,
      },
    });

    // Prepare evaluation config (with secrets for runtime, but not stored)
    const evaluationConfig = {
      provider: agentType,
      model: agentConfig.model || "gpt-4o-mini",
      temperature: agentConfig.temperature ?? 0.0,
      max_tokens: agentConfig.max_tokens || 512,
      max_concurrency: agentConfig.max_concurrency || 3,
      timeout_seconds: agentConfig.timeout_seconds || 30.0,
      max_retries: agentConfig.max_retries || 3,
      base_url: agentConfig.base_url || null,
      http_agent_base_url: agentConfig.http_agent?.base_url || null,
    };

    // Enqueue evaluation (will start immediately if slot available)
    await evaluationQueue.enqueue({
      evaluationId: evaluation.id,
      config: evaluationConfig,
      scenarioIds: selectedScenarios,
      scenariosDir,
    });

    // Return immediately
    return NextResponse.json({
      success: true,
      evaluationId: evaluation.id,
      status: initialStatus,
    });
  } catch (error: any) {
    console.error("Evaluation API error:", error);
    return NextResponse.json(
      { 
        error: error.message || "Internal server error",
        details: process.env.NODE_ENV === "development" ? error.stack : undefined
      },
      { status: 500 }
    );
  }
}
