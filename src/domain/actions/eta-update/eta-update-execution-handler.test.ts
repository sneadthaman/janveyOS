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
