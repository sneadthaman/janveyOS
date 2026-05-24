import { updatePurchaseOrderEta } from "../../../integrations/netsuite/client.js";
import { config } from "../../../shared/config.js";
import { logger } from "../../../shared/logger.js";
import { NonRetryableActionError } from "../../errors/non-retryable-action-error.js";
import { markEtaUpdateStatus } from "./eta-update-repository.js";

function pickString(value: unknown) {
  const v = typeof value === "string" ? value.trim() : "";
  return v.length > 0 ? v : undefined;
}

function hasPoEtaUpdateRestletUrlConfigured() {
  const runtime = typeof process.env.NETSUITE_PO_ETA_UPDATE_RESTLET_URL === "string"
    ? process.env.NETSUITE_PO_ETA_UPDATE_RESTLET_URL.trim()
    : "";
  return Boolean(runtime || config.NETSUITE_PO_ETA_UPDATE_RESTLET_URL);
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
  const etaDate = pickString(payload.eta_date ?? payload.etaDate);
  const trackingNumber = pickString(payload.tracking_number ?? payload.trackingNumber);
  const etaConfidence = pickString(payload.eta_confidence ?? payload.etaConfidence ?? payload.extraction_confidence) ?? "MED";
  const etaSource = pickString(payload.eta_source ?? payload.etaSource ?? payload.source_type) ?? "email";
  const etaNotes = pickString(payload.eta_notes ?? payload.etaNotes ?? payload.raw_notes ?? payload.notes) ?? "";
  const items = Array.isArray(payload.items) ? payload.items : [];

  if (!etaUpdateId) throw new NonRetryableActionError("eta_update_id is required for eta_update execution.");
  if (!etaDate) {
    await deps.markEtaUpdateStatus(etaUpdateId, "needs_review");
    throw new NonRetryableActionError("ETA date is required for eta_update execution.");
  }
  if (!poInternalId && !poNumber) {
    await deps.markEtaUpdateStatus(etaUpdateId, "needs_review");
    throw new NonRetryableActionError("Either netsuite_po_internal_id or po_number is required for eta_update execution.");
  }

  if (!hasPoEtaUpdateRestletUrlConfigured()) {
    await deps.markEtaUpdateStatus(etaUpdateId, "needs_review");
    throw new NonRetryableActionError("NETSUITE_PO_ETA_UPDATE_RESTLET_URL is not configured.");
  }

  const po = poNumber ?? poInternalId;
  if (!po) {
    await deps.markEtaUpdateStatus(etaUpdateId, "needs_review");
    throw new NonRetryableActionError("PO number is required for eta_update execution.");
  }

  logger.info("eta_update.netsuite_update.request", {
    po,
    etaDate,
    etaConfidence,
    hasTracking: Boolean(trackingNumber),
    itemCount: items.length
  });

  const response = await deps.updatePurchaseOrderEta({
    po,
    etaDate,
    etaConfidence,
    trackingNumber: trackingNumber ?? null,
    etaSource,
    etaNotes,
    updateOwner: "JanveyOS",
    items: items
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)))
      .map((item) => ({
        item: pickString(item.item),
        itemInternalId: pickString(item.itemInternalId ?? item.item_internal_id),
        etaDate: pickString(item.etaDate ?? item.eta_date),
        trackingNumber: pickString(item.trackingNumber ?? item.tracking_number),
        confidence: pickString(item.confidence),
        notes: pickString(item.notes)
      }))
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
    poNumber: response.poNumber ?? poNumber ?? po ?? null,
    etaDate,
    etaConfidence,
    etaSource,
    trackingNumber: trackingNumber ?? null,
    linesUpdated: response.linesUpdated ?? response.updatedLineCount ?? null,
    updatedLineCount: response.updatedLineCount ?? response.linesUpdated ?? null,
    netsuiteResponse: response
  };
}
