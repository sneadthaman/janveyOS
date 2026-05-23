import test from "node:test";
import assert from "node:assert/strict";
import { extractJsonObject, hasEnoughEtaInfo, normalizeEtaEmailExtractedPayload } from "./eta-email-extraction-service.js";

test("extracts payload from sample email text JSON", () => {
  const sample = `Here you go:\n\n\`\`\`json\n{"poNumber":"PO289731","etaDate":"2026-05-29","trackingNumber":"PRO123","vendorName":"Diversey","items":[],"confidence":"HIGH","etaSource":"email","etaNotes":"Full PO update"}\n\`\`\``;
  const json = extractJsonObject(sample);
  const payload = normalizeEtaEmailExtractedPayload(json);

  assert.equal(payload.poNumber, "PO289731");
  assert.equal(payload.etaDate, "2026-05-29");
  assert.equal(payload.vendorName, "Diversey");
  assert.equal(payload.confidence, "HIGH");
  assert.equal(hasEnoughEtaInfo(payload), true);
});
