import { logger } from "../../../shared/logger.js";
import { config } from "../../../shared/config.js";
import {
  downloadFileAttachment,
  findMailFolderByDisplayName,
  listMessageAttachments,
  listMessagesInFolder,
  type GraphMailMessage
} from "../../../integrations/microsoft-graph/client.js";
import { extractPdfText } from "../../documents/pdf-text-extractor.js";
import { lookupOpenPurchaseOrder } from "../../../integrations/netsuite/client.js";
import {
  createEtaEmailIngestion,
  findEtaEmailIngestionByGraphMessageId,
  updateEtaEmailIngestion,
  type EtaEmailIngestionRow
} from "./eta-email-ingestion-repository.js";
import { createEtaUpdate, attachActionRequestToEtaUpdate } from "./eta-update-repository.js";
import {
  createAgentActionRequest,
  findExistingEtaUpdateActionRequest,
  findLatestEtaUpdateActionRequestByEtaId
} from "../../repositories/agent-log-repository.js";
import { notifyEtaUpdateApprovalRequested } from "../../services/slack/eta-update-approval.js";
import { postSlackMessage } from "../../services/slack/quote-to-so-notifier.js";
import { extractEtaPayloadFromEmail, hasEnoughEtaInfo } from "./eta-email-extraction-service.js";

type EtaEmailIngestionDependencies = {
  findMailFolderByDisplayName: typeof findMailFolderByDisplayName;
  listMessagesInFolder: typeof listMessagesInFolder;
  listMessageAttachments: typeof listMessageAttachments;
  downloadFileAttachment: typeof downloadFileAttachment;
  extractPdfText: typeof extractPdfText;
  findEtaEmailIngestionByGraphMessageId: typeof findEtaEmailIngestionByGraphMessageId;
  createEtaEmailIngestion: typeof createEtaEmailIngestion;
  updateEtaEmailIngestion: typeof updateEtaEmailIngestion;
  extractEtaPayloadFromEmail: typeof extractEtaPayloadFromEmail;
  lookupOpenPurchaseOrder: typeof lookupOpenPurchaseOrder;
  createEtaUpdate: typeof createEtaUpdate;
  findLatestEtaUpdateActionRequestByEtaId: typeof findLatestEtaUpdateActionRequestByEtaId;
  findExistingEtaUpdateActionRequest: typeof findExistingEtaUpdateActionRequest;
  createAgentActionRequest: typeof createAgentActionRequest;
  attachActionRequestToEtaUpdate: typeof attachActionRequestToEtaUpdate;
  notifyEtaUpdateApprovalRequested: typeof notifyEtaUpdateApprovalRequested;
  postSlackMessage: typeof postSlackMessage;
};

const defaultDependencies: EtaEmailIngestionDependencies = {
  findMailFolderByDisplayName,
  listMessagesInFolder,
  listMessageAttachments,
  downloadFileAttachment,
  extractPdfText,
  findEtaEmailIngestionByGraphMessageId,
  createEtaEmailIngestion,
  updateEtaEmailIngestion,
  extractEtaPayloadFromEmail,
  lookupOpenPurchaseOrder,
  createEtaUpdate,
  findLatestEtaUpdateActionRequestByEtaId,
  findExistingEtaUpdateActionRequest,
  createAgentActionRequest,
  attachActionRequestToEtaUpdate,
  notifyEtaUpdateApprovalRequested,
  postSlackMessage
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

function normalizePoNumber(poNumber: string | null) {
  if (!poNumber) return null;
  const cleaned = poNumber.trim().toUpperCase().replace(/^PO\s*-?/, "PO");
  const m = cleaned.match(/^PO(\d{3,20})$/);
  if (!m) return null;
  return `PO${m[1]}`;
}

async function createApprovalForEta(input: {
  etaUpdateId: string;
  graphMessageId: string;
  vendorName: string;
  poNumber: string;
  etaDate: string | null;
  trackingNumber: string | null;
  confidence: string;
  sender: string | null;
  subject: string | null;
  sourceReference: string;
  notes: string;
  itemsSummary: string;
}, deps: EtaEmailIngestionDependencies = defaultDependencies) {
  const existingRequest = await deps.findExistingEtaUpdateActionRequest({
    etaUpdateId: input.etaUpdateId,
    graphMessageId: input.graphMessageId
  });
  if (existingRequest) return existingRequest.id;

  const actionRequestId = await deps.createAgentActionRequest({
    requestedBy: "system:email_ingestion",
    source: "email",
    actionType: "eta_update",
    requiresApproval: true,
    inputJson: {
      eta_update_id: input.etaUpdateId,
      vendor_name: input.vendorName,
      po_number: input.poNumber,
      eta_date: input.etaDate,
      tracking_number: input.trackingNumber,
      update_scope: "po_all_lines",
      raw_notes: input.notes,
      source_type: "email",
      source_reference: input.sourceReference,
      email_sender: input.sender,
      email_subject: input.subject,
      extraction_confidence: input.confidence,
      proposed_affected_lines: input.itemsSummary,
      graph_message_id: input.graphMessageId
    },
    previewJson: {
      eta_update_id: input.etaUpdateId,
      po_number: input.poNumber,
      eta_date: input.etaDate,
      tracking_number: input.trackingNumber,
      source_folder: config.MICROSOFT_GRAPH_AI_ETA_FOLDER_NAME || "AI ETA",
      graph_message_id: input.graphMessageId
    },
    status: "pending"
  });

  await deps.attachActionRequestToEtaUpdate(input.etaUpdateId, actionRequestId);

  return actionRequestId;
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
  const pdfTexts: string[] = [];

  for (const attachment of attachments) {
    const contentType = String(attachment.contentType ?? "").toLowerCase();
    const isPdf = contentType === "application/pdf" || attachment.name.toLowerCase().endsWith(".pdf");
    logger.info("eta_email.attachment_detected", {
      messageId: message.id,
      subject: message.subject ?? null,
      sender: message.sender ?? null,
      fileName: attachment.name,
      size: attachment.size ?? null,
      isPdf
    });
    if (!isPdf) continue;

    try {
      const buffer = await deps.downloadFileAttachment({ userEmail, messageId: message.id, attachmentId: attachment.id });
      logger.info("eta_email.pdf_attachment_downloaded", {
        messageId: message.id,
        fileName: attachment.name,
        size: attachment.size ?? buffer.byteLength
      });
      const text = await deps.extractPdfText(buffer);
      logger.info("eta_email.pdf_text_extracted", {
        messageId: message.id,
        fileName: attachment.name,
        extractedLength: text.length
      });
      if (text.trim()) pdfTexts.push(text.trim());
    } catch (error) {
      logger.warn("eta_email.pdf_text_extract_failed", {
        messageId: message.id,
        fileName: attachment.name,
        reason: error instanceof Error ? error.message : String(error)
      });
    }
  }

  const combinedSourceText = [bodyText, ...pdfTexts].filter(Boolean).join("\n\n");
  logger.info("eta_email.combined_source_prepared", {
    messageId: message.id,
    subject: message.subject ?? null,
    sender: message.sender ?? null,
    bodyLength: bodyText.length,
    pdfCount: pdfTexts.length,
    combinedLength: combinedSourceText.length
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
    const extracted = await deps.extractEtaPayloadFromEmail({
      subject: message.subject ?? "",
      sender: message.sender ?? "",
      bodyText: combinedSourceText || bodyText
    });

    if (!hasEnoughEtaInfo(extracted)) {
      logger.info("eta_email.no_eta_found", {
        messageId: message.id,
        subject: message.subject ?? null,
        sender: message.sender ?? null,
        hadBodyText: Boolean(bodyText.trim()),
        hadPdfText: pdfTexts.length > 0
      });
      row = await deps.updateEtaEmailIngestion({
        id: row.id,
        extractionStatus: "failed",
        extractedPayload: extracted as unknown as Record<string, unknown>,
        errorMessage: "Extraction missing PO number or ETA/tracking info."
      });
      return { status: "skipped" as const, reason: "no_eta_found", row };
    }

    const poNumber = normalizePoNumber(extracted.poNumber);
    if (!poNumber) {
      row = await deps.updateEtaEmailIngestion({
        id: row.id,
        extractionStatus: "failed",
        extractedPayload: extracted as unknown as Record<string, unknown>,
        errorMessage: "PO number missing or invalid in extraction payload."
      });
      return { status: "failed" as const, reason: "missing_po", row };
    }

    const poLookupPayload = { po: poNumber };
    logger.info("eta_email_ingestion.po_lookup.request", poLookupPayload);
    const poLookup = await deps.lookupOpenPurchaseOrder(poLookupPayload);
    const poLookupSuccess =
      poLookup.success === true ||
      ((poLookup as unknown as Record<string, unknown>).status === true &&
        (poLookup as unknown as Record<string, unknown>).data &&
        typeof (poLookup as unknown as Record<string, unknown>).data === "object");
    const poLookupData =
      poLookupSuccess && (poLookup as unknown as Record<string, unknown>).status === true
        ? (((poLookup as unknown as Record<string, unknown>).data as Record<string, unknown> | undefined) ?? {})
        : {};

    if (!poLookupSuccess) {
      row = await deps.updateEtaEmailIngestion({
        id: row.id,
        extractionStatus: "failed",
        extractedPayload: {
          extracted,
          poLookup
        } as unknown as Record<string, unknown>,
        errorMessage: `Open PO lookup failed for ${poNumber}: ${poLookup.message ?? poLookup.code ?? "not found"}`
      });
      return { status: "failed" as const, reason: "po_not_found", row };
    }

    row = await deps.updateEtaEmailIngestion({
      id: row.id,
      extractionStatus: "extracted",
      extractedPayload: {
        extracted,
        poLookup
      } as unknown as Record<string, unknown>,
      errorMessage: null
    });

    const etaUpdate = await deps.createEtaUpdate({
      vendorName: extracted.vendorName ?? poLookup.vendorName ?? (typeof poLookupData.vendorName === "string" ? poLookupData.vendorName : "Unknown"),
      poNumber,
      netsuitePoInternalId:
        poLookup.poInternalId ?? (typeof poLookupData.poInternalId === "string" ? poLookupData.poInternalId : null),
      etaDate: extracted.etaDate,
      trackingNumber: extracted.trackingNumber,
      updateScope: "po_all_lines",
      sourceType: "email",
      sourceReference: `${folderName}:${message.id}`,
      rawNotes: extracted.etaNotes || combinedSourceText || bodyText,
      confidence: extracted.confidence === "HIGH" ? 0.95 : extracted.confidence === "MED" ? 0.8 : 0.7,
      status: "parsed"
    });

    const itemsSummary = extracted.items
      .map((item) => [item.item ?? "(item)", item.etaDate ?? "(no eta)", item.trackingNumber ?? ""].join(" | "))
      .join("; ");

    const actionRequestId = await createApprovalForEta(
      {
      etaUpdateId: etaUpdate.id,
      graphMessageId: message.id,
      vendorName: etaUpdate.vendorName,
      poNumber,
      etaDate: etaUpdate.etaDate,
      trackingNumber: etaUpdate.trackingNumber,
      confidence: extracted.confidence,
      sender: message.sender ?? null,
      subject: message.subject ?? null,
      sourceReference: `${folderName}:${message.id}`,
      notes: extracted.etaNotes || combinedSourceText || bodyText,
      itemsSummary
      },
      deps
    );

    await deps.updateEtaEmailIngestion({
      id: row.id,
      extractionStatus: "approval_created",
      extractedPayload: {
        ...(row.extracted_payload ?? {}),
        etaUpdateId: etaUpdate.id,
        actionRequestId
      },
      errorMessage: null
    });

    await deps.notifyEtaUpdateApprovalRequested({
      postMessage: async (payload) => {
        const channel = String(config.MICROSOFT_GRAPH_APPROVAL_SLACK_CHANNEL_ID ?? "").trim();
        if (!channel) return;
        await deps.postSlackMessage({ channel, text: payload.text, blocks: payload.blocks });
      },
      actionRequestId,
      etaUpdateId: etaUpdate.id,
      vendorName: etaUpdate.vendorName,
      poNumber,
      etaDate: etaUpdate.etaDate ?? "-",
      trackingNumber: etaUpdate.trackingNumber,
      requestedBySlackUserId: null,
      sender: message.sender ?? null,
      subject: message.subject ?? null,
      confidence: extracted.confidence,
      sourceFolder: folderName,
      proposedAffectedLines: itemsSummary || null,
      notes: extracted.etaNotes || null
    });

    return { status: "approval_created" as const, actionRequestId };
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
