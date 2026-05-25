import test from "node:test";
import assert from "node:assert/strict";
import { config } from "../../../shared/config.js";
import { processEtaGraphMessage, runEtaOutlookIngestionOnce } from "./eta-email-ingestion-service.js";

function baseDeps(overrides: Record<string, unknown> = {}) {
  return {
    findMailFolderByDisplayName: async () => ({ id: "folder-1", displayName: "AI ETA" }),
    listMessagesInFolder: async () => [],
    listMessageAttachments: async () => [],
    downloadFileAttachment: async () => Buffer.from(""),
    findEtaEmailIngestionByGraphMessageId: async () => null,
    createEtaEmailIngestion: async () => ({ id: "ing-1", extracted_payload: null }),
    updateEtaEmailIngestion: async (_input: Record<string, unknown>) => ({ id: "ing-1", extracted_payload: null }),
    ingestPdfDocument: async () => ({ id: "doc-1", extractionStatus: "completed", extractionMethod: "pdf_text", ocrUsed: false }),
    ingestTextDocument: async () => ({ status: "ingested", document: { id: "doc-body-1", extractionStatus: "completed" } }),
    processIngestedDocument: async () => ({
      extraction: { classification: "eta_update" },
      candidates: [{ id: "cand-1" }]
    }),
    createPendingReviewForCandidate: async () => ({ id: "review-1", reviewStatus: "pending" }),
    ...overrides
  };
}

test("ETA worker PDF attachment calls ingestPdfDocument, not direct PDF text extraction", async () => {
  let ingestCalls = 0;
  let processCalls = 0;

  const result = await processEtaGraphMessage(
    { id: "m1", subject: "ETA", sender: "mduplicki@rjschinner.com", bodyText: "" },
    "AI ETA",
    baseDeps({
      listMessageAttachments: async () => [{ id: "a1", name: "S6509406-0001_3529484.pdf", contentType: "application/pdf", size: 100 }],
      downloadFileAttachment: async () => Buffer.from("pdf"),
      ingestPdfDocument: async () => {
        ingestCalls += 1;
        return { id: "doc-rj", extractionStatus: "completed", extractionMethod: "ocr", ocrUsed: true };
      },
      processIngestedDocument: async () => {
        processCalls += 1;
        return {
          extraction: { classification: "invoice_with_shipping_signal" },
          candidates: [{ id: "cand-rj" }]
        };
      }
    }) as any
  );

  assert.equal(result.status, "approval_created");
  assert.equal(ingestCalls, 1);
  assert.equal(processCalls, 1);
});

test("OCR-backed ingested document produces ETA review for RJ Schinner", async () => {
  const reviewIds: string[] = [];
  const result = await processEtaGraphMessage(
    {
      id: "m2",
      subject: "Acknowledgement S6509406 PO# PO289824",
      sender: "mduplicki@rjschinner.com",
      bodyText: ""
    },
    "AI ETA",
    baseDeps({
      listMessageAttachments: async () => [{ id: "a1", name: "S6509406-0001_3529484.pdf", contentType: "application/pdf", size: 100 }],
      downloadFileAttachment: async () => Buffer.from("pdf"),
      ingestPdfDocument: async () => ({
        id: "doc-rj",
        extractionStatus: "completed",
        extractionMethod: "ocr",
        ocrUsed: true
      }),
      processIngestedDocument: async () => ({
        extraction: { classification: "invoice_with_shipping_signal" },
        candidates: [{ id: "cand-rj", poNumber: "PO289824", etaDate: "2026-05-26", carrier: "RJ_SCHINNER_TRUCK", appliesToEntirePo: true }]
      }),
      createPendingReviewForCandidate: async (candidateId: string) => {
        reviewIds.push(candidateId);
        return { id: "review-rj", reviewStatus: "pending" };
      }
    }) as any
  );

  assert.equal(result.status, "approval_created");
  assert.deepEqual(reviewIds, ["cand-rj"]);
});

test("extraction failed document logs/continues and returns no_eta_found when none succeed", async () => {
  const result = await processEtaGraphMessage(
    { id: "m3", subject: "ETA", bodyText: "" },
    "AI ETA",
    baseDeps({
      listMessageAttachments: async () => [{ id: "a1", name: "bad.pdf", contentType: "application/pdf", size: 100 }],
      downloadFileAttachment: async () => Buffer.from("bad"),
      ingestPdfDocument: async () => ({ id: "doc-bad", extractionStatus: "failed", extractionMethod: null, ocrUsed: false })
    }) as any
  );

  assert.equal(result.status, "skipped");
  assert.equal((result as { reason?: string }).reason, "no_eta_found");
});

test("duplicate existing completed document still creates/reuses pending review idempotently", async () => {
  let reviewCalls = 0;
  await processEtaGraphMessage(
    { id: "m4", subject: "ETA", bodyText: "" },
    "AI ETA",
    baseDeps({
      listMessageAttachments: async () => [{ id: "a1", name: "dup.pdf", contentType: "application/pdf", size: 100 }],
      downloadFileAttachment: async () => Buffer.from("dup"),
      ingestPdfDocument: async () => ({ id: "doc-dup", extractionStatus: "completed", extractionMethod: "ocr", ocrUsed: true }),
      processIngestedDocument: async () => ({ extraction: { classification: "eta_update" }, candidates: [{ id: "cand-dup" }] }),
      createPendingReviewForCandidate: async () => {
        reviewCalls += 1;
        return { id: "review-dup", reviewStatus: "pending" };
      }
    }) as any
  );

  await processEtaGraphMessage(
    { id: "m4b", subject: "ETA", bodyText: "" },
    "AI ETA",
    baseDeps({
      listMessageAttachments: async () => [{ id: "a1", name: "dup.pdf", contentType: "application/pdf", size: 100 }],
      downloadFileAttachment: async () => Buffer.from("dup"),
      ingestPdfDocument: async () => ({ id: "doc-dup", extractionStatus: "completed", extractionMethod: "ocr", ocrUsed: true }),
      processIngestedDocument: async () => ({ extraction: { classification: "eta_update" }, candidates: [{ id: "cand-dup" }] }),
      createPendingReviewForCandidate: async () => {
        reviewCalls += 1;
        return { id: "review-dup", reviewStatus: "pending" };
      }
    }) as any
  );

  assert.equal(reviewCalls, 2);
});

test("body-only email fallback remains if no PDF attachments", async () => {
  let bodyIngestCalls = 0;
  const result = await processEtaGraphMessage(
    { id: "m5", subject: "ETA body", bodyText: "PO289731 ETA 5/29 tracking PRO123" },
    "AI ETA",
    baseDeps({
      listMessageAttachments: async () => [],
      ingestTextDocument: async () => {
        bodyIngestCalls += 1;
        return { status: "ingested", document: { id: "doc-body", extractionStatus: "completed" } };
      },
      processIngestedDocument: async () => ({ extraction: { classification: "eta_update" }, candidates: [{ id: "cand-body" }] })
    }) as any
  );
  assert.equal(result.status, "approval_created");
  assert.equal(bodyIngestCalls, 1);
});

test("run ingestion processes messages from configured folder", async () => {
  const prevEnabled = config.MICROSOFT_GRAPH_ENABLED;
  const prevUser = config.MICROSOFT_GRAPH_USER_EMAIL;
  const prevFolder = config.MICROSOFT_GRAPH_AI_ETA_FOLDER_NAME;
  config.MICROSOFT_GRAPH_ENABLED = true;
  config.MICROSOFT_GRAPH_USER_EMAIL = "ops@example.com";
  config.MICROSOFT_GRAPH_AI_ETA_FOLDER_NAME = "AI ETA";
  try {
    const summary = await runEtaOutlookIngestionOnce(
      baseDeps({
        listMessagesInFolder: async () => [{ id: "m6", subject: "ETA", bodyText: "PO289731 ETA 5/29" }]
      }) as any
    );
    assert.equal(summary.enabled, true);
    assert.equal(summary.folderFound, true);
    assert.equal(summary.totalMessages, 1);
  } finally {
    config.MICROSOFT_GRAPH_ENABLED = prevEnabled;
    config.MICROSOFT_GRAPH_USER_EMAIL = prevUser;
    config.MICROSOFT_GRAPH_AI_ETA_FOLDER_NAME = prevFolder;
  }
});
