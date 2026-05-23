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
      notifyEtaUpdateApprovalRequested: async () => undefined
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
      notifyEtaUpdateApprovalRequested: async () => undefined
    }
  );

  assert.equal(handled, false);
  assert.equal(called, false);
  assert.equal(replies.length, 0);
});
