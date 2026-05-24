import { config } from "../../shared/config.js";
import { logger } from "../../shared/logger.js";
import {
  downloadFileAttachment,
  findMailFolderByDisplayName,
  listMessageAttachments,
  listMessagesByConversationId,
  listMessagesInFolder,
  type GraphAttachmentSummary,
  type GraphMessageSummary
} from "../../integrations/microsoft-graph/graph-client.js";
import { ingestPdfDocument, type IngestPdfDocumentInput } from "./document-ingestion-service.js";
import { processIngestedDocument } from "./document-extraction-service.js";
import { updateMetadataById } from "./ingested-document-repository.js";
import { ingestTextDocument } from "./text-document-ingestion-service.js";

const CUSTOMER_PO_FOLDER_HINT = "customer_po";

type IngestStatus = "ingested" | "duplicate_existing_document" | "skipped_no_pdf" | "skipped_non_pdf";
type IngestKind = "direct_attachment" | "thread_attachment" | "email_body";

interface OutlookFolderIngestionDeps {
  findMailFolderByDisplayName: typeof findMailFolderByDisplayName;
  listMessagesInFolder: typeof listMessagesInFolder;
  listMessagesByConversationId: typeof listMessagesByConversationId;
  listMessageAttachments: typeof listMessageAttachments;
  downloadFileAttachment: typeof downloadFileAttachment;
  ingestPdfDocument: (input: IngestPdfDocumentInput) => ReturnType<typeof ingestPdfDocument>;
  ingestTextDocument: typeof ingestTextDocument;
  processIngestedDocument: typeof processIngestedDocument;
  updateMetadataById: typeof updateMetadataById;
}

const defaultDeps: OutlookFolderIngestionDeps = {
  findMailFolderByDisplayName,
  listMessagesInFolder,
  listMessagesByConversationId,
  listMessageAttachments,
  downloadFileAttachment,
  ingestPdfDocument,
  ingestTextDocument,
  processIngestedDocument,
  updateMetadataById
};

export interface CustomerPoDryRunMessageSummary {
  messageId: string;
  receivedDate: string | null;
  sender: string | null;
  subject: string | null;
  sourceFolderHint: "customer_po";
  pdfAttachments: Array<{ name: string; size: number | null; location: "direct" | "thread" }>;
}

export interface CustomerPoDryRunSummary {
  mailbox: string;
  folderName: string;
  sourceFolderHint: "customer_po";
  scannedMessageCount: number;
  threadMessagesScanned: number;
  threadScanErrors: number;
  pdfAttachmentCount: number;
  pdfFoundDirect: number;
  pdfFoundViaThread: number;
  emailBodiesEligible: number;
  skippedAutoReplies: number;
  duplicatesSkipped: number;
  messages: CustomerPoDryRunMessageSummary[];
}

export interface CustomerPoIngestedDocumentResult {
  messageId: string;
  sender: string | null;
  subject: string | null;
  receivedDate: string | null;
  sourceFolderHint: "customer_po";
  sourceType: "email_attachment" | "email_body";
  ingestionPath: IngestKind;
  status: IngestStatus;
  attachmentName: string;
  attachmentSize: number | null;
  documentId: string | null;
  extractionStatus: string | null;
  classification: string | null;
  classificationMismatch: boolean;
  needsManualTriage: boolean;
}

export interface CustomerPoIngestSummary {
  mailbox: string;
  folderName: string;
  sourceFolderHint: "customer_po";
  scannedMessageCount: number;
  threadMessagesScanned: number;
  threadScanErrors: number;
  pdfAttachmentCount: number;
  ingestedDocumentCount: number;
  duplicatesSkipped: number;
  skippedAutoReplies: number;
  bodyDocumentsIngested: number;
  documents: CustomerPoIngestedDocumentResult[];
}

function requireOutlookConfig() {
  if (!config.OUTLOOK_INGESTION_ENABLED) {
    throw new Error("OUTLOOK_INGESTION_ENABLED must be true to run Outlook ingestion.");
  }
  const mailbox = config.OUTLOOK_MAILBOX?.trim();
  if (!mailbox) throw new Error("OUTLOOK_MAILBOX is required.");
  const folderName = (config.OUTLOOK_CUSTOMER_PO_FOLDER_NAME?.trim() || "AI Cust PO").trim();
  return { mailbox, folderName };
}

function parseLimit(limit?: number) {
  const configured = typeof config.OUTLOOK_MAX_MESSAGES === "number" && Number.isFinite(config.OUTLOOK_MAX_MESSAGES)
    ? config.OUTLOOK_MAX_MESSAGES
    : 10;
  const desired = typeof limit === "number" && Number.isFinite(limit) ? limit : configured;
  return Math.max(1, Math.min(100, Math.floor(desired)));
}

function isPoLikeClassification(classification: string | null | undefined) {
  const normalized = String(classification ?? "").trim().toLowerCase();
  return normalized === "purchase_order" || normalized === "customer_purchase_order";
}

function htmlToText(input: string) {
  return input
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanupBodyText(message: GraphMessageSummary): string {
  const raw = (message.bodyText ?? message.bodyPreview ?? (message.bodyHtml ? htmlToText(message.bodyHtml) : "")).trim();
  if (!raw) return "";
  return raw.split(/\nFrom:\s|\nOn .*wrote:\s|\n-----Original Message-----/i)[0]?.trim() ?? raw;
}

function hasStrongPoBodySignals(subject: string | null, body: string): boolean {
  const subjectText = String(subject ?? "").toLowerCase();
  const bodyText = body.toLowerCase();
  const poSignals = [
    /purchase\s+order/i,
    /po\s*(number|#)\s*:?\s*[a-z0-9-]{4,}/i,
    /order\s+number\s*:?\s*[a-z0-9-]{4,}/i,
    /ship\s+to/i,
    /bill\s+to/i,
    /\bitem\b/i,
    /\bqty\b/i
  ];
  const hits = poSignals.reduce((count, rx) => (rx.test(bodyText) ? count + 1 : count), 0);
  const subjectPo = /purchase\s+order|po\s*#?\s*\d{4,}/i.test(subjectText);
  return subjectPo || hits >= 2;
}

function isAutomaticReply(subject: string | null) {
  const s = String(subject ?? "").toLowerCase();
  return s.includes("automatic reply") || s.includes("out of office") || s.includes("autoreply");
}

function dedupeMessages(messages: GraphMessageSummary[]) {
  const byId = new Map<string, GraphMessageSummary>();
  for (const m of messages) if (m.id) byId.set(m.id, m);
  return Array.from(byId.values());
}

interface CandidateAttachment {
  routedBy: GraphMessageSummary;
  sourceMessage: GraphMessageSummary;
  attachment: GraphAttachmentSummary;
  path: "direct" | "thread";
}

async function buildThreadAwareCandidates(
  mailbox: string,
  folderMessages: GraphMessageSummary[],
  includeThread: boolean,
  deps: OutlookFolderIngestionDeps
) {
  const candidates: CandidateAttachment[] = [];
  const dedupeAttachmentKey = new Set<string>();
  const seenThreadMessageIds = new Set<string>();
  let threadMessagesScanned = 0;
  let threadScanErrors = 0;
  let directPdf = 0;
  let threadPdf = 0;

  for (const routedBy of folderMessages) {
    let threadMessages: GraphMessageSummary[] = [routedBy];
    if (includeThread && routedBy.conversationId) {
      try {
        threadMessages = dedupeMessages([routedBy, ...(await deps.listMessagesByConversationId(mailbox, routedBy.conversationId, 25))]);
      } catch (error) {
        threadScanErrors += 1;
        logger.warn("outlook.customer_po.thread_scan_skipped", {
          messageId: routedBy.id,
          conversationId: routedBy.conversationId,
          reason: error instanceof Error ? error.message : String(error)
        });
        threadMessages = [routedBy];
      }
    }

    threadMessagesScanned += threadMessages.length;

    for (const message of threadMessages) {
      if (seenThreadMessageIds.has(message.id)) continue;
      seenThreadMessageIds.add(message.id);

      const attachments = await deps.listMessageAttachments(mailbox, message.id);
      for (const attachment of attachments) {
        const key = `${message.id}::${attachment.id}`;
        if (dedupeAttachmentKey.has(key)) continue;
        dedupeAttachmentKey.add(key);

        const path: "direct" | "thread" = message.id === routedBy.id ? "direct" : "thread";
        if (path === "direct") directPdf += 1;
        else threadPdf += 1;

        candidates.push({ routedBy, sourceMessage: message, attachment, path });
      }
    }
  }

  return { candidates, threadMessagesScanned, threadScanErrors, directPdf, threadPdf };
}

export async function scanCustomerPoFolderDryRunWithDeps(
  input: { limit?: number; includeThread?: boolean; includeBody?: boolean } | undefined,
  deps: OutlookFolderIngestionDeps
): Promise<CustomerPoDryRunSummary> {
  const { mailbox, folderName } = requireOutlookConfig();
  const limit = parseLimit(input?.limit);
  const includeThread = input?.includeThread ?? true;
  const includeBody = input?.includeBody ?? true;

  const folder = await deps.findMailFolderByDisplayName(mailbox, folderName);
  if (!folder) throw new Error(`Outlook folder not found: ${folderName}`);

  const folderMessages = await deps.listMessagesInFolder(mailbox, folder.id, limit);
  const summaries: CustomerPoDryRunMessageSummary[] = [];

  const built = await buildThreadAwareCandidates(mailbox, folderMessages, includeThread, deps);

  for (const message of folderMessages) {
    const ownCandidates = built.candidates.filter((c) => c.routedBy.id === message.id);
    summaries.push({
      messageId: message.id,
      receivedDate: message.receivedDateTime ?? null,
      sender: message.sender ?? null,
      subject: message.subject ?? null,
      sourceFolderHint: CUSTOMER_PO_FOLDER_HINT,
      pdfAttachments: ownCandidates.map((c) => ({ name: c.attachment.name, size: c.attachment.size, location: c.path }))
    });
  }

  let emailBodiesEligible = 0;
  let skippedAutoReplies = 0;
  if (includeBody) {
    for (const msg of folderMessages) {
      const body = cleanupBodyText(msg);
      if (!body) continue;
      if (isAutomaticReply(msg.subject) && !hasStrongPoBodySignals(msg.subject, body)) {
        skippedAutoReplies += 1;
        continue;
      }
      if (hasStrongPoBodySignals(msg.subject, body)) emailBodiesEligible += 1;
    }
  }

  return {
    mailbox,
    folderName,
    sourceFolderHint: CUSTOMER_PO_FOLDER_HINT,
    scannedMessageCount: folderMessages.length,
    threadMessagesScanned: built.threadMessagesScanned,
    threadScanErrors: built.threadScanErrors,
    pdfAttachmentCount: built.candidates.length,
    pdfFoundDirect: built.directPdf,
    pdfFoundViaThread: built.threadPdf,
    emailBodiesEligible,
    skippedAutoReplies,
    duplicatesSkipped: 0,
    messages: summaries
  };
}

export async function scanCustomerPoFolderDryRun(input?: { limit?: number; includeThread?: boolean; includeBody?: boolean }): Promise<CustomerPoDryRunSummary> {
  return scanCustomerPoFolderDryRunWithDeps(input, defaultDeps);
}

export async function ingestCustomerPoFolderWithDeps(
  input: { limit?: number; extract?: boolean; includeThread?: boolean; includeBody?: boolean } | undefined,
  deps: OutlookFolderIngestionDeps
): Promise<CustomerPoIngestSummary> {
  const { mailbox, folderName } = requireOutlookConfig();
  const limit = parseLimit(input?.limit);
  const extract = Boolean(input?.extract);
  const includeThread = input?.includeThread ?? true;
  const includeBody = input?.includeBody ?? true;

  const folder = await deps.findMailFolderByDisplayName(mailbox, folderName);
  if (!folder) throw new Error(`Outlook folder not found: ${folderName}`);

  const folderMessages = await deps.listMessagesInFolder(mailbox, folder.id, limit);
  const built = await buildThreadAwareCandidates(mailbox, folderMessages, includeThread, deps);
  const documents: CustomerPoIngestedDocumentResult[] = [];
  const seenDocIds = new Set<string>();
  let duplicatesSkipped = 0;
  let skippedAutoReplies = 0;
  let bodyDocumentsIngested = 0;

  for (const cand of built.candidates) {
    const buffer = await deps.downloadFileAttachment(mailbox, cand.sourceMessage.id, cand.attachment.id);
    const ingested = await deps.ingestPdfDocument({
      source: "email_attachment",
      sourceMailbox: mailbox,
      sourceFolder: folderName,
      sourceFolderHint: CUSTOMER_PO_FOLDER_HINT,
      sourceMessageId: cand.sourceMessage.id,
      sourceThreadId: cand.sourceMessage.conversationId,
      sourceSender: cand.sourceMessage.sender ?? null,
      sourceSubject: cand.sourceMessage.subject ?? null,
      sourceReceivedAt: cand.sourceMessage.receivedDateTime ?? null,
      routedByMessageId: cand.routedBy.id,
      routedBySubject: cand.routedBy.subject ?? null,
      routedBySender: cand.routedBy.sender ?? null,
      fileName: cand.attachment.name,
      mimeType: cand.attachment.contentType ?? "application/pdf",
      fileSizeBytes: cand.attachment.size ?? buffer.byteLength,
      buffer,
      storagePath: null
    });

    const status: IngestStatus = seenDocIds.has(ingested.id) ? "duplicate_existing_document" : "ingested";
    if (status === "duplicate_existing_document") duplicatesSkipped += 1;
    seenDocIds.add(ingested.id);

    let classification: string | null = null;
    let classificationMismatch = false;
    let needsManualTriage = false;

    if (extract && status === "ingested") {
      const extraction = await deps.processIngestedDocument(ingested.id);
      classification = extraction.extraction.classification;
      if (!isPoLikeClassification(classification)) {
        classificationMismatch = true;
        needsManualTriage = true;
        await deps.updateMetadataById(ingested.id, { classification_mismatch: true, needs_manual_triage: true });
      } else {
        await deps.updateMetadataById(ingested.id, { classification_mismatch: false, needs_manual_triage: false });
      }
    }

    documents.push({
      messageId: cand.sourceMessage.id,
      sender: cand.sourceMessage.sender ?? null,
      subject: cand.sourceMessage.subject ?? null,
      receivedDate: cand.sourceMessage.receivedDateTime ?? null,
      sourceFolderHint: CUSTOMER_PO_FOLDER_HINT,
      sourceType: "email_attachment",
      ingestionPath: cand.path === "direct" ? "direct_attachment" : "thread_attachment",
      status,
      attachmentName: cand.attachment.name,
      attachmentSize: cand.attachment.size,
      documentId: ingested.id,
      extractionStatus: ingested.extractionStatus,
      classification,
      classificationMismatch,
      needsManualTriage
    });
  }

  if (includeBody) {
    for (const message of folderMessages) {
      const body = cleanupBodyText(message);
      if (!body) continue;
      if (isAutomaticReply(message.subject) && !hasStrongPoBodySignals(message.subject, body)) {
        skippedAutoReplies += 1;
        continue;
      }
      if (!hasStrongPoBodySignals(message.subject, body)) continue;

      const bodyResult = await deps.ingestTextDocument({
        source: "email_body",
        sourceMailbox: mailbox,
        sourceFolder: folderName,
        sourceFolderHint: CUSTOMER_PO_FOLDER_HINT,
        sourceMessageId: message.id,
        sourceThreadId: message.conversationId,
        sourceSender: message.sender ?? null,
        sourceSubject: message.subject ?? null,
        sourceReceivedAt: message.receivedDateTime ?? null,
        routedByMessageId: message.id,
        routedBySubject: message.subject ?? null,
        routedBySender: message.sender ?? null,
        fileName: `email-body-${message.id}.txt`,
        mimeType: "text/plain",
        fileSizeBytes: Buffer.byteLength(body, "utf8"),
        text: body
      });

      const status: IngestStatus = bodyResult.status === "duplicate_existing_document" ? "duplicate_existing_document" : "ingested";
      if (status === "duplicate_existing_document") duplicatesSkipped += 1;
      if (status === "ingested") bodyDocumentsIngested += 1;

      let classification: string | null = null;
      let classificationMismatch = false;
      let needsManualTriage = false;

      if (extract && status === "ingested") {
        const extraction = await deps.processIngestedDocument(bodyResult.document.id);
        classification = extraction.extraction.classification;
        if (!isPoLikeClassification(classification)) {
          classificationMismatch = true;
          needsManualTriage = true;
          await deps.updateMetadataById(bodyResult.document.id, { classification_mismatch: true, needs_manual_triage: true });
        } else {
          await deps.updateMetadataById(bodyResult.document.id, { classification_mismatch: false, needs_manual_triage: false });
        }
      }

      documents.push({
        messageId: message.id,
        sender: message.sender ?? null,
        subject: message.subject ?? null,
        receivedDate: message.receivedDateTime ?? null,
        sourceFolderHint: CUSTOMER_PO_FOLDER_HINT,
        sourceType: "email_body",
        ingestionPath: "email_body",
        status,
        attachmentName: `email-body-${message.id}.txt`,
        attachmentSize: Buffer.byteLength(body, "utf8"),
        documentId: bodyResult.document.id,
        extractionStatus: bodyResult.document.extractionStatus,
        classification,
        classificationMismatch,
        needsManualTriage
      });
    }
  }

  return {
    mailbox,
    folderName,
    sourceFolderHint: CUSTOMER_PO_FOLDER_HINT,
    scannedMessageCount: folderMessages.length,
    threadMessagesScanned: built.threadMessagesScanned,
    threadScanErrors: built.threadScanErrors,
    pdfAttachmentCount: built.candidates.length,
    ingestedDocumentCount: documents.filter((d) => d.status === "ingested").length,
    duplicatesSkipped,
    skippedAutoReplies,
    bodyDocumentsIngested,
    documents
  };
}

export async function ingestCustomerPoFolder(input?: { limit?: number; extract?: boolean; includeThread?: boolean; includeBody?: boolean }): Promise<CustomerPoIngestSummary> {
  return ingestCustomerPoFolderWithDeps(input, defaultDeps);
}
