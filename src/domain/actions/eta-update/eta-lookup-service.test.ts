import test from "node:test";
import assert from "node:assert/strict";
import { parseExecutedEtaRowForPo } from "./eta-lookup-service.js";

test("handles snake_case payload/output fields for executed eta action", () => {
  const result = parseExecutedEtaRowForPo("PO289827", {
    input_json: { po_number: "PO289827", eta_source: "document_review", extraction_confidence: "MED", tracking_number: "PRO1" },
    output_json: { eta_date: "2026-06-02", updatedLineCount: 4 },
    source: "document_review",
    executed_at: "2026-05-26T14:15:00Z"
  });
  assert.equal(result?.kind, "executed");
  assert.equal(result?.etaDate, "2026-06-02");
  assert.equal(result?.confidence, "MED");
  assert.equal(result?.trackingNumber, "PRO1");
  assert.equal(result?.updatedLines, 4);
});

test("handles camelCase payload/output fields for executed eta action", () => {
  const result = parseExecutedEtaRowForPo("PO289827", {
    input_json: { poNumber: "PO289827", etaSource: "document_review", confidence_label: "HIGH", trackingNumber: "PRO2" },
    output_json: { etaDate: "2026-06-02", linesUpdated: 2 },
    source: "document_review",
    updated_at: "2026-05-26T14:15:00Z"
  });
  assert.equal(result?.kind, "executed");
  assert.equal(result?.etaDate, "2026-06-02");
  assert.equal(result?.confidence, "HIGH");
  assert.equal(result?.trackingNumber, "PRO2");
  assert.equal(result?.updatedLines, 2);
});

