import { config } from "../../../shared/config.js";
import { NetSuiteRestletError, transformQuoteToSalesOrder } from "../../../integrations/netsuite/client.js";
import { NonRetryableActionError } from "../../errors/non-retryable-action-error.js";

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

export async function runQuoteToSoDryRunHandler(input: Record<string, unknown>) {
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
    if (config.NETSUITE_LIVE_QUOTE_TO_SO_ENABLED !== "true") {
      throw new NonRetryableActionError(
        "Live NetSuite execution for quote_to_so is disabled by NETSUITE_LIVE_QUOTE_TO_SO_ENABLED.",
        {
          mode,
          action_type: "quote_to_so"
        }
      );
    }

    try {
      const netsuiteResponse = await transformQuoteToSalesOrder({
        quoteInternalId,
        quoteTranId,
        poNumber,
        memo,
        approvalStatusTarget,
        agentActionRequestId
      });

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
        safety: {
          message: "Live NetSuite transform executed after manager approval.",
          liveExecutionEnabled: true
        }
      };
    } catch (error) {
      if (error instanceof NonRetryableActionError) throw error;
      if (error instanceof NetSuiteRestletError) {
        if (error.message === "NetSuite authentication failed for quote_to_so transform.") {
          throw new NonRetryableActionError(error.message, {
            mode,
            action_type: "quote_to_so",
            code: error.code,
            details: error.details,
            http_status: error.httpStatus
          });
        }

        if (isBusinessTransformErrorCode(error.code)) {
          throw new NonRetryableActionError(
            `NetSuite quote_to_so transform business error: ${error.code ?? "UNKNOWN_CODE"}.`,
            {
              mode,
              action_type: "quote_to_so",
              code: error.code,
              details: error.details,
              http_status: error.httpStatus
            }
          );
        }
      }

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
