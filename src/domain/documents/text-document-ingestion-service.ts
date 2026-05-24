import crypto from "node:crypto";
import { createPending, findByHash, markExtractionCompleted } from "./ingested-document-repository.js";
import type { IngestedDocumentSource, IngestedDocument } from "./ingested-document-types.js";

export interface IngestTextDocumentInput {
  source: IngestedDocumentSource;
  sourceMessageId?: string | null;
  sourceThreadId?: string | null;
  sourceSender?: string | null;
  sourceSubject?: string | null;
  sourceMailbox?: string | null;
  sourceFolder?: string | null;
  sourceFolderHint?: string | null;
  sourceReceivedAt?: string | null;
  routedByMessageId?: string | null;
  routedBySubject?: string | null;
  routedBySender?: string | null;
  fileName: string;
  mimeType?: string;
  fileSizeBytes?: number | null;
  text: string;
}

export async function ingestTextDocument(input: IngestTextDocumentInput): Promise<{ document: IngestedDocument; status: "ingested" | "duplicate_existing_document" }> {
  const normalizedText = input.text.trim();
  const sha256Hash = crypto.createHash("sha256").update(normalizedText).digest("hex");
  const existing = await findByHash(sha256Hash);
  if (existing) return { document: existing, status: "duplicate_existing_document" };

  const pending = await createPending({
    source: input.source,
    sourceMessageId: input.sourceMessageId ?? null,
    sourceThreadId: input.sourceThreadId ?? null,
    sourceSender: input.sourceSender ?? null,
    sourceSubject: input.sourceSubject ?? null,
    sourceMailbox: input.sourceMailbox ?? null,
    sourceFolder: input.sourceFolder ?? null,
    sourceFolderHint: input.sourceFolderHint ?? null,
    sourceReceivedAt: input.sourceReceivedAt ?? null,
    routedByMessageId: input.routedByMessageId ?? null,
    routedBySubject: input.routedBySubject ?? null,
    routedBySender: input.routedBySender ?? null,
    fileName: input.fileName,
    mimeType: input.mimeType ?? "text/plain",
    fileSizeBytes: input.fileSizeBytes ?? Buffer.byteLength(normalizedText, "utf8"),
    storagePath: null,
    sha256Hash,
    documentType: "unknown"
  });

  const completed = await markExtractionCompleted(pending.id, normalizedText);
  return { document: completed, status: "ingested" };
}
