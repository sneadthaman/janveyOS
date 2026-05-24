import test from "node:test";
import assert from "node:assert/strict";
import { config } from "../../shared/config.js";
import { updatePurchaseOrderEta } from "./client.js";

test("missing PO ETA RESTlet URL fails safely", async () => {
  const prev = config.NETSUITE_PO_ETA_UPDATE_RESTLET_URL;
  config.NETSUITE_PO_ETA_UPDATE_RESTLET_URL = undefined;
  try {
    const result = await updatePurchaseOrderEta({ po: "PO289731", etaDate: "2026-05-29" });
    assert.equal(result.success, false);
    assert.equal(result.code, "CONFIG_ERROR");
  } finally {
    config.NETSUITE_PO_ETA_UPDATE_RESTLET_URL = prev;
  }
});

test("PO ETA update normalizes successful response", async () => {
  const prev = config.NETSUITE_PO_ETA_UPDATE_RESTLET_URL;
  const originalFetch = globalThis.fetch;
  config.NETSUITE_PO_ETA_UPDATE_RESTLET_URL = "https://example.com/po-eta-update";

  globalThis.fetch = (async () =>
    ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: true, poNumber: "PO289731", poInternalId: "9001", linesUpdated: 2 })
    }) as Response) as typeof fetch;

  try {
    const result = await updatePurchaseOrderEta({ po: "PO289731", etaDate: "2026-05-29" });
    assert.equal(result.success, true);
    assert.equal(result.poNumber, "PO289731");
    assert.equal(result.poInternalId, "9001");
    assert.equal(result.linesUpdated, 2);
  } finally {
    config.NETSUITE_PO_ETA_UPDATE_RESTLET_URL = prev;
    globalThis.fetch = originalFetch;
  }
});

test("PO ETA update normalizes status/data schema response", async () => {
  const prev = config.NETSUITE_PO_ETA_UPDATE_RESTLET_URL;
  const originalFetch = globalThis.fetch;
  config.NETSUITE_PO_ETA_UPDATE_RESTLET_URL = "https://example.com/po-eta-update";

  globalThis.fetch = (async () =>
    ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          status: true,
          message: "PO ETA update completed",
          data: {
            updatedLineCount: 1,
            updates: [{ line: 1 }]
          }
        })
    }) as Response) as typeof fetch;

  try {
    const result = await updatePurchaseOrderEta({ po: "PO289807", etaDate: "2026-05-29" });
    assert.equal(result.success, true);
    assert.equal(result.message, "PO ETA update completed");
    assert.equal(result.updatedLineCount, 1);
    assert.equal(result.linesUpdated, 1);
    assert.deepEqual(result.updates, [{ line: 1 }]);
    assert.equal(typeof result.data, "object");
  } finally {
    config.NETSUITE_PO_ETA_UPDATE_RESTLET_URL = prev;
    globalThis.fetch = originalFetch;
  }
});
