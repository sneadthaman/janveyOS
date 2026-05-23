import test from "node:test";
import assert from "node:assert/strict";
import { config } from "../../../shared/config.js";
import { formatQuoteToSoCompletionMessage, notifyQuoteToSoCompleted } from "./quote-to-so-notifier.js";

test("completion notification text includes Quote, Customer, SO, and PO", () => {
  const text = formatQuoteToSoCompletionMessage({
    slackChannelId: "C123",
    quoteTranId: "EST7883",
    customerName: "Test Ecommerce",
    salesOrderTranId: "SO307397",
    salesOrderInternalId: "9001",
    poNumber: "PO-44"
  });

  assert.match(text, /Quote: EST7883/);
  assert.match(text, /Customer: Test Ecommerce/);
  assert.match(text, /Sales Order: SO307397/);
  assert.match(text, /PO: PO-44/);
});

test("completion message includes SO link when NETSUITE_ACCOUNT_BASE_URL is set", () => {
  const originalBase = config.NETSUITE_ACCOUNT_BASE_URL;
  (config as Record<string, unknown>).NETSUITE_ACCOUNT_BASE_URL = "https://acct.app.netsuite.com";
  try {
    const text = formatQuoteToSoCompletionMessage({
      slackChannelId: "C123",
      quoteTranId: "EST7883",
      customerName: "Test Ecommerce",
      salesOrderTranId: "SO307397",
      salesOrderInternalId: "9001",
      poNumber: "PO-44"
    });
    assert.match(text, /Open Sales Order: https:\/\/acct\.app\.netsuite\.com\/app\/accounting\/transactions\/salesord\.nl\?id=9001/i);
  } finally {
    (config as Record<string, unknown>).NETSUITE_ACCOUNT_BASE_URL = originalBase;
  }
});

test("notifyQuoteToSoCompleted posts Slack success message", async () => {
  const originalFetch = globalThis.fetch;
  let called = 0;
  let postedBody: Record<string, unknown> | null = null;

  globalThis.fetch = (async (_url, init) => {
    called += 1;
    postedBody = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    return {
      ok: true,
      json: async () => ({ ok: true })
    } as Response;
  }) as typeof fetch;

  try {
    await notifyQuoteToSoCompleted({
      slackChannelId: "C123",
      slackThreadTs: "171234.123",
      quoteTranId: "EST7883",
      customerName: "Test Ecommerce",
      salesOrderTranId: "SO307397",
      salesOrderInternalId: "9001",
      poNumber: null
    });
    assert.equal(called, 1);
    assert.ok(postedBody);
    assert.equal((postedBody as Record<string, unknown>)["thread_ts"], undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
