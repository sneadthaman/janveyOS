import { randomUUID } from "node:crypto";
import { logger } from "../../shared/logger.js";
import { NonRetryableActionError } from "../errors/non-retryable-action-error.js";
import {
  claimApprovedActionRequest,
  createActionExecutionLog,
  listApprovedUnclaimedActionRequests,
  markActionAttemptFailed,
  markActionExecuted
} from "../repositories/agent-worker-repository.js";
import { runQuoteToSoDryRunHandler } from "./actions/quote-to-so-execution-handler.js";
import { notifyQuoteToSoCompleted } from "./slack/quote-to-so-notifier.js";

function normalizeActionType(actionType: string) {
  if (["quote_to_so", "quote_to_so_preview", "quote_to_sales_order", "estimate_to_sales_order"].includes(actionType)) {
    return "quote_to_so";
  }
  return actionType;
}

export async function executeAction(actionType: string, input: Record<string, unknown>, actionRequestId?: string) {
  const normalized = normalizeActionType(actionType);
  const enrichedInput =
    actionRequestId && !input.agent_action_request_id
      ? { ...input, agent_action_request_id: actionRequestId }
      : input;

  if (normalized === "quote_to_so") {
    const result = await runQuoteToSoDryRunHandler(enrichedInput);
    return {
      handler: "quote_to_so_execute",
      result
    };
  }

  if (enrichedInput.force_fail === true) {
    throw new Error("Forced mock failure requested.");
  }

  if (normalized === "new_item_draft") {
    return {
      handler: "mock_new_item_draft",
      result: {
        message: "Mock new-item draft execution complete.",
        vendor: enrichedInput.vendor ?? null,
        vendor_sku: enrichedInput.vendor_sku ?? null,
        netsuite_mutation: "not_implemented"
      }
    };
  }

  if (normalized === "pricing_update") {
    return {
      handler: "mock_pricing_update",
      result: {
        message: "Mock pricing update execution complete.",
        sku: enrichedInput.sku ?? null,
        customer: enrichedInput.customer ?? null,
        new_price: enrichedInput.new_price ?? null,
        netsuite_mutation: "not_implemented"
      }
    };
  }

  throw new Error(`No mock handler found for action_type=${actionType}`);
}

export async function executeClaimedActionRequest(
  claimed: { id: string; action_type: string; input_json: Record<string, unknown>; retry_count: number },
  workerId: string,
  options?: { suppressSlackCompletionNotification?: boolean }
) {
  const attempt = claimed.retry_count + 1;
  const startedAt = Date.now();
  const startedAtIso = new Date(startedAt).toISOString();
  const normalizedType = normalizeActionType(claimed.action_type);

  await createActionExecutionLog({
    actionRequestId: claimed.id,
    attemptNumber: attempt,
    workerId,
    status: "started",
    handlerName: `handler_${normalizedType}`,
    inputJson: claimed.input_json
  });

  try {
    const executed = await executeAction(claimed.action_type, claimed.input_json, claimed.id);
    const latencyMs = Date.now() - startedAt;

    await markActionExecuted({ id: claimed.id, outputJson: executed.result, latencyMs });

    if (normalizedType === "quote_to_so") {
      const source = String(claimed.input_json.source ?? "").toLowerCase();
      const mode = String((executed.result as Record<string, unknown>).mode ?? "");
      const wouldSubmit = (executed.result as Record<string, unknown>).wouldSubmit === true;
      const target = ((executed.result as Record<string, unknown>).target ?? {}) as Record<string, unknown>;
      const soInternalId = typeof target.internalId === "string" ? target.internalId : null;
      const soTranId = typeof target.tranId === "string" ? target.tranId : null;

      if (!options?.suppressSlackCompletionNotification && source === "slack" && mode === "live" && wouldSubmit && (soInternalId || soTranId)) {
        const slackChannelId = String(claimed.input_json.slack_channel_id ?? claimed.input_json.slackChannelId ?? "").trim();
        if (slackChannelId) {
          try {
            await notifyQuoteToSoCompleted({
              slackChannelId,
              slackUserId: String(claimed.input_json.slack_user_id ?? claimed.input_json.slackUserId ?? "").trim() || undefined,
              slackThreadTs:
                String(claimed.input_json.slack_thread_ts ?? claimed.input_json.slackThreadTs ?? "").trim() || undefined,
              quoteTranId:
                String(claimed.input_json.quote_tranid ?? claimed.input_json.quoteTranId ?? "").trim() ||
                String(claimed.input_json.quote_internal_id ?? claimed.input_json.quoteInternalId ?? "").trim(),
              customerName: String(claimed.input_json.customer_name ?? claimed.input_json.customerName ?? "").trim() || null,
              poNumber: String(claimed.input_json.po_number ?? claimed.input_json.poNumber ?? "").trim() || null,
              salesOrderInternalId: soInternalId,
              salesOrderTranId: soTranId
            });
          } catch (notifyError) {
            logger.error("quote_to_so slack completion notification failed", notifyError);
          }
        }
      }
    }

    await createActionExecutionLog({
      actionRequestId: claimed.id,
      attemptNumber: attempt,
      workerId,
      status: "completed",
      handlerName: executed.handler,
      inputJson: claimed.input_json,
      outputJson: executed.result,
      latencyMs
    });

    return { ok: true as const, result: executed.result };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    const nonRetryable = error instanceof NonRetryableActionError;
    const message = error instanceof Error ? error.message : "Unknown worker execution error";
    const details = nonRetryable ? (error.details ?? null) : null;
    const errorMessage = details ? `${message} | details=${JSON.stringify(details)}` : message;

    await markActionAttemptFailed({
      id: claimed.id,
      currentRetryCount: claimed.retry_count,
      errorMessage,
      forceTerminal: nonRetryable,
      outputJson: {
        execution_meta: {
          workerId,
          startedAt: startedAtIso,
          failedAt: new Date().toISOString(),
          safeErrorMessage: errorMessage
        }
      }
    });

    await createActionExecutionLog({
      actionRequestId: claimed.id,
      attemptNumber: attempt,
      workerId,
      status: "failed",
      handlerName: `handler_${normalizedType}`,
      inputJson: claimed.input_json,
      outputJson: details ? { error_details: details } : undefined,
      errorMessage,
      latencyMs
    });

    return { ok: false as const, error, errorMessage };
  }
}

export function startActionExecutionWorker(intervalMs = 10_000) {
  const workerId = `execution-worker-${randomUUID()}`;
  let timer: NodeJS.Timeout | null = null;
  let inFlight = false;

  const tick = async () => {
    if (inFlight) return;
    inFlight = true;

    try {
      const candidates = await listApprovedUnclaimedActionRequests(10);

      for (const candidate of candidates) {
        const claimed = await claimApprovedActionRequest(candidate.id, workerId);
        if (!claimed) continue;

        await executeClaimedActionRequest(claimed, workerId);
      }
    } catch (error) {
      logger.error("Execution worker tick failed", error);
    } finally {
      inFlight = false;
    }
  };

  timer = setInterval(() => {
    void tick();
  }, intervalMs);

  void tick();

  logger.info(`Action execution worker started (${workerId}) interval=${intervalMs}ms`);

  return {
    async stop() {
      if (timer) clearInterval(timer);
      timer = null;
      logger.info(`Action execution worker stopped (${workerId})`);
    }
  };
}
