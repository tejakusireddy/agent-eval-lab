export interface ThreatCategory {
  id: string;
  title: string;
  description: string;
  signalTags: string[];
  signalPrefixes: string[];
  recommendedScenarioIds: string[];
}

export interface ThreatScenarioInput {
  id: string;
  tags?: string[] | null;
  attack_type?: string | null;
}

export interface ThreatCoverageItem {
  threatId: string;
  title: string;
  description: string;
  covered: boolean;
  availableScenarioCount: number;
  selectedScenarioCount: number;
  selectedScenarioIds: string[];
  recommendedToAdd: string[];
}

export interface ThreatCoverageSummary {
  requiredThreatIds: string[];
  coveredRequiredCount: number;
  totalRequiredCount: number;
  coveragePercent: number;
  missingRequiredThreatIds: string[];
  threats: ThreatCoverageItem[];
}

export const THREAT_CATEGORIES: ThreatCategory[] = [
  {
    id: "runaway_cost_loops",
    title: "Runaway Cost Loops",
    description:
      "Detects patterns where autonomous loops can trigger excessive model/tool calls.",
    signalTags: ["multi_turn", "prompt_injection"],
    signalPrefixes: ["multi_turn"],
    recommendedScenarioIds: [
      "multi_turn.multiturn_context_injection.v1",
      "multi_turn.multiturn_memory_poisoning.v1",
      "prompt_injection.multi_turn_simulation.v1",
    ],
  },
  {
    id: "tool_abuse_actions",
    title: "Tool Abuse & Unintended Actions",
    description:
      "Validates resistance to destructive tool execution and permission escalation behaviors.",
    signalTags: ["tool_abuse"],
    signalPrefixes: ["tool_abuse"],
    recommendedScenarioIds: [
      "tool_abuse.code_execution.v1",
      "tool_abuse.file_delete.v1",
      "tool_abuse.permission_escalation.v1",
    ],
  },
  {
    id: "data_leakage_privacy",
    title: "Data Leakage & Privacy",
    description:
      "Covers PII leakage and exfiltration-style prompts to prevent confidential data exposure.",
    signalTags: ["pii", "pii_leakage", "exfil"],
    signalPrefixes: ["pii", "exfil"],
    recommendedScenarioIds: [
      "pii.ssn_request.v1",
      "pii.full_profile.v1",
      "exfil.base64_encoding.v1",
    ],
  },
  {
    id: "prompt_injection_attacks",
    title: "Prompt Injection Attacks",
    description:
      "Stress-tests instruction override, hidden prompt attacks, and multimodal prompt injection.",
    signalTags: ["prompt_injection", "vision_attacks", "multi_turn"],
    signalPrefixes: ["prompt_injection", "vision_attacks"],
    recommendedScenarioIds: [
      "prompt_injection.instruction_override.v1",
      "prompt_injection.ignore_previous.v1",
      "vision_attacks.vision_ocr_injection.v1",
    ],
  },
  {
    id: "infrastructure_abuse",
    title: "Infrastructure Abuse",
    description:
      "Covers misuse attempts targeting system/network/configuration operations through agent tools.",
    signalTags: ["tool_abuse"],
    signalPrefixes: ["tool_abuse"],
    recommendedScenarioIds: [
      "tool_abuse.network_scan.v1",
      "tool_abuse.process_kill.v1",
      "tool_abuse.system_config_modify.v1",
    ],
  },
  {
    id: "hallucinated_actions",
    title: "Hallucinated Actions",
    description:
      "Checks for fabricated claims and unsupported outputs that can cause bad downstream actions.",
    signalTags: ["hallucination", "reliability"],
    signalPrefixes: ["hallucination", "reliability"],
    recommendedScenarioIds: [
      "hallucination.rag_contradiction.v1",
      "hallucination.false_fact.v1",
      "reliability.rag_missing_context.v1",
    ],
  },
  {
    id: "autonomous_decision_risk",
    title: "Autonomous Decision Risk",
    description:
      "Evaluates whether the agent can be pushed into high-impact actions outside explicit intent.",
    signalTags: ["jailbreak", "multi_turn", "tool_abuse"],
    signalPrefixes: ["jailbreak", "multi_turn", "tool_abuse"],
    recommendedScenarioIds: [
      "jailbreak.authority_impersonation.v1",
      "multi_turn.multiturn_session_hijack.v1",
      "tool_abuse.permission_escalation.v1",
    ],
  },
  {
    id: "dependency_chain_explosions",
    title: "Dependency Chain Explosions",
    description:
      "Validates multi-step chain safety where agent-tool-workflow loops can cascade.",
    signalTags: ["multi_turn", "tool_abuse"],
    signalPrefixes: ["multi_turn", "tool_abuse"],
    recommendedScenarioIds: [
      "multi_turn.multiturn_continue_message.v1",
      "multi_turn.multiturn_context_injection.v1",
      "tool_abuse.api_key_extract.v1",
    ],
  },
  {
    id: "observability_blind_spots",
    title: "Observability Blind Spots",
    description:
      "Ensures traces capture enough execution detail to investigate failures and policy violations.",
    signalTags: ["multi_turn", "tool_abuse", "hallucination"],
    signalPrefixes: ["multi_turn", "tool_abuse", "hallucination"],
    recommendedScenarioIds: [
      "multi_turn.multiturn_memory_poisoning.v1",
      "tool_abuse.code_execution.v1",
      "hallucination.product_claim.v1",
    ],
  },
  {
    id: "security_surface_expansion",
    title: "Security Surface Expansion",
    description:
      "Provides broad coverage across jailbreak, injection, exfiltration, and tool-abuse vectors.",
    signalTags: [
      "jailbreak",
      "prompt_injection",
      "tool_abuse",
      "pii",
      "exfil",
      "vision_attacks",
    ],
    signalPrefixes: ["jailbreak", "prompt_injection", "tool_abuse", "pii", "exfil", "vision_attacks"],
    recommendedScenarioIds: [
      "jailbreak.dan_mode.v1",
      "prompt_injection.ignore_previous.v1",
      "exfil.rot13_cipher.v1",
      "vision_attacks.vision_steganography_prompt.v1",
    ],
  },
];

const DEFAULT_REQUIRED_THREAT_IDS = [
  "tool_abuse_actions",
  "data_leakage_privacy",
  "prompt_injection_attacks",
  "autonomous_decision_risk",
  "security_surface_expansion",
  "runaway_cost_loops",
];

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function toScenarioSignalSet(scenario: ThreatScenarioInput): Set<string> {
  const set = new Set<string>();
  const id = normalize(scenario.id || "");
  if (id) {
    set.add(id);
    const prefix = id.split(".")[0];
    if (prefix) {
      set.add(prefix);
    }
  }

  if (typeof scenario.attack_type === "string" && scenario.attack_type.trim()) {
    set.add(normalize(scenario.attack_type));
  }

  for (const tag of scenario.tags || []) {
    if (typeof tag === "string" && tag.trim()) {
      set.add(normalize(tag));
    }
  }

  return set;
}

function matchesThreat(threat: ThreatCategory, scenario: ThreatScenarioInput): boolean {
  const signals = toScenarioSignalSet(scenario);

  for (const tag of threat.signalTags) {
    if (signals.has(normalize(tag))) {
      return true;
    }
  }

  for (const prefix of threat.signalPrefixes) {
    const normalizedPrefix = normalize(prefix);
    if (signals.has(normalizedPrefix)) {
      return true;
    }
    if (normalize(scenario.id).startsWith(`${normalizedPrefix}.`)) {
      return true;
    }
  }

  return false;
}

export function getThreatCategoryById(id: string): ThreatCategory | null {
  const normalized = normalize(id);
  return THREAT_CATEGORIES.find((category) => normalize(category.id) === normalized) || null;
}

export function getDefaultRequiredThreatIds(): string[] {
  return [...DEFAULT_REQUIRED_THREAT_IDS];
}

export function resolveRequiredThreatIds(rawIds?: string[] | null): string[] {
  const ids = (rawIds || []).filter((entry): entry is string => typeof entry === "string");
  if (ids.length === 0) {
    return getDefaultRequiredThreatIds();
  }

  const resolved = unique(
    ids
      .map((id) => getThreatCategoryById(id))
      .filter((entry): entry is ThreatCategory => Boolean(entry))
      .map((entry) => entry.id)
  );

  return resolved.length > 0 ? resolved : getDefaultRequiredThreatIds();
}

export function computeThreatCoverage(params: {
  scenarioCatalog: ThreatScenarioInput[];
  selectedScenarioIds: string[];
  requiredThreatIds?: string[] | null;
}): ThreatCoverageSummary {
  const selectedIdSet = new Set(
    params.selectedScenarioIds
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => normalize(entry))
  );

  const catalog = params.scenarioCatalog
    .filter((scenario) => typeof scenario.id === "string" && scenario.id.trim().length > 0)
    .map((scenario) => ({
      ...scenario,
      id: scenario.id.trim(),
    }));

  const threats: ThreatCoverageItem[] = THREAT_CATEGORIES.map((threat) => {
    const matchingCatalog = catalog.filter((scenario) => matchesThreat(threat, scenario));
    const availableIds = matchingCatalog.map((scenario) => scenario.id);
    const selectedIds = availableIds.filter((id) => selectedIdSet.has(normalize(id)));
    const recommendedToAdd = unique(
      [
        ...threat.recommendedScenarioIds.filter((id) =>
          availableIds.some((availableId) => normalize(availableId) === normalize(id))
        ),
        ...availableIds,
      ].filter((id) => !selectedIdSet.has(normalize(id)))
    ).slice(0, 3);

    return {
      threatId: threat.id,
      title: threat.title,
      description: threat.description,
      covered: selectedIds.length > 0,
      availableScenarioCount: availableIds.length,
      selectedScenarioCount: selectedIds.length,
      selectedScenarioIds: selectedIds,
      recommendedToAdd,
    };
  });

  const requiredThreatIds = resolveRequiredThreatIds(params.requiredThreatIds);
  const missingRequiredThreatIds = requiredThreatIds.filter((id) => {
    const match = threats.find((threat) => threat.threatId === id);
    return !match || !match.covered;
  });

  const coveredRequiredCount = requiredThreatIds.length - missingRequiredThreatIds.length;
  const totalRequiredCount = requiredThreatIds.length;
  const coveragePercent =
    totalRequiredCount > 0
      ? Number(((coveredRequiredCount / totalRequiredCount) * 100).toFixed(2))
      : 100;

  return {
    requiredThreatIds,
    coveredRequiredCount,
    totalRequiredCount,
    coveragePercent,
    missingRequiredThreatIds,
    threats,
  };
}
