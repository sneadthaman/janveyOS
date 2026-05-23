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
import { notifyQuoteToSoCompleted } from "./slack/quote-to-so-notifier.js";
import { postSlackMessage } from "./slack/quote-to-so-notifier.js";
import { dispatchActionExecution } from "../actions/action-dispatcher.js";
import { normalizeActionType } from "../actions/shared/action-types.js";

export async function executeAction(actionType: string, input: Record<string, unknown>, actionRequestId?: string) {
  return dispatchActionExecution({
    actionType,
    actionRequestId,
    payload: input
  });
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

    if (normalizedType === "eta_update" && !options?.suppressSlackCompletionNotification) {
      const source = String(claimed.input_json.source_type ?? claimed.input_json.source ?? "").toLowerCase();
      if (source === "slack") {
        const slackChannelId = String(claimed.input_json.slack_channel_id ?? "").trim();
        if (slackChannelId) {
          try {
            const output = executed.result as Record<string, unknown>;
            await postSlackMessage({
              channel: slackChannelId,
              text:
                "✅ ETA update applied.\n" +
                `PO: ${String(output.poNumber ?? claimed.input_json.po_number ?? "-")}\n` +
                `ETA: ${String(output.etaDate ?? claimed.input_json.eta_date ?? "-")}\n` +
                `Request: ${claimed.id}`
            });
          } catch (notifyError) {
            logger.error("eta_update slack completion notification failed", notifyError);
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
