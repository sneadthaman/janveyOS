import test from "node:test";
import assert from "node:assert/strict";
import { handleEtaUpdateApprovalAction } from "./eta-update-approval.js";

function deps(overrides: Record<string, unknown> = {}) {
  return {
    isAuthorizedApprover: () => true,
    getAgentActionRequestById: async () => ({
      id: "req-eta-1",
      status: "pending",
      input_json: { slack_channel_id: "C1", po_number: "PO289731", eta_date: "2026-05-29" },
      retry_count: 0
    }) as any,
    approveAgentActionRequest: async () => ({ id: "req-eta-1" }) as any,
    cancelAgentActionRequest: async () => ({ id: "req-eta-1" }) as any,
    rejectAgentActionRequest: async () => ({ id: "req-eta-1" }) as any,
    claimApprovedActionRequest: async () => ({
      id: "req-eta-1",
      action_type: "eta_update",
      input_json: { slack_channel_id: "C1", po_number: "PO289731", eta_date: "2026-05-29" },
      retry_count: 0
    }) as any,
    executeClaimedActionRequest: async () => ({ ok: true, result: { poNumber: "PO289731", etaDate: "2026-05-29" } }) as any,
    markActionAttemptFailed: async () => undefined,
    postSlackMessage: async () => undefined,
    updateSlackMessage: async () => undefined,
    ...overrides
  };
}

test("unauthorized approver is blocked", async () => {
  const result = await handleEtaUpdateApprovalAction(
    {
      actionId: "eta_update_approve_request",
      actorSlackUserId: "U-NO",
      value: JSON.stringify({ actionRequestId: "req-eta-1", etaUpdateId: "eta-1" })
    },
    deps({ isAuthorizedApprover: () => false }) as any
  );

  assert.equal(result.kind, "unauthorized");
});

test("duplicate approval blocked when already executed", async () => {
  let executeCalls = 0;
  const result = await handleEtaUpdateApprovalAction(
    {
      actionId: "eta_update_approve_request",
      actorSlackUserId: "U-ADMIN",
      value: JSON.stringify({ actionRequestId: "req-eta-1", etaUpdateId: "eta-1" })
    },
    deps({
      getAgentActionRequestById: async () => ({ id: "req-eta-1", status: "executed", retry_count: 0 }) as any,
      executeClaimedActionRequest: async () => {
        executeCalls += 1;
        return { ok: true } as any;
      }
    }) as any
  );

  assert.equal(result.kind, "ok");
  assert.equal(executeCalls, 0);
  assert.match(result.message, /already executed/i);
});
