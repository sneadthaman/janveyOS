import test from "node:test";
import assert from "node:assert/strict";
import { toQuoteToSoSlackMessage, type QuoteToSoUserResult } from "./user-result.js";

test("started maps to converting message", () => {
  const result: QuoteToSoUserResult = { status: "started", quoteInternalId: "173626", quoteTranId: "EST12345" };
  const text = toQuoteToSoSlackMessage(result);
  assert.match(text, /Converting Quote EST12345 to Sales Order/);
});

test("already_running maps to duplicate-safe running message", () => {
  const result: QuoteToSoUserResult = { status: "already_running", quoteInternalId: "173626", quoteTranId: "EST12345" };
  const text = toQuoteToSoSlackMessage(result);
  assert.match(text, /already being converted/i);
  assert.match(text, /No duplicate Sales Order will be created/);
});

test("already_completed maps to existing SO message", () => {
  const result: QuoteToSoUserResult = {
    status: "already_completed",
    quoteInternalId: "173626",
    quoteTranId: "EST12345",
    salesOrderInternalId: "5001",
    salesOrderTranId: "SO123456"
  };
  const text = toQuoteToSoSlackMessage(result);
  assert.match(text, /already converted/i);
  assert.match(text, /Sales Order: SO123456/);
});

test("completed maps to success message", () => {
  const result: QuoteToSoUserResult = {
    status: "completed",
    quoteInternalId: "173626",
    quoteTranId: "EST12345",
    salesOrderInternalId: "5001",
    salesOrderTranId: "SO123456"
  };
  const text = toQuoteToSoSlackMessage(result);
  assert.match(text, /completed/i);
  assert.match(text, /SO123456/);
});

test("failed maps to safe failure message without raw auth details", () => {
  const result: QuoteToSoUserResult = {
    status: "failed",
    quoteInternalId: "173626",
    quoteTranId: "EST12345",
    safeErrorMessage: "NetSuite validation rejected this quote."
  };
  const text = toQuoteToSoSlackMessage(result);
  assert.match(text, /failed/i);
  assert.match(text, /No duplicate Sales Order was created/);
  assert.doesNotMatch(text, /authorization|oauth|token|signature/i);
});
