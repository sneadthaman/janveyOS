import { supabaseAdminClient } from "../../integrations/supabase/client.js";

export interface SalesPlaybookInput {
  category: string;
  segment: string;
  required_questions: string[];
  recommendation_rules: string[];
  selling_points: string[];
  objections: string[];
  products_to_prioritize: string[];
  products_to_avoid: string[];
}

export async function listPlaybooks(category?: string) {
  if (!supabaseAdminClient) throw new Error("Supabase is required.");
  let query = supabaseAdminClient.from("sales_playbooks").select("*").order("updated_at", { ascending: false });
  if (category) query = query.eq("category", category);
  const { data, error } = await query;
  if (error) throw new Error(`Failed to list playbooks: ${error.message}`);
  return data ?? [];
}

export async function getPlaybook(id: string) {
  if (!supabaseAdminClient) throw new Error("Supabase is required.");
  const { data, error } = await supabaseAdminClient.from("sales_playbooks").select("*").eq("id", id).single();
  if (error) throw new Error(`Failed to get playbook: ${error.message}`);
  return data;
}

export async function createPlaybook(input: SalesPlaybookInput) {
  if (!supabaseAdminClient) throw new Error("Supabase is required.");
  const { data, error } = await supabaseAdminClient
    .from("sales_playbooks")
    .insert({ ...input, updated_at: new Date().toISOString() })
    .select("*")
    .single();
  if (error) throw new Error(`Failed to create playbook: ${error.message}`);
  return data;
}

export async function updatePlaybook(id: string, input: Partial<SalesPlaybookInput>) {
  if (!supabaseAdminClient) throw new Error("Supabase is required.");
  const { data, error } = await supabaseAdminClient
    .from("sales_playbooks")
    .update({ ...input, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(`Failed to update playbook: ${error.message}`);
  return data;
}

export async function deletePlaybook(id: string) {
  if (!supabaseAdminClient) throw new Error("Supabase is required.");
  const { error } = await supabaseAdminClient.from("sales_playbooks").delete().eq("id", id);
  if (error) throw new Error(`Failed to delete playbook: ${error.message}`);
}

export async function findRelevantPlaybook(category: string, segment?: string) {
  const rows = await listPlaybooks(category);
  const bySegment = segment ? rows.find((r) => String(r.segment).toLowerCase() === segment.toLowerCase()) : null;
  if (bySegment) return bySegment;
  return rows.find((r) => String(r.segment).toLowerCase() === "other") ?? rows[0] ?? null;
}
