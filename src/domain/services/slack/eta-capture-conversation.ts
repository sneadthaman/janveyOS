import { createAgentActionRequest, findLatestEtaUpdateActionRequestByEtaId } from "../../repositories/agent-log-repository.js";
import { attachActionRequestToEtaUpdate, createEtaUpdate } from "../../actions/eta-update/eta-update-repository.js";
import { parseSlackEtaUpdate } from "../../actions/eta-update/eta-slack-parser.js";
import { notifyEtaUpdateApprovalRequested } from "./eta-update-approval.js";
import { postSlackMessage } from "./quote-to-so-notifier.js";

export function formatEtaCaptureConfirmation(input: {
  vendorName: string;
  poNumber: string;
  etaDate: string;
  trackingNumber: string | null;
  updateScope: string;
}) {
  return [
    "Saved ETA update:",
    `Vendor: ${input.vendorName}`,
    `PO: ${input.poNumber}`,
    `ETA: ${input.etaDate}`,
    `Tracking: ${input.trackingNumber ?? "-"}`,
    `Scope: ${input.updateScope}`,
    "Status: parsed"
  ].join("\n");
}

type EtaCaptureDependencies = {
  createEtaUpdate: typeof createEtaUpdate;
  attachActionRequestToEtaUpdate: typeof attachActionRequestToEtaUpdate;
  createAgentActionRequest: typeof createAgentActionRequest;
  findLatestEtaUpdateActionRequestByEtaId: typeof findLatestEtaUpdateActionRequestByEtaId;
  notifyEtaUpdateApprovalRequested: typeof notifyEtaUpdateApprovalRequested;
};

const defaultDependencies: EtaCaptureDependencies = {
  createEtaUpdate,
  attachActionRequestToEtaUpdate,
  createAgentActionRequest,
  findLatestEtaUpdateActionRequestByEtaId,
  notifyEtaUpdateApprovalRequested
};

export async function handleEtaSlackCapture(input: {
  text: string;
  slackUserId?: string;
  slackChannelId?: string;
  slackMessageTs?: string;
  reply: (message: string) => Promise<void>;
}, dependencies: EtaCaptureDependencies = defaultDependencies): Promise<boolean> {
  const parsed = parseSlackEtaUpdate(input.text);
  if (!parsed) return false;

  const sourceReferenceParts = [input.slackChannelId, input.slackMessageTs].filter(Boolean);
  const sourceReference = sourceReferenceParts.length ? sourceReferenceParts.join(":") : null;

  const saved = await dependencies.createEtaUpdate({
    vendorName: parsed.vendorName,
    poNumber: parsed.poNumber,
    netsuitePoInternalId: parsed.netsuitePoInternalId,
    itemNumber: parsed.itemNumber,
    netsuiteItemInternalId: parsed.netsuiteItemInternalId,
    etaDate: parsed.etaDate,
    trackingNumber: parsed.trackingNumber,
    updateScope: parsed.updateScope,
    sourceType: "slack",
    sourceReference,
    rawNotes: input.text,
    confidence: parsed.confidence,
    status: "parsed"
  });

  const existingRequest = await dependencies.findLatestEtaUpdateActionRequestByEtaId(saved.id);
  if (!existingRequest) {
    const actionRequestId = await dependencies.createAgentActionRequest({
      requestedBy: input.slackUserId,
      source: "slack",
      actionType: "eta_update",
      requiresApproval: true,
      inputJson: {
        eta_update_id: saved.id,
        vendor_name: saved.vendorName,
        po_number: saved.poNumber,
        netsuite_po_internal_id: saved.netsuitePoInternalId,
        item_number: saved.itemNumber,
        netsuite_item_internal_id: saved.netsuiteItemInternalId,
        eta_date: saved.etaDate,
        tracking_number: saved.trackingNumber,
        update_scope: saved.updateScope,
        raw_notes: saved.rawNotes,
        confidence: saved.confidence,
        source_type: "slack",
        source_reference: saved.sourceReference,
        slack_channel_id: input.slackChannelId ?? null,
        slack_user_id: input.slackUserId ?? null,
        slack_message_ts: input.slackMessageTs ?? null
      },
      previewJson: {
        eta_update_id: saved.id,
        po_number: saved.poNumber,
        eta_date: saved.etaDate,
        update_scope: saved.updateScope,
        tracking_number: saved.trackingNumber
      },
      status: "pending"
    });

    await dependencies.attachActionRequestToEtaUpdate(saved.id, actionRequestId);

    if (input.slackChannelId) {
      const channel = input.slackChannelId;
      await dependencies.notifyEtaUpdateApprovalRequested({
        postMessage: async (payload) => {
          await postSlackMessage({ channel, text: payload.text, blocks: payload.blocks });
        },
        actionRequestId,
        etaUpdateId: saved.id,
        vendorName: saved.vendorName,
        poNumber: saved.poNumber ?? "-",
        etaDate: saved.etaDate ?? "-",
        trackingNumber: saved.trackingNumber,
        requestedBySlackUserId: input.slackUserId
      });
    }
  }

  await input.reply(
    formatEtaCaptureConfirmation({
      vendorName: saved.vendorName,
      poNumber: saved.poNumber ?? parsed.poNumber ?? "-",
      etaDate: saved.etaDate ?? parsed.etaDate ?? "-",
      trackingNumber: saved.trackingNumber,
      updateScope: saved.updateScope
    })
  );

  return true;
}
