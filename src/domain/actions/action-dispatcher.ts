import { runQuoteToSoDryRunHandler } from "./quote-to-so/quote-to-so-execution-handler.js";
import { actionHandlerName } from "./shared/action-logging.js";
import {
  ACTION_TYPE_NEW_ITEM_DRAFT,
  ACTION_TYPE_QUOTE_TO_SO,
  normalizeActionType
} from "./shared/action-types.js";
import type { ActionExecutionDispatchResult } from "./shared/action-result.js";

export async function dispatchActionExecution(input: {
  actionType: string;
  actionRequestId?: string;
  payload: Record<string, unknown>;
}): Promise<ActionExecutionDispatchResult> {
  const normalized = normalizeActionType(input.actionType);
  const enrichedPayload =
    input.actionRequestId && !input.payload.agent_action_request_id
      ? { ...input.payload, agent_action_request_id: input.actionRequestId }
      : input.payload;

  if (normalized === ACTION_TYPE_QUOTE_TO_SO) {
    const result = await runQuoteToSoDryRunHandler(enrichedPayload);
    return {
      handler: "quote_to_so_execute",
      result
    };
  }

  if (enrichedPayload.force_fail === true) {
    throw new Error("Forced mock failure requested.");
  }

  if (normalized === ACTION_TYPE_NEW_ITEM_DRAFT) {
    return {
      handler: "mock_new_item_draft",
      result: {
        message: "Mock new-item draft execution complete.",
        vendor: enrichedPayload.vendor ?? null,
        vendor_sku: enrichedPayload.vendor_sku ?? null,
        netsuite_mutation: "not_implemented"
      }
    };
  }

  if (normalized === "pricing_update") {
    return {
      handler: "mock_pricing_update",
      result: {
        message: "Mock pricing update execution complete.",
        sku: enrichedPayload.sku ?? null,
        customer: enrichedPayload.customer ?? null,
        new_price: enrichedPayload.new_price ?? null,
        netsuite_mutation: "not_implemented"
      }
    };
  }

  return {
    handler: actionHandlerName(normalized),
    result: {
      status: false,
      code: "unsupported_action",
      message: `Unsupported action_type=${input.actionType}`
    }
  };
}
