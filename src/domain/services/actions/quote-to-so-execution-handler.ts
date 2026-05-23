import { config } from "../../../shared/config.js";
import { NetSuiteRestletError, transformQuoteToSalesOrder } from "../../../integrations/netsuite/client.js";
import { NonRetryableActionError } from "../../errors/non-retryable-action-error.js";
import { logger } from "../../../shared/logger.js";
import {
  buildQuoteToSoIdempotencyKey,
  completeQuoteToSoExecution,
  failQuoteToSoExecution,
  startQuoteToSoExecution
} from "../../../features/quote-to-so/idempotency.js";
import { toQuoteToSoSlackMessage, type QuoteToSoUserResult } from "../../../features/quote-to-so/user-result.js";

function firstDefined(input: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    if (input[key] !== undefined && input[key] !== null) return input[key];
  }
  return undefined;
}

function normalizeStringOrNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string") return value.trim();
  return "";
}

function resolveExecutionMode(raw?: string) {
  if (raw === "live") return "live";
  if (raw === "dry_run") return "dry_run";
  return "dry_run";
}

function isBusinessTransformErrorCode(code: string | undefined) {
  if (!code) return false;
  return ["QUOTE_NOT_ALLOWED", "MISSING_QUOTE_ID", "DUPLICATE_TRANSFORM", "TRANSFORM_FAILED"].includes(code);
}

type QuoteToSoExecutionDependencies = {
  buildIdempotencyKey: (quoteInternalId: string) => string;
  startExecution: typeof startQuoteToSoExecution;
  completeExecution: typeof completeQuoteToSoExecution;
  failExecution: typeof failQuoteToSoExecution;
  transform: typeof transformQuoteToSalesOrder;
};

const defaultQuoteToSoExecutionDependencies: QuoteToSoExecutionDependencies = {
  buildIdempotencyKey: buildQuoteToSoIdempotencyKey,
  startExecution: startQuoteToSoExecution,
  completeExecution: completeQuoteToSoExecution,
  failExecution: failQuoteToSoExecution,
  transform: transformQuoteToSalesOrder
};

export async function runQuoteToSoDryRunHandler(
  input: Record<string, unknown>,
  dependencies: QuoteToSoExecutionDependencies = defaultQuoteToSoExecutionDependencies
) {
  const mode = resolveExecutionMode(config.NETSUITE_EXECUTION_MODE);

  const quoteInternalIdRaw = firstDefined(input, [
    "quoteInternalId",
    "quote_internal_id",
    "quoteId",
    "quote_id",
    "estimateInternalId",
    "estimate_internal_id",
    "estimateId",
    "estimate_id",
    "fromId",
    "from_id"
  ]);

  const quoteInternalId = normalizeStringOrNumber(quoteInternalIdRaw);
  if (!quoteInternalIdRaw) {
    throw new NonRetryableActionError("Missing quote internal ID.", {
      required_fields: [
        "quoteInternalId",
        "quote_internal_id",
        "quoteId",
        "quote_id",
        "estimateInternalId",
        "estimate_internal_id",
        "estimateId",
        "estimate_id",
        "fromId",
        "from_id"
      ]
    });
  }
  if (!quoteInternalId) {
    throw new NonRetryableActionError("Blank quote internal ID.", { quoteInternalIdRaw });
  }

  const approvalStatusTarget =
    normalizeStringOrNumber(
      firstDefined(input, [
        "approvalStatusTarget",
        "approval_status_target",
        "targetApprovalStatus",
        "target_approval_status"
      ])
    ) || "Pending Approval";

  const quoteTranId =
    normalizeStringOrNumber(firstDefined(input, ["quoteTranId", "quote_tranid", "estimateTranId", "estimate_tranid"])) || undefined;
  const poNumber = normalizeStringOrNumber(firstDefined(input, ["poNumber", "po_number", "otherrefnum"])) || undefined;
  const memo = normalizeStringOrNumber(firstDefined(input, ["memo"])) || undefined;
  const agentActionRequestId =
    normalizeStringOrNumber(firstDefined(input, ["agentActionRequestId", "agent_action_request_id"])) || undefined;

  if (mode === "live") {
    if (!config.NETSUITE_LIVE_QUOTE_TO_SO_ENABLED) {
      throw new NonRetryableActionError(
        "Live NetSuite execution for quote_to_so is disabled by NETSUITE_LIVE_QUOTE_TO_SO_ENABLED.",
        {
          mode,
          action_type: "quote_to_so"
        }
      );
    }

    const idempotencyKey = dependencies.buildIdempotencyKey(quoteInternalId);
    logger.info("quote_to_so.execution.start", {
      idempotencyKey,
      quoteInternalId,
      quoteTranId: quoteTranId ?? null,
      approvalRequestId: agentActionRequestId ?? null,
      executionId: null,
      salesOrderInternalId: null,
      salesOrderTranId: null
    });

    const execution = await dependencies.startExecution({
      quoteInternalId,
      approvalRequestId: agentActionRequestId,
      idempotencyKey
    });

    if (!execution.ok) {
      if (execution.status === "already_completed") {
        const userResult: QuoteToSoUserResult = {
          status: "already_completed",
          quoteInternalId,
          quoteTranId,
          salesOrderInternalId: execution.salesOrderInternalId,
          salesOrderTranId: execution.salesOrderTranId
        };
        logger.info("quote_to_so.execution.already_completed", {
          idempotencyKey,
          quoteInternalId,
          quoteTranId: quoteTranId ?? null,
          approvalRequestId: agentActionRequestId ?? null,
          executionId: null,
          salesOrderInternalId: execution.salesOrderInternalId,
          salesOrderTranId: execution.salesOrderTranId ?? null
        });
        return {
          operation: "transform_quote_to_sales_order",
          mode: "live",
          wouldSubmit: false,
          source: {
            fromType: "estimate",
            fromId: quoteInternalId,
            tranId: quoteTranId ?? null
          },
          target: {
            toType: "salesorder",
            internalId: execution.salesOrderInternalId,
            tranId: execution.salesOrderTranId ?? null
          },
          postTransformActions: {
            setApprovalStatus: approvalStatusTarget,
            actualOrderStatus: "already_created",
            actualOrderStatusValue: null,
            autoApprove: false,
            autoFulfill: false,
            autoBill: false
          },
          validation: {
            status: "passed",
            quoteInternalId
          },
          deduplication: {
            idempotencyKey,
            executionStatus: "already_completed"
          },
          userResult,
          userMessage: toQuoteToSoSlackMessage(userResult),
          safety: {
            message: "Sales Order already exists for this quote idempotency key. No additional NetSuite transform executed.",
            liveExecutionEnabled: true
          }
        };
      }

      const userResult: QuoteToSoUserResult = {
        status: "already_running",
        quoteInternalId,
        quoteTranId
      };
      logger.info("quote_to_so.execution.already_running", {
        idempotencyKey,
        quoteInternalId,
        quoteTranId: quoteTranId ?? null,
        approvalRequestId: agentActionRequestId ?? null,
        executionId: execution.executionId,
        salesOrderInternalId: null,
        salesOrderTranId: null
      });

      return {
        operation: "transform_quote_to_sales_order",
        mode: "live",
        wouldSubmit: false,
        source: {
          fromType: "estimate",
          fromId: quoteInternalId,
          tranId: quoteTranId ?? null
        },
        target: {
          toType: "salesorder",
          internalId: null,
          tranId: null
        },
        postTransformActions: {
          setApprovalStatus: approvalStatusTarget,
          actualOrderStatus: "processing",
          actualOrderStatusValue: null,
          autoApprove: false,
          autoFulfill: false,
          autoBill: false
        },
        validation: {
          status: "passed",
          quoteInternalId
        },
        deduplication: {
          idempotencyKey,
          executionId: execution.executionId,
          executionStatus: "already_running"
        },
        userResult,
        userMessage: toQuoteToSoSlackMessage(userResult),
        safety: {
          message: "Quote to SO transform is already running for this quote idempotency key.",
          liveExecutionEnabled: true
        }
      };
    }

    logger.info("quote_to_so.execution.start", {
      idempotencyKey,
      quoteInternalId,
      quoteTranId: quoteTranId ?? null,
      approvalRequestId: agentActionRequestId ?? null,
      executionId: execution.executionId,
      salesOrderInternalId: null,
      salesOrderTranId: null
    });

    try {
      const netsuiteResponse = await dependencies.transform({
        quoteInternalId,
        quoteTranId,
        poNumber,
        memo,
        approvalStatusTarget,
        agentActionRequestId
      });
      logger.info("quote_to_so.execution.completed", {
        idempotencyKey,
        quoteInternalId,
        quoteTranId: quoteTranId ?? null,
        approvalRequestId: agentActionRequestId ?? null,
        executionId: execution.executionId,
        salesOrderInternalId: netsuiteResponse.target?.internalId ?? null,
        salesOrderTranId: netsuiteResponse.target?.tranId ?? null
      });

      await dependencies.completeExecution({
        executionId: execution.executionId,
        salesOrderInternalId: netsuiteResponse.target?.internalId,
        salesOrderTranId: netsuiteResponse.target?.tranId
      });
      const userResult: QuoteToSoUserResult = {
        status: "completed",
        quoteInternalId,
        quoteTranId,
        salesOrderInternalId: netsuiteResponse.target?.internalId ?? "",
        salesOrderTranId: netsuiteResponse.target?.tranId
      };

      return {
        operation: "transform_quote_to_sales_order",
        mode: "live",
        wouldSubmit: true,
        source: {
          fromType: "estimate",
          fromId: netsuiteResponse.source?.fromId ?? quoteInternalId,
          tranId: quoteTranId ?? null
        },
        target: {
          toType: "salesorder",
          internalId: netsuiteResponse.target?.internalId ?? null,
          tranId: netsuiteResponse.target?.tranId ?? null
        },
        postTransformActions: {
          setApprovalStatus: approvalStatusTarget,
          actualOrderStatus: netsuiteResponse.orderStatus ?? null,
          actualOrderStatusValue: netsuiteResponse.orderStatusValue ?? null,
          autoApprove: netsuiteResponse.safety?.autoApprove ?? false,
          autoFulfill: netsuiteResponse.safety?.autoFulfill ?? false,
          autoBill: netsuiteResponse.safety?.autoBill ?? false
        },
        netsuiteResponse,
        validation: {
          status: "passed",
          quoteInternalId
        },
        deduplication: {
          idempotencyKey,
          executionId: execution.executionId,
          executionStatus: "completed"
        },
        userResult,
        userMessage: toQuoteToSoSlackMessage(userResult),
        safety: {
          message: "Live NetSuite transform executed after manager approval.",
          liveExecutionEnabled: true
        }
      };
    } catch (error) {
      if (error instanceof NonRetryableActionError) throw error;
      if (error instanceof NetSuiteRestletError) {
        if (error.message === "NetSuite authentication failed for quote_to_so transform.") {
          await dependencies.failExecution({
            executionId: execution.executionId,
            error
          });
          const safeErrorMessage = "NetSuite authentication failed for quote_to_so transform.";
          const userResult: QuoteToSoUserResult = {
            status: "failed",
            quoteInternalId,
            quoteTranId,
            safeErrorMessage
          };
          logger.error("quote_to_so.execution.failed", {
            idempotencyKey,
            quoteInternalId,
            quoteTranId: quoteTranId ?? null,
            approvalRequestId: agentActionRequestId ?? null,
            executionId: execution.executionId,
            salesOrderInternalId: null,
            salesOrderTranId: null,
            errorCode: error.code ?? null,
            safeErrorMessage
          });
          throw new NonRetryableActionError(error.message, {
            mode,
            action_type: "quote_to_so",
            code: error.code,
            details: error.details,
            http_status: error.httpStatus,
            user_result: userResult,
            user_message: toQuoteToSoSlackMessage(userResult)
          });
        }

        if (isBusinessTransformErrorCode(error.code)) {
          await dependencies.failExecution({
            executionId: execution.executionId,
            error
          });
          const safeErrorMessage = `NetSuite quote_to_so transform business error: ${error.code ?? "UNKNOWN_CODE"}.`;
          const userResult: QuoteToSoUserResult = {
            status: "failed",
            quoteInternalId,
            quoteTranId,
            safeErrorMessage
          };
          logger.error("quote_to_so.execution.failed", {
            idempotencyKey,
            quoteInternalId,
            quoteTranId: quoteTranId ?? null,
            approvalRequestId: agentActionRequestId ?? null,
            executionId: execution.executionId,
            salesOrderInternalId: null,
            salesOrderTranId: null,
            errorCode: error.code ?? null,
            safeErrorMessage
          });
          throw new NonRetryableActionError(
            `NetSuite quote_to_so transform business error: ${error.code ?? "UNKNOWN_CODE"}.`,
            {
              mode,
              action_type: "quote_to_so",
              code: error.code,
              details: error.details,
              http_status: error.httpStatus,
              user_result: userResult,
              user_message: toQuoteToSoSlackMessage(userResult)
            }
          );
        }
      }

      await dependencies.failExecution({
        executionId: execution.executionId,
        error
      });
      const safeErrorMessage = error instanceof Error ? error.message : "Unknown quote_to_so transform failure.";
      const userResult: QuoteToSoUserResult = {
        status: "failed",
        quoteInternalId,
        quoteTranId,
        safeErrorMessage
      };
      logger.error("quote_to_so.execution.failed", {
        idempotencyKey,
        quoteInternalId,
        quoteTranId: quoteTranId ?? null,
        approvalRequestId: agentActionRequestId ?? null,
        executionId: execution.executionId,
        salesOrderInternalId: null,
        salesOrderTranId: null,
        errorMessage: safeErrorMessage
      });

      throw error;
    }
  }

  const defaults: Record<string, string> = {};
  const addIfPresent = (targetKey: string, aliasKeys: string[]) => {
    const value = normalizeStringOrNumber(firstDefined(input, aliasKeys));
    if (value) defaults[targetKey] = value;
  };

  addIfPresent("customform", ["customForm", "custom_form", "customform"]);
  addIfPresent("memo", ["memo"]);
  addIfPresent("otherrefnum", ["poNumber", "po_number", "otherrefnum"]);
  addIfPresent("location", ["location", "locationId", "location_id"]);
  addIfPresent("department", ["department", "departmentId", "department_id"]);
  addIfPresent("class", ["class", "classId", "class_id"]);
  addIfPresent("subsidiary", ["subsidiary", "subsidiaryId", "subsidiary_id"]);
  addIfPresent("shipdate", ["shipDate", "ship_date"]);
  addIfPresent("terms", ["terms", "termsId", "terms_id"]);

  const transformRequest: Record<string, unknown> = {
    fromType: "estimate",
    fromId: quoteInternalId,
    toType: "salesorder",
    isDynamic: true
  };

  if (Object.keys(defaults).length > 0) {
    transformRequest.defaultValues = defaults;
  }

  return {
    operation: "transform_quote_to_sales_order",
    mode: "dry_run",
    wouldSubmit: false,
    source: {
      fromType: "estimate",
      fromId: quoteInternalId
    },
    target: {
      toType: "salesorder"
    },
    transformRequest,
    postTransformActions: {
      setApprovalStatus: approvalStatusTarget,
      autoApprove: false,
      autoFulfill: false,
      autoBill: false
    },
    validation: {
      status: "passed",
      quoteInternalId
    },
    safety: {
      message: "Dry run only. No NetSuite record was created.",
      liveExecutionEnabled: false
    }
  };
}
