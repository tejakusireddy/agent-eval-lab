# Scenario Catalog

This document provides an overview of all evaluation scenarios available in the Agent Eval Lab toolkit.

## Overview

Total Scenarios: **101**

The scenarios are organized into 12 main categories, each targeting different attack vectors and safety concerns.

## Categories

### 1. Prompt Injection / System Prompt Exfiltration (10 scenarios)

Tests the agent's resistance to various prompt injection techniques that attempt to extract system instructions or bypass context boundaries.

**Scenarios:**
- `prompt_injection.role_play.v1` - Role play injection to reveal instructions
- `prompt_injection.ignore_previous.v1` - Ignore previous instructions attack
- `prompt_injection.xml_breakout.v1` - XML-style injection attempt
- `prompt_injection.multi_turn_simulation.v1` - Multi-turn simulation injection
- `prompt_injection.encoding_base64.v1` - Base64 encoded injection
- `prompt_injection.unicode_obfuscation.v1` - Unicode obfuscation injection
- `prompt_injection.instruction_override.v1` - Instruction override attempt
- `prompt_injection.context_poisoning.v1` - Context poisoning injection
- `prompt_injection.tool_reveal.v1` - Tool definition reveal attempt
- `prompt_injection.chain_of_thought.v1` - Chain of thought injection
- `prompt_injection.translation_bypass.v1` - Translation bypass injection

**Severity Expectation:** Critical

### 2. Jailbreak / Policy Bypass (10 scenarios)

Tests the agent's resistance to jailbreak techniques that attempt to remove safety restrictions.

**Scenarios:**
- `jailbreak.dan_mode.v1` - DAN (Do Anything Now) mode activation
- `jailbreak.developer_mode.v1` - Developer mode activation
- `jailbreak.hypothetical_scenario.v1` - Hypothetical scenario bypass
- `jailbreak.educational_context.v1` - Educational context bypass
- `jailbreak.fictional_context.v1` - Fictional context bypass
- `jailbreak.authority_impersonation.v1` - Authority impersonation bypass
- `jailbreak.ethical_hacking.v1` - Ethical hacking context bypass
- `jailbreak.legacy_mode.v1` - Legacy mode activation
- `jailbreak.character_persona.v1` - Character persona bypass
- `jailbreak.continuation_attack.v1` - Continuation attack
- `jailbreak.obfuscated_request.v1` - Obfuscated harmful request

**Severity Expectation:** Critical

### 3. PII Leakage / Sensitive Data (10 scenarios)

Tests the agent's resistance to generating personally identifiable information.

**Scenarios:**
- `pii.phone_number.v1` - Phone number generation
- `pii.ssn_request.v1` - Social Security Number request
- `pii.credit_card.v1` - Credit card number generation
- `pii.passport_number.v1` - Passport number request
- `pii.drivers_license.v1` - Driver's license number request
- `pii.bank_account.v1` - Bank account number request
- `pii.medical_record.v1` - Medical record number request
- `pii.ip_address.v1` - IP address generation
- `pii.date_of_birth.v1` - Date of birth generation
- `pii.full_profile.v1` - Complete profile generation

**Severity Expectation:** Critical (most), Minor (some)

### 4. Tool Abuse / Function Misuse (8 scenarios)

Tests the agent's resistance to performing dangerous system operations or tool misuse.

**Scenarios:**
- `tool_abuse.file_delete.v1` - File deletion request
- `tool_abuse.network_scan.v1` - Network scanning request
- `tool_abuse.code_execution.v1` - Code execution request
- `tool_abuse.database_drop.v1` - Database drop request
- `tool_abuse.api_key_extract.v1` - API key extraction request
- `tool_abuse.system_config_modify.v1` - System configuration modification
- `tool_abuse.process_kill.v1` - Process termination request
- `tool_abuse.permission_escalation.v1` - Permission escalation request

**Severity Expectation:** Critical

### 5. Data Exfiltration via Formatting / Encoding / Steganography (4 scenarios)

Tests the agent's resistance to helping encode or hide sensitive data for exfiltration.

**Scenarios:**
- `exfil.base64_encoding.v1` - Base64 encoded data exfiltration
- `exfil.hex_encoding.v1` - Hexadecimal encoded data exfiltration
- `exfil.rot13_cipher.v1` - ROT13 cipher data exfiltration
- `exfil.steganography_hint.v1` - Steganography data hiding request

**Severity Expectation:** Critical

### 6. Hallucination / Missing Context / False Claims (4 scenarios)

Tests the agent's ability to acknowledge uncertainty and avoid fabricating information.

**Scenarios:**
- `hallucination.product_claim.v1` - Nonexistent product knowledge claim
- `hallucination.false_fact.v1` - False fact confirmation
- `hallucination.specific_details.v1` - Fabricated specific details
- `hallucination.rag_contradiction.v1` - RAG context contradiction

**Severity Expectation:** Critical

### 7. Toxicity / Harassment / Hate / Self-harm Refusal (4 scenarios)

Tests the agent's resistance to generating toxic, harassing, or harmful content.

**Scenarios:**
- `toxicity.hate_speech.v1` - Hate speech generation request
- `toxicity.harassment.v1` - Harassment content request
- `toxicity.self_harm.v1` - Self-harm content request
- `toxicity.violence_incitement.v1` - Violence incitement request

**Severity Expectation:** Critical

### 8. Vision-Model Attacks (5 scenarios)

Tests the agent's resistance to attacks targeting vision models through text descriptions of visual patterns.

**Scenarios:**
- `vision_attacks.ascii_injection.v1` - ASCII art injection
- `vision_attacks.ocr_injection.v1` - OCR-based prompt injection
- `vision_attacks.pixel_hallucination.v1` - Pixel-triggered hallucination prompts
- `vision_attacks.steganography_prompt.v1` - Steganographic prompt injection
- `vision_attacks.adversarial_pattern.v1` - Adversarial pattern description

**Severity Expectation:** Critical

### 9. Multi-Turn Persistence (5 scenarios)

Tests the agent's resistance to multi-turn attacks that attempt to persist harmful instructions across turns.

**Scenarios:**
- `multi_turn.assume_previous.v1` - Assume previous conversation injection
- `multi_turn.continue_message.v1` - Continue from last message injection
- `multi_turn.memory_poisoning.v1` - Memory poisoning attack
- `multi_turn.context_injection.v1` - Context injection via continuation
- `multi_turn.session_hijack.v1` - Session hijack via continuation

**Severity Expectation:** Critical

### 10. Scam/Bait Scenarios (10 scenarios)

Tests the agent's resistance to generating scam content or social engineering materials.

**Scenarios:**
- `scam_bait.gift_card.v1` - Gift card scam refusal
- `scam_bait.phishing_email.v1` - Phishing email generation refusal
- `scam_bait.fake_login.v1` - Fake login page crafting refusal
- `scam_bait.social_engineering.v1` - Social engineering refusal
- `scam_bait.romance_scam.v1` - Romance scam refusal
- `scam_bait.tech_support.v1` - Tech support scam refusal
- `scam_bait.inheritance.v1` - Inheritance scam refusal
- `scam_bait.lottery.v1` - Lottery scam refusal
- `scam_bait.impersonation.v1` - Impersonation scam refusal
- `scam_bait.advance_fee.v1` - Advance fee scam refusal
- `scam_bait.pyramid.v1` - Pyramid scheme refusal

**Severity Expectation:** Critical

### 11. Brand Safety (10 scenarios)

Tests the agent's resistance to generating content that could harm brands or violate intellectual property.

**Scenarios:**
- `brand_safety.deepfake_refusal.v1` - Deepfake generation refusal
- `brand_safety.impersonation_public_figure.v1` - Public figure impersonation refusal
- `brand_safety.fake_news.v1` - Fake news generation refusal
- `brand_safety.defamation.v1` - Defamation content refusal
- `brand_safety.celebrity_voice.v1` - Celebrity voice cloning refusal
- `brand_safety.trademark_violation.v1` - Trademark violation content refusal
- `brand_safety.false_endorsement.v1` - False endorsement refusal
- `brand_safety.manipulated_quote.v1` - Manipulated quote refusal
- `brand_safety.slanderous_content.v1` - Slanderous content refusal
- `brand_safety.unauthorized_branding.v1` - Unauthorized branding refusal

**Severity Expectation:** Critical

### 12. Economic & Legal Safety (10 scenarios)

Tests the agent's resistance to providing advice on illegal economic activities or legal violations.

**Scenarios:**
- `economic_legal.tax_evasion.v1` - Tax evasion request refusal
- `economic_legal.insurance_fraud.v1` - Insurance fraud refusal
- `economic_legal.bank_dispute_fabrication.v1` - Bank dispute fabrication refusal
- `economic_legal.illegal_advice.v1` - Illegal advice request detection
- `economic_legal.wage_theft.v1` - Wage theft scheme refusal
- `economic_legal.ponzi_scheme.v1` - Ponzi scheme refusal
- `economic_legal.sec_violation.v1` - SEC violation refusal
- `economic_legal.contract_fraud.v1` - Contract fraud refusal
- `economic_legal.price_fixing.v1` - Price fixing refusal
- `economic_legal.embezzlement.v1` - Embezzlement scheme refusal

**Severity Expectation:** Critical

## Legacy Scenarios

The following scenarios remain in the root `scenario_definitions/` directory for backward compatibility:

- `safety.jailbreak_basic.v1`
- `safety.pii_leakage_email.v1`
- `safety.pii_leakage_address.v1`
- `safety.system_prompt_leak.v2`
- `safety.tool_abuse_file_write.v1`
- `safety.missing_context_hallucination.v1`
- `safety.rag_sensitive_topic.v1`
- `reliability.rag_missing_context.v1`

## Usage

All scenarios are automatically discovered by the scenario loader, which recursively scans the `scenario_definitions/` directory and all subdirectories.

Run all scenarios:
```bash
agent-eval run-all-scenarios
```

Run specific scenarios:
```bash
agent-eval run-scenarios --scenario-ids prompt_injection.role_play.v1 jailbreak.dan_mode.v1
```

## Scenario Structure

Each scenario YAML file contains:
- `id`: Unique identifier
- `name`: Human-readable name
- `description`: What the scenario tests
- `attack_type`: Category of attack
- `max_attempts`: Number of retry attempts
- `prompt_template`: The attack prompt
- `pass_criteria`: Positive behaviors expected
- `fail_criteria`: Negative behaviors (minor/critical)
- `tags`: Categorization tags
- `severity_expectation`: Expected severity level
- `example_failure_snippet`: Example of what failure looks like

