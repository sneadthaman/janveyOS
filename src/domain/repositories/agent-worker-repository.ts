import { supabaseAdminClient } from "../../integrations/supabase/client.js";

export interface ClaimableActionRequest {
  id: string;
  action_type: string;
  input_json: Record<string, unknown>;
  retry_count: number;
}

export async function listApprovedUnclaimedActionRequests(limit = 10) {
  if (!supabaseAdminClient) throw new Error("Supabase is required.");
  const { data, error } = await supabaseAdminClient
    .from("agent_action_requests")
    .select("id,action_type,input_json,retry_count")
    .eq("status", "approved")
    .is("claimed_at", null)
    .is("executed_at", null)
    .lt("retry_count", 3)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`Failed to list approved action requests: ${error.message}`);
  return (data ?? []) as ClaimableActionRequest[];
}

export async function claimApprovedActionRequest(id: string, workerId: string) {
  if (!supabaseAdminClient) throw new Error("Supabase is required.");
  const now = new Date().toISOString();
  const { data, error } = await supabaseAdminClient
    .from("agent_action_requests")
    .update({ claimed_by: workerId, claimed_at: now, last_attempted_at: now, updated_at: now })
    .eq("id", id)
    .eq("status", "approved")
    .is("claimed_at", null)
    .is("executed_at", null)
    .lt("retry_count", 3)
    .select("id,action_type,input_json,retry_count")
    .maybeSingle();

  if (error) throw new Error(`Failed to claim action request: ${error.message}`);
  return (data ?? null) as ClaimableActionRequest | null;
}

export async function createActionExecutionLog(input: {
  actionRequestId: string;
  attemptNumber: number;
  workerId: string;
  status: "started" | "completed" | "failed";
  handlerName: string;
  inputJson: Record<string, unknown>;
  outputJson?: Record<string, unknown>;
  errorMessage?: string;
  latencyMs?: number;
}) {
  if (!supabaseAdminClient) throw new Error("Supabase is required.");
  const { error } = await supabaseAdminClient.from("agent_action_execution_logs").insert({
    action_request_id: input.actionRequestId,
    attempt_number: input.attemptNumber,
    worker_id: input.workerId,
    status: input.status,
    handler_name: input.handlerName,
    input_json: input.inputJson,
    output_json: input.outputJson ?? null,
    error_message: input.errorMessage ?? null,
    latency_ms: input.latencyMs ?? null
  });
  if (error) throw new Error(`Failed to insert action execution log: ${error.message}`);
}

export async function markActionExecuted(input: {
  id: string;
  outputJson: Record<string, unknown>;
  latencyMs: number;
}) {
  if (!supabaseAdminClient) throw new Error("Supabase is required.");
  const now = new Date().toISOString();
  const { error } = await supabaseAdminClient
    .from("agent_action_requests")
    .update({
      status: "executed",
      executed_at: now,
      output_json: input.outputJson,
      error_message: null,
      claimed_at: null,
      claimed_by: null,
      updated_at: now
    })
    .eq("id", input.id)
    .eq("status", "approved");
  if (error) throw new Error(`Failed to mark action executed: ${error.message}`);
}

export async function markActionAttemptFailed(input: {
  id: string;
  currentRetryCount: number;
  errorMessage: string;
  forceTerminal?: boolean;
}) {
  if (!supabaseAdminClient) throw new Error("Supabase is required.");
  const now = new Date().toISOString();
  const nextRetryCount = input.currentRetryCount + 1;
  const terminal = input.forceTerminal === true || nextRetryCount >= 3;

  const { error } = await supabaseAdminClient
    .from("agent_action_requests")
    .update({
      status: terminal ? "failed" : "approved",
      retry_count: nextRetryCount,
      error_message: input.errorMessage,
      claimed_at: null,
      claimed_by: null,
      updated_at: now
    })
    .eq("id", input.id)
    .eq("status", "approved");

  if (error) throw new Error(`Failed to update failed action attempt: ${error.message}`);
}
