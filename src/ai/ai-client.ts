import { randomUUID } from "node:crypto";
import type OpenAI from "openai";
import { buildResponseCreateParams, resolveModelRoute, type AiTaskType } from "./model-router.js";
import { openaiClient } from "../integrations/openai/client.js";
import { logger } from "../shared/logger.js";
import { supabaseAdminClient } from "../integrations/supabase/client.js";

export interface RunAiTaskOptions {
  source_feature?: string;
  recommendation_log_id?: string;
  slack_user_id?: string;
  upload_document_id?: string;
  metadata?: Record<string, unknown>;
  fallbackText?: string;
}

export interface AiTaskResult {
  text: string;
  model: string;
  task_type: AiTaskType;
  reasoning_effort?: string;
  latency_ms: number;
  used_fallback: boolean;
  raw_response_id?: string;
}

function defaultFallback(taskType: AiTaskType) {
  return `[fallback:${taskType}] AI response unavailable.`;
}

async function logAiCall(
  result: AiTaskResult,
  options: RunAiTaskOptions,
  errorMessage?: string
) {
  if (!supabaseAdminClient) return;
  const { error } = await supabaseAdminClient.from("ai_call_logs").insert({
    id: randomUUID(),
    task_type: result.task_type,
    model: result.model,
    reasoning_effort: result.reasoning_effort ?? null,
    source_feature: options.source_feature ?? null,
    recommendation_log_id: options.recommendation_log_id ?? null,
    slack_user_id: options.slack_user_id ?? null,
    upload_document_id: options.upload_document_id ?? null,
    latency_ms: Math.round(result.latency_ms),
    used_fallback: result.used_fallback,
    error_message: errorMessage ?? null,
    metadata: options.metadata ?? {}
  });
  if (error) logger.warn("Failed to write ai_call_logs", error);
}

export async function runAiTask(
  taskType: AiTaskType,
  input: string,
  options: RunAiTaskOptions = {},
  deps?: {
    client?: {
      responses: {
        create: (params: OpenAI.Responses.ResponseCreateParamsNonStreaming) => Promise<{
          output_text?: string | null;
          id?: string;
        }>;
      };
    } | null;
  }
): Promise<AiTaskResult> {
  const route = resolveModelRoute(taskType);
  const started = Date.now();
  const fallbackText = options.fallbackText ?? defaultFallback(taskType);
  const client = deps?.client ?? openaiClient;

  if (!client) {
    const result: AiTaskResult = {
      text: fallbackText,
      model: route.model,
      task_type: taskType,
      reasoning_effort: route.reasoningEffort,
      latency_ms: Date.now() - started,
      used_fallback: true
    };
    await logAiCall(result, options, "OPENAI_API_KEY missing");
    return result;
  }

  try {
    const params = buildResponseCreateParams(taskType, input);
    const response = await client.responses.create(params);
    const result: AiTaskResult = {
      text: response.output_text ?? "",
      model: route.model,
      task_type: taskType,
      reasoning_effort: route.reasoningEffort,
      latency_ms: Date.now() - started,
      used_fallback: false,
      raw_response_id: response.id
    };
    await logAiCall(result, options);
    return result;
  } catch (error) {
    logger.warn("runAiTask failed; using fallback", error);
    const message = error instanceof Error ? error.message : "Unknown AI call failure";
    const result: AiTaskResult = {
      text: fallbackText,
      model: route.model,
      task_type: taskType,
      reasoning_effort: route.reasoningEffort,
      latency_ms: Date.now() - started,
      used_fallback: true
    };
    await logAiCall(result, options, message);
    return result;
  }
}
