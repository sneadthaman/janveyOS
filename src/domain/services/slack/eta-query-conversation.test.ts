import test from "node:test";
import assert from "node:assert/strict";
import { debugExtractEtaIntent, handleEtaSlackQuery } from "./eta-query-conversation.js";

test("lookup intent extracts PO across expected phrasings", () => {
  const cases = [
    "what is the ETA of PO289827",
    "eta PO289827",
    "ETA for PO289827",
    "when is PO289827 coming in",
    "status PO289827"
  ];
  for (const text of cases) {
    const intent = debugExtractEtaIntent(text);
    assert.equal(intent.matched, true);
    assert.equal(intent.poNumber, "PO289827");
  }
});

test("update eta intent is not treated as lookup", () => {
  const intent = debugExtractEtaIntent("update eta PO123456");
  assert.equal(intent.matched, false);
});

test("executed action result formats expected response", async () => {
  const replies: string[] = [];
  const handled = await handleEtaSlackQuery(
    {
      text: "eta for PO289827",
      reply: async (message) => {
        replies.push(message);
      }
    },
    {
      lookupEtaByPoNumber: async () => ({
        kind: "executed",
        poNumber: "PO289827",
        etaDate: "2026-06-02",
        confidence: "MED",
        trackingNumber: null,
        source: "Contec order confirmation / document_review",
        updatedLines: 4,
        lastUpdatedAt: "2026-05-26T14:15:00Z"
      })
    }
  );
  assert.equal(handled, true);
  assert.match(replies[0], /ETA for PO289827/i);
  assert.match(replies[0], /Expected ETA: 6\/2\/2026/i);
  assert.match(replies[0], /Confidence: MED/i);
  assert.match(replies[0], /Updated lines: 4/i);
});

test("pending review result formats pending response", async () => {
  const replies: string[] = [];
  const handled = await handleEtaSlackQuery(
    {
      text: "status PO289827",
      reply: async (message) => {
        replies.push(message);
      }
    },
    {
      lookupEtaByPoNumber: async () => ({
        kind: "pending_review",
        poNumber: "PO289827",
        etaDate: "2026-06-02",
        confidence: "MED",
        trackingNumber: null,
        source: "Contec order confirmation",
        status: "pending",
        lastUpdatedAt: "2026-05-26T14:15:00Z"
      })
    }
  );
  assert.equal(handled, true);
  assert.match(replies[0], /pending review/i);
  assert.match(replies[0], /Proposed ETA: 6\/2\/2026/i);
  assert.match(replies[0], /awaiting approval/i);
});

test("no result formats not-found response", async () => {
  const replies: string[] = [];
  const handled = await handleEtaSlackQuery(
    {
      text: "eta PO289827",
      reply: async (message) => {
        replies.push(message);
      }
    },
    {
      lookupEtaByPoNumber: async () => ({ kind: "not_found", poNumber: "PO289827" })
    }
  );
  assert.equal(handled, true);
  assert.match(replies[0], /don’t have an ETA for PO289827 yet/i);
});

