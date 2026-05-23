import test from "node:test";
import assert from "node:assert/strict";
import { debugExtractEtaIntent, handleEtaSlackQuery } from "./eta-query-conversation.js";

test("ETA intent detects common PO ETA phrasing", () => {
  const intent1 = debugExtractEtaIntent("what's the ETA on PO289731");
  const intent2 = debugExtractEtaIntent("any updates on PO289731");
  const intent3 = debugExtractEtaIntent("show ETA for PO289731");

  assert.equal(intent1.matched, true);
  assert.equal(intent2.matched, true);
  assert.equal(intent3.matched, true);
  assert.equal(intent1.poNumber, "PO289731");
});

test("ETA query returns latest local updates when found", async () => {
  const replies: string[] = [];
  const handled = await handleEtaSlackQuery(
    {
      text: "what's the ETA on PO289731",
      reply: async (message) => {
        replies.push(message);
      }
    },
    {
      findEtaUpdatesByPoNumber: async () => [
        {
          id: "1",
          vendorName: "ACME",
          poNumber: "PO289731",
          netsuitePoInternalId: null,
          itemNumber: "ITEM-1",
          netsuiteItemInternalId: null,
          etaDate: "2026-06-10",
          trackingNumber: null,
          updateScope: "po_line",
          sourceType: "slack",
          sourceReference: null,
          rawNotes: "dock delayed",
          confidence: 0.92,
          status: "parsed",
          createdActionRequestId: null,
          createdAt: "2026-05-01T00:00:00.000Z",
          updatedAt: "2026-05-23T00:00:00.000Z"
        }
      ]
    }
  );

  assert.equal(handled, true);
  assert.match(replies[0], /ETA updates for PO289731/i);
  assert.match(replies[0], /2026-06-10/);
});

test("ETA query returns no-local-update message when not found", async () => {
  const replies: string[] = [];
  const handled = await handleEtaSlackQuery(
    {
      text: "show ETA for PO289731",
      reply: async (message) => {
        replies.push(message);
      }
    },
    {
      findEtaUpdatesByPoNumber: async () => []
    }
  );

  assert.equal(handled, true);
  assert.match(replies[0], /No local ETA updates found yet for PO289731/i);
});
