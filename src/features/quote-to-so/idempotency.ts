import { supabaseAdminClient } from "../../integrations/supabase/client.js";

export type QuoteToSoExecutionStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export interface QuoteToSoExecutionRow {
  id: string;
  quote_internal_id: string;
  approval_request_id: string | null;
  idempotency_key: string;
  status: QuoteToSoExecutionStatus;
  sales_order_internal_id: string | null;
  sales_order_tran_id: string | null;
  error_code: string | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export type StartExecutionResult =
  | {
      ok: true;
      executionId: string;
      status: "started";
    }
  | {
      ok: false;
      status: "already_completed";
      salesOrderInternalId: string;
      salesOrderTranId?: string;
    }
  | {
      ok: false;
      status: "already_running";
      executionId: string;
    };

function isUniqueViolation(error: unknown) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "23505"
  );
}

function toErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown quote_to_so execution error";
}

function toErrorCode(error: unknown) {
  if (error && typeof error === "object" && "code" in error) {
    const raw = (error as { code?: unknown }).code;
    if (typeof raw === "string" && raw.trim().length > 0) return raw;
  }
  return null;
}

async function getExecutionByIdempotencyKey(idempotencyKey: string) {
  if (!supabaseAdminClient) throw new Error("Supabase is required.");
  const { data, error } = await supabaseAdminClient
    .from("quote_to_so_executions")
    .select("*")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle<QuoteToSoExecutionRow>();

  if (error) throw new Error(`Failed to load quote_to_so execution: ${error.message}`);
  return data ?? null;
}

export function buildQuoteToSoIdempotencyKey(quoteInternalId: string): string {
  return `quote_to_so:${quoteInternalId.trim()}`;
}

export async function startQuoteToSoExecution(input: {
  quoteInternalId: string;
  approvalRequestId?: string;
  idempotencyKey: string;
}): Promise<StartExecutionResult> {
  if (!supabaseAdminClient) throw new Error("Supabase is required.");

  const now = new Date().toISOString();
  const createPayload = {
    quote_internal_id: input.quoteInternalId,
    approval_request_id: input.approvalRequestId ?? null,
    idempotency_key: input.idempotencyKey,
    status: "running" as const,
    started_at: now,
    updated_at: now
  };

  const { data, error } = await supabaseAdminClient
    .from("quote_to_so_executions")
    .insert(createPayload)
    .select("id")
    .single<{ id: string }>();

  if (!error && data?.id) {
    return {
      ok: true,
      executionId: data.id,
      status: "started"
    };
  }

  if (!isUniqueViolation(error)) {
    throw new Error(`Failed to start quote_to_so execution: ${error?.message ?? "unknown error"}`);
  }

  const existing = await getExecutionByIdempotencyKey(input.idempotencyKey);
  if (!existing) {
    throw new Error("quote_to_so execution unique conflict occurred but no existing execution was found.");
  }

  if (existing.status === "completed") {
    return {
      ok: false,
      status: "already_completed",
      salesOrderInternalId: existing.sales_order_internal_id ?? "",
      salesOrderTranId: existing.sales_order_tran_id ?? undefined
    };
  }

  if (existing.status === "running" || existing.status === "pending") {
    return {
      ok: false,
      status: "already_running",
      executionId: existing.id
    };
  }

  if (existing.status === "failed") {
    const { data: restarted, error: restartError } = await supabaseAdminClient
      .from("quote_to_so_executions")
      .update({
        status: "running",
        approval_request_id: input.approvalRequestId ?? existing.approval_request_id,
        started_at: now,
        completed_at: null,
        error_code: null,
        error_message: null,
        updated_at: now
      })
      .eq("id", existing.id)
      .eq("status", "failed")
      .select("id")
      .maybeSingle<{ id: string }>();

    if (restartError) {
      throw new Error(`Failed to restart quote_to_so execution: ${restartError.message}`);
    }

    if (restarted?.id) {
      return {
        ok: true,
        executionId: restarted.id,
        status: "started"
      };
    }

    return {
      ok: false,
      status: "already_running",
      executionId: existing.id
    };
  }

  return {
    ok: false,
    status: "already_running",
    executionId: existing.id
  };
}

export async function completeQuoteToSoExecution(input: {
  executionId: string;
  salesOrderInternalId?: string;
  salesOrderTranId?: string;
}): Promise<void> {
  if (!supabaseAdminClient) throw new Error("Supabase is required.");
  const now = new Date().toISOString();
  const { error } = await supabaseAdminClient
    .from("quote_to_so_executions")
    .update({
      status: "completed",
      sales_order_internal_id: input.salesOrderInternalId ?? null,
      sales_order_tran_id: input.salesOrderTranId ?? null,
      error_code: null,
      error_message: null,
      completed_at: now,
      updated_at: now
    })
    .eq("id", input.executionId)
    .eq("status", "running");

  if (error) throw new Error(`Failed to complete quote_to_so execution: ${error.message}`);
}

export async function failQuoteToSoExecution(input: {
  executionId: string;
  error: unknown;
}): Promise<void> {
  if (!supabaseAdminClient) throw new Error("Supabase is required.");
  const now = new Date().toISOString();
  const { error } = await supabaseAdminClient
    .from("quote_to_so_executions")
    .update({
      status: "failed",
      error_code: toErrorCode(input.error),
      error_message: toErrorMessage(input.error),
      completed_at: now,
      updated_at: now
    })
    .eq("id", input.executionId);

  if (error) throw new Error(`Failed to mark quote_to_so execution failed: ${error.message}`);
}
