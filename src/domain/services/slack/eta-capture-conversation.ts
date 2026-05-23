import { createEtaUpdate } from "../../actions/eta-update/eta-update-repository.js";
import { parseSlackEtaUpdate } from "../../actions/eta-update/eta-slack-parser.js";

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
};

const defaultDependencies: EtaCaptureDependencies = {
  createEtaUpdate
};

export async function handleEtaSlackCapture(input: {
  text: string;
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
