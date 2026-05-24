import test from "node:test";
import assert from "node:assert/strict";
import { buildEtaCandidateReviewBlocks } from "./document-review-card.js";

test("card formatter includes estimated ETA metadata", () => {
  const blocks = buildEtaCandidateReviewBlocks({
    reviewId: "review-1",
    poNumber: "PO289731",
    etaDate: "2026-05-29",
    etaDateIsEstimated: true,
    etaDateSource: "estimated_from_invoice_date_plus_4_days",
    baseDate: "2026-05-25",
    baseDateSource: "invoice_date",
    carrier: "UPS",
    trackingNumber: "1Z999",
    itemNumber: "123456",
    appliesToEntirePo: true,
    confidence: 0.62,
    sourceFile: "sample.pdf",
    classification: "invoice_with_shipping_signal",
    rawContext: "raw"
  });

  const text = String((blocks[0]?.text as Record<string, unknown>)?.text ?? "");
  assert.match(text, /ETA estimated: true/);
  assert.match(text, /ETA date source: estimated_from_invoice_date_plus_4_days/);
  assert.match(text, /Base date: 2026-05-25/);
  assert.match(text, /Base date source: invoice_date/);
});

test("card formatter truncates raw_context to max 500 chars", () => {
  const long = "A".repeat(700);
  const blocks = buildEtaCandidateReviewBlocks({
    reviewId: "review-1",
    rawContext: long
  });
  const text = String((blocks[0]?.text as Record<string, unknown>)?.text ?? "");
  assert.match(text, /Raw context:/);
  const rawLine = text.split("\n").find((line) => line.includes("Raw context:")) ?? "";
  assert.ok(rawLine.length <= 520);
  assert.match(rawLine, /\.\.\.$/);
});
