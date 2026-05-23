import test from "node:test";
import assert from "node:assert/strict";
import { parseSlackEtaUpdate } from "./eta-slack-parser.js";

test("parses 'Diversey says PO289731 is coming 5/29'", () => {
  const result = parseSlackEtaUpdate("Diversey says PO289731 is coming 5/29");
  assert.ok(result);
  assert.equal(result?.vendorName, "Diversey");
  assert.equal(result?.poNumber, "PO289731");
  assert.match(result?.etaDate ?? "", /^\d{4}-05-29$/);
  assert.equal(result?.trackingNumber, null);
  assert.equal(result?.updateScope, "unknown");
  assert.equal(result?.confidence, 0.85);
});

test("parses 'PO289731 ETA 5/29 tracking 123456'", () => {
  const result = parseSlackEtaUpdate("PO289731 ETA 5/29 tracking 123456");
  assert.ok(result);
  assert.equal(result?.poNumber, "PO289731");
  assert.match(result?.etaDate ?? "", /^\d{4}-05-29$/);
  assert.equal(result?.trackingNumber, "123456");
  assert.equal(result?.confidence, 0.8);
});

test("parses 'Apply 5/29 ETA to all lines on PO289731' with po_all_lines scope", () => {
  const result = parseSlackEtaUpdate("Apply 5/29 ETA to all lines on PO289731");
  assert.ok(result);
  assert.equal(result?.poNumber, "PO289731");
  assert.equal(result?.updateScope, "po_all_lines");
  assert.equal(result?.confidence, 0.7);
});

test("non-ETA message returns null", () => {
  const result = parseSlackEtaUpdate("can you check this order for me");
  assert.equal(result, null);
});
