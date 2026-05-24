import test from "node:test";
import assert from "node:assert/strict";
import { config } from "../../shared/config.js";
import { lookupOpenPurchaseOrder } from "./client.js";

test("open PO lookup returns config error when URL missing", async () => {
  const prev = config.NETSUITE_OPEN_PO_LOOKUP_RESTLET_URL;
  config.NETSUITE_OPEN_PO_LOOKUP_RESTLET_URL = undefined;
  try {
    const result = await lookupOpenPurchaseOrder({ po: "PO289731" });
    assert.equal(result.success, false);
    assert.equal(result.code, "CONFIG_ERROR");
  } finally {
    config.NETSUITE_OPEN_PO_LOOKUP_RESTLET_URL = prev;
  }
});

test("open PO lookup normalizes success payload", async () => {
  const prev = config.NETSUITE_OPEN_PO_LOOKUP_RESTLET_URL;
  const originalFetch = globalThis.fetch;
  config.NETSUITE_OPEN_PO_LOOKUP_RESTLET_URL = "https://example.com/open-po-lookup";

  globalThis.fetch = (async (_url, init) => {
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
    assert.deepEqual(body, { po: "PO289731" });

    return {
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          success: true,
          poInternalId: "9001",
          tranId: "PO289731",
          vendorName: "ACME",
          status: "Pending Receipt",
          lines: [
            {
              lineId: "10",
              lineUniqueKey: "lk-10",
              itemInternalId: "123",
              itemNumber: "ITEM-ABC",
              description: "Widget",
              quantity: 10,
              quantityReceived: 3,
              quantityRemaining: 7,
              expectedReceiptDate: "2026-06-01",
              isClosed: false
            }
          ]
        })
    } as Response;
  }) as typeof fetch;

  try {
    const result = await lookupOpenPurchaseOrder({ po: "PO289731" });
    assert.equal(result.success, true);
    assert.equal(result.poInternalId, "9001");
    assert.equal(result.tranId, "PO289731");
    assert.equal(result.vendorName, "ACME");
    assert.equal(result.lines.length, 1);
    assert.equal(result.lines[0]?.itemNumber, "ITEM-ABC");
  } finally {
    config.NETSUITE_OPEN_PO_LOOKUP_RESTLET_URL = prev;
    globalThis.fetch = originalFetch;
  }
});

test("open PO lookup normalizes RESTlet status/data schema as success", async () => {
  const prev = config.NETSUITE_OPEN_PO_LOOKUP_RESTLET_URL;
  const originalFetch = globalThis.fetch;
  config.NETSUITE_OPEN_PO_LOOKUP_RESTLET_URL = "https://example.com/open-po-lookup";

  globalThis.fetch = (async () => {
    return {
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          status: true,
          message: "Open PO found",
          data: {
            poInternalId: "9002",
            tranId: "PO289807",
            vendorName: "Diversey",
            status: "Pending Receipt",
            lines: [{ itemNumber: "ITEM-A", quantity: 5 }]
          }
        })
    } as Response;
  }) as typeof fetch;

  try {
    const result = await lookupOpenPurchaseOrder({ po: "PO289807" });
    assert.equal(result.success, true);
    assert.equal(result.poInternalId, "9002");
    assert.equal(result.tranId, "PO289807");
    assert.equal(result.vendorName, "Diversey");
    assert.equal(result.lines.length, 1);
  } finally {
    config.NETSUITE_OPEN_PO_LOOKUP_RESTLET_URL = prev;
    globalThis.fetch = originalFetch;
  }
});

test("open PO lookup handles failure response", async () => {
  const prev = config.NETSUITE_OPEN_PO_LOOKUP_RESTLET_URL;
  const originalFetch = globalThis.fetch;
  config.NETSUITE_OPEN_PO_LOOKUP_RESTLET_URL = "https://example.com/open-po-lookup";

  globalThis.fetch = (async () => {
    return {
      ok: false,
      status: 500,
      text: async () => JSON.stringify({ success: false, code: "LOOKUP_FAILED", message: "RESTlet error" })
    } as Response;
  }) as typeof fetch;

  try {
    const result = await lookupOpenPurchaseOrder({ po: "PO289731" });
    assert.equal(result.success, false);
    assert.equal(result.code, "LOOKUP_FAILED");
  } finally {
    config.NETSUITE_OPEN_PO_LOOKUP_RESTLET_URL = prev;
    globalThis.fetch = originalFetch;
  }
});
