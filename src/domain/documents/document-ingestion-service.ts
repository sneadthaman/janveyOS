import crypto from "node:crypto";
import { createPending, findByHash, markExtractionCompleted, markExtractionFailed } from "./ingested-document-repository.js";
import type { IngestedDocument, IngestedDocumentSource } from "./ingested-document-types.js";
import { extractPdfText } from "./pdf-text-extractor.js";

export interface IngestPdfDocumentInput {
  source: IngestedDocumentSource;
  sourceMessageId?: string | null;
  sourceThreadId?: string | null;
  sourceSender?: string | null;
  sourceSubject?: string | null;
  fileName: string;
  mimeType?: string;
  fileSizeBytes?: number | null;
  buffer: Buffer;
  storagePath?: string | null;
}

interface DocumentIngestionDeps {
  findByHash: (hash: string) => Promise<IngestedDocument | null>;
  createPending: (input: {
    source: IngestedDocumentSource;
    sourceMessageId?: string | null;
    sourceThreadId?: string | null;
    sourceSender?: string | null;
    sourceSubject?: string | null;
    fileName: string;
    mimeType?: string;
    fileSizeBytes?: number | null;
    storagePath?: string | null;
    sha256Hash?: string | null;
    documentType?: "unknown";
  }) => Promise<IngestedDocument>;
  markExtractionCompleted: (id: string, extractedText: string) => Promise<IngestedDocument>;
  markExtractionFailed: (id: string, error: string) => Promise<IngestedDocument>;
  extractPdfText: (buffer: Buffer) => Promise<string>;
  logger: Pick<Console, "info" | "error">;
}

const defaultDeps: DocumentIngestionDeps = {
  findByHash,
  createPending,
  markExtractionCompleted,
  markExtractionFailed,
  extractPdfText,
  logger: console
};

export async function ingestPdfDocumentWithDeps(
  input: IngestPdfDocumentInput,
  deps: Partial<DocumentIngestionDeps>
): Promise<IngestedDocument> {
  const resolved: DocumentIngestionDeps = {
    ...defaultDeps,
    ...deps
  };

  const sha256Hash = crypto.createHash("sha256").update(input.buffer).digest("hex");

  const existing = await resolved.findByHash(sha256Hash);
  if (existing) {
    resolved.logger.info("document_ingestion.duplicate_hash", {
      source: input.source,
      fileName: input.fileName,
      sha256Hash
    });
    return existing;
  }

  const pending = await resolved.createPending({
    source: input.source,
    sourceMessageId: input.sourceMessageId ?? null,
    sourceThreadId: input.sourceThreadId ?? null,
    sourceSender: input.sourceSender ?? null,
    sourceSubject: input.sourceSubject ?? null,
    fileName: input.fileName,
    mimeType: input.mimeType ?? "application/pdf",
    fileSizeBytes: input.fileSizeBytes ?? input.buffer.byteLength,
    storagePath: input.storagePath ?? null,
    sha256Hash,
    documentType: "unknown"
  });

  try {
    const extractedText = await resolved.extractPdfText(input.buffer);
    const completed = await resolved.markExtractionCompleted(pending.id, extractedText);

    resolved.logger.info("document_ingestion.completed", {
      source: input.source,
      fileName: input.fileName,
      sha256Hash,
      extractionStatus: completed.extractionStatus
    });

    return completed;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown extraction error";
    const failed = await resolved.markExtractionFailed(pending.id, errorMessage);

    resolved.logger.error("document_ingestion.failed", {
      source: input.source,
      fileName: input.fileName,
      sha256Hash,
      extractionStatus: failed.extractionStatus,
      extractionError: errorMessage
    });

    return failed;
  }
}

export async function ingestPdfDocument(input: IngestPdfDocumentInput): Promise<IngestedDocument> {
  return ingestPdfDocumentWithDeps(input, {});
}
