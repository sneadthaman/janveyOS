import test from "node:test";
import assert from "node:assert/strict";
import { extractEtaUpdateCandidates } from "./eta-candidate-extractor.js";

test("extractor parses PO/date from bring PO289731 on 5/29", () => {
  const candidates = extractEtaUpdateCandidates("Please bring PO289731 on 5/29", { now: new Date("2026-01-10T00:00:00Z") });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.poNumber, "PO289731");
  assert.equal(candidates[0]?.etaDate, "2026-05-29");
});

test("extractor detects entire PO language", () => {
  const candidates = extractEtaUpdateCandidates("Deliver entire PO 289731 for all items by 05/29", {
    now: new Date("2026-01-10T00:00:00Z")
  });
  assert.equal(candidates[0]?.appliesToEntirePo, true);
});

test("extractor parses item code with DIV prefix", () => {
  const candidates = extractEtaUpdateCandidates("PO 289731 item DIV 123456 ETA 5/29");
  assert.equal(candidates[0]?.itemNumber, "123456");
});
