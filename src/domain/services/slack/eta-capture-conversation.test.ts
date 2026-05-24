import test from "node:test";
import assert from "node:assert/strict";
import { handleEtaSlackCapture } from "./eta-capture-conversation.js";

test("captures and saves manual ETA update from Slack", async () => {
  const replies: string[] = [];
  let createInput: Record<string, unknown> | null = null;

  const handled = await handleEtaSlackCapture(
    {
      text: "Diversey PO289731 tracking PRO123 ETA 5/29",
      slackChannelId: "C123",
      slackMessageTs: "1710000.123",
      reply: async (message) => {
        replies.push(message);
      }
    },
    {
      createEtaUpdate: async (input) => {
        createInput = input as unknown as Record<string, unknown>;
        return {
          id: "eta-1",
          vendorName: input.vendorName,
          poNumber: input.poNumber ?? null,
          netsuitePoInternalId: null,
          itemNumber: null,
          netsuiteItemInternalId: null,
          etaDate: input.etaDate ?? null,
          trackingNumber: input.trackingNumber ?? null,
          updateScope: input.updateScope ?? "unknown",
          sourceType: "slack",
          sourceReference: input.sourceReference ?? null,
          rawNotes: input.rawNotes ?? null,
          confidence: input.confidence ?? null,
          status: "parsed",
          createdActionRequestId: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
      },
      attachActionRequestToEtaUpdate: async () => undefined,
      createAgentActionRequest: async () => "req-eta-1",
      findLatestEtaUpdateActionRequestByEtaId: async () => null,
      notifyEtaUpdateApprovalRequested: async () => undefined,
      now: () => new Date("2026-05-24T12:00:00Z")
    }
  );

  assert.equal(handled, true);
  assert.ok(createInput);
  assert.equal(createInput?.["sourceType"], "slack");
  assert.equal(createInput?.["poNumber"], "PO289731");
  assert.equal(createInput?.["sourceReference"], "C123:1710000.123");
  assert.match(replies[0] ?? "", /Saved ETA update:/);
  assert.match(replies[0] ?? "", /Status: parsed/);
});

test("non-ETA text is ignored and does not save", async () => {
  let called = false;
  const replies: string[] = [];

  const handled = await handleEtaSlackCapture(
    {
      text: "what's the ETA on PO289731",
      reply: async (message) => {
        replies.push(message);
      }
    },
    {
      createEtaUpdate: async () => {
        called = true;
        throw new Error("should not be called");
      },
      attachActionRequestToEtaUpdate: async () => undefined,
      createAgentActionRequest: async () => "req-eta-2",
      findLatestEtaUpdateActionRequestByEtaId: async () => null,
      notifyEtaUpdateApprovalRequested: async () => undefined,
      now: () => new Date("2026-05-24T12:00:00Z")
    }
  );

  assert.equal(handled, false);
  assert.equal(called, false);
  assert.equal(replies.length, 0);
});

test("starts manual flow from update eta command and asks for date", async () => {
  const replies: string[] = [];

  const handled = await handleEtaSlackCapture(
    {
      text: "Update ETA PO123456",
      slackUserId: "U1",
      slackChannelId: "C1",
      slackMessageTs: "1000.1",
      reply: async (message) => {
        replies.push(message);
      }
    },
    {
      createEtaUpdate: async () => {
        throw new Error("should not create yet");
      },
      attachActionRequestToEtaUpdate: async () => undefined,
      createAgentActionRequest: async () => "req-1",
      findLatestEtaUpdateActionRequestByEtaId: async () => null,
      notifyEtaUpdateApprovalRequested: async () => undefined,
      now: () => new Date("2026-05-24T12:00:00Z")
    }
  );

  assert.equal(handled, true);
  assert.match(replies[0] ?? "", /What is the ETA date/i);
});

test("manual flow rejects invalid date then accepts valid date", async () => {
  const replies: string[] = [];

  const deps = {
    createEtaUpdate: async () => {
      throw new Error("should not create yet");
    },
    attachActionRequestToEtaUpdate: async () => undefined,
    createAgentActionRequest: async () => "req-2",
    findLatestEtaUpdateActionRequestByEtaId: async () => null,
    notifyEtaUpdateApprovalRequested: async () => undefined,
    now: () => new Date("2026-05-24T12:00:00Z")
  };

  await handleEtaSlackCapture(
    {
      text: "Update ETA for PO123456",
      slackUserId: "U2",
      slackChannelId: "C2",
      slackMessageTs: "2000.1",
      reply: async (message) => {
        replies.push(message);
      }
    },
    deps
  );

  await handleEtaSlackCapture(
    {
      text: "tomorrow-ish",
      slackUserId: "U2",
      slackChannelId: "C2",
      slackMessageTs: "2000.2",
      reply: async (message) => {
        replies.push(message);
      }
    },
    deps
  );
  await handleEtaSlackCapture(
    {
      text: "5/29",
      slackUserId: "U2",
      slackChannelId: "C2",
      slackMessageTs: "2000.3",
      reply: async (message) => {
        replies.push(message);
      }
    },
    deps
  );

  assert.match(replies[1] ?? "", /Please provide a valid ETA date/i);
  assert.match(replies[2] ?? "", /Tracking number/i);
});

test("manual flow accepts skip tracking and notes and creates approval payload with HIGH confidence and owner", async () => {
  const replies: string[] = [];
  const createdActionInputs: Array<Record<string, unknown>> = [];
  let notifyCalled = 0;

  const deps = {
    createEtaUpdate: async (input: Record<string, unknown>) => {
      return {
        id: "eta-manual-1",
        vendorName: String(input.vendorName ?? ""),
        poNumber: String(input.poNumber ?? ""),
        netsuitePoInternalId: null,
        itemNumber: null,
        netsuiteItemInternalId: null,
        etaDate: String(input.etaDate ?? ""),
        trackingNumber: null,
        updateScope: "po_all_lines" as const,
        sourceType: "slack" as const,
        sourceReference: "C3:3000.1",
        rawNotes: String(input.rawNotes ?? ""),
        confidence: Number(input.confidence ?? 0),
        status: "parsed" as const,
        createdActionRequestId: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
    },
    attachActionRequestToEtaUpdate: async () => undefined,
    createAgentActionRequest: async (input: Record<string, unknown>) => {
      createdActionInputs.push(input);
      return "req-manual-1";
    },
    findLatestEtaUpdateActionRequestByEtaId: async () => null,
    notifyEtaUpdateApprovalRequested: async () => {
      notifyCalled += 1;
    },
    now: () => new Date("2026-05-24T12:00:00Z")
  };

  await handleEtaSlackCapture(
    {
      text: "Update ETA PO123456",
      slackUserId: "U3",
      slackChannelId: "C3",
      slackMessageTs: "3000.1",
      reply: async (message) => {
        replies.push(message);
      }
    },
    deps
  );
  await handleEtaSlackCapture(
    {
      text: "2026-05-29",
      slackUserId: "U3",
      slackChannelId: "C3",
      slackMessageTs: "3000.2",
      reply: async (message) => {
        replies.push(message);
      }
    },
    deps
  );
  await handleEtaSlackCapture(
    {
      text: "skip",
      slackUserId: "U3",
      slackChannelId: "C3",
      slackMessageTs: "3000.3",
      reply: async (message) => {
        replies.push(message);
      }
    },
    deps
  );
  await handleEtaSlackCapture(
    {
      text: "none",
      slackUserId: "U3",
      slackChannelId: "C3",
      slackMessageTs: "3000.4",
      reply: async (message) => {
        replies.push(message);
      }
    },
    deps
  );

  assert.equal(createdActionInputs.length, 1);
  const created = createdActionInputs[0];
  const inputJson = created["inputJson"] as Record<string, unknown>;
  assert.equal(inputJson["po_number"], "PO123456");
  assert.equal(inputJson["eta_date"], "2026-05-29");
  assert.equal(inputJson["extraction_confidence"], "HIGH");
  assert.equal(inputJson["eta_source"], "manual_slack");
  assert.equal(inputJson["eta_update_owner"], "U3");
  assert.equal(notifyCalled, 1);
  assert.match(replies.at(-1) ?? "", /Approval request/i);
});

test("manual flow cancel works", async () => {
  const replies: string[] = [];

  const deps = {
    createEtaUpdate: async () => {
      throw new Error("should not create");
    },
    attachActionRequestToEtaUpdate: async () => undefined,
    createAgentActionRequest: async () => "req-cancel",
    findLatestEtaUpdateActionRequestByEtaId: async () => null,
    notifyEtaUpdateApprovalRequested: async () => undefined,
    now: () => new Date("2026-05-24T12:00:00Z")
  };

  await handleEtaSlackCapture(
    {
      text: "update eta for po999999",
      slackUserId: "U4",
      slackChannelId: "C4",
      slackMessageTs: "4000.1",
      reply: async (message) => {
        replies.push(message);
      }
    },
    deps
  );
  const handled = await handleEtaSlackCapture(
    {
      text: "cancel",
      slackUserId: "U4",
      slackChannelId: "C4",
      slackMessageTs: "4000.2",
      reply: async (message) => {
        replies.push(message);
      }
    },
    deps
  );

  assert.equal(handled, true);
  assert.match(replies.at(-1) ?? "", /Canceled manual ETA update/i);
});
