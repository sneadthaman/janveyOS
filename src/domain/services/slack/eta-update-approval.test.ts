import test from "node:test";
import assert from "node:assert/strict";
import { config } from "../../../shared/config.js";
import { runEtaUpdateExecutionHandlerWithDeps } from "../../actions/eta-update/eta-update-execution-handler.js";
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

test("slack approval-style execution path calls updatePurchaseOrderEta when env is set", async () => {
  const prevEnv = process.env.NETSUITE_PO_ETA_UPDATE_RESTLET_URL;
  const prevConfig = config.NETSUITE_PO_ETA_UPDATE_RESTLET_URL;
  process.env.NETSUITE_PO_ETA_UPDATE_RESTLET_URL = "https://example.com/po-eta-update";
  config.NETSUITE_PO_ETA_UPDATE_RESTLET_URL = undefined;
  let updateCalls = 0;
  let posted = "";

  try {
    const result = await handleEtaUpdateApprovalAction(
      {
        actionId: "eta_update_approve_request",
        actorSlackUserId: "U-ADMIN",
        value: JSON.stringify({ actionRequestId: "req-eta-1", etaUpdateId: "eta-1", poNumber: "PO289807", etaDate: "2026-06-03" })
      },
      deps({
        claimApprovedActionRequest: async () =>
          ({
            id: "req-eta-1",
            action_type: "eta_update",
            input_json: {
              slack_channel_id: "C1",
              eta_update_id: "eta-1",
              po_number: "PO289807",
              eta_date: "2026-06-03",
              extraction_confidence: "HIGH",
              source_type: "email",
              raw_notes: "from email"
            },
            retry_count: 0
          }) as any,
        executeClaimedActionRequest: async (claimed: { input_json: Record<string, unknown> }) => {
          const runResult = await runEtaUpdateExecutionHandlerWithDeps(claimed.input_json, {
            updatePurchaseOrderEta: async () => {
              updateCalls += 1;
              return { success: true, poNumber: "PO289807", linesUpdated: 1 };
            },
            markEtaUpdateStatus: async () => undefined
          });
          return { ok: true, result: runResult } as any;
        },
        postSlackMessage: async (payload: { text: string }) => {
          posted = payload.text;
        }
      }) as any
    );

    assert.equal(result.kind, "ok");
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(updateCalls, 1);
    assert.match(posted, /ETA update applied/i);
  } finally {
    process.env.NETSUITE_PO_ETA_UPDATE_RESTLET_URL = prevEnv;
    config.NETSUITE_PO_ETA_UPDATE_RESTLET_URL = prevConfig;
  }
});

test("successful approve updates Slack from applying to completed with final details and no buttons", async () => {
  const updates: Array<{ text: string; blocks?: Array<Record<string, unknown>> }> = [];
  await handleEtaUpdateApprovalAction(
    {
      actionId: "eta_update_approve_request",
      actorSlackUserId: "U-ADMIN",
      slackChannelId: "C1",
      slackMessageTs: "123.456",
      value: JSON.stringify({ actionRequestId: "req-eta-1", etaUpdateId: "eta-1", poNumber: "PO289807", etaDate: "2026-06-03" })
    },
    deps({
      executeClaimedActionRequest: async () =>
        ({
          ok: true,
          result: {
            executionStatus: "success",
            poNumber: "PO289807",
            etaDate: "2026-06-03",
            etaConfidence: "HIGH",
            linesUpdated: 2,
            netsuiteResponse: { message: "ETA updated on PO." }
          }
        }) as any,
      updateSlackMessage: async (payload: { text: string; blocks?: Array<Record<string, unknown>> }) => {
        updates.push(payload);
      }
    }) as any
  );

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(updates.length, 2);
  assert.equal(updates[0]?.text, "⏳ Running");
  const finalUpdate = updates[updates.length - 1];
  assert.equal(finalUpdate?.text, "✅ ETA update applied");
  const finalText = String(finalUpdate?.blocks?.[0]?.text && typeof finalUpdate.blocks[0].text === "object" ? (finalUpdate.blocks[0].text as Record<string, unknown>).text : "");
  assert.match(finalText, /ETA update applied/i);
  assert.match(finalText, /PO289807/);
  assert.match(finalText, /2026-06-03/);
  assert.match(finalText, /HIGH/);
  assert.match(finalText, /Updated line count: 2/);
  assert.match(finalText, /ETA updated on PO\./);
  const hasActionsBlock = (finalUpdate?.blocks ?? []).some((b) => b.type === "actions");
  assert.equal(hasActionsBlock, false);
});

test("failed approve updates Slack from applying to failed and shows no NetSuite changes", async () => {
  const updates: Array<{ text: string; blocks?: Array<Record<string, unknown>> }> = [];
  await handleEtaUpdateApprovalAction(
    {
      actionId: "eta_update_approve_request",
      actorSlackUserId: "U-ADMIN",
      slackChannelId: "C1",
      slackMessageTs: "123.456",
      value: JSON.stringify({ actionRequestId: "req-eta-1", etaUpdateId: "eta-1", poNumber: "PO289807", etaDate: "2026-06-03" })
    },
    deps({
      executeClaimedActionRequest: async () => ({ ok: false, errorMessage: "safe eta failure" }) as any,
      updateSlackMessage: async (payload: { text: string; blocks?: Array<Record<string, unknown>> }) => {
        updates.push(payload);
      }
    }) as any
  );

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(updates.length, 2);
  const finalUpdate = updates[updates.length - 1];
  assert.equal(finalUpdate?.text, "❌ ETA update failed");
  const finalText = String(finalUpdate?.blocks?.[0]?.text && typeof finalUpdate.blocks[0].text === "object" ? (finalUpdate.blocks[0].text as Record<string, unknown>).text : "");
  assert.match(finalText, /ETA update failed/i);
  assert.match(finalText, /PO289807/);
  assert.match(finalText, /safe eta failure/);
  assert.match(finalText, /No NetSuite changes were applied/i);
  const hasActionsBlock = (finalUpdate?.blocks ?? []).some((b) => b.type === "actions");
  assert.equal(hasActionsBlock, false);
});
