import { randomUUID } from "node:crypto";
import { supabaseAdminClient } from "../../integrations/supabase/client.js";
import { logger } from "../../shared/logger.js";
import type { RecommendationResult, RepRequestInput } from "../types.js";

export async function logRecommendation(input: {
  request: RepRequestInput;
  recommendation: RecommendationResult;
}) {
  if (!supabaseAdminClient) return;
  const { error } = await supabaseAdminClient.from("recommendation_logs").insert({
    id: input.recommendation.id || randomUUID(),
    source: input.request.source,
    rep_user_id: input.request.userId,
    request_text: input.request.text,
    account_name: input.request.accountName ?? null,
    recommendation_json: input.recommendation
  });
  if (error) {
    logger.warn("Failed to log recommendation", error);
  }
}

export async function storeFeedback(input: {
  recommendationId: string;
  userId: string;
  feedbackType: "approve" | "edit" | "reject";
  notes?: string;
}) {
  if (!supabaseAdminClient) return;
  const { error } = await supabaseAdminClient.from("recommendation_feedback").insert({
    recommendation_id: input.recommendationId,
    user_id: input.userId,
    feedback_type: input.feedbackType,
    notes: input.notes ?? null
  });
  if (error) {
    logger.warn("Failed to store recommendation feedback", error);
  }
}
