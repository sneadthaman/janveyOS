import test from "node:test";
import assert from "node:assert/strict";
import { clearSlackConversationStateForUser, handleQuoteToSoButtonAction, handleQuoteToSoSlackMessage } from "./quote-to-so-conversation.js";

type ReplyCapture = string | { text: string; blocks?: Array<Record<string, unknown>> };

function textOf(reply: ReplyCapture | undefined): string {
  if (!reply) return "";
  return typeof reply === "string" ? reply : reply.text;
}

const quoteLookupResponse = {
  success: true,
  quote: {
    internalId: "173626",
    tranId: "EST7883",
    customerName: "Test Ecommerce",
    total: "1200.00",
    expired: false
  }
};

test("existing completed SO is verified and already-converted message returned", async () => {
  const replies: ReplyCapture[] = [];
  let createCalls = 0;

  const handled = await handleQuoteToSoSlackMessage(
    {
      slackUserId: "U1",
      channelId: "C1",
      text: "convert EST7883",
      reply: async (message) => {
        replies.push(message);
      }
    },
    {
      lookupQuoteByTranId: async () => quoteLookupResponse,
      getSalesOrderByInternalId: async () => ({ status: "exists" as const, internalId: "9001", tranId: "SO307397" }),
      createQuoteToSoActionRequest: async () => {
        createCalls += 1;
        return "req-created";
      },
      findCompletedQuoteToSoByQuote: async () => ({
        found: true,
        source: "quote_to_so_executions" as const,
        quoteInternalId: "173626",
        quoteTranId: "EST7883",
        salesOrderInternalId: "9001",
        salesOrderTranId: "SO307397"
      }),
      findLatestQuoteToSoActionRequestForQuote: async () => null
    }
  );

  assert.equal(handled, true);
  assert.equal(createCalls, 0);
  assert.match(textOf(replies[0]), /already converted to Sales Order SO307397/i);
});

test("missing SO in NetSuite returns mismatch warning and does not auto-create", async () => {
  const replies: ReplyCapture[] = [];
  let createCalls = 0;

  const handled = await handleQuoteToSoSlackMessage(
    {
      slackUserId: "U1",
      channelId: "C1",
      text: "convert EST7883",
      reply: async (message) => {
        replies.push(message);
      }
    },
    {
      lookupQuoteByTranId: async () => quoteLookupResponse,
      getSalesOrderByInternalId: async () => ({ status: "missing" as const, internalId: "9001", errorCode: "NOT_FOUND" }),
      createQuoteToSoActionRequest: async () => {
        createCalls += 1;
        return "req-created";
      },
      findCompletedQuoteToSoByQuote: async () => ({
        found: true,
        source: "quote_to_so_executions" as const,
        quoteInternalId: "173626",
        quoteTranId: "EST7883",
        salesOrderInternalId: "9001",
        salesOrderTranId: "SO307397"
      }),
      findLatestQuoteToSoActionRequestForQuote: async () => null
    }
  );

  assert.equal(handled, true);
  assert.equal(createCalls, 0);
  assert.match(textOf(replies[0]), /no longer appears to exist in NetSuite/i);
});

test("user provides PO after prompt and request is submitted without loop", async () => {
  const replies: ReplyCapture[] = [];
  let lookupCalls = 0;
  let createdPayload: Record<string, unknown> | null = null;
  clearSlackConversationStateForUser("U-PO");

  const dependencies = {
    lookupQuoteByTranId: async () => {
      lookupCalls += 1;
      return quoteLookupResponse;
    },
    getSalesOrderByInternalId: async () => ({ status: "verification_error" as const, internalId: "9001", errorCode: "LOOKUP_ERROR" }),
    createQuoteToSoActionRequest: async (payload: Record<string, unknown>) => {
      createdPayload = payload;
      return "req-po";
    },
    findCompletedQuoteToSoByQuote: async () => ({ found: false, source: "agent_action_requests" as const }),
    findLatestQuoteToSoActionRequestForQuote: async () => null
  };

  await handleQuoteToSoSlackMessage(
    {
      slackUserId: "U-PO",
      channelId: "C-PO",
      text: "convert EST7883",
      reply: async (message) => {
        replies.push(message);
      }
    },
    dependencies
  );

  const handledPo = await handleQuoteToSoSlackMessage(
    {
      slackUserId: "U-PO",
      channelId: "C-PO",
      text: "PO12345",
      reply: async (message) => {
        replies.push(message);
      }
    },
    dependencies
  );

  assert.equal(handledPo, true);
  assert.equal(lookupCalls, 1);
  assert.ok(createdPayload);
  assert.equal(createdPayload?.["poNumber"], "PO12345");
  assert.equal(createdPayload?.["poSource"], "user_supplied");
  assert.match(textOf(replies[1]), /added PO PO12345/i);
});

test("no-po reply submits with no_po source and does not loop", async () => {
  const replies: ReplyCapture[] = [];
  let createdPayload: Record<string, unknown> | null = null;
  clearSlackConversationStateForUser("U-NOPO");

  const dependencies = {
    lookupQuoteByTranId: async () => quoteLookupResponse,
    getSalesOrderByInternalId: async () => ({ status: "verification_error" as const, internalId: "9001", errorCode: "LOOKUP_ERROR" }),
    createQuoteToSoActionRequest: async (payload: Record<string, unknown>) => {
      createdPayload = payload;
      return "req-nopo";
    },
    findCompletedQuoteToSoByQuote: async () => ({ found: false, source: "agent_action_requests" as const }),
    findLatestQuoteToSoActionRequestForQuote: async () => null
  };

  await handleQuoteToSoSlackMessage(
    {
      slackUserId: "U-NOPO",
      channelId: "C-NOPO",
      text: "convert EST7883",
      reply: async (message) => {
        replies.push(message);
      }
    },
    dependencies
  );

  await handleQuoteToSoSlackMessage(
    {
      slackUserId: "U-NOPO",
      channelId: "C-NOPO",
      text: "no po",
      reply: async (message) => {
        replies.push(message);
      }
    },
    dependencies
  );

  assert.ok(createdPayload);
  assert.equal(createdPayload?.["poNumber"], undefined);
  assert.equal(createdPayload?.["poSource"], "no_po");
  assert.match(textOf(replies[1]), /with no PO/i);
});

test("duplicate convert after PO capture reports already pending with PO", async () => {
  const replies: ReplyCapture[] = [];
  clearSlackConversationStateForUser("U-DUP");

  await handleQuoteToSoSlackMessage(
    {
      slackUserId: "U-DUP",
      channelId: "C-DUP",
      text: "convert EST7883",
      reply: async (message) => {
        replies.push(message);
      }
    },
    {
      lookupQuoteByTranId: async () => quoteLookupResponse,
      getSalesOrderByInternalId: async () => ({ status: "verification_error" as const, internalId: "9001", errorCode: "LOOKUP_ERROR" }),
      createQuoteToSoActionRequest: async () => "req",
      findCompletedQuoteToSoByQuote: async () => ({ found: false, source: "agent_action_requests" as const }),
      findLatestQuoteToSoActionRequestForQuote: async () => ({
        id: "req-existing",
        status: "pending",
        input_json: { quote_internal_id: "173626", quote_tranid: "EST7883", po_number: "PO12345" },
        output_json: null,
        created_at: new Date().toISOString()
      })
    }
  );

  assert.match(textOf(replies[0]), /pending manager approval with PO PO12345/i);
});

test("replying yes moves to po_number and does not create action request yet", async () => {
  const replies: ReplyCapture[] = [];
  let createCalls = 0;
  clearSlackConversationStateForUser("U-YES");

  const dependencies = {
    lookupQuoteByTranId: async () => quoteLookupResponse,
    getSalesOrderByInternalId: async () => ({ status: "verification_error" as const, internalId: "9001", errorCode: "LOOKUP_ERROR" }),
    createQuoteToSoActionRequest: async () => {
      createCalls += 1;
      return "req-yes";
    },
    findCompletedQuoteToSoByQuote: async () => ({ found: false, source: "agent_action_requests" as const }),
    findLatestQuoteToSoActionRequestForQuote: async () => null
  };

  await handleQuoteToSoSlackMessage(
    {
      slackUserId: "U-YES",
      channelId: "C-YES",
      text: "convert quote EST7883",
      reply: async (message) => {
        replies.push(message);
      }
    },
    dependencies
  );

  await handleQuoteToSoSlackMessage(
    {
      slackUserId: "U-YES",
      channelId: "C-YES",
      text: "yes",
      reply: async (message) => {
        replies.push(message);
      }
    },
    dependencies
  );

  assert.equal(createCalls, 0);
  assert.match(textOf(replies[1]), /Please send me the PO number for Quote EST7883/i);
});

test("after yes, PO12345 creates action request with exact PO", async () => {
  const replies: ReplyCapture[] = [];
  const captured: Array<Record<string, unknown>> = [];
  clearSlackConversationStateForUser("U-YES-PO");

  const dependencies = {
    lookupQuoteByTranId: async () => quoteLookupResponse,
    getSalesOrderByInternalId: async () => ({ status: "verification_error" as const, internalId: "9001", errorCode: "LOOKUP_ERROR" }),
    createQuoteToSoActionRequest: async (payload: Record<string, unknown>) => {
      captured.push(payload);
      return "req-yes-po";
    },
    findCompletedQuoteToSoByQuote: async () => ({ found: false, source: "agent_action_requests" as const }),
    findLatestQuoteToSoActionRequestForQuote: async () => null
  };

  await handleQuoteToSoSlackMessage(
    {
      slackUserId: "U-YES-PO",
      channelId: "C-YES-PO",
      text: "JanveyOS convert quote EST7883",
      reply: async (message) => {
        replies.push(message);
      }
    },
    dependencies
  );

  await handleQuoteToSoSlackMessage(
    {
      slackUserId: "U-YES-PO",
      channelId: "C-YES-PO",
      text: "yes",
      reply: async (message) => {
        replies.push(message);
      }
    },
    dependencies
  );

  await handleQuoteToSoSlackMessage(
    {
      slackUserId: "U-YES-PO",
      channelId: "C-YES-PO",
      text: "PO12345",
      reply: async (message) => {
        replies.push(message);
      }
    },
    dependencies
  );

  assert.equal(captured.length, 1);
  assert.equal(captured[0]?.["poNumber"], "PO12345");
  assert.notEqual(captured[0]?.["poNumber"], "JanveyOS convert quote EST7883");
  assert.match(textOf(replies[2]), /added PO PO12345/i);
});

test("command-like text rejected in po_number state", async () => {
  const replies: ReplyCapture[] = [];
  let createCalls = 0;
  clearSlackConversationStateForUser("U-REJECT");

  const dependencies = {
    lookupQuoteByTranId: async () => quoteLookupResponse,
    getSalesOrderByInternalId: async () => ({ status: "verification_error" as const, internalId: "9001", errorCode: "LOOKUP_ERROR" }),
    createQuoteToSoActionRequest: async () => {
      createCalls += 1;
      return "req-reject";
    },
    findCompletedQuoteToSoByQuote: async () => ({ found: false, source: "agent_action_requests" as const }),
    findLatestQuoteToSoActionRequestForQuote: async () => null
  };

  await handleQuoteToSoSlackMessage(
    {
      slackUserId: "U-REJECT",
      channelId: "C-REJECT",
      text: "convert EST7883",
      reply: async (message) => {
        replies.push(message);
      }
    },
    dependencies
  );

  await handleQuoteToSoSlackMessage(
    {
      slackUserId: "U-REJECT",
      channelId: "C-REJECT",
      text: "yes",
      reply: async (message) => {
        replies.push(message);
      }
    },
    dependencies
  );

  await handleQuoteToSoSlackMessage(
    {
      slackUserId: "U-REJECT",
      channelId: "C-REJECT",
      text: "convert quote EST7883",
      reply: async (message) => {
        replies.push(message);
      }
    },
    dependencies
  );

  assert.equal(createCalls, 0);
  assert.match(textOf(replies[2]), /does not look like a PO number/i);
});

test("verification_error (LOOKUP_ERROR) returns could-not-verify warning and not deleted message", async () => {
  const replies: ReplyCapture[] = [];
  let createCalls = 0;

  const handled = await handleQuoteToSoSlackMessage(
    {
      slackUserId: "U-VERIFY-ERR",
      channelId: "C-VERIFY-ERR",
      text: "convert EST7883",
      reply: async (message) => {
        replies.push(message);
      }
    },
    {
      lookupQuoteByTranId: async () => quoteLookupResponse,
      getSalesOrderByInternalId: async () => ({ status: "verification_error" as const, internalId: "175278", errorCode: "LOOKUP_ERROR" }),
      createQuoteToSoActionRequest: async () => {
        createCalls += 1;
        return "req-created";
      },
      findCompletedQuoteToSoByQuote: async () => ({
        found: true,
        source: "agent_action_requests" as const,
        quoteInternalId: "173626",
        quoteTranId: "EST7883",
        salesOrderInternalId: "9001",
        salesOrderTranId: "SO307397"
      }),
      findLatestQuoteToSoActionRequestForQuote: async () => null
    }
  );

  assert.equal(handled, true);
  assert.equal(createCalls, 0);
  assert.match(textOf(replies[0]), /could not verify it in NetSuite right now/i);
  assert.doesNotMatch(textOf(replies[0]), /no longer appears to exist/i);
});

test("completed lookup verifies by salesOrderInternalId", async () => {
  const replies: ReplyCapture[] = [];
  const lookupArgs: string[] = [];

  await handleQuoteToSoSlackMessage(
    {
      slackUserId: "U-INTERNAL-ID",
      channelId: "C-INTERNAL-ID",
      text: "convert EST7883",
      reply: async (message) => {
        replies.push(message);
      }
    },
    {
      lookupQuoteByTranId: async () => quoteLookupResponse,
      getSalesOrderByInternalId: async (internalId: string) => {
        lookupArgs.push(internalId);
        return { status: "exists" as const, internalId, tranId: "SO307399" };
      },
      createQuoteToSoActionRequest: async () => "req-created",
      findCompletedQuoteToSoByQuote: async () => ({
        found: true,
        source: "agent_action_requests" as const,
        quoteInternalId: "173626",
        quoteTranId: "EST7883",
        salesOrderInternalId: "9001",
        salesOrderTranId: "SO307399"
      }),
      findLatestQuoteToSoActionRequestForQuote: async () => null
    }
  );

  assert.deepEqual(lookupArgs, ["9001"]);
  assert.match(textOf(replies[0]), /already converted to Sales Order SO307399/i);
});

test("no completed or pending record asks PO question", async () => {
  const replies: ReplyCapture[] = [];
  clearSlackConversationStateForUser("U-ASK-PO");
  await handleQuoteToSoSlackMessage(
    {
      slackUserId: "U-ASK-PO",
      channelId: "C-ASK-PO",
      text: "convert EST7883",
      reply: async (message) => {
        replies.push(message);
      }
    },
    {
      lookupQuoteByTranId: async () => quoteLookupResponse,
      getSalesOrderByInternalId: async () => ({ status: "verification_error" as const, internalId: "9001", errorCode: "LOOKUP_ERROR" }),
      createQuoteToSoActionRequest: async () => "req-created",
      findCompletedQuoteToSoByQuote: async () => ({ found: false, source: "agent_action_requests" as const }),
      findLatestQuoteToSoActionRequestForQuote: async () => null
    }
  );
  assert.match(textOf(replies[0]), /How would you like to proceed\\?/i);
});

test("quote found response includes Block Kit buttons with required action IDs", async () => {
  const replies: Array<string | { text: string; blocks?: Array<Record<string, unknown>> }> = [];
  clearSlackConversationStateForUser("U-BLOCK");
  await handleQuoteToSoSlackMessage(
    {
      slackUserId: "U-BLOCK",
      channelId: "C-BLOCK",
      text: "convert EST7883",
      reply: async (message) => {
        replies.push(message);
      }
    },
    {
      lookupQuoteByTranId: async () => quoteLookupResponse,
      getSalesOrderByInternalId: async () => ({ status: "verification_error" as const, internalId: "9001", errorCode: "LOOKUP_ERROR" }),
      createQuoteToSoActionRequest: async () => "req-created",
      findCompletedQuoteToSoByQuote: async () => ({ found: false, source: "agent_action_requests" as const }),
      findLatestQuoteToSoActionRequestForQuote: async () => null
    }
  );

  const payload = replies[0] as { text: string; blocks?: Array<Record<string, unknown>> };
  assert.ok(payload.blocks);
  const actionsBlock = payload.blocks?.find((b) => b.type === "actions");
  assert.ok(actionsBlock);
  const elements = (actionsBlock?.elements ?? []) as Array<Record<string, unknown>>;
  const actionIds = elements.map((e) => String(e.action_id));
  assert.deepEqual(actionIds, ["quote_to_so_add_po", "quote_to_so_no_po", "quote_to_so_cancel"]);
});

test("Add PO button moves to po_number without creating action request", async () => {
  const replies: ReplyCapture[] = [];
  let createCalls = 0;
  await handleQuoteToSoButtonAction(
    {
      actionId: "quote_to_so_add_po",
      value: JSON.stringify({
        actionId: "quote_to_so_add_po",
        quoteInternalId: "173626",
        quoteTranId: "EST7883",
        slackChannelId: "C-BTN",
        slackUserId: "U-BTN"
      }),
      slackUserId: "U-BTN",
      slackChannelId: "C-BTN",
      reply: async (message) => {
        replies.push(typeof message === "string" ? message : message.text);
      }
    },
    {
      lookupQuoteByTranId: async () => quoteLookupResponse,
      getSalesOrderByInternalId: async () => ({ status: "verification_error" as const, internalId: "9001", errorCode: "LOOKUP_ERROR" }),
      createQuoteToSoActionRequest: async () => {
        createCalls += 1;
        return "req";
      },
      findCompletedQuoteToSoByQuote: async () => ({ found: false, source: "agent_action_requests" as const }),
      findLatestQuoteToSoActionRequestForQuote: async () => null
    }
  );
  assert.equal(createCalls, 0);
  assert.match(textOf(replies[0]), /Please send me the PO number/i);
});

test("Continue Without PO button creates request with no PO", async () => {
  const replies: ReplyCapture[] = [];
  let captured: Record<string, unknown> | null = null;
  await handleQuoteToSoButtonAction(
    {
      actionId: "quote_to_so_no_po",
      value: JSON.stringify({
        actionId: "quote_to_so_no_po",
        quoteInternalId: "173626",
        quoteTranId: "EST7883",
        slackChannelId: "C-BTN2",
        slackUserId: "U-BTN2"
      }),
      slackUserId: "U-BTN2",
      slackChannelId: "C-BTN2",
      reply: async (message) => {
        replies.push(typeof message === "string" ? message : message.text);
      }
    },
    {
      lookupQuoteByTranId: async () => quoteLookupResponse,
      getSalesOrderByInternalId: async () => ({ status: "verification_error" as const, internalId: "9001", errorCode: "LOOKUP_ERROR" }),
      createQuoteToSoActionRequest: async (payload: Record<string, unknown>) => {
        captured = payload;
        return "req";
      },
      findCompletedQuoteToSoByQuote: async () => ({ found: false, source: "agent_action_requests" as const }),
      findLatestQuoteToSoActionRequestForQuote: async () => null
    }
  );
  assert.ok(captured);
  assert.equal(captured?.["poSource"], "no_po");
  assert.equal(captured?.["poNumber"], undefined);
  assert.match(textOf(replies[0]), /with no PO/i);
});

test("Cancel button clears flow and creates no action request", async () => {
  const replies: ReplyCapture[] = [];
  let createCalls = 0;
  await handleQuoteToSoButtonAction(
    {
      actionId: "quote_to_so_cancel",
      value: JSON.stringify({
        actionId: "quote_to_so_cancel",
        quoteInternalId: "173626",
        quoteTranId: "EST7883",
        slackChannelId: "C-BTN3",
        slackUserId: "U-BTN3"
      }),
      slackUserId: "U-BTN3",
      slackChannelId: "C-BTN3",
      reply: async (message) => {
        replies.push(typeof message === "string" ? message : message.text);
      }
    },
    {
      lookupQuoteByTranId: async () => quoteLookupResponse,
      getSalesOrderByInternalId: async () => ({ status: "verification_error" as const, internalId: "9001", errorCode: "LOOKUP_ERROR" }),
      createQuoteToSoActionRequest: async () => {
        createCalls += 1;
        return "req";
      },
      findCompletedQuoteToSoByQuote: async () => ({ found: false, source: "agent_action_requests" as const }),
      findLatestQuoteToSoActionRequestForQuote: async () => null
    }
  );
  assert.equal(createCalls, 0);
  assert.match(textOf(replies[0]), /request cancelled/i);
});

test("stale button on pending quote returns existing pending response and no new request", async () => {
  const replies: ReplyCapture[] = [];
  let createCalls = 0;
  await handleQuoteToSoButtonAction(
    {
      actionId: "quote_to_so_no_po",
      value: JSON.stringify({
        actionId: "quote_to_so_no_po",
        quoteInternalId: "173626",
        quoteTranId: "EST7883",
        slackChannelId: "C-BTN4",
        slackUserId: "U-BTN4"
      }),
      slackUserId: "U-BTN4",
      slackChannelId: "C-BTN4",
      reply: async (message) => {
        replies.push(typeof message === "string" ? message : message.text);
      }
    },
    {
      lookupQuoteByTranId: async () => quoteLookupResponse,
      getSalesOrderByInternalId: async () => ({ status: "verification_error" as const, internalId: "9001", errorCode: "LOOKUP_ERROR" }),
      createQuoteToSoActionRequest: async () => {
        createCalls += 1;
        return "req";
      },
      findCompletedQuoteToSoByQuote: async () => ({ found: false, source: "agent_action_requests" as const }),
      findLatestQuoteToSoActionRequestForQuote: async () => ({
        id: "req-existing",
        status: "pending",
        input_json: { quote_internal_id: "173626", quote_tranid: "EST7883", po_number: "PO999" },
        output_json: null,
        created_at: new Date().toISOString()
      })
    }
  );
  assert.equal(createCalls, 0);
  assert.match(textOf(replies[0]), /already have Quote EST7883 pending manager approval with PO PO999/i);
});
