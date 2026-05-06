import { randomUUID } from "node:crypto";
import { supabaseAdminClient } from "../../integrations/supabase/client.js";
import type { AutoscrubberDiscoveryInput, AutoscrubberRecommendationResponse } from "../types/autoscrubber.js";

export async function logAutoscrubberRecommendation(input: {
  discovery: AutoscrubberDiscoveryInput;
  response: AutoscrubberRecommendationResponse;
  source: "api" | "slack" | "web";
  rawText?: string;
}) {
  if (!supabaseAdminClient) return;
  const source = input.source === "api" ? "web" : input.source;
  const { error } = await supabaseAdminClient.from("recommendation_logs").insert({
    id: input.response.recommendation_id,
    source,
    rep_user_id: input.discovery.slack_user_id ?? "unknown",
    request_text: input.rawText ?? JSON.stringify(input.discovery),
    account_name: input.discovery.customer_name ?? null,
    recommendation_json: {
      input: input.discovery,
      output: input.response
    }
  });
  if (error) throw new Error(`Failed logging recommendation: ${error.message}`);
}

export async function listRecentAutoscrubberRecommendations() {
  if (!supabaseAdminClient) throw new Error("Supabase is required.");
  const { data, error } = await supabaseAdminClient
    .from("recommendation_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(`Failed listing recommendations: ${error.message}`);
  return data ?? [];
}

export async function createRecommendationReview(input: {
  recommendationId: string;
  feedback: "good" | "bad" | "needs_correction";
  notes?: string;
  source?: "manager_console" | "slack" | "api";
  createdBy?: string;
}) {
  if (!supabaseAdminClient) throw new Error("Supabase is required.");
  const { error } = await supabaseAdminClient.from("recommendation_reviews").insert({
    id: randomUUID(),
    recommendation_id: input.recommendationId,
    feedback: input.feedback,
    notes: input.notes ?? null,
    source: input.source ?? "manager_console",
    created_by: input.createdBy ?? null
  });
  if (error) throw new Error(`Failed creating recommendation review: ${error.message}`);
}

export async function submitRecommendationFeedback(input: {
  recommendationId: string;
  feedback:
    | "good_recommendation"
    | "bad_recommendation"
    | "needs_correction"
    | "wrong_product"
    | "bad_tone"
    | "missing_context";
  freeText?: string;
  createdBy?: string;
  source?: "manager_console" | "slack" | "api";
}) {
  if (!supabaseAdminClient) throw new Error("Supabase is required.");

  const normalizedFeedback =
    input.feedback === "good_recommendation"
      ? "good"
      : input.feedback === "bad_recommendation"
        ? "bad"
        : "needs_correction";
  const notesPrefix = `feedback_type=${input.feedback}`;
  const notes = input.freeText ? `${notesPrefix}\n${input.freeText}` : notesPrefix;

  await createRecommendationReview({
    recommendationId: input.recommendationId,
    feedback: normalizedFeedback,
    notes,
    createdBy: input.createdBy,
    source: input.source ?? "manager_console"
  });

  if (input.freeText && input.freeText.trim().length > 0) {
    const { data: recLog } = await supabaseAdminClient
      .from("recommendation_logs")
      .select("id,recommendation_json")
      .eq("id", input.recommendationId)
      .single();
    const recommendationJson = (recLog?.recommendation_json ?? {}) as Record<string, unknown>;
    const inputObj = (recommendationJson.input ?? {}) as Record<string, unknown>;
    const segment = String(inputObj.customer_segment ?? "");
    const floorType = String(inputObj.floor_type ?? "");

    const { error } = await supabaseAdminClient.from("knowledge_entries").insert({
      title: `Manager Feedback ${new Date().toISOString()}`,
      body: input.freeText.trim(),
      category: "manager_feedback",
      source_type: "recommendation_feedback",
      approved_status: "pending",
      metadata_json: {
        recommendation_id: input.recommendationId,
        feedback_type: input.feedback,
        customer_segment: segment || null,
        floor_type: floorType || null,
        created_by: input.createdBy ?? null
      }
    });
    if (error) throw new Error(`Failed creating feedback knowledge draft: ${error.message}`);
  }
}

export async function fetchApprovedManagerFeedback(input: { customerSegment?: string; floorType?: string }) {
  if (!supabaseAdminClient) return [];
  const { data, error } = await supabaseAdminClient
    .from("knowledge_entries")
    .select("title,body,metadata_json")
    .eq("approved_status", "approved")
    .eq("category", "manager_feedback")
    .eq("source_type", "recommendation_feedback")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(`Failed fetching manager feedback knowledge: ${error.message}`);
  const rows = data ?? [];
  return rows.filter((row) => {
    const metadata = (row.metadata_json ?? {}) as Record<string, unknown>;
    const seg = String(metadata.customer_segment ?? "").toLowerCase();
    const floor = String(metadata.floor_type ?? "").toLowerCase();
    const segmentMatch = input.customerSegment ? seg === input.customerSegment.toLowerCase() || seg === "" : true;
    const floorMatch = input.floorType ? floor === input.floorType.toLowerCase() || floor === "" : true;
    return segmentMatch && floorMatch;
  });
}
