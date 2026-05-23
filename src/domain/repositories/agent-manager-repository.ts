import { supabaseAdminClient } from "../../integrations/supabase/client.js";
import { canExecuteActionRequest } from "../services/actions/action-request-status.js";

const actionRequestSelect =
  "id,created_at,requested_by,source,action_type,requires_approval,approval_status_target,status,input_json,preview_json,output_json,approved_by,approved_at,executed_at,claimed_by,claimed_at,retry_count,last_attempted_at,error_message";

export async function listAgentToolCalls() {
  if (!supabaseAdminClient) throw new Error("Supabase is required.");
  const { data, error } = await supabaseAdminClient
    .from("agent_tool_calls")
    .select("id,created_at,requested_by,source,tool_name,status,latency_ms,error_message,input_json,output_json")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(`Failed to list agent tool calls: ${error.message}`);
  return data ?? [];
}

export async function listAgentActionRequests() {
  if (!supabaseAdminClient) throw new Error("Supabase is required.");
  const { data, error } = await supabaseAdminClient
    .from("agent_action_requests")
    .select(actionRequestSelect)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(`Failed to list agent action requests: ${error.message}`);
  return data ?? [];
}

export async function getAgentActionRequestById(id: string) {
  if (!supabaseAdminClient) throw new Error("Supabase is required.");
  const { data, error } = await supabaseAdminClient
    .from("agent_action_requests")
    .select(actionRequestSelect)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Failed to load action request: ${error.message}`);
  return data;
}

export async function approveAgentActionRequest(id: string, approvedBy: string) {
  if (!supabaseAdminClient) throw new Error("Supabase is required.");

  const { data: existing, error: findError } = await supabaseAdminClient
    .from("agent_action_requests")
    .select("id,status")
    .eq("id", id)
    .maybeSingle();

  if (findError) throw new Error(`Failed to load action request: ${findError.message}`);
  if (!existing) throw new Error("Action request not found.");
  if (!canExecuteActionRequest(existing.status)) {
    throw new Error(`Only pending requests can be approved. Current status: ${existing.status}`);
  }

  const now = new Date().toISOString();
  const { data, error } = await supabaseAdminClient
    .from("agent_action_requests")
    .update({
      status: "approved",
      approved_by: approvedBy,
      approved_at: now,
      updated_at: now
    })
    .eq("id", id)
    .select(actionRequestSelect)
    .single();

  if (error) throw new Error(`Failed to approve action request: ${error.message}`);
  return data;
}

export async function rejectAgentActionRequest(id: string) {
  if (!supabaseAdminClient) throw new Error("Supabase is required.");

  const { data: existing, error: findError } = await supabaseAdminClient
    .from("agent_action_requests")
    .select("id,status")
    .eq("id", id)
    .maybeSingle();

  if (findError) throw new Error(`Failed to load action request: ${findError.message}`);
  if (!existing) throw new Error("Action request not found.");
  if (!canExecuteActionRequest(existing.status)) {
    throw new Error(`Only pending requests can be rejected. Current status: ${existing.status}`);
  }

  const now = new Date().toISOString();
  const { data, error } = await supabaseAdminClient
    .from("agent_action_requests")
    .update({
      status: "rejected",
      updated_at: now
    })
    .eq("id", id)
    .select(actionRequestSelect)
    .single();

  if (error) throw new Error(`Failed to reject action request: ${error.message}`);
  return data;
}

export async function cancelAgentActionRequest(id: string) {
  if (!supabaseAdminClient) throw new Error("Supabase is required.");

  const { data: existing, error: findError } = await supabaseAdminClient
    .from("agent_action_requests")
    .select("id,status")
    .eq("id", id)
    .maybeSingle();

  if (findError) throw new Error(`Failed to load action request: ${findError.message}`);
  if (!existing) throw new Error("Action request not found.");
  if (!canExecuteActionRequest(existing.status)) {
    throw new Error(`Only pending requests can be cancelled. Current status: ${existing.status}`);
  }

  const now = new Date().toISOString();
  const { data, error } = await supabaseAdminClient
    .from("agent_action_requests")
    .update({
      status: "cancelled",
      updated_at: now
    })
    .eq("id", id)
    .select(actionRequestSelect)
    .single();

  if (error) throw new Error(`Failed to cancel action request: ${error.message}`);
  return data;
}

export async function listActionExecutionLogs(actionRequestId: string) {
  if (!supabaseAdminClient) throw new Error("Supabase is required.");
  const { data, error } = await supabaseAdminClient
    .from("agent_action_execution_logs")
    .select("id,attempt_number,status,created_at,error_message,input_json,output_json")
    .eq("action_request_id", actionRequestId)
    .order("attempt_number", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Failed to list action execution logs: ${error.message}`);

  const grouped = new Map<number, { start: Record<string, unknown> | null; end: Record<string, unknown> | null }>();
  for (const row of data ?? []) {
    const attempt = Number(row.attempt_number);
    const current = grouped.get(attempt) ?? { start: null, end: null };
    if (row.status === "started" && !current.start) current.start = row;
    if (row.status === "completed" || row.status === "failed") current.end = row;
    grouped.set(attempt, current);
  }

  return Array.from(grouped.entries()).map(([attempt, rows]) => {
    const endStatus = (rows.end?.status as string | undefined) ?? (rows.start?.status as string | undefined) ?? "started";
    return {
      attempt_number: attempt,
      status: endStatus,
      started_at: (rows.start?.created_at as string | undefined) ?? null,
      completed_at:
        endStatus === "completed" || endStatus === "failed" ? ((rows.end?.created_at as string | undefined) ?? null) : null,
      error_message: (rows.end?.error_message as string | undefined) ?? null,
      input_json: (rows.start?.input_json as Record<string, unknown> | undefined) ?? {},
      output_json: (rows.end?.output_json as Record<string, unknown> | undefined) ?? null
    };
  });
}
