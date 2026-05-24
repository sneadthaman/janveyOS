import test from "node:test";
import assert from "node:assert/strict";
import { processIngestedDocumentWithDeps } from "./document-extraction-service.js";
import type { IngestedDocument } from "./ingested-document-types.js";

function makeDoc(overrides?: Partial<IngestedDocument>): IngestedDocument {
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
    fileName: "sample.pdf",
    mimeType: "application/pdf",
    fileSizeBytes: 100,
    storagePath: null,
    sha256Hash: "hash",
    extractedText: "bring PO289731 on 5/29 tracking 1Z999",
    extractionStatus: "completed",
    extractionError: null,
    documentType: "unknown",
    classificationMismatch: false,
    needsManualTriage: false,
    createdAt: "2026-05-24T00:00:00Z",
    updatedAt: "2026-05-24T00:00:00Z",
    ...overrides
  };
}

test("service processes completed document", async () => {
  const result = await processIngestedDocumentWithDeps("doc-1", {
    findDocumentById: async () => makeDoc(),
    findExtractionByDocumentId: async () => null,
    findEtaCandidatesByExtractionId: async () => [],
    classifyDocumentText: () => ({ classification: "eta_update", confidence: 0.9, reasons: ["eta"] }),
    createDocumentExtraction: async () => ({
      id: "ex-1",
      documentId: "doc-1",
      extractorVersion: "v1",
      classification: "eta_update",
      confidence: 0.9,
      rawExtractionJson: {},
      createdAt: "2026-05-24T00:00:00Z"
    }),
    extractEtaUpdateCandidates: () => [
      {
        poNumber: "PO289731",
        etaDate: "2026-05-29",
        etaDateSource: "explicit_date_in_document",
        etaDateIsEstimated: false,
        baseDate: null,
        baseDateSource: null,
        trackingNumber: null,
        carrier: null,
        itemNumber: null,
        appliesToEntirePo: true,
        confidence: 0.8,
        rawContext: "ctx"
      }
    ],
    createEtaUpdateCandidates: async () => [
      {
        id: "cand-1",
        documentExtractionId: "ex-1",
        poNumber: "PO289731",
        etaDate: "2026-05-29",
        etaDateSource: "explicit_date_in_document",
        etaDateIsEstimated: false,
        baseDate: null,
        baseDateSource: null,
        trackingNumber: null,
        carrier: null,
        itemNumber: null,
        appliesToEntirePo: true,
        confidence: 0.8,
        rawContext: "ctx",
        createdAt: "2026-05-24T00:00:00Z"
      }
    ],
    updateIngestedDocumentType: async () => makeDoc({ documentType: "eta_update" })
  });

  assert.equal(result.extraction.classification, "eta_update");
  assert.equal(result.candidates.length, 1);
  assert.equal(result.document.documentType, "eta_update");
});

test("service rejects pending/failed documents", async () => {
  await assert.rejects(
    () =>
      processIngestedDocumentWithDeps("doc-2", {
        findDocumentById: async () => makeDoc({ extractionStatus: "pending" })
      }),
    /must be completed/
  );

  await assert.rejects(
    () =>
      processIngestedDocumentWithDeps("doc-3", {
        findDocumentById: async () => makeDoc({ extractionStatus: "failed" })
      }),
    /must be completed/
  );
});
