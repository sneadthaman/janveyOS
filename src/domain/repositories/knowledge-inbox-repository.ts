import { supabaseAdminClient } from "../../integrations/supabase/client.js";

type KnowledgeStatus = "pending" | "approved" | "rejected";

export async function listKnowledgeEntries(status: KnowledgeStatus = "pending") {
  if (!supabaseAdminClient) throw new Error("Supabase is required.");
  const { data, error } = await supabaseAdminClient
    .from("knowledge_entries")
    .select("*")
    .eq("approved_status", status)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(`Failed to list knowledge entries: ${error.message}`);
  return data ?? [];
}

export async function patchKnowledgeEntry(
  knowledgeId: string,
  input: { title?: string; body?: string; approvedStatus?: KnowledgeStatus }
) {
  if (!supabaseAdminClient) throw new Error("Supabase is required.");
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.title !== undefined) payload.title = input.title;
  if (input.body !== undefined) payload.body = input.body;
  if (input.approvedStatus !== undefined) payload.approved_status = input.approvedStatus;

  const { data, error } = await supabaseAdminClient
    .from("knowledge_entries")
    .update(payload)
    .eq("id", knowledgeId)
    .select("*")
    .single();
  if (error) throw new Error(`Failed to update knowledge entry: ${error.message}`);
  return data;
}

export async function setKnowledgeStatus(knowledgeId: string, status: KnowledgeStatus) {
  return patchKnowledgeEntry(knowledgeId, { approvedStatus: status });
}
