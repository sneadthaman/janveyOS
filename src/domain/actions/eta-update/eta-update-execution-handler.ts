import { updatePurchaseOrderEta } from "../../../integrations/netsuite/client.js";
import { config } from "../../../shared/config.js";
import { NonRetryableActionError } from "../../errors/non-retryable-action-error.js";
import { markEtaUpdateStatus } from "./eta-update-repository.js";

function pickString(value: unknown) {
  const v = typeof value === "string" ? value.trim() : "";
  return v.length > 0 ? v : undefined;
}

export async function runEtaUpdateExecutionHandler(payload: Record<string, unknown>) {
  return runEtaUpdateExecutionHandlerWithDeps(payload, {
    updatePurchaseOrderEta,
    markEtaUpdateStatus
  });
}

export async function runEtaUpdateExecutionHandlerWithDeps(
  payload: Record<string, unknown>,
  deps: {
    updatePurchaseOrderEta: typeof updatePurchaseOrderEta;
    markEtaUpdateStatus: typeof markEtaUpdateStatus;
  }
) {
  const etaUpdateId = pickString(payload.eta_update_id ?? payload.etaUpdateId);
  const poInternalId = pickString(payload.netsuite_po_internal_id ?? payload.po_internal_id ?? payload.poInternalId);
  const poNumber = pickString(payload.po_number ?? payload.poNumber);
  const itemInternalId = pickString(payload.netsuite_item_internal_id ?? payload.item_internal_id ?? payload.itemInternalId);
  const etaDate = pickString(payload.eta_date ?? payload.etaDate);
  const updateScope = pickString(payload.update_scope ?? payload.updateScope) as "po_all_lines" | "po_line" | undefined;
  const trackingNumber = pickString(payload.tracking_number ?? payload.trackingNumber);
  const notes = pickString(payload.raw_notes ?? payload.notes);

  if (!etaUpdateId) throw new NonRetryableActionError("eta_update_id is required for eta_update execution.");
  if (!etaDate) {
    await deps.markEtaUpdateStatus(etaUpdateId, "needs_review");
    throw new NonRetryableActionError("ETA date is required for eta_update execution.");
  }
  if (!updateScope || (updateScope !== "po_all_lines" && updateScope !== "po_line")) {
    await deps.markEtaUpdateStatus(etaUpdateId, "needs_review");
    throw new NonRetryableActionError("update_scope must be po_all_lines or po_line for eta_update execution.");
  }
  if (!poInternalId && !poNumber) {
    await deps.markEtaUpdateStatus(etaUpdateId, "needs_review");
    throw new NonRetryableActionError("Either netsuite_po_internal_id or po_number is required for eta_update execution.");
  }

  if (!config.NETSUITE_PO_ETA_UPDATE_RESTLET_URL) {
    await deps.markEtaUpdateStatus(etaUpdateId, "needs_review");
    throw new NonRetryableActionError("NETSUITE_PO_ETA_UPDATE_RESTLET_URL is not configured.");
  }

  const response = await deps.updatePurchaseOrderEta({
    poInternalId,
    poNumber,
    itemInternalId,
    etaDate,
    updateScope,
    trackingNumber,
    notes
  });

  if (!response.success) {
    await deps.markEtaUpdateStatus(etaUpdateId, "needs_review");
    throw new NonRetryableActionError(response.message ?? "NetSuite ETA update failed.", {
      code: response.code,
      details: response.details
    });
  }

  await deps.markEtaUpdateStatus(etaUpdateId, "applied");

  return {
    operation: "update_purchase_order_eta",
    mode: config.NETSUITE_EXECUTION_MODE ?? "dry_run",
    success: true,
    etaUpdateId,
    poInternalId: response.poInternalId ?? poInternalId ?? null,
    poNumber: response.poNumber ?? poNumber ?? null,
    etaDate,
    updateScope,
    trackingNumber: trackingNumber ?? null,
    linesUpdated: response.linesUpdated ?? null,
    netsuiteResponse: response
  };
}
