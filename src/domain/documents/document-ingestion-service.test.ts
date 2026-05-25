import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { ingestPdfDocumentWithDeps } from "./document-ingestion-service.js";
import type { IngestedDocument } from "./ingested-document-types.js";

function makeDocument(overrides?: Partial<IngestedDocument>): IngestedDocument {
  return {
    id: "doc-1",
    source: "manual_upload",
    sourceMessageId: null,
    sourceThreadId: null,
    sourceSender: null,
    sourceSubject: null,
    sourceMailbox: null,
    sourceFolder: null,
    sourceFolderHint: null,
    sourceReceivedAt: null,
    routedByMessageId: null,
    routedBySubject: null,
    routedBySender: null,
    fileName: "file.pdf",
    mimeType: "application/pdf",
    fileSizeBytes: 10,
    storagePath: null,
    sha256Hash: "hash",
    extractedText: null,
    extractionMethod: null,
    ocrUsed: false,
    extractionStatus: "pending",
    extractionError: null,
    documentType: "unknown",
    classificationMismatch: false,
    needsManualTriage: false,
    createdAt: "2026-05-23T00:00:00.000Z",
    updatedAt: "2026-05-23T00:00:00.000Z",
    ...overrides
  };
}

test("ingestion service computes hash and creates row", async () => {
  const buffer = Buffer.from("pdf-bytes");
  const expectedHash = crypto.createHash("sha256").update(buffer).digest("hex");
  let capturedHash: string | null = null;

  const result = await ingestPdfDocumentWithDeps(
    {
      source: "manual_upload",
      fileName: "upload.pdf",
      buffer
    },
    {
      findByHash: async () => null,
      createPending: async (input) => {
        capturedHash = input.sha256Hash ?? null;
        return makeDocument({ id: "doc-new", sha256Hash: input.sha256Hash ?? null, fileName: input.fileName });
      },
      markExtractionCompleted: async (id, text, metadata) =>
        makeDocument({
          id,
          extractionStatus: "completed",
          extractedText: text,
          extractionMethod: metadata?.extractionMethod ?? null,
          ocrUsed: metadata?.ocrUsed ?? false,
          sha256Hash: expectedHash,
          fileName: "upload.pdf"
        }),
      markExtractionFailed: async (id, error) => makeDocument({ id, extractionStatus: "failed", extractionError: error }),
      extractPdfTextWithOcrFallback: async () => ({ text: "hello world", extractionMethod: "pdf_text", ocrUsed: false }),
      logger: { info: () => undefined, error: () => undefined }
    }
  );

  assert.equal(capturedHash, expectedHash);
  assert.equal(result.extractionStatus, "completed");
  assert.equal(result.extractedText, "hello world");
  assert.equal(result.extractionMethod, "pdf_text");
  assert.equal(result.ocrUsed, false);
});

test("duplicate hash returns existing document", async () => {
  const existing = makeDocument({ id: "doc-existing", sha256Hash: "same", extractionStatus: "completed" });
  let createCalled = 0;

  const result = await ingestPdfDocumentWithDeps(
    {
      source: "email_attachment",
      fileName: "dup.pdf",
      buffer: Buffer.from("dup")
    },
    {
      findByHash: async () => existing,
      createPending: async () => {
        createCalled += 1;
        return makeDocument();
      },
      markExtractionCompleted: async () => makeDocument(),
      markExtractionFailed: async () => makeDocument(),
      extractPdfTextWithOcrFallback: async () => ({ text: "ignored", extractionMethod: "pdf_text", ocrUsed: false }),
      logger: { info: () => undefined, error: () => undefined }
    }
  );

  assert.equal(result.id, "doc-existing");
  assert.equal(createCalled, 0);
});

test("extraction failure marks row failed", async () => {
  const result = await ingestPdfDocumentWithDeps(
    {
      source: "slack_upload",
      fileName: "bad.pdf",
      buffer: Buffer.from("bad")
    },
    {
      findByHash: async () => null,
      createPending: async () => makeDocument({ id: "doc-fail", extractionStatus: "pending" }),
      markExtractionCompleted: async () => makeDocument({ extractionStatus: "completed" }),
      markExtractionFailed: async (id, error) => makeDocument({ id, extractionStatus: "failed", extractionError: error }),
      extractPdfTextWithOcrFallback: async () => {
        throw new Error("parser blew up");
      },
      logger: { info: () => undefined, error: () => undefined }
    }
  );

  assert.equal(result.id, "doc-fail");
  assert.equal(result.extractionStatus, "failed");
  assert.match(String(result.extractionError), /parser blew up/);
});

test("ingestion stores extraction_method and ocr_used from OCR fallback", async () => {
  const result = await ingestPdfDocumentWithDeps(
    {
      source: "manual_upload",
      fileName: "scan.pdf",
      buffer: Buffer.from("scan")
    },
    {
      findByHash: async () => null,
      createPending: async () => makeDocument({ id: "doc-ocr" }),
      markExtractionCompleted: async (id, text, metadata) =>
        makeDocument({
          id,
          extractionStatus: "completed",
          extractedText: text,
          extractionMethod: metadata?.extractionMethod ?? null,
          ocrUsed: metadata?.ocrUsed ?? false
        }),
      markExtractionFailed: async (id, error) => makeDocument({ id, extractionStatus: "failed", extractionError: error }),
      extractPdfTextWithOcrFallback: async () => ({ text: "RJ Schinner PO289824 05/26/26 OUR.TRUCK", extractionMethod: "ocr", ocrUsed: true }),
      logger: { info: () => undefined, error: () => undefined }
    }
  );

  assert.equal(result.extractionStatus, "completed");
  assert.equal(result.extractionMethod, "ocr");
  assert.equal(result.ocrUsed, true);
});
