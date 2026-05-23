import assert from "node:assert/strict";
import test from "node:test";
import { config } from "../../../shared/config.js";
import {
  buildQuoteToSoApprovalBlocks,
  handleQuoteToSoApprovalAction,
  parseApproverSlackUserIds
} from "./quote-to-so-approval.js";

function baseDeps(overrides: Record<string, unknown> = {}) {
  return {
    isAuthorizedApprover: () => true,
    getAgentActionRequestById: async () => ({ id: "req-1", status: "pending", input_json: { slack_channel_id: "C1", quote_tranid: "EST7883" } }) as any,
    approveAgentActionRequest: async () => ({ id: "req-1" }) as any,
    cancelAgentActionRequest: async () => ({ id: "req-1" }) as any,
    rejectAgentActionRequest: async () => ({ id: "req-1" }) as any,
    claimApprovedActionRequest: async () => ({ id: "req-1", action_type: "quote_to_so", input_json: { slack_channel_id: "C1", quote_tranid: "EST7883" }, retry_count: 0 }) as any,
    executeClaimedActionRequest: async () => ({ ok: true, result: { mode: "live", wouldSubmit: true, target: { tranId: "SO1", internalId: "1001" } } }) as any,
    markActionAttemptFailed: async () => undefined,
    postSlackMessage: async () => undefined,
    updateSlackMessage: async () => undefined,
    ...overrides
  };
}

test("parseApproverSlackUserIds parses comma-separated values", () => {
  assert.deepEqual(parseApproverSlackUserIds("U1, U2 ,,U3"), ["U1", "U2", "U3"]);
});

test("authorized pending approval transitions to running/executed path", async () => {
  let approveCalls = 0;
  let claimCalls = 0;
  let executeCalls = 0;

  const result = await handleQuoteToSoApprovalAction(
    {
      actionId: "quote_to_so_approve_request",
      actorSlackUserId: "U-ADMIN",
      value: JSON.stringify({ actionRequestId: "req-1" })
    },
    baseDeps({
      approveAgentActionRequest: async () => {
        approveCalls += 1;
        return { id: "req-1" } as any;
      },
      claimApprovedActionRequest: async () => {
        claimCalls += 1;
        return { id: "req-1", action_type: "quote_to_so", input_json: { slack_channel_id: "C1", quote_tranid: "EST7883" }, retry_count: 0 } as any;
      },
      executeClaimedActionRequest: async () => {
        executeCalls += 1;
        return { ok: true, result: { mode: "live", wouldSubmit: true, target: { tranId: "SO1", internalId: "1001" } } } as any;
      }
    })
  );

  assert.equal(result.kind, "ok");
  assert.equal(approveCalls, 1);
  assert.equal(claimCalls, 1);
  assert.equal(executeCalls, 1);
  assert.match(result.message, /Approved\. Creating Sales Order/i);
});

test("unauthorized approver is blocked", async () => {
  const result = await handleQuoteToSoApprovalAction(
    {
      actionId: "quote_to_so_approve_request",
      actorSlackUserId: "U-NOPE",
      value: JSON.stringify({ actionRequestId: "req-1" })
    },
    baseDeps({
      isAuthorizedApprover: () => false
    })
  );

  assert.equal(result.kind, "unauthorized");
  assert.match(result.message, /not authorized/i);
});

test("already-executed request cannot be approved again", async () => {
  let executeCalls = 0;
  const result = await handleQuoteToSoApprovalAction(
    {
      actionId: "quote_to_so_approve_request",
      actorSlackUserId: "U-ADMIN",
      value: JSON.stringify({ actionRequestId: "req-1" })
    },
    baseDeps({
      getAgentActionRequestById: async () =>
        ({ id: "req-1", status: "executed", output_json: { target: { tranId: "SO307999" } } }) as any,
      executeClaimedActionRequest: async () => {
        executeCalls += 1;
        return { ok: true, result: {} } as any;
      }
    })
  );

  assert.equal(result.kind, "ok");
  assert.equal(executeCalls, 0);
  assert.match(result.message, /already executed/i);
});

test("NetSuite/worker failure transitions to failed response path", async () => {
  let posted = "";
  await handleQuoteToSoApprovalAction(
    {
      actionId: "quote_to_so_approve_request",
      actorSlackUserId: "U-ADMIN",
      value: JSON.stringify({ actionRequestId: "req-1" })
    },
    baseDeps({
      executeClaimedActionRequest: async () => ({ ok: false, errorMessage: "NetSuite quote_to_so transform business error: TRANSFORM_FAILED." }) as any,
      postSlackMessage: async (payload: { text: string }) => {
        posted = payload.text;
      }
    })
  );

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.match(posted, /Quote-to-Sales-Order failed/i);
});

test("live disabled path does not call NetSuite completion and posts non-live message", async () => {
  let posted = "";
  await handleQuoteToSoApprovalAction(
    {
      actionId: "quote_to_so_approve_request",
      actorSlackUserId: "U-ADMIN",
      value: JSON.stringify({ actionRequestId: "req-1" })
    },
    baseDeps({
      executeClaimedActionRequest: async () =>
        ({
          ok: true,
          result: {
            mode: "dry_run",
            wouldSubmit: false
          }
        }) as any,
      postSlackMessage: async (payload: { text: string }) => {
        posted = payload.text;
      }
    })
  );

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.match(posted, /live execution is disabled/i);
});

test("approval message updated after reject/cancel", async () => {
  let updatedCount = 0;

  await handleQuoteToSoApprovalAction(
    {
      actionId: "quote_to_so_reject_request",
      actorSlackUserId: "U-ADMIN",
      slackChannelId: "C1",
      slackMessageTs: "123.456",
      value: JSON.stringify({ actionRequestId: "req-1", quoteTranId: "EST7883" })
    },
    baseDeps({
      updateSlackMessage: async () => {
        updatedCount += 1;
      }
    })
  );

  await handleQuoteToSoApprovalAction(
    {
      actionId: "quote_to_so_cancel_request",
      actorSlackUserId: "U-ADMIN",
      slackChannelId: "C1",
      slackMessageTs: "123.456",
      value: JSON.stringify({ actionRequestId: "req-1", quoteTranId: "EST7883" })
    },
    baseDeps({
      updateSlackMessage: async () => {
        updatedCount += 1;
      }
    })
  );

  assert.equal(updatedCount, 2);
});

test("final success includes SO link when NETSUITE_ACCOUNT_BASE_URL present", async () => {
  const originalBaseUrl = config.NETSUITE_ACCOUNT_BASE_URL;
  (config as Record<string, unknown>).NETSUITE_ACCOUNT_BASE_URL = "https://acct.app.netsuite.com";
  let posted = "";
  try {
    await handleQuoteToSoApprovalAction(
      {
        actionId: "quote_to_so_approve_request",
        actorSlackUserId: "U-ADMIN",
        slackChannelId: "C1",
        slackMessageTs: "123.456",
        value: JSON.stringify({ actionRequestId: "req-1", quoteTranId: "EST7883" })
      },
      baseDeps({
        postSlackMessage: async (payload: { text: string }) => {
          posted = payload.text;
        }
      })
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.match(posted, /Open Sales Order:/i);
  } finally {
    (config as Record<string, unknown>).NETSUITE_ACCOUNT_BASE_URL = originalBaseUrl;
  }
});

test("final success still works without NETSUITE_ACCOUNT_BASE_URL", async () => {
  const originalBaseUrl = config.NETSUITE_ACCOUNT_BASE_URL;
  (config as Record<string, unknown>).NETSUITE_ACCOUNT_BASE_URL = "";
  let posted = "";
  try {
    await handleQuoteToSoApprovalAction(
      {
        actionId: "quote_to_so_approve_request",
        actorSlackUserId: "U-ADMIN",
        slackChannelId: "C1",
        slackMessageTs: "123.456",
        value: JSON.stringify({ actionRequestId: "req-1", quoteTranId: "EST7883" })
      },
      baseDeps({
        postSlackMessage: async (payload: { text: string }) => {
          posted = payload.text;
        }
      })
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.match(posted, /Sales Order Internal ID:/i);
  } finally {
    (config as Record<string, unknown>).NETSUITE_ACCOUNT_BASE_URL = originalBaseUrl;
  }
});

test("failure message formatting includes request and next step", async () => {
  let posted = "";
  await handleQuoteToSoApprovalAction(
    {
      actionId: "quote_to_so_approve_request",
      actorSlackUserId: "U-ADMIN",
      slackChannelId: "C1",
      slackMessageTs: "123.456",
      value: JSON.stringify({ actionRequestId: "req-1", quoteTranId: "EST7883" })
    },
    baseDeps({
      executeClaimedActionRequest: async () => ({ ok: false, errorMessage: "safe failure" }) as any,
      postSlackMessage: async (payload: { text: string }) => {
        posted = payload.text;
      }
    })
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.match(posted, /Request: req-1/i);
  assert.match(posted, /safe failure/i);
  assert.match(posted, /Review logs or retry from dashboard/i);
});

test("reject/cancel only work from pending", async () => {
  let rejectCalls = 0;
  let cancelCalls = 0;

  const rejectResult = await handleQuoteToSoApprovalAction(
    {
      actionId: "quote_to_so_reject_request",
      actorSlackUserId: "U-ADMIN",
      value: JSON.stringify({ actionRequestId: "req-1" })
    },
    baseDeps({
      rejectAgentActionRequest: async () => {
        rejectCalls += 1;
        return { id: "req-1" } as any;
      }
    })
  );

  const cancelResult = await handleQuoteToSoApprovalAction(
    {
      actionId: "quote_to_so_cancel_request",
      actorSlackUserId: "U-ADMIN",
      value: JSON.stringify({ actionRequestId: "req-1" })
    },
    baseDeps({
      cancelAgentActionRequest: async () => {
        cancelCalls += 1;
        return { id: "req-1" } as any;
      }
    })
  );

  assert.equal(rejectCalls, 1);
  assert.equal(cancelCalls, 1);
  assert.match(rejectResult.message, /Rejected request/i);
  assert.match(cancelResult.message, /Cancelled request/i);
});

test("non-pending request does not execute", async () => {
  let executeCalls = 0;
  const result = await handleQuoteToSoApprovalAction(
    {
      actionId: "quote_to_so_approve_request",
      actorSlackUserId: "U-ADMIN",
      value: JSON.stringify({ actionRequestId: "req-1" })
    },
    baseDeps({
      getAgentActionRequestById: async () => ({ id: "req-1", status: "running" }) as any,
      executeClaimedActionRequest: async () => {
        executeCalls += 1;
        return { ok: true, result: {} } as any;
      }
    })
  );

  assert.equal(executeCalls, 0);
  assert.match(result.message, /already running/i);
});

test("cancelled request cannot be approved again", async () => {
  let executeCalls = 0;
  const result = await handleQuoteToSoApprovalAction(
    {
      actionId: "quote_to_so_approve_request",
      actorSlackUserId: "U-ADMIN",
      value: JSON.stringify({ actionRequestId: "req-1" })
    },
    baseDeps({
      getAgentActionRequestById: async () => ({ id: "req-1", status: "cancelled" }) as any,
      executeClaimedActionRequest: async () => {
        executeCalls += 1;
        return { ok: true, result: {} } as any;
      }
    })
  );

  assert.equal(executeCalls, 0);
  assert.match(result.message, /already cancelled/i);
});

test("approval/execution code does not use completed as action request status", async () => {
  const { readFile } = await import("node:fs/promises");
  const files = [
    "src/domain/services/slack/quote-to-so-approval.ts",
    "src/domain/repositories/agent-worker-repository.ts",
    "src/domain/services/action-execution-worker.ts"
  ];

  for (const file of files) {
    const content = await readFile(file, "utf8");
    assert.doesNotMatch(content, /\.eq\(\s*["']status["']\s*,\s*["']completed["']\s*\)/i);
    assert.doesNotMatch(content, /\.update\(\s*\{[^}]*status:\s*["']completed["']/is);
  }
});

test("approval message buttons include expected action ids", () => {
  const blocks = buildQuoteToSoApprovalBlocks({
    actionRequestId: "req-123",
    quoteTranId: "EST7883",
    quoteInternalId: "173626",
    customerName: "Test Ecommerce",
    poSource: "user_supplied",
    poNumber: "PO12345",
    requestedBySlackUserId: "U1"
  });

  const actionsBlock = blocks.find((b) => b.type === "actions") as { elements?: Array<Record<string, unknown>> } | undefined;
  assert.ok(actionsBlock);
  const actionIds = (actionsBlock?.elements ?? []).map((x) => String(x.action_id));
  assert.deepEqual(actionIds, ["quote_to_so_approve_request", "quote_to_so_reject_request", "quote_to_so_cancel_request"]);
});
