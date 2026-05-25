import test from "node:test";
import assert from "node:assert/strict";
import {
  createPendingWithDeps,
  findByHashWithDeps,
  markExtractionCompletedWithDeps,
  markExtractionFailedWithDeps
} from "./ingested-document-repository.js";
import type { CreateIngestedDocumentInput } from "./ingested-document-types.js";

function makeRow(overrides?: Record<string, unknown>) {
  return {
    id: "doc-1",
    source: "email_attachment",
    source_message_id: "m1",
    source_thread_id: "t1",
    source_sender: "sender@example.com",
    source_subject: "ETA PDF",
    file_name: "eta.pdf",
    mime_type: "application/pdf",
    file_size_bytes: 100,
    storage_path: "/tmp/eta.pdf",
    sha256_hash: "abc",
    extracted_text: null,
    extraction_method: null,
    ocr_used: false,
    extraction_status: "pending",
    extraction_error: null,
    document_type: "unknown",
    created_at: "2026-05-23T00:00:00.000Z",
    updated_at: "2026-05-23T00:00:00.000Z",
    ...overrides
  };
}

const baseInput: CreateIngestedDocumentInput = {
  source: "email_attachment",
  fileName: "eta.pdf",
  mimeType: "application/pdf"
};

test("repository createPendingWithDeps creates pending row", async () => {
  const doc = await createPendingWithDeps(baseInput, {
    createRow: async () => makeRow(),
    updateRowById: async () => makeRow(),
    findRowByHash: async () => null,
    findRowById: async () => null
  });

  assert.equal(doc.id, "doc-1");
  assert.equal(doc.extractionStatus, "pending");
  assert.equal(doc.fileName, "eta.pdf");
});

test("repository markExtractionCompletedWithDeps marks completed and stores text", async () => {
  const doc = await markExtractionCompletedWithDeps("doc-1", "Extracted text", { extractionMethod: "ocr", ocrUsed: true }, {
    createRow: async () => makeRow(),
    updateRowById: async (_id, patch) =>
      makeRow({
        extraction_status: patch.extraction_status,
        extracted_text: patch.extracted_text,
        extraction_method: patch.extraction_method,
        ocr_used: patch.ocr_used,
        extraction_error: patch.extraction_error
      }),
    findRowByHash: async () => null,
    findRowById: async () => null
  });

  assert.equal(doc.extractionStatus, "completed");
  assert.equal(doc.extractedText, "Extracted text");
  assert.equal(doc.extractionMethod, "ocr");
  assert.equal(doc.ocrUsed, true);
  assert.equal(doc.extractionError, null);
});

test("repository markExtractionFailedWithDeps marks failed and stores error", async () => {
  const doc = await markExtractionFailedWithDeps("doc-1", "bad pdf", {
    createRow: async () => makeRow(),
    updateRowById: async (_id, patch) =>
      makeRow({
        extraction_status: patch.extraction_status,
        extraction_error: patch.extraction_error
      }),
    findRowByHash: async () => null,
    findRowById: async () => null
  });

  assert.equal(doc.extractionStatus, "failed");
  assert.equal(doc.extractionError, "bad pdf");
});

test("repository findByHashWithDeps finds existing document", async () => {
  const doc = await findByHashWithDeps("abc", {
    createRow: async () => makeRow(),
    updateRowById: async () => makeRow(),
    findRowByHash: async () => makeRow({ id: "doc-existing", sha256_hash: "abc" }),
    findRowById: async () => null
  });

  assert.equal(doc?.id, "doc-existing");
  assert.equal(doc?.sha256Hash, "abc");
});
