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
      resolveSlackUserDisplayName: async (slackUserId: string) => slackUserId,
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
      resolveSlackUserDisplayName: async (slackUserId: string) => slackUserId,
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
      resolveSlackUserDisplayName: async (slackUserId: string) => slackUserId,
      now: () => new Date("2026-05-24T12:00:00Z")
    }
  );

  assert.equal(handled, true);
  assert.match(replies[0] ?? "", /What ETA date should I use for PO123456\?/i);
  assert.match(replies[0] ?? "", /Type `exit` anytime to cancel/i);
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
    resolveSlackUserDisplayName: async (slackUserId: string) => slackUserId,
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
  assert.match(replies[2] ?? "", /Optional: send tracking number/i);
  assert.match(replies[2] ?? "", /Type `exit` anytime to cancel/i);
});

test("manual flow uses resolved real_name as ETA Update Owner", async () => {
  const replies: string[] = [];
  const createdActionInputs: Array<Record<string, unknown>> = [];
  let notifyCalled = 0;
  let notifiedOwner: string | null = null;

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
    notifyEtaUpdateApprovalRequested: async (input: { etaUpdateOwner?: string | null }) => {
      notifyCalled += 1;
      notifiedOwner = input.etaUpdateOwner ?? null;
    },
    resolveSlackUserDisplayName: async () => "Sam Janvey",
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
  assert.equal(inputJson["eta_update_owner"], "Sam Janvey");
  assert.equal(inputJson["eta_update_owner_slack_user_id"], "U3");
  assert.equal(notifiedOwner, "Sam Janvey");
  assert.equal(notifyCalled, 1);
  assert.match(replies.at(-1) ?? "", /Approval request/i);
});

test("manual flow falls back to display_name when real_name unavailable", async () => {
  const createdActionInputs: Array<Record<string, unknown>> = [];
  const deps = {
    createEtaUpdate: async () => ({
      id: "eta-manual-display",
      vendorName: "Manual Slack update",
      poNumber: "PO222222",
      netsuitePoInternalId: null,
      itemNumber: null,
      netsuiteItemInternalId: null,
      etaDate: "2026-05-30",
      trackingNumber: null,
      updateScope: "po_all_lines" as const,
      sourceType: "slack" as const,
      sourceReference: "C9:1",
      rawNotes: "n",
      confidence: 0.95,
      status: "parsed" as const,
      createdActionRequestId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }),
    attachActionRequestToEtaUpdate: async () => undefined,
    createAgentActionRequest: async (input: Record<string, unknown>) => {
      createdActionInputs.push(input);
      return "req-manual-display";
    },
    findLatestEtaUpdateActionRequestByEtaId: async () => null,
    notifyEtaUpdateApprovalRequested: async () => undefined,
    resolveSlackUserDisplayName: async () => "SamJ",
    now: () => new Date("2026-05-24T12:00:00Z")
  };

  for (const text of ["update eta po222222", "2026-05-30", "skip", "skip"]) {
    await handleEtaSlackCapture({
      text,
      slackUserId: "U9",
      slackChannelId: "C9",
      slackMessageTs: "9",
      reply: async () => undefined
    }, deps);
  }

  const inputJson = (createdActionInputs[0]?.["inputJson"] ?? {}) as Record<string, unknown>;
  assert.equal(inputJson["eta_update_owner"], "SamJ");
});

test("manual flow falls back to Slack user ID when user lookup fails", async () => {
  const createdActionInputs: Array<Record<string, unknown>> = [];
  const deps = {
    createEtaUpdate: async () => ({
      id: "eta-manual-fallback",
      vendorName: "Manual Slack update",
      poNumber: "PO333333",
      netsuitePoInternalId: null,
      itemNumber: null,
      netsuiteItemInternalId: null,
      etaDate: "2026-05-31",
      trackingNumber: null,
      updateScope: "po_all_lines" as const,
      sourceType: "slack" as const,
      sourceReference: "C10:1",
      rawNotes: "n",
      confidence: 0.95,
      status: "parsed" as const,
      createdActionRequestId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }),
    attachActionRequestToEtaUpdate: async () => undefined,
    createAgentActionRequest: async (input: Record<string, unknown>) => {
      createdActionInputs.push(input);
      return "req-manual-fallback";
    },
    findLatestEtaUpdateActionRequestByEtaId: async () => null,
    notifyEtaUpdateApprovalRequested: async () => undefined,
    resolveSlackUserDisplayName: async () => {
      throw new Error("lookup failed");
    },
    now: () => new Date("2026-05-24T12:00:00Z")
  };

  for (const text of ["update eta po333333", "2026-05-31", "skip", "skip"]) {
    await handleEtaSlackCapture({
      text,
      slackUserId: "U10",
      slackChannelId: "C10",
      slackMessageTs: "10",
      reply: async () => undefined
    }, deps);
  }

  const inputJson = (createdActionInputs[0]?.["inputJson"] ?? {}) as Record<string, unknown>;
  assert.equal(inputJson["eta_update_owner"], "U10");
  assert.equal(inputJson["eta_update_owner_slack_user_id"], "U10");
});

test("exit cancels during ETA date step", async () => {
  const replies: string[] = [];
  let createCalled = false;
  let createActionCalled = false;

  const deps = {
    createEtaUpdate: async () => {
      createCalled = true;
      throw new Error("should not create");
    },
    attachActionRequestToEtaUpdate: async () => undefined,
    createAgentActionRequest: async () => {
      createActionCalled = true;
      return "req-cancel";
    },
    findLatestEtaUpdateActionRequestByEtaId: async () => null,
    notifyEtaUpdateApprovalRequested: async () => undefined,
    resolveSlackUserDisplayName: async (slackUserId: string) => slackUserId,
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
      text: "exit",
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
  assert.match(replies.at(-1) ?? "", /Canceled ETA update for PO999999\./i);
  assert.match(replies.at(-1) ?? "", /update eta PO999999/i);
  assert.equal(createCalled, false);
  assert.equal(createActionCalled, false);
});

test("cancel cancels during tracking step", async () => {
  const replies: string[] = [];
  await handleEtaSlackCapture(
    {
      text: "update eta po123123",
      slackUserId: "U5",
      slackChannelId: "C5",
      slackMessageTs: "5000.1",
      reply: async (message) => {
        replies.push(message);
      }
    },
    {
      createEtaUpdate: async () => {
        throw new Error("should not create");
      },
      attachActionRequestToEtaUpdate: async () => undefined,
      createAgentActionRequest: async () => "req",
      findLatestEtaUpdateActionRequestByEtaId: async () => null,
      notifyEtaUpdateApprovalRequested: async () => undefined,
      resolveSlackUserDisplayName: async (slackUserId: string) => slackUserId,
      now: () => new Date("2026-05-24T12:00:00Z")
    }
  );
  await handleEtaSlackCapture(
    {
      text: "2026-05-29",
      slackUserId: "U5",
      slackChannelId: "C5",
      slackMessageTs: "5000.2",
      reply: async (message) => {
        replies.push(message);
      }
    },
    {
      createEtaUpdate: async () => {
        throw new Error("should not create");
      },
      attachActionRequestToEtaUpdate: async () => undefined,
      createAgentActionRequest: async () => "req",
      findLatestEtaUpdateActionRequestByEtaId: async () => null,
      notifyEtaUpdateApprovalRequested: async () => undefined,
      resolveSlackUserDisplayName: async (slackUserId: string) => slackUserId,
      now: () => new Date("2026-05-24T12:00:00Z")
    }
  );
  const handled = await handleEtaSlackCapture(
    {
      text: "cancel",
      slackUserId: "U5",
      slackChannelId: "C5",
      slackMessageTs: "5000.3",
      reply: async (message) => {
        replies.push(message);
      }
    },
    {
      createEtaUpdate: async () => {
        throw new Error("should not create");
      },
      attachActionRequestToEtaUpdate: async () => undefined,
      createAgentActionRequest: async () => "req",
      findLatestEtaUpdateActionRequestByEtaId: async () => null,
      notifyEtaUpdateApprovalRequested: async () => undefined,
      resolveSlackUserDisplayName: async (slackUserId: string) => slackUserId,
      now: () => new Date("2026-05-24T12:00:00Z")
    }
  );

  assert.equal(handled, true);
  assert.match(replies.at(-1) ?? "", /Canceled ETA update for PO123123\./i);
});

test("never mind cancels during notes step", async () => {
  const replies: string[] = [];
  const deps = {
    createEtaUpdate: async () => {
      throw new Error("should not create");
    },
    attachActionRequestToEtaUpdate: async () => undefined,
    createAgentActionRequest: async () => "req",
    findLatestEtaUpdateActionRequestByEtaId: async () => null,
    notifyEtaUpdateApprovalRequested: async () => undefined,
    resolveSlackUserDisplayName: async (slackUserId: string) => slackUserId,
    now: () => new Date("2026-05-24T12:00:00Z")
  };

  for (const text of ["update eta po121212", "2026-05-29", "skip"]) {
    await handleEtaSlackCapture(
      {
        text,
        slackUserId: "U6",
        slackChannelId: "C6",
        slackMessageTs: "6000.1",
        reply: async (message) => {
          replies.push(message);
        }
      },
      deps
    );
  }

  const handled = await handleEtaSlackCapture(
    {
      text: "never mind",
      slackUserId: "U6",
      slackChannelId: "C6",
      slackMessageTs: "6000.2",
      reply: async (message) => {
        replies.push(message);
      }
    },
    deps
  );

  assert.equal(handled, true);
  assert.match(replies.at(-1) ?? "", /Canceled ETA update for PO121212\./i);
});

test("prompts include exit cancel hint throughout manual flow", async () => {
  const replies: string[] = [];
  await handleEtaSlackCapture(
    {
      text: "update eta po454545",
      slackUserId: "U7",
      slackChannelId: "C7",
      slackMessageTs: "7000.1",
      reply: async (message) => {
        replies.push(message);
      }
    },
    {
      createEtaUpdate: async () => {
        throw new Error("should not create yet");
      },
      attachActionRequestToEtaUpdate: async () => undefined,
      createAgentActionRequest: async () => "req",
      findLatestEtaUpdateActionRequestByEtaId: async () => null,
      notifyEtaUpdateApprovalRequested: async () => undefined,
      resolveSlackUserDisplayName: async (slackUserId: string) => slackUserId,
      now: () => new Date("2026-05-24T12:00:00Z")
    }
  );
  await handleEtaSlackCapture(
    {
      text: "2026-05-29",
      slackUserId: "U7",
      slackChannelId: "C7",
      slackMessageTs: "7000.2",
      reply: async (message) => {
        replies.push(message);
      }
    },
    {
      createEtaUpdate: async () => {
        throw new Error("should not create yet");
      },
      attachActionRequestToEtaUpdate: async () => undefined,
      createAgentActionRequest: async () => "req",
      findLatestEtaUpdateActionRequestByEtaId: async () => null,
      notifyEtaUpdateApprovalRequested: async () => undefined,
      resolveSlackUserDisplayName: async (slackUserId: string) => slackUserId,
      now: () => new Date("2026-05-24T12:00:00Z")
    }
  );
  await handleEtaSlackCapture(
    {
      text: "skip",
      slackUserId: "U7",
      slackChannelId: "C7",
      slackMessageTs: "7000.3",
      reply: async (message) => {
        replies.push(message);
      }
    },
    {
      createEtaUpdate: async () => {
        throw new Error("should not create yet");
      },
      attachActionRequestToEtaUpdate: async () => undefined,
      createAgentActionRequest: async () => "req",
      findLatestEtaUpdateActionRequestByEtaId: async () => null,
      notifyEtaUpdateApprovalRequested: async () => undefined,
      resolveSlackUserDisplayName: async (slackUserId: string) => slackUserId,
      now: () => new Date("2026-05-24T12:00:00Z")
    }
  );

  assert.match(replies[0] ?? "", /Type `exit` anytime to cancel\./i);
  assert.match(replies[1] ?? "", /Type `exit` anytime to cancel\./i);
  assert.match(replies[2] ?? "", /Type `exit` anytime to cancel\./i);
});

test("conversation expires after 5 minutes and does not consume current message as old response", async () => {
  const replies: string[] = [];
  let now = new Date("2026-05-24T12:00:00.000Z");
  const deps = {
    createEtaUpdate: async () => {
      throw new Error("should not create");
    },
    attachActionRequestToEtaUpdate: async () => undefined,
    createAgentActionRequest: async () => "req",
    findLatestEtaUpdateActionRequestByEtaId: async () => null,
    notifyEtaUpdateApprovalRequested: async () => undefined,
    resolveSlackUserDisplayName: async (slackUserId: string) => slackUserId,
    now: () => now
  };

  await handleEtaSlackCapture(
    {
      text: "update eta po888888",
      slackUserId: "U8",
      slackChannelId: "C8",
      slackMessageTs: "8000.1",
      reply: async (message) => {
        replies.push(message);
      }
    },
    deps
  );

  now = new Date("2026-05-24T12:05:01.000Z");
  const handled = await handleEtaSlackCapture(
    {
      text: "2026-05-30",
      slackUserId: "U8",
      slackChannelId: "C8",
      slackMessageTs: "8000.2",
      reply: async (message) => {
        replies.push(message);
      }
    },
    deps
  );

  assert.equal(handled, false);
  assert.match(replies.at(-1) ?? "", /expired after 5 minutes/i);
  assert.doesNotMatch(replies.at(-1) ?? "", /tracking/i);
});

test("expired conversation plus fresh update eta message starts a new conversation", async () => {
  const replies: string[] = [];
  let now = new Date("2026-05-24T12:00:00.000Z");
  const deps = {
    createEtaUpdate: async () => {
      throw new Error("should not create");
    },
    attachActionRequestToEtaUpdate: async () => undefined,
    createAgentActionRequest: async () => "req",
    findLatestEtaUpdateActionRequestByEtaId: async () => null,
    notifyEtaUpdateApprovalRequested: async () => undefined,
    resolveSlackUserDisplayName: async (slackUserId: string) => slackUserId,
    now: () => now
  };

  await handleEtaSlackCapture(
    {
      text: "update eta po111111",
      slackUserId: "U11",
      slackChannelId: "C11",
      slackMessageTs: "11000.1",
      reply: async (message) => {
        replies.push(message);
      }
    },
    deps
  );

  now = new Date("2026-05-24T12:05:01.000Z");
  const handled = await handleEtaSlackCapture(
    {
      text: "update eta PO999",
      slackUserId: "U11",
      slackChannelId: "C11",
      slackMessageTs: "11000.2",
      reply: async (message) => {
        replies.push(message);
      }
    },
    deps
  );

  assert.equal(handled, true);
  assert.match(replies[1] ?? "", /expired after 5 minutes/i);
  assert.match(replies[2] ?? "", /What ETA date should I use for PO999\?/i);
});

test("valid responses refresh lastUpdatedAt to prevent expiration", async () => {
  const replies: string[] = [];
  let now = new Date("2026-05-24T12:00:00.000Z");
  let createCalled = false;
  const deps = {
    createEtaUpdate: async () => {
      createCalled = true;
      throw new Error("should not create in this test");
    },
    attachActionRequestToEtaUpdate: async () => undefined,
    createAgentActionRequest: async () => "req",
    findLatestEtaUpdateActionRequestByEtaId: async () => null,
    notifyEtaUpdateApprovalRequested: async () => undefined,
    resolveSlackUserDisplayName: async (slackUserId: string) => slackUserId,
    now: () => now
  };

  await handleEtaSlackCapture(
    {
      text: "update eta po777777",
      slackUserId: "U12",
      slackChannelId: "C12",
      slackMessageTs: "12000.1",
      reply: async (message) => {
        replies.push(message);
      }
    },
    deps
  );

  now = new Date("2026-05-24T12:04:59.000Z");
  await handleEtaSlackCapture(
    {
      text: "2026-05-29",
      slackUserId: "U12",
      slackChannelId: "C12",
      slackMessageTs: "12000.2",
      reply: async (message) => {
        replies.push(message);
      }
    },
    deps
  );

  now = new Date("2026-05-24T12:09:58.000Z");
  const handled = await handleEtaSlackCapture(
    {
      text: "skip",
      slackUserId: "U12",
      slackChannelId: "C12",
      slackMessageTs: "12000.3",
      reply: async (message) => {
        replies.push(message);
      }
    },
    deps
  );

  assert.equal(handled, true);
  assert.match(replies.at(-1) ?? "", /Optional: add notes/i);
  assert.equal(createCalled, false);
});
