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
