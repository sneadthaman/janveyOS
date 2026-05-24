import { config } from "../src/shared/config.js";
import { findMailFolderByDisplayName, listMessagesInFolder } from "../src/integrations/microsoft-graph/client.js";
import { processEtaGraphMessage } from "../src/domain/actions/eta-update/eta-email-ingestion-service.js";
import { extractEtaPayloadFromEmail } from "../src/domain/actions/eta-update/eta-email-extraction-service.js";
import { listMessageAttachments, downloadFileAttachment } from "../src/integrations/microsoft-graph/client.js";
import { extractPdfText } from "../src/domain/documents/pdf-text-extractor.js";

function parseArgs(argv: string[]) {
  const limitIndex = argv.findIndex((arg) => arg === "--limit");
  const limitRaw = limitIndex >= 0 ? argv[limitIndex + 1] : undefined;
  const limit = limitRaw ? Number(limitRaw) : 10;
  return { limit: Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 10 };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const userEmail = String(config.MICROSOFT_GRAPH_USER_EMAIL ?? "").trim();
  if (!userEmail) throw new Error("MICROSOFT_GRAPH_USER_EMAIL is required.");

  const folderName = String(process.env.GRAPH_MAIL_FOLDER_NAME ?? config.MICROSOFT_GRAPH_AI_ETA_FOLDER_NAME ?? "AI ETA").trim() || "AI ETA";
  const folder = await findMailFolderByDisplayName({ userEmail, folderName });
  if (!folder) throw new Error(`Folder not found: ${folderName}`);

  const messages = await listMessagesInFolder({ userEmail, folderId: folder.id, limit: args.limit });
  console.log(`[eta:dry-run] folder=${folder.displayName} mailbox=${userEmail} messages=${messages.length}`);

  const extractedByMessageId = new Map<string, Record<string, unknown>>();

  for (const message of messages) {
    const result = await processEtaGraphMessage(
      message,
      folder.displayName || folderName,
      {
        findMailFolderByDisplayName,
        listMessagesInFolder,
        listMessageAttachments,
        downloadFileAttachment,
        extractPdfText,
        findEtaEmailIngestionByGraphMessageId: async () => null,
        createEtaEmailIngestion: async () => ({ id: `dry-${message.id}`, extracted_payload: null }),
        updateEtaEmailIngestion: async () => ({ id: `dry-${message.id}`, extracted_payload: null }),
        extractEtaPayloadFromEmail: async (input) => {
          const extracted = await extractEtaPayloadFromEmail(input);
          extractedByMessageId.set(message.id, extracted as unknown as Record<string, unknown>);
          return extracted;
        },
        lookupOpenPurchaseOrder: async () => ({ success: true, poInternalId: "DRYRUN", poNumber: "DRYRUN", lines: [] }) as any,
        createEtaUpdate: async () => ({
          id: `dry-eta-${message.id}`,
          vendorName: "DRYRUN",
          poNumber: "DRYRUN",
          netsuitePoInternalId: "DRYRUN",
          itemNumber: null,
          netsuiteItemInternalId: null,
          etaDate: null,
          trackingNumber: null,
          updateScope: "po_all_lines",
          sourceType: "email",
          sourceReference: null,
          rawNotes: null,
          confidence: 0,
          status: "parsed",
          createdActionRequestId: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }),
        findLatestEtaUpdateActionRequestByEtaId: async () => null,
        findExistingEtaUpdateActionRequest: async () => null,
        createAgentActionRequest: async () => "dry-run-action-request",
        attachActionRequestToEtaUpdate: async () => undefined,
        notifyEtaUpdateApprovalRequested: async () => undefined,
        postSlackMessage: async () => undefined
      } as any
    );

    const extracted = extractedByMessageId.get(message.id) ?? null;
    const status = (result as { status?: string }).status ?? "unknown";
    const reason = (result as { reason?: string }).reason ?? null;

    console.log("[eta:dry-run] message", {
      messageId: message.id,
      sender: message.sender ?? null,
      subject: message.subject ?? null,
      status,
      reason,
      extracted
    });
  }
}

main().catch((error) => {
  console.error("[eta:dry-run] failed", {
    message: error instanceof Error ? error.message : String(error)
  });
  process.exit(1);
});
