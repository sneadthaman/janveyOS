import test from "node:test";
import assert from "node:assert/strict";
import { normalizeExtractedText } from "./pdf-text-extractor.js";

test("normalizeExtractedText trims and collapses repeated blank lines", () => {
  const input = "\n\nLine 1\r\n\r\n\r\nLine 2\n\n\n\nLine 3\n";
  const normalized = normalizeExtractedText(input);
  assert.equal(normalized, "Line 1\n\nLine 2\n\nLine 3");
});
