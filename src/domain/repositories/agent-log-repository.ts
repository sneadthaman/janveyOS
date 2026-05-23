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
  status?: "pending" | "approved" | "running" | "rejected" | "cancelled" | "executed" | "failed";
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

export async function findLatestQuoteToSoActionRequestForQuote(input: {
  quoteInternalId: string;
  quoteTranId?: string;
}) {
  if (!supabaseAdminClient) throw new Error("Supabase is required for action request logging.");
  const { data, error } = await supabaseAdminClient
    .from("agent_action_requests")
    .select("id,status,input_json,output_json,created_at")
    .eq("action_type", "quote_to_so")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) throw new Error(`Failed to fetch quote_to_so action request rows: ${error.message}`);

  for (const row of data ?? []) {
    const inputJson = (row.input_json ?? {}) as Record<string, unknown>;
    const quoteInternalId = String(inputJson.quote_internal_id ?? inputJson.quoteInternalId ?? "").trim();
    const quoteTranId = String(inputJson.quote_tranid ?? inputJson.quoteTranId ?? "").trim().toUpperCase();

    if (quoteInternalId && quoteInternalId === input.quoteInternalId) return row;
    if (input.quoteTranId && quoteTranId && quoteTranId === input.quoteTranId.toUpperCase()) return row;
  }

  return null;
}

export async function findCompletedQuoteToSoByQuote(input: {
  quoteInternalId?: string;
  quoteTranId?: string;
}): Promise<{
  found: boolean;
  quoteInternalId?: string;
  quoteTranId?: string;
  salesOrderInternalId?: string;
  salesOrderTranId?: string;
  source: "quote_to_so_executions" | "agent_action_requests";
}> {
  if (!supabaseAdminClient) throw new Error("Supabase is required for action request logging.");

  const normalizedQuoteInternalId = (input.quoteInternalId ?? "").trim();
  const normalizedQuoteTranId = (input.quoteTranId ?? "").trim().toUpperCase();

  if (normalizedQuoteInternalId) {
    const { data: executionRows, error: executionError } = await supabaseAdminClient
      .from("quote_to_so_executions")
      .select("quote_internal_id,sales_order_internal_id,sales_order_tran_id,updated_at,created_at")
      .eq("quote_internal_id", normalizedQuoteInternalId)
      .eq("status", "completed")
      .not("sales_order_internal_id", "is", null)
      .order("updated_at", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1);

    if (executionError) {
      throw new Error(`Failed to fetch quote_to_so_executions rows: ${executionError.message}`);
    }

    const execution = executionRows?.[0];
    if (execution?.sales_order_internal_id) {
      return {
        found: true,
        quoteInternalId: String(execution.quote_internal_id),
        quoteTranId: normalizedQuoteTranId || undefined,
        salesOrderInternalId: String(execution.sales_order_internal_id),
        salesOrderTranId: execution.sales_order_tran_id ? String(execution.sales_order_tran_id) : undefined,
        source: "quote_to_so_executions"
      };
    }
  }

  const { data: actionRows, error: actionError } = await supabaseAdminClient
    .from("agent_action_requests")
    .select("input_json,output_json,created_at")
    .eq("action_type", "quote_to_so")
    .eq("status", "executed")
    .order("created_at", { ascending: false })
    .limit(500);

  if (actionError) throw new Error(`Failed to fetch executed quote_to_so action requests: ${actionError.message}`);

  const extractFromActionRow = (row: { input_json?: unknown; output_json?: unknown }) => {
    const inputJson = (row.input_json ?? {}) as Record<string, unknown>;
    const outputJson = (row.output_json ?? {}) as Record<string, unknown>;
    const target = (outputJson.target ?? {}) as Record<string, unknown>;
    const userResult = (outputJson.userResult ?? {}) as Record<string, unknown>;

    const quoteInternalId = String(inputJson.quote_internal_id ?? inputJson.quoteInternalId ?? "").trim();
    const quoteTranId = String(inputJson.quote_tranid ?? inputJson.quoteTranId ?? "")
      .trim()
      .toUpperCase();

    const salesOrderInternalId =
      String(target.internalId ?? userResult.salesOrderInternalId ?? "").trim() || undefined;
    const salesOrderTranId = String(target.tranId ?? userResult.salesOrderTranId ?? "").trim() || undefined;

    return { quoteInternalId, quoteTranId, salesOrderInternalId, salesOrderTranId };
  };

  if (normalizedQuoteInternalId) {
    for (const row of actionRows ?? []) {
      const extracted = extractFromActionRow(row);
      if (extracted.quoteInternalId === normalizedQuoteInternalId && extracted.salesOrderInternalId) {
        return {
          found: true,
          quoteInternalId: extracted.quoteInternalId,
          quoteTranId: extracted.quoteTranId || normalizedQuoteTranId || undefined,
          salesOrderInternalId: extracted.salesOrderInternalId,
          salesOrderTranId: extracted.salesOrderTranId,
          source: "agent_action_requests"
        };
      }
    }
  }

  if (normalizedQuoteTranId) {
    for (const row of actionRows ?? []) {
      const extracted = extractFromActionRow(row);
      if (extracted.quoteTranId === normalizedQuoteTranId && extracted.salesOrderInternalId) {
        return {
          found: true,
          quoteInternalId: extracted.quoteInternalId || normalizedQuoteInternalId || undefined,
          quoteTranId: extracted.quoteTranId,
          salesOrderInternalId: extracted.salesOrderInternalId,
          salesOrderTranId: extracted.salesOrderTranId,
          source: "agent_action_requests"
        };
      }
    }
  }

  return {
    found: false,
    quoteInternalId: normalizedQuoteInternalId || undefined,
    quoteTranId: normalizedQuoteTranId || undefined,
    source: "agent_action_requests"
  };
}

export async function findLatestEtaUpdateActionRequestByEtaId(etaUpdateId: string) {
  if (!supabaseAdminClient) throw new Error("Supabase is required for action request logging.");
  const { data, error } = await supabaseAdminClient
    .from("agent_action_requests")
    .select("id,status,input_json,output_json,created_at")
    .eq("action_type", "eta_update")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) throw new Error(`Failed to fetch eta_update action request rows: ${error.message}`);

  for (const row of data ?? []) {
    const inputJson = (row.input_json ?? {}) as Record<string, unknown>;
    const id = String(inputJson.eta_update_id ?? inputJson.etaUpdateId ?? "").trim();
    if (id && id === etaUpdateId) return row;
  }

  return null;
}
