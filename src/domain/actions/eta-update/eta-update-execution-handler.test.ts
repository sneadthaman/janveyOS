import test from "node:test";
import assert from "node:assert/strict";
import { config } from "../../../shared/config.js";
import { runEtaUpdateExecutionHandlerWithDeps } from "./eta-update-execution-handler.js";

test("missing RESTlet URL fails safely", async () => {
  const prev = config.NETSUITE_PO_ETA_UPDATE_RESTLET_URL;
  config.NETSUITE_PO_ETA_UPDATE_RESTLET_URL = undefined;
  const statuses: Array<{ id: string; status: string }> = [];

  try {
    await assert.rejects(
      () =>
        runEtaUpdateExecutionHandlerWithDeps(
          {
            eta_update_id: "eta-1",
            po_number: "PO289731",
            eta_date: "2026-05-29",
            update_scope: "po_all_lines"
          },
          {
            updatePurchaseOrderEta: async () => ({ success: true }),
            markEtaUpdateStatus: async (id, status) => {
              statuses.push({ id, status });
            }
          }
        ),
      /NETSUITE_PO_ETA_UPDATE_RESTLET_URL is not configured/
    );
  } finally {
    config.NETSUITE_PO_ETA_UPDATE_RESTLET_URL = prev;
  }

  assert.equal(statuses[0]?.status, "needs_review");
});

test("successful NetSuite response marks eta update applied", async () => {
  const prev = config.NETSUITE_PO_ETA_UPDATE_RESTLET_URL;
  config.NETSUITE_PO_ETA_UPDATE_RESTLET_URL = "https://example.com/eta";
  const statuses: Array<{ id: string; status: string }> = [];

  try {
    const result = await runEtaUpdateExecutionHandlerWithDeps(
      {
        eta_update_id: "eta-2",
        po_number: "PO289731",
        eta_date: "2026-05-29",
        update_scope: "po_all_lines"
      },
      {
        updatePurchaseOrderEta: async () => ({ success: true, poNumber: "PO289731", linesUpdated: 4 }),
        markEtaUpdateStatus: async (id, status) => {
          statuses.push({ id, status });
        }
      }
    );

    assert.equal(result.success, true);
    assert.equal(statuses[0]?.status, "applied");
  } finally {
    config.NETSUITE_PO_ETA_UPDATE_RESTLET_URL = prev;
  }
});

test("approved eta_update execution calls updatePurchaseOrderEta exactly once with deployed payload shape", async () => {
  const prev = config.NETSUITE_PO_ETA_UPDATE_RESTLET_URL;
  config.NETSUITE_PO_ETA_UPDATE_RESTLET_URL = "https://example.com/eta";
  let updateCalls = 0;
  let capturedPayload: Record<string, unknown> | null = null;
  let lookupCalls = 0;

  try {
    const result = await runEtaUpdateExecutionHandlerWithDeps(
      {
        eta_update_id: "eta-4",
        po_number: "PO289807",
        eta_date: "2026-06-03",
        extraction_confidence: "HIGH",
        tracking_number: "PRO123",
        source_type: "email",
        raw_notes: "ETA from vendor email",
        items: [{ item: "ITEM-1", etaDate: "2026-06-03", confidence: "HIGH" }]
      },
      {
        updatePurchaseOrderEta: async (payload) => {
          updateCalls += 1;
          capturedPayload = payload as unknown as Record<string, unknown>;
          return { success: true, poNumber: "PO289807", linesUpdated: 1 };
        },
        markEtaUpdateStatus: async () => {
          lookupCalls += 0;
        }
      }
    );

    assert.equal(result.success, true);
    assert.equal(updateCalls, 1);
    assert.deepEqual(capturedPayload, {
      po: "PO289807",
      etaDate: "2026-06-03",
      etaConfidence: "HIGH",
      trackingNumber: "PRO123",
      etaSource: "email",
      etaNotes: "ETA from vendor email",
      updateOwner: "JanveyOS",
      items: [
        {
          item: "ITEM-1",
          itemInternalId: undefined,
          etaDate: "2026-06-03",
          trackingNumber: undefined,
          confidence: "HIGH",
          notes: undefined
        }
      ]
    });
    assert.equal(lookupCalls, 0);
  } finally {
    config.NETSUITE_PO_ETA_UPDATE_RESTLET_URL = prev;
  }
});

test("failure response does not mark applied", async () => {
  const prev = config.NETSUITE_PO_ETA_UPDATE_RESTLET_URL;
  config.NETSUITE_PO_ETA_UPDATE_RESTLET_URL = "https://example.com/eta";
  const statuses: Array<{ id: string; status: string }> = [];

  try {
    await assert.rejects(
      () =>
        runEtaUpdateExecutionHandlerWithDeps(
          {
            eta_update_id: "eta-3",
            po_number: "PO289731",
            eta_date: "2026-05-29",
            update_scope: "po_all_lines"
          },
          {
            updatePurchaseOrderEta: async () => ({ success: false, code: "VALIDATION_ERROR", message: "bad" }),
            markEtaUpdateStatus: async (id, status) => {
              statuses.push({ id, status });
            }
          }
        ),
      /bad/
    );
  } finally {
    config.NETSUITE_PO_ETA_UPDATE_RESTLET_URL = prev;
  }

  assert.equal(statuses[0]?.status, "needs_review");
  assert.equal(statuses.some((s) => s.status === "applied"), false);
});
