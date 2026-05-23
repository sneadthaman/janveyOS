import { config } from "../../shared/config.js";
import { supabaseAdminClient } from "../../integrations/supabase/client.js";

export function assertQuoteToSoDevResetAllowed() {
  if (config.NODE_ENV === "production") {
    throw new Error("dev:reset-quote-to-so is blocked in production.");
  }
}

function normalize(input: string) {
  return input.trim().toUpperCase();
}

export async function resetQuoteToSoLocalState(quoteRef: string) {
  assertQuoteToSoDevResetAllowed();
  if (!supabaseAdminClient) throw new Error("Supabase is required.");

  const ref = normalize(quoteRef);

  const { data: actionRequests, error: actionError } = await supabaseAdminClient
    .from("agent_action_requests")
    .select("id,input_json")
    .eq("action_type", "quote_to_so")
    .order("created_at", { ascending: false })
    .limit(1000);
  if (actionError) throw new Error(`Failed to load quote_to_so action requests: ${actionError.message}`);

  const actionIds: string[] = [];
  const quoteInternalIds = new Set<string>();
  for (const row of actionRequests ?? []) {
    const input = (row.input_json ?? {}) as Record<string, unknown>;
    const qInternal = String(input.quote_internal_id ?? input.quoteInternalId ?? "").trim();
    const qTran = String(input.quote_tranid ?? input.quoteTranId ?? "").trim().toUpperCase();
    if (normalize(qInternal || "") === ref || qTran === ref) {
      actionIds.push(String(row.id));
      if (qInternal) quoteInternalIds.add(qInternal);
    }
  }

  if (quoteInternalIds.size === 0) {
    const { data: executions, error: execLookupError } = await supabaseAdminClient
      .from("quote_to_so_executions")
      .select("quote_internal_id")
      .eq("quote_internal_id", quoteRef)
      .limit(1);
    if (execLookupError) throw new Error(`Failed to look up quote_to_so_executions: ${execLookupError.message}`);
    if (executions?.[0]?.quote_internal_id) quoteInternalIds.add(String(executions[0].quote_internal_id));
  }

  let deletedExecutions = 0;
  for (const quoteInternalId of quoteInternalIds) {
    const { error } = await supabaseAdminClient.from("quote_to_so_executions").delete().eq("quote_internal_id", quoteInternalId);
    if (error) throw new Error(`Failed deleting quote_to_so_executions for ${quoteInternalId}: ${error.message}`);
    deletedExecutions += 1;
  }

  let deletedActionRequests = 0;
  if (actionIds.length > 0) {
    const { error } = await supabaseAdminClient.from("agent_action_requests").delete().in("id", actionIds);
    if (error) throw new Error(`Failed deleting agent_action_requests: ${error.message}`);
    deletedActionRequests = actionIds.length;
  }

  return {
    quoteRef: ref,
    deletedExecutions,
    deletedActionRequests,
    quoteInternalIds: Array.from(quoteInternalIds)
  };
}
