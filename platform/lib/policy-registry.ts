import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";

import {
  ReleaseGatePolicy,
  loadReleaseGatePolicy,
  normalizeReleaseGatePolicy,
} from "@/lib/release-gate";

export interface PolicyVersionEntry {
  id: string;
  name: string;
  version: number;
  created_at: string;
  created_by: string | null;
  notes: string | null;
  checksum_sha256: string;
  policy: ReleaseGatePolicy;
}

interface PolicyRegistryDoc {
  schema_version: number;
  active_policy_id: string;
  updated_at: string;
  updated_by: string | null;
  policies: PolicyVersionEntry[];
}

export interface PolicySummary {
  id: string;
  name: string;
  version: number;
  created_at: string;
  created_by: string | null;
  notes: string | null;
}

interface PolicyRegistryLoadResult {
  path: string;
  registry: PolicyRegistryDoc | null;
  error?: string;
}

export interface ResolvedPolicy {
  policy: ReleaseGatePolicy | null;
  policyId: string | null;
  policyPath: string | null;
  source: "registry" | "legacy";
  error?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toNullableString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return slug || "policy";
}

function parsePolicyFromConfig(config: unknown): { versionId: string | null } {
  if (!isRecord(config)) {
    return { versionId: null };
  }

  const releasePolicy = isRecord(config.release_policy) ? config.release_policy : null;
  if (!releasePolicy) {
    return { versionId: null };
  }

  const versionId = toNullableString(releasePolicy.version_id);
  return { versionId };
}

function toPolicyChecksum(policy: ReleaseGatePolicy): string {
  return createHash("sha256")
    .update(JSON.stringify(policy))
    .digest("hex");
}

function toDefaultEntry(policy: ReleaseGatePolicy): PolicyVersionEntry {
  const id = `${slugify(policy.name)}-v${policy.version}`;
  return {
    id,
    name: policy.name,
    version: policy.version,
    created_at: new Date().toISOString(),
    created_by: "system",
    notes: "Bootstrapped from release_gate.enterprise.yaml",
    checksum_sha256: toPolicyChecksum(policy),
    policy,
  };
}

function resolveRegistryPathCandidates(): string[] {
  return [
    join(process.cwd(), "..", "policy", "release_gate.versions.json"),
    join(process.cwd(), "policy", "release_gate.versions.json"),
    join(process.cwd(), "..", "..", "policy", "release_gate.versions.json"),
  ];
}

function ensureRegistryPath(): string {
  const candidates = resolveRegistryPathCandidates();
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return candidates[0];
}

function sanitizeEntry(raw: unknown): PolicyVersionEntry | null {
  if (!isRecord(raw)) {
    return null;
  }

  const id = toNullableString(raw.id);
  const name = toNullableString(raw.name);
  const createdAt = toNullableString(raw.created_at);
  const policyRaw = raw.policy;

  if (!id || !name || !createdAt || !policyRaw) {
    return null;
  }

  let policy: ReleaseGatePolicy;
  try {
    policy = normalizeReleaseGatePolicy(policyRaw);
  } catch {
    return null;
  }

  const versionValue = Number(raw.version);
  const version = Number.isFinite(versionValue)
    ? Math.max(1, Math.floor(versionValue))
    : Math.max(1, Math.floor(Number(policy.version || 1)));

  return {
    id,
    name,
    version,
    created_at: createdAt,
    created_by: toNullableString(raw.created_by),
    notes: toNullableString(raw.notes),
    checksum_sha256:
      toNullableString(raw.checksum_sha256) || toPolicyChecksum(policy),
    policy,
  };
}

function normalizeRegistry(raw: unknown, defaultEntry: PolicyVersionEntry): PolicyRegistryDoc {
  if (!isRecord(raw)) {
    return {
      schema_version: 1,
      active_policy_id: defaultEntry.id,
      updated_at: new Date().toISOString(),
      updated_by: null,
      policies: [defaultEntry],
    };
  }

  const rawPolicies = Array.isArray(raw.policies) ? raw.policies : [];
  const policies = rawPolicies
    .map((entry) => sanitizeEntry(entry))
    .filter((entry): entry is PolicyVersionEntry => Boolean(entry));

  if (policies.length === 0) {
    policies.push(defaultEntry);
  }

  const requestedActive = toNullableString(raw.active_policy_id);
  const activePolicyId =
    requestedActive && policies.some((entry) => entry.id === requestedActive)
      ? requestedActive
      : policies[0].id;

  const updatedAt = toNullableString(raw.updated_at) || new Date().toISOString();

  return {
    schema_version: 1,
    active_policy_id: activePolicyId,
    updated_at: updatedAt,
    updated_by: toNullableString(raw.updated_by),
    policies,
  };
}

function writeRegistry(path: string, registry: PolicyRegistryDoc): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(registry, null, 2), "utf-8");
}

function loadPolicyRegistryInternal(): PolicyRegistryLoadResult {
  const path = ensureRegistryPath();

  const legacyLoad = loadReleaseGatePolicy();
  if (!legacyLoad.policy) {
    return {
      path,
      registry: null,
      error: legacyLoad.error || "legacy policy unavailable",
    };
  }

  const defaultEntry = toDefaultEntry(legacyLoad.policy);

  try {
    if (!existsSync(path)) {
      const registry: PolicyRegistryDoc = {
        schema_version: 1,
        active_policy_id: defaultEntry.id,
        updated_at: new Date().toISOString(),
        updated_by: "system",
        policies: [defaultEntry],
      };
      writeRegistry(path, registry);
      return { path, registry };
    }

    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw);
    const registry = normalizeRegistry(parsed, defaultEntry);

    // Keep checksum/shape normalized on disk.
    writeRegistry(path, registry);
    return { path, registry };
  } catch (error: any) {
    return {
      path,
      registry: null,
      error: error?.message || "failed to load policy registry",
    };
  }
}

export function listPolicyVersions(): {
  activePolicyId: string | null;
  policies: PolicySummary[];
  policyPath: string | null;
  error?: string;
} {
  const loaded = loadPolicyRegistryInternal();
  if (!loaded.registry) {
    return {
      activePolicyId: null,
      policies: [],
      policyPath: loaded.path,
      error: loaded.error,
    };
  }
  const registry = loaded.registry;

  const policies = registry.policies
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      version: entry.version,
      created_at: entry.created_at,
      created_by: entry.created_by,
      notes: entry.notes,
    }))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return {
    activePolicyId: registry.active_policy_id,
    policies,
    policyPath: loaded.path,
  };
}

export function getPolicyVersionById(policyId: string): {
  entry: PolicyVersionEntry | null;
  policyPath: string | null;
  error?: string;
} {
  const loaded = loadPolicyRegistryInternal();
  if (!loaded.registry) {
    return {
      entry: null,
      policyPath: loaded.path,
      error: loaded.error,
    };
  }
  const registry = loaded.registry;

  const entry = registry.policies.find((item) => item.id === policyId) || null;
  return {
    entry,
    policyPath: loaded.path,
    error: entry ? undefined : "policy version not found",
  };
}

export function getActivePolicyVersion(): {
  entry: PolicyVersionEntry | null;
  policyPath: string | null;
  error?: string;
} {
  const loaded = loadPolicyRegistryInternal();
  if (!loaded.registry) {
    return {
      entry: null,
      policyPath: loaded.path,
      error: loaded.error,
    };
  }
  const registry = loaded.registry;

  const entry =
    registry.policies.find((item) => item.id === registry.active_policy_id) ||
    registry.policies[0] ||
    null;

  return {
    entry,
    policyPath: loaded.path,
    error: entry ? undefined : "no policy entries available",
  };
}

export function resolvePolicyForConfig(config: unknown): ResolvedPolicy {
  const parsed = parsePolicyFromConfig(config);

  if (parsed.versionId) {
    const byId = getPolicyVersionById(parsed.versionId);
    if (byId.entry) {
      return {
        policy: byId.entry.policy,
        policyId: byId.entry.id,
        policyPath: byId.policyPath,
        source: "registry",
      };
    }

    return {
      policy: null,
      policyId: parsed.versionId,
      policyPath: byId.policyPath,
      source: "registry",
      error: byId.error || "referenced policy version was not found",
    };
  }

  const active = getActivePolicyVersion();
  if (active.entry) {
    return {
      policy: active.entry.policy,
      policyId: active.entry.id,
      policyPath: active.policyPath,
      source: "registry",
    };
  }

  const legacy = loadReleaseGatePolicy();
  if (legacy.policy) {
    return {
      policy: legacy.policy,
      policyId: null,
      policyPath: legacy.policyPath,
      source: "legacy",
    };
  }

  return {
    policy: null,
    policyId: null,
    policyPath: legacy.policyPath,
    source: "legacy",
    error: legacy.error || "release gate policy unavailable",
  };
}

export function createPolicyVersion(input: {
  policy: unknown;
  name?: string;
  version?: number;
  notes?: string | null;
  createdBy?: string | null;
  activate?: boolean;
}): {
  entry: PolicyVersionEntry | null;
  activePolicyId: string | null;
  policyPath: string | null;
  error?: string;
} {
  const loaded = loadPolicyRegistryInternal();
  if (!loaded.registry) {
    return {
      entry: null,
      activePolicyId: null,
      policyPath: loaded.path,
      error: loaded.error,
    };
  }
  const registry = loaded.registry;

  try {
    const normalized = normalizeReleaseGatePolicy(input.policy);
    const maxVersion = registry.policies.reduce(
      (maxValue, entry) => Math.max(maxValue, entry.version),
      0
    );
    const version =
      typeof input.version === "number" && Number.isFinite(input.version)
        ? Math.max(1, Math.floor(input.version))
        : Math.max(maxVersion + 1, normalized.version || 1);

    const name = toNullableString(input.name) || normalized.name;
    const baseId = `${slugify(name)}-v${version}`;

    let id = baseId;
    let suffix = 2;
    while (registry.policies.some((entry) => entry.id === id)) {
      id = `${baseId}-${suffix}`;
      suffix += 1;
    }

    const nowIso = new Date().toISOString();
    const entry: PolicyVersionEntry = {
      id,
      name,
      version,
      created_at: nowIso,
      created_by: toNullableString(input.createdBy),
      notes: toNullableString(input.notes),
      checksum_sha256: toPolicyChecksum(normalized),
      policy: {
        ...normalized,
        name,
        version,
      },
    };

    registry.policies.push(entry);
    if (input.activate) {
      registry.active_policy_id = entry.id;
    }
    registry.updated_at = nowIso;
    registry.updated_by = toNullableString(input.createdBy);

    writeRegistry(loaded.path, registry);

    return {
      entry,
      activePolicyId: registry.active_policy_id,
      policyPath: loaded.path,
    };
  } catch (error: any) {
    return {
      entry: null,
      activePolicyId: registry.active_policy_id,
      policyPath: loaded.path,
      error: error?.message || "failed to create policy version",
    };
  }
}

export function setActivePolicyVersion(input: {
  policyId: string;
  updatedBy?: string | null;
}): {
  activeEntry: PolicyVersionEntry | null;
  policyPath: string | null;
  error?: string;
} {
  const loaded = loadPolicyRegistryInternal();
  if (!loaded.registry) {
    return {
      activeEntry: null,
      policyPath: loaded.path,
      error: loaded.error,
    };
  }
  const registry = loaded.registry;

  const nextActive = registry.policies.find((entry) => entry.id === input.policyId);
  if (!nextActive) {
    return {
      activeEntry: null,
      policyPath: loaded.path,
      error: `policy '${input.policyId}' does not exist`,
    };
  }

  registry.active_policy_id = nextActive.id;
  registry.updated_at = new Date().toISOString();
  registry.updated_by = toNullableString(input.updatedBy);
  writeRegistry(loaded.path, registry);

  return {
    activeEntry: nextActive,
    policyPath: loaded.path,
  };
}

export function buildReleasePolicyRef(config: unknown): {
  version_id: string | null;
  name: string | null;
  version: number | null;
  source: "registry" | "legacy";
} {
  const resolved = resolvePolicyForConfig(config);
  return {
    version_id: resolved.policyId,
    name: resolved.policy?.name || null,
    version:
      typeof resolved.policy?.version === "number"
        ? resolved.policy.version
        : null,
    source: resolved.source,
  };
}
