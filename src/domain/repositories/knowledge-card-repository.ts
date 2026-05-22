import { supabaseAdminClient } from "../../integrations/supabase/client.js";
import type { KnowledgeApprovalStatus, KnowledgeCardType } from "../types/knowledge-card.js";

export async function listKnowledgeCards(input: { status?: KnowledgeApprovalStatus; uploadId?: string }) {
  if (!supabaseAdminClient) throw new Error("Supabase is required.");
  let query = supabaseAdminClient.from("knowledge_cards").select("*").order("created_at", { ascending: false }).limit(500);
  if (input.status) query = query.eq("approved_status", input.status);
  if (input.uploadId) query = query.eq("uploaded_document_id", input.uploadId);
  const { data, error } = await query;
  if (error) throw new Error(`Failed to list knowledge cards: ${error.message}`);
  return data ?? [];
}

export async function insertKnowledgeCards(
  cards: Array<{
    uploaded_document_id: string;
    linked_product_id?: string | null;
    card_type: KnowledgeCardType;
    title: string;
    body: string;
    vendor?: string | null;
    category?: string | null;
    segment?: string | null;
    confidence_score?: number | null;
    source_type: string;
    source_url?: string | null;
    source_excerpt?: string | null;
    match_reason?: string | null;
  }>
) {
  if (!supabaseAdminClient || cards.length === 0) return;
  const payload = cards.map((c) => ({ ...c, approved_status: "pending", updated_at: new Date().toISOString() }));
  const { error } = await supabaseAdminClient.from("knowledge_cards").insert(payload);
  if (error) throw new Error(`Failed to insert knowledge cards: ${error.message}`);
}

export async function patchKnowledgeCard(
  id: string,
  input: { title?: string; body?: string; approvedStatus?: KnowledgeApprovalStatus }
) {
  if (!supabaseAdminClient) throw new Error("Supabase is required.");
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.title !== undefined) payload.title = input.title;
  if (input.body !== undefined) payload.body = input.body;
  if (input.approvedStatus !== undefined) payload.approved_status = input.approvedStatus;

  const { data, error } = await supabaseAdminClient
    .from("knowledge_cards")
    .update(payload)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(`Failed to patch knowledge card: ${error.message}`);
  return data;
}

export async function setKnowledgeCardStatus(id: string, status: KnowledgeApprovalStatus) {
  return patchKnowledgeCard(id, { approvedStatus: status });
}

export async function bulkSetKnowledgeCardStatus(ids: string[], status: KnowledgeApprovalStatus) {
  if (!supabaseAdminClient) throw new Error("Supabase is required.");
  if (ids.length === 0) return { count: 0 };
  const { error } = await supabaseAdminClient
    .from("knowledge_cards")
    .update({ approved_status: status, updated_at: new Date().toISOString() })
    .in("id", ids);
  if (error) throw new Error(`Failed to bulk update knowledge cards: ${error.message}`);
  return { count: ids.length };
}

export async function bulkAutoReviewByConfidence(input: {
  uploadId: string;
  minConfidenceForApprove: number;
  maxConfidenceForReject: number;
}) {
  if (!supabaseAdminClient) throw new Error("Supabase is required.");
  const { data, error } = await supabaseAdminClient
    .from("knowledge_cards")
    .select("id,confidence_score")
    .eq("uploaded_document_id", input.uploadId)
    .eq("approved_status", "pending");
  if (error) throw new Error(`Failed loading cards for auto-review: ${error.message}`);

  const rows = data ?? [];
  const approveIds = rows.filter((r) => Number(r.confidence_score ?? 0) >= input.minConfidenceForApprove).map((r) => String(r.id));
  const rejectIds = rows.filter((r) => Number(r.confidence_score ?? 0) <= input.maxConfidenceForReject).map((r) => String(r.id));

  if (approveIds.length > 0) {
    await bulkSetKnowledgeCardStatus(approveIds, "approved");
  }
  if (rejectIds.length > 0) {
    await bulkSetKnowledgeCardStatus(rejectIds, "rejected");
  }

  return { approved: approveIds.length, rejected: rejectIds.length };
}

export async function getUploadKnowledgeCardSummary(uploadedDocumentId: string) {
  if (!supabaseAdminClient) throw new Error("Supabase is required.");
  const { data, error } = await supabaseAdminClient
    .from("knowledge_cards")
    .select("approved_status,linked_product_id,card_type")
    .eq("uploaded_document_id", uploadedDocumentId);
  if (error) throw new Error(`Failed to summarize knowledge cards: ${error.message}`);
  const cards = data ?? [];
  return {
    card_count: cards.length,
    matched_product_count: new Set(cards.filter((c) => c.linked_product_id).map((c) => c.linked_product_id)).size,
    pending_count: cards.filter((c) => c.approved_status === "pending").length,
    approved_count: cards.filter((c) => c.approved_status === "approved").length,
    rejected_count: cards.filter((c) => c.approved_status === "rejected").length,
    product_spec_count: cards.filter((c) => c.card_type === "spec_fact").length,
    document_summary_count: cards.filter((c) => c.card_type === "product_insight" || c.card_type === "application_fit").length
  };
}
