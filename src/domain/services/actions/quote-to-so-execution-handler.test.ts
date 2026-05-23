import test from "node:test";
import assert from "node:assert/strict";
import { config } from "../../../shared/config.js";
import { runQuoteToSoDryRunHandler } from "./quote-to-so-execution-handler.js";

const baseInput = {
  quote_internal_id: "173626",
  quote_tranid: "EST7883",
  approval_status_target: "Pending Approval",
  agent_action_request_id: "8f6d8091-07f0-4331-93b6-f5030d8e4ec8"
};

function withLiveEnabled() {
  const previousMode = config.NETSUITE_EXECUTION_MODE;
  const previousEnabled = config.NETSUITE_LIVE_QUOTE_TO_SO_ENABLED;
  config.NETSUITE_EXECUTION_MODE = "live";
  config.NETSUITE_LIVE_QUOTE_TO_SO_ENABLED = "true";
  return () => {
    config.NETSUITE_EXECUTION_MODE = previousMode;
    config.NETSUITE_LIVE_QUOTE_TO_SO_ENABLED = previousEnabled;
  };
}

test("first execution creates running state and calls NetSuite once", async () => {
  const restore = withLiveEnabled();
  let transformCalls = 0;
  let completeCalls = 0;

  try {
    const result = await runQuoteToSoDryRunHandler(baseInput, {
      buildIdempotencyKey: () => "quote_to_so:173626",
      startExecution: async () => ({ ok: true, executionId: "exec-1", status: "started" }),
      completeExecution: async () => {
        completeCalls += 1;
      },
      failExecution: async () => undefined,
      transform: async () => {
        transformCalls += 1;
        return {
          success: true,
          operation: "transform_quote_to_sales_order",
          source: { fromType: "estimate", fromId: "173626" },
          target: { toType: "salesorder", internalId: "221", tranId: "SO221" },
          orderStatus: "Pending Approval",
          orderStatusValue: "A",
          safety: { autoApprove: false, autoFulfill: false, autoBill: false }
        };
      }
    });

    assert.equal(transformCalls, 1);
    assert.equal(completeCalls, 1);
    assert.equal(result.mode, "live");
    assert.equal(result.wouldSubmit, true);
    assert.equal(result.target.internalId, "221");
    assert.equal(result.target.tranId, "SO221");
  } finally {
    restore();
  }
});

test("completed execution blocks duplicate NetSuite call and returns existing SO info", async () => {
  const restore = withLiveEnabled();
  let transformCalls = 0;

  try {
    const result = await runQuoteToSoDryRunHandler(baseInput, {
      buildIdempotencyKey: () => "quote_to_so:173626",
      startExecution: async () => ({
        ok: false,
        status: "already_completed",
        salesOrderInternalId: "221",
        salesOrderTranId: "SO221"
      }),
      completeExecution: async () => undefined,
      failExecution: async () => undefined,
      transform: async () => {
        transformCalls += 1;
        throw new Error("should not execute");
      }
    });

    assert.equal(transformCalls, 0);
    assert.equal(result.wouldSubmit, false);
    assert.equal(result.target.internalId, "221");
    assert.equal(result.target.tranId, "SO221");
  } finally {
    restore();
  }
});

test("running execution blocks duplicate NetSuite call", async () => {
  const restore = withLiveEnabled();
  let transformCalls = 0;

  try {
    const result = await runQuoteToSoDryRunHandler(baseInput, {
      buildIdempotencyKey: () => "quote_to_so:173626",
      startExecution: async () => ({
        ok: false,
        status: "already_running",
        executionId: "exec-running"
      }),
      completeExecution: async () => undefined,
      failExecution: async () => undefined,
      transform: async () => {
        transformCalls += 1;
        throw new Error("should not execute");
      }
    });

    assert.equal(transformCalls, 0);
    assert.equal(result.wouldSubmit, false);
    assert.equal(result.deduplication?.executionStatus, "already_running");
  } finally {
    restore();
  }
});

test("failed transform records error via failExecution", async () => {
  const restore = withLiveEnabled();
  let failCalls = 0;
  const expected = new Error("TRANSFORM_FAILED");

  try {
    await assert.rejects(
      runQuoteToSoDryRunHandler(baseInput, {
        buildIdempotencyKey: () => "quote_to_so:173626",
        startExecution: async () => ({ ok: true, executionId: "exec-1", status: "started" }),
        completeExecution: async () => undefined,
        failExecution: async ({ error }) => {
          failCalls += 1;
          assert.equal(error, expected);
        },
        transform: async () => {
          throw expected;
        }
      }),
      /TRANSFORM_FAILED/
    );
    assert.equal(failCalls, 1);
  } finally {
    restore();
  }
});

test("retry after failed can restart without duplicate NetSuite rows", async () => {
  const restore = withLiveEnabled();
  let transformCalls = 0;

  try {
    const result = await runQuoteToSoDryRunHandler(baseInput, {
      buildIdempotencyKey: () => "quote_to_so:173626",
      startExecution: async () => ({ ok: true, executionId: "exec-restarted", status: "started" }),
      completeExecution: async () => undefined,
      failExecution: async () => undefined,
      transform: async () => {
        transformCalls += 1;
        return {
          success: true,
          operation: "transform_quote_to_sales_order",
          source: { fromType: "estimate", fromId: "173626" },
          target: { toType: "salesorder", internalId: "333", tranId: "SO333" },
          orderStatus: "Pending Approval",
          orderStatusValue: "A",
          safety: { autoApprove: false, autoFulfill: false, autoBill: false }
        };
      }
    });

    assert.equal(transformCalls, 1);
    assert.equal(result.target.tranId, "SO333");
  } finally {
    restore();
  }
});
