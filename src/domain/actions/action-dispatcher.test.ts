import test from "node:test";
import assert from "node:assert/strict";
import { dispatchActionExecution } from "./action-dispatcher.js";
import { config } from "../../shared/config.js";

test("dispatcher routes quote_to_so safely", async () => {
  const prevMode = config.NETSUITE_EXECUTION_MODE;
  try {
    config.NETSUITE_EXECUTION_MODE = "dry_run";
    const result = await dispatchActionExecution({
      actionType: "quote_to_so",
      actionRequestId: "req-1",
      payload: {
        quote_internal_id: "173626"
      }
    });
    assert.equal(result.handler, "quote_to_so_execute");
    assert.equal(result.result.operation, "transform_quote_to_sales_order");
  } finally {
    config.NETSUITE_EXECUTION_MODE = prevMode;
  }
});

test("dispatcher returns unsupported_action for unknown action type", async () => {
  const result = await dispatchActionExecution({
    actionType: "totally_unknown_action",
    payload: {}
  });

  assert.equal(result.handler, "handler_totally_unknown_action");
  assert.equal(result.result.code, "unsupported_action");
  assert.match(String(result.result.message), /Unsupported action_type/i);
});

test("dispatcher routes eta_update correctly", async () => {
  const prevUrl = config.NETSUITE_PO_ETA_UPDATE_RESTLET_URL;
  const originalFetch = globalThis.fetch;
  config.NETSUITE_PO_ETA_UPDATE_RESTLET_URL = "https://example.com/eta";
  globalThis.fetch = (async () =>
    ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: true, poNumber: "PO289731", linesUpdated: 3 })
    }) as Response) as typeof fetch;

  try {
    const result = await dispatchActionExecution({
      actionType: "eta_update",
      payload: {
        eta_update_id: "eta-1",
        po_number: "PO289731",
        eta_date: "2026-05-29",
        update_scope: "po_all_lines"
      }
    });

    assert.equal(result.handler, "eta_update_execute");
    assert.equal(result.result.operation, "update_purchase_order_eta");
  } finally {
    config.NETSUITE_PO_ETA_UPDATE_RESTLET_URL = prevUrl;
    globalThis.fetch = originalFetch;
  }
});
