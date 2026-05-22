import { supabaseAdminClient } from "../../integrations/supabase/client.js";

export async function createAgentToolCall(input: {
  requestedBy?: string;
  source?: string;
  toolName: string;
  inputJson: Record<string, unknown>;
  outputJson?: Record<string, unknown>;
  status: "completed" | "failed";
  errorMessage?: string;
  latencyMs?: number;
}) {
  if (!supabaseAdminClient) throw new Error("Supabase is required for tool logging.");

  const { data, error } = await supabaseAdminClient
    .from("agent_tool_calls")
    .insert({
      requested_by: input.requestedBy ?? null,
      source: input.source ?? null,
      tool_name: input.toolName,
      input_json: input.inputJson,
      output_json: input.outputJson ?? null,
      status: input.status,
      error_message: input.errorMessage ?? null,
      latency_ms: input.latencyMs ?? null
    })
    .select("id")
    .single();

  if (error || !data) throw new Error(`Failed to create agent_tool_calls row: ${error?.message ?? "unknown error"}`);
  return String(data.id);
}

export async function createAgentActionRequest(input: {
  requestedBy?: string;
  source?: string;
  actionType: string;
  requiresApproval?: boolean;
  approvalStatusTarget?: string;
  inputJson: Record<string, unknown>;
  previewJson?: Record<string, unknown>;
  status?: "pending" | "approved" | "rejected" | "executed" | "failed";
  errorMessage?: string;
}) {
  if (!supabaseAdminClient) throw new Error("Supabase is required for action request logging.");

  const { data, error } = await supabaseAdminClient
    .from("agent_action_requests")
    .insert({
      requested_by: input.requestedBy ?? null,
      source: input.source ?? null,
      action_type: input.actionType,
      requires_approval: input.requiresApproval ?? true,
      approval_status_target: input.approvalStatusTarget ?? "Pending Approval",
      input_json: input.inputJson,
      preview_json: input.previewJson ?? null,
      status: input.status ?? (input.requiresApproval === false ? "approved" : "pending"),
      error_message: input.errorMessage ?? null,
      updated_at: new Date().toISOString()
    })
    .select("id")
    .single();

  if (error || !data) throw new Error(`Failed to create agent_action_requests row: ${error?.message ?? "unknown error"}`);
  return String(data.id);
}

export async function getLatestToolCallByName(toolName: string) {
  if (!supabaseAdminClient) throw new Error("Supabase is required for tool logging.");
  const { data, error } = await supabaseAdminClient
    .from("agent_tool_calls")
    .select("id, tool_name, status, created_at")
    .eq("tool_name", toolName)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Failed to fetch tool log row: ${error.message}`);
  return data;
}

export async function getLatestActionRequestByType(actionType: string) {
  if (!supabaseAdminClient) throw new Error("Supabase is required for action request logging.");
  const { data, error } = await supabaseAdminClient
    .from("agent_action_requests")
    .select("id, action_type, status, created_at")
    .eq("action_type", actionType)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Failed to fetch action request row: ${error.message}`);
  return data;
}
