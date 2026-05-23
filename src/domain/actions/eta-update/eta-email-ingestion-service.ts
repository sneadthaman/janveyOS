import { logger } from "../../../shared/logger.js";
import { config } from "../../../shared/config.js";
import { findMailFolderByDisplayName, listMessagesInFolder, type GraphMailMessage } from "../../../integrations/microsoft-graph/client.js";
import { lookupOpenPurchaseOrder } from "../../../integrations/netsuite/client.js";
import {
  createEtaEmailIngestion,
  findEtaEmailIngestionByGraphMessageId,
  updateEtaEmailIngestion,
  type EtaEmailIngestionRow
} from "./eta-email-ingestion-repository.js";
import { createEtaUpdate, attachActionRequestToEtaUpdate } from "./eta-update-repository.js";
import { createAgentActionRequest, findLatestEtaUpdateActionRequestByEtaId } from "../../repositories/agent-log-repository.js";
import { notifyEtaUpdateApprovalRequested } from "../../services/slack/eta-update-approval.js";
import { postSlackMessage } from "../../services/slack/quote-to-so-notifier.js";
import { extractEtaPayloadFromEmail, hasEnoughEtaInfo } from "./eta-email-extraction-service.js";

type EtaEmailIngestionDependencies = {
  findMailFolderByDisplayName: typeof findMailFolderByDisplayName;
  listMessagesInFolder: typeof listMessagesInFolder;
  findEtaEmailIngestionByGraphMessageId: typeof findEtaEmailIngestionByGraphMessageId;
  createEtaEmailIngestion: typeof createEtaEmailIngestion;
  updateEtaEmailIngestion: typeof updateEtaEmailIngestion;
  extractEtaPayloadFromEmail: typeof extractEtaPayloadFromEmail;
  lookupOpenPurchaseOrder: typeof lookupOpenPurchaseOrder;
  createEtaUpdate: typeof createEtaUpdate;
  findLatestEtaUpdateActionRequestByEtaId: typeof findLatestEtaUpdateActionRequestByEtaId;
  createAgentActionRequest: typeof createAgentActionRequest;
  attachActionRequestToEtaUpdate: typeof attachActionRequestToEtaUpdate;
  notifyEtaUpdateApprovalRequested: typeof notifyEtaUpdateApprovalRequested;
  postSlackMessage: typeof postSlackMessage;
};

const defaultDependencies: EtaEmailIngestionDependencies = {
  findMailFolderByDisplayName,
  listMessagesInFolder,
  findEtaEmailIngestionByGraphMessageId,
  createEtaEmailIngestion,
  updateEtaEmailIngestion,
  extractEtaPayloadFromEmail,
  lookupOpenPurchaseOrder,
  createEtaUpdate,
  findLatestEtaUpdateActionRequestByEtaId,
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
  const existingRequest = await deps.findLatestEtaUpdateActionRequestByEtaId(input.etaUpdateId);
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
      proposed_affected_lines: input.itemsSummary
    },
    previewJson: {
      eta_update_id: input.etaUpdateId,
      po_number: input.poNumber,
      eta_date: input.etaDate,
      tracking_number: input.trackingNumber,
      source_folder: config.MICROSOFT_GRAPH_AI_ETA_FOLDER_NAME || "AI ETA"
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
      bodyText
    });

    if (!hasEnoughEtaInfo(extracted)) {
      row = await deps.updateEtaEmailIngestion({
        id: row.id,
        extractionStatus: "failed",
        extractedPayload: extracted as unknown as Record<string, unknown>,
        errorMessage: "Extraction missing PO number or ETA/tracking info."
      });
      return { status: "failed" as const, reason: "insufficient_extraction", row };
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

    const poLookup = await deps.lookupOpenPurchaseOrder({ poNumber });
    if (!poLookup.success) {
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
      vendorName: extracted.vendorName ?? poLookup.vendorName ?? "Unknown",
      poNumber,
      netsuitePoInternalId: poLookup.poInternalId ?? null,
      etaDate: extracted.etaDate,
      trackingNumber: extracted.trackingNumber,
      updateScope: "po_all_lines",
      sourceType: "email",
      sourceReference: `${folderName}:${message.id}`,
      rawNotes: extracted.etaNotes || bodyText,
      confidence: extracted.confidence === "HIGH" ? 0.95 : extracted.confidence === "MED" ? 0.8 : 0.7,
      status: "parsed"
    });

    const itemsSummary = extracted.items
      .map((item) => [item.item ?? "(item)", item.etaDate ?? "(no eta)", item.trackingNumber ?? ""].join(" | "))
      .join("; ");

    const actionRequestId = await createApprovalForEta(
      {
      etaUpdateId: etaUpdate.id,
      vendorName: etaUpdate.vendorName,
      poNumber,
      etaDate: etaUpdate.etaDate,
      trackingNumber: etaUpdate.trackingNumber,
      confidence: extracted.confidence,
      sender: message.sender ?? null,
      subject: message.subject ?? null,
      sourceReference: `${folderName}:${message.id}`,
      notes: extracted.etaNotes || bodyText,
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
