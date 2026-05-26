import { logger } from "../../../shared/logger.js";
import { config } from "../../../shared/config.js";
import {
  downloadFileAttachment,
  findMailFolderByDisplayName,
  listMessageAttachments,
  listMessagesInFolder,
  type GraphMailMessage
} from "../../../integrations/microsoft-graph/client.js";
import {
  createEtaEmailIngestion,
  findEtaEmailIngestionByGraphMessageId,
  updateEtaEmailIngestion,
  type EtaEmailIngestionRow
} from "./eta-email-ingestion-repository.js";
import { ingestPdfDocument, type IngestPdfDocumentInput } from "../../documents/document-ingestion-service.js";
import { ingestTextDocument } from "../../documents/text-document-ingestion-service.js";
import { processIngestedDocument } from "../../documents/document-extraction-service.js";
import { createPendingReviewForCandidateWithStatus } from "../../documents/eta-candidate-review-service.js";
import { postPendingEtaReviewToSlack } from "../../services/slack/document-review-notifier.js";

type EtaEmailIngestionDependencies = {
  findMailFolderByDisplayName: typeof findMailFolderByDisplayName;
  listMessagesInFolder: typeof listMessagesInFolder;
  listMessageAttachments: typeof listMessageAttachments;
  downloadFileAttachment: typeof downloadFileAttachment;
  findEtaEmailIngestionByGraphMessageId: typeof findEtaEmailIngestionByGraphMessageId;
  createEtaEmailIngestion: typeof createEtaEmailIngestion;
  updateEtaEmailIngestion: typeof updateEtaEmailIngestion;
  ingestPdfDocument: (input: IngestPdfDocumentInput) => ReturnType<typeof ingestPdfDocument>;
  ingestTextDocument: typeof ingestTextDocument;
  processIngestedDocument: typeof processIngestedDocument;
  createPendingReviewForCandidateWithStatus: typeof createPendingReviewForCandidateWithStatus;
  postPendingEtaReviewToSlack: typeof postPendingEtaReviewToSlack;
};

const defaultDependencies: EtaEmailIngestionDependencies = {
  findMailFolderByDisplayName,
  listMessagesInFolder,
  listMessageAttachments,
  downloadFileAttachment,
  findEtaEmailIngestionByGraphMessageId,
  createEtaEmailIngestion,
  updateEtaEmailIngestion,
  ingestPdfDocument,
  ingestTextDocument,
  processIngestedDocument,
  createPendingReviewForCandidateWithStatus,
  postPendingEtaReviewToSlack
};

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

function isEtaLikeClassification(value: string) {
  return value === "eta_update" || value === "invoice_with_shipping_signal";
}

async function createReviewsForDocument(
  input: { documentId: string; messageId: string; sourceType: "email_attachment" | "email_body" },
  deps: EtaEmailIngestionDependencies
) {
  const extraction = await deps.processIngestedDocument(input.documentId);
  const classification = extraction.extraction.classification;
  if (!isEtaLikeClassification(classification)) {
    return { classification, candidateCount: extraction.candidates.length, reviewCount: 0 };
  }

  let reviewCount = 0;
  for (const candidate of extraction.candidates) {
    const createdReview = await deps.createPendingReviewForCandidateWithStatus(candidate.id);
    reviewCount += 1;
    logger.info("eta_email.review_created", {
      messageId: input.messageId,
      sourceType: input.sourceType,
      documentId: input.documentId,
      candidateId: candidate.id,
      reviewId: createdReview.review.id,
      created: createdReview.created
    });

    if (!config.ETA_EMAIL_POST_REVIEWS_TO_SLACK) continue;
    if (!createdReview.created) {
      logger.info("eta_email.review_post_skipped_existing", {
        messageId: input.messageId,
        reviewId: createdReview.review.id,
        candidateId: candidate.id
      });
      continue;
    }

    try {
      const postResult = await deps.postPendingEtaReviewToSlack(createdReview.review.id);
      if (postResult.postedChannels.length > 0) {
        logger.info("eta_email.review_posted_to_slack", {
          messageId: input.messageId,
          reviewId: createdReview.review.id,
          candidateId: candidate.id,
          postedChannels: postResult.postedChannels,
          failedChannels: postResult.failedChannels
        });
      }
    } catch (error) {
      logger.error("eta_email.review_post_failed", {
        messageId: input.messageId,
        reviewId: createdReview.review.id,
        candidateId: candidate.id,
        reason: error instanceof Error ? error.message : String(error)
      });
    }
  }

  logger.info("eta_email.candidate_reviews_created", {
    messageId: input.messageId,
    sourceType: input.sourceType,
    documentId: input.documentId,
    classification,
    candidateCount: extraction.candidates.length,
    reviewCount
  });
  return { classification, candidateCount: extraction.candidates.length, reviewCount };
}

export async function processEtaGraphMessage(
  message: GraphMailMessage,
  folderName: string,
  deps: EtaEmailIngestionDependencies = defaultDependencies
) {
  const existing = await deps.findEtaEmailIngestionByGraphMessageId(message.id);
  if (existing) {
    return { status: "skipped" as const, reason: "already_processed", row: existing };
  }

  const bodyText = (message.bodyText && message.bodyText.trim()) || (message.bodyHtml ? htmlToText(message.bodyHtml) : "") || message.bodyPreview || "";
  const userEmail = String(config.MICROSOFT_GRAPH_USER_EMAIL ?? "").trim();
  const attachments = userEmail ? await deps.listMessageAttachments({ userEmail, messageId: message.id }) : [];
  const pdfAttachments = attachments.filter((attachment) => {
    const contentType = String(attachment.contentType ?? "").toLowerCase();
    return contentType === "application/pdf" || attachment.name.toLowerCase().endsWith(".pdf");
  });

  const ingestion = await deps.createEtaEmailIngestion({
    graphMessageId: message.id,
    internetMessageId: message.internetMessageId ?? null,
    subject: message.subject ?? null,
    sender: message.sender ?? null,
    receivedAt: message.receivedDateTime ?? null,
    folderName,
    rawBodyText: bodyText,
    rawBodyHtml: message.bodyHtml ?? null,
    extractionStatus: "pending"
  });

  let row: EtaEmailIngestionRow = ingestion;

  try {
    let processedDocuments = 0;
    let reviewsCreated = 0;

    if (pdfAttachments.length > 0) {
      for (const attachment of pdfAttachments) {
        try {
          const buffer = await deps.downloadFileAttachment({ userEmail, messageId: message.id, attachmentId: attachment.id });
          const ingested = await deps.ingestPdfDocument({
            source: "email_attachment",
            sourceMailbox: userEmail,
            sourceFolder: folderName,
            sourceFolderHint: "vendor_eta",
            sourceMessageId: message.id,
            sourceSender: message.sender ?? null,
            sourceSubject: message.subject ?? null,
            sourceReceivedAt: message.receivedDateTime ?? null,
            fileName: attachment.name,
            mimeType: attachment.contentType ?? "application/pdf",
            fileSizeBytes: attachment.size ?? buffer.byteLength,
            buffer,
            storagePath: null
          });

          logger.info("eta_email.document_ingested", {
            messageId: message.id,
            fileName: attachment.name,
            extractionStatus: ingested.extractionStatus,
            extractionMethod: ingested.extractionMethod ?? null,
            ocrUsed: ingested.ocrUsed ?? false
          });

          if (ingested.extractionStatus !== "completed") {
            logger.warn("eta_email.document_ingestion_failed", {
              messageId: message.id,
              fileName: attachment.name,
              extractionStatus: ingested.extractionStatus,
              extractionMethod: ingested.extractionMethod ?? null,
              ocrUsed: ingested.ocrUsed ?? false
            });
            continue;
          }

          const outcome = await createReviewsForDocument(
            { documentId: ingested.id, messageId: message.id, sourceType: "email_attachment" },
            deps
          );
          processedDocuments += 1;
          reviewsCreated += outcome.reviewCount;
        } catch (error) {
          logger.warn("eta_email.document_ingestion_failed", {
            messageId: message.id,
            fileName: attachment.name,
            reason: error instanceof Error ? error.message : String(error)
          });
        }
      }
    } else if (bodyText.trim()) {
      const ingestedBody = await deps.ingestTextDocument({
        source: "email_body",
        sourceMailbox: userEmail,
        sourceFolder: folderName,
        sourceFolderHint: "vendor_eta",
        sourceMessageId: message.id,
        sourceSender: message.sender ?? null,
        sourceSubject: message.subject ?? null,
        sourceReceivedAt: message.receivedDateTime ?? null,
        fileName: `eta-email-body-${message.id}.txt`,
        mimeType: "text/plain",
        fileSizeBytes: Buffer.byteLength(bodyText, "utf8"),
        text: bodyText
      });
      const outcome = await createReviewsForDocument(
        { documentId: ingestedBody.document.id, messageId: message.id, sourceType: "email_body" },
        deps
      );
      processedDocuments += 1;
      reviewsCreated += outcome.reviewCount;
    }

    if (reviewsCreated === 0) {
      logger.info("eta_email.no_eta_found", {
        messageId: message.id,
        subject: message.subject ?? null,
        sender: message.sender ?? null,
        hadBodyText: Boolean(bodyText.trim()),
        hadPdf: pdfAttachments.length > 0
      });
      row = await deps.updateEtaEmailIngestion({
        id: row.id,
        extractionStatus: "failed",
        errorMessage: "No ETA-like candidates found from ingested documents."
      });
      return { status: "skipped" as const, reason: "no_eta_found", row };
    }

    row = await deps.updateEtaEmailIngestion({
      id: row.id,
      extractionStatus: "approval_created",
      extractedPayload: {
        processedDocuments,
        reviewsCreated
      },
      errorMessage: null
    });
    return { status: "approval_created" as const, reviewsCreated };
  } catch (error) {
    const messageText = error instanceof Error ? error.message : "Unknown email ingestion error";
    await deps.updateEtaEmailIngestion({
      id: row.id,
      extractionStatus: "failed",
      errorMessage: messageText
    });
    return { status: "failed" as const, reason: "exception", error: messageText };
  }
}

export async function runEtaOutlookIngestionOnce(deps: EtaEmailIngestionDependencies = defaultDependencies) {
  if (!config.MICROSOFT_GRAPH_ENABLED) return { enabled: false as const, processed: 0 };

  const userEmail = String(config.MICROSOFT_GRAPH_USER_EMAIL ?? "").trim();
  if (!userEmail) {
    throw new Error("MICROSOFT_GRAPH_USER_EMAIL is required when MICROSOFT_GRAPH_ENABLED=true");
  }

  const folderName = String(config.MICROSOFT_GRAPH_AI_ETA_FOLDER_NAME ?? "AI ETA").trim() || "AI ETA";
  const folder = await deps.findMailFolderByDisplayName({ userEmail, folderName });
  if (!folder) {
    logger.warn("eta_email_ingestion.folder_not_found", { folderName, userEmail });
    return { enabled: true as const, processed: 0, folderFound: false as const };
  }

  const messages = await deps.listMessagesInFolder({ userEmail, folderId: folder.id, limit: 50 });
  let processed = 0;

  for (const message of messages) {
    const result = await processEtaGraphMessage(message, folder.displayName || folderName, deps);
    if (result.status !== "skipped") processed += 1;
  }

  return { enabled: true as const, processed, folderFound: true as const, totalMessages: messages.length };
}
