import { config } from "../shared/config.js";
import OpenAI from "openai";

export type AiTaskType =
  | "sales_recommendation"
  | "slack_simple_reply"
  | "file_extraction"
  | "knowledge_summary"
  | "structured_knowledge_extraction"
  | "email_draft"
  | "fallback";

type ReasoningEffort = "minimal" | "low" | "medium" | "high";

interface TaskRoute {
  model: string;
  reasoningEffort?: ReasoningEffort;
}

function normalizeModelName(model: string) {
  return model.trim().toLowerCase();
}

export function supportsReasoningEffort(model: string) {
  const normalized = normalizeModelName(model);
  if (!normalized) return false;

  // Conservative allow-list: only include families known to support reasoning controls.
  return (
    normalized.startsWith("gpt-5") ||
    normalized.startsWith("o1") ||
    normalized.startsWith("o3") ||
    normalized.startsWith("o4")
  );
}

const defaultRoutes: Record<AiTaskType, TaskRoute> = {
  sales_recommendation: { model: "gpt-4.1-mini", reasoningEffort: "medium" },
  slack_simple_reply: { model: "gpt-4.1-mini", reasoningEffort: "low" },
  file_extraction: { model: "gpt-4.1", reasoningEffort: "medium" },
  knowledge_summary: { model: "gpt-4.1-mini", reasoningEffort: "low" },
  structured_knowledge_extraction: { model: "gpt-4.1-mini", reasoningEffort: "low" },
  email_draft: { model: "gpt-4.1", reasoningEffort: "medium" },
  fallback: { model: "gpt-4.1-mini", reasoningEffort: "low" }
};

const modelEnvByTask: Record<AiTaskType, keyof typeof config> = {
  sales_recommendation: "AI_MODEL_SALES_RECOMMENDATION",
  slack_simple_reply: "AI_MODEL_SLACK_SIMPLE_REPLY",
  file_extraction: "AI_MODEL_FILE_EXTRACTION",
  knowledge_summary: "AI_MODEL_KNOWLEDGE_SUMMARY",
  structured_knowledge_extraction: "AI_MODEL_STRUCTURED_KNOWLEDGE_EXTRACTION",
  email_draft: "AI_MODEL_EMAIL_DRAFT",
  fallback: "AI_MODEL_FALLBACK"
};

const reasoningEnvByTask: Record<AiTaskType, keyof typeof config> = {
  sales_recommendation: "AI_REASONING_EFFORT_SALES_RECOMMENDATION",
  slack_simple_reply: "AI_REASONING_EFFORT_SLACK_SIMPLE_REPLY",
  file_extraction: "AI_REASONING_EFFORT_FILE_EXTRACTION",
  knowledge_summary: "AI_REASONING_EFFORT_KNOWLEDGE_SUMMARY",
  structured_knowledge_extraction: "AI_REASONING_EFFORT_STRUCTURED_KNOWLEDGE_EXTRACTION",
  email_draft: "AI_REASONING_EFFORT_EMAIL_DRAFT",
  fallback: "AI_REASONING_EFFORT_FALLBACK"
};

function parseReasoningEffort(value?: string): ReasoningEffort | undefined {
  if (!value) return undefined;
  if (value === "minimal" || value === "low" || value === "medium" || value === "high") return value;
  return undefined;
}

export function resolveModelRoute(task: AiTaskType): TaskRoute {
  const defaults = defaultRoutes[task];
  const modelValue = config[modelEnvByTask[task]];
  const modelOverride = typeof modelValue === "string" ? modelValue : undefined;
  const reasoningValue = config[reasoningEnvByTask[task]];
  const reasoningOverride = parseReasoningEffort(typeof reasoningValue === "string" ? reasoningValue : undefined);
  return {
    model: modelOverride ?? defaults.model,
    reasoningEffort: reasoningOverride ?? defaults.reasoningEffort
  };
}

export function buildResponseCreateParams(
  task: AiTaskType,
  input: string
): OpenAI.Responses.ResponseCreateParamsNonStreaming {
  const route = resolveModelRoute(task);
  const params: OpenAI.Responses.ResponseCreateParamsNonStreaming = {
    model: route.model,
    input
  };
  if (supportsReasoningEffort(route.model) && route.reasoningEffort && route.reasoningEffort !== "minimal") {
    params.reasoning = { effort: route.reasoningEffort };
  }
  return params;
}
