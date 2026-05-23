import assert from "node:assert/strict";
import test from "node:test";
import {
  ACTION_REQUEST_STATUSES,
  TERMINAL_ACTION_REQUEST_STATUSES,
  canExecuteActionRequest,
  isTerminalActionRequestStatus
} from "./action-request-status.js";

test("canonical action request statuses include executed and exclude completed", () => {
  assert.ok(ACTION_REQUEST_STATUSES.includes("executed"));
  assert.ok(!ACTION_REQUEST_STATUSES.includes("completed" as never));
});

test("terminal action request statuses include executed/failed/rejected/cancelled", () => {
  assert.deepEqual(TERMINAL_ACTION_REQUEST_STATUSES, ["executed", "failed", "rejected", "cancelled"]);
  assert.equal(isTerminalActionRequestStatus("executed"), true);
  assert.equal(isTerminalActionRequestStatus("running"), false);
});

test("canExecuteActionRequest only allows pending", () => {
  assert.equal(canExecuteActionRequest("pending"), true);
  assert.equal(canExecuteActionRequest("approved"), false);
  assert.equal(canExecuteActionRequest("running"), false);
  assert.equal(canExecuteActionRequest("executed"), false);
  assert.equal(canExecuteActionRequest("failed"), false);
  assert.equal(canExecuteActionRequest("rejected"), false);
  assert.equal(canExecuteActionRequest("cancelled"), false);
});
