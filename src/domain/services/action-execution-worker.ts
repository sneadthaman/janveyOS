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

function normalizeActionType(actionType: string) {
  if (["quote_to_so", "quote_to_so_preview", "quote_to_sales_order", "estimate_to_sales_order"].includes(actionType)) {
    return "quote_to_so";
  }
  return actionType;
}

async function executeAction(actionType: string, input: Record<string, unknown>, actionRequestId?: string) {
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

        const attempt = claimed.retry_count + 1;
        const startedAt = Date.now();
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
            forceTerminal: nonRetryable
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
        }
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
