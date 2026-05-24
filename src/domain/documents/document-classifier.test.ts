import test from "node:test";
import assert from "node:assert/strict";
import { classifyDocumentText } from "./document-classifier.js";

test("classifier identifies eta_update", () => {
  const result = classifyDocumentText("PO289731 tracking 1Z999 expected delivery 5/29 ETA update");
  assert.equal(result.classification, "eta_update");
  assert.ok(result.confidence > 0.8);
});

test("classifier identifies purchase_order", () => {
  const result = classifyDocumentText("Purchase Order 289731\nCustomer PO: 289731\nOrder Number: 55");
  assert.equal(result.classification, "purchase_order");
});

test("classifier identifies unknown", () => {
  const result = classifyDocumentText("Hello team, attached is a general update with no logistics info.");
  assert.equal(result.classification, "unknown");
});
