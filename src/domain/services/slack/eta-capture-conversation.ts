import { createAgentActionRequest, findLatestEtaUpdateActionRequestByEtaId } from "../../repositories/agent-log-repository.js";
import { attachActionRequestToEtaUpdate, createEtaUpdate } from "../../actions/eta-update/eta-update-repository.js";
import { parseSlackEtaUpdate } from "../../actions/eta-update/eta-slack-parser.js";
import { notifyEtaUpdateApprovalRequested } from "./eta-update-approval.js";
import { postSlackMessage } from "./quote-to-so-notifier.js";
import { logger } from "../../../shared/logger.js";

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
  now: () => Date;
};

const defaultDependencies: EtaCaptureDependencies = {
  createEtaUpdate,
  attachActionRequestToEtaUpdate,
  createAgentActionRequest,
  findLatestEtaUpdateActionRequestByEtaId,
  notifyEtaUpdateApprovalRequested,
  now: () => new Date()
};

type AwaitingField = "eta_date" | "tracking_number" | "notes";
type PendingManualEtaConversation = {
  poNumber: string;
  slackUserId: string;
  slackChannelId: string;
  threadTs?: string;
  awaiting: AwaitingField;
  etaDate?: string;
  trackingNumber?: string | null;
};

const pendingManualEtaConversations = new Map<string, PendingManualEtaConversation>();

function conversationKey(input: { slackUserId?: string; slackChannelId?: string; threadTs?: string; slackMessageTs?: string }) {
  const user = input.slackUserId ?? "";
  const channel = input.slackChannelId ?? "";
  if (!user || !channel) return "";
  return `${channel}:${user}:${input.threadTs ?? "root"}`;
}

function extractManualEtaIntentPoNumber(text: string): string | null {
  const m = text.match(/\bupdate\s+eta(?:\s+for)?\s+po\s*-?\s*(\d{3,20})\b/i);
  if (!m?.[1]) return null;
  return `PO${m[1]}`;
}

function pad2(n: number) {
  return n < 10 ? `0${n}` : String(n);
}

function toIsoDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return null;
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function parseManualEtaDate(rawText: string, now: Date): string | null {
  const text = rawText.trim();
  if (!text) return null;

  const iso = text.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) return toIsoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const slash = text.match(/\b(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?\b/);
  if (slash) {
    const month = Number(slash[1]);
    const day = Number(slash[2]);
    if (slash[3]) {
      let year = Number(slash[3]);
      if (year < 100) year += 2000;
      return toIsoDate(year, month, day);
    }
    const currentYear = now.getFullYear();
    const thisYear = toIsoDate(currentYear, month, day);
    if (!thisYear) return null;
    if (thisYear >= `${currentYear}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`) return thisYear;
    return toIsoDate(currentYear + 1, month, day);
  }

  const monthName = text.match(
    /\b(Jan|January|Feb|February|Mar|March|Apr|April|May|Jun|June|Jul|July|Aug|August|Sep|Sept|September|Oct|October|Nov|November|Dec|December)\s+(\d{1,2})(?:,\s*(\d{4}))?\b/i
  );
  if (monthName) {
    const mm: Record<string, number> = {
      jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12
    };
    const month = mm[monthName[1].toLowerCase()];
    const day = Number(monthName[2]);
    const year = monthName[3] ? Number(monthName[3]) : now.getFullYear();
    const thisYear = toIsoDate(year, month, day);
    if (!thisYear) return null;
    if (monthName[3]) return thisYear;
    if (thisYear >= `${year}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`) return thisYear;
    return toIsoDate(year + 1, month, day);
  }

  return null;
}

function parseOptionalField(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (/^(skip|none|n\/a)$/i.test(trimmed)) return null;
  return trimmed;
}

export async function handleEtaSlackCapture(input: {
  text: string;
  slackUserId?: string;
  slackChannelId?: string;
  slackMessageTs?: string;
  threadTs?: string;
  reply: (message: string) => Promise<void>;
}, dependencies: EtaCaptureDependencies = defaultDependencies): Promise<boolean> {
  const key = conversationKey(input);
  const trimmedText = input.text.trim();
  const lower = trimmedText.toLowerCase();

  if (key) {
    const pending = pendingManualEtaConversations.get(key);
    if (pending) {
      if (lower === "cancel") {
        pendingManualEtaConversations.delete(key);
        logger.info("eta_manual_slack.cancelled", { poNumber: pending.poNumber, slackUserId: input.slackUserId ?? null });
        await input.reply(`Canceled manual ETA update for ${pending.poNumber}.`);
        return true;
      }

      try {
        if (pending.awaiting === "eta_date") {
          const etaDate = parseManualEtaDate(trimmedText, dependencies.now());
          if (!etaDate) {
            await input.reply("Please provide a valid ETA date (for example: 5/29, 05/29/2026, May 29, or 2026-05-29).");
            return true;
          }
          pending.etaDate = etaDate;
          pending.awaiting = "tracking_number";
          logger.info("eta_manual_slack.date_captured", { poNumber: pending.poNumber, etaDate });
          await input.reply("Got it. Tracking number? (optional; reply `skip` for none)");
          return true;
        }

        if (pending.awaiting === "tracking_number") {
          pending.trackingNumber = parseOptionalField(trimmedText);
          pending.awaiting = "notes";
          logger.info("eta_manual_slack.tracking_captured", {
            poNumber: pending.poNumber,
            hasTracking: Boolean(pending.trackingNumber)
          });
          await input.reply("Any notes? (optional; reply `skip` for none)");
          return true;
        }

        const notes = parseOptionalField(trimmedText);
        logger.info("eta_manual_slack.notes_captured", { poNumber: pending.poNumber, hasNotes: Boolean(notes) });
        pendingManualEtaConversations.delete(key);

        const sourceReferenceParts = [input.slackChannelId, input.slackMessageTs].filter(Boolean);
        const sourceReference = sourceReferenceParts.length ? sourceReferenceParts.join(":") : null;
        const owner = input.slackUserId ?? "unknown_slack_user";
        const rawNotes = notes
          ? `Manual Slack update. Owner: ${owner}. Notes: ${notes}`
          : `Manual Slack update. Owner: ${owner}.`;

        const saved = await dependencies.createEtaUpdate({
          vendorName: "Manual Slack update",
          poNumber: pending.poNumber,
          netsuitePoInternalId: null,
          itemNumber: null,
          netsuiteItemInternalId: null,
          etaDate: pending.etaDate ?? null,
          trackingNumber: pending.trackingNumber ?? null,
          updateScope: "po_all_lines",
          sourceType: "slack",
          sourceReference,
          rawNotes,
          confidence: 0.95,
          status: "parsed"
        });

        const existingRequest = await dependencies.findLatestEtaUpdateActionRequestByEtaId(saved.id);
        let actionRequestId = existingRequest?.id ?? null;
        if (!actionRequestId) {
          actionRequestId = await dependencies.createAgentActionRequest({
            requestedBy: owner,
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
              slack_message_ts: input.slackMessageTs ?? null,
              extraction_confidence: "HIGH",
              eta_source: "manual_slack",
              eta_update_owner: owner
            },
            previewJson: {
              eta_update_id: saved.id,
              po_number: saved.poNumber,
              eta_date: saved.etaDate,
              update_scope: saved.updateScope,
              tracking_number: saved.trackingNumber,
              eta_source: "manual_slack",
              eta_update_owner: owner,
              extraction_confidence: "HIGH",
              notes: notes ?? null
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
              poNumber: saved.poNumber ?? pending.poNumber,
              etaDate: saved.etaDate ?? "-",
              trackingNumber: saved.trackingNumber,
              requestedBySlackUserId: input.slackUserId,
              confidence: "HIGH",
              etaSource: "manual_slack",
              notes: notes ?? "Assumed manual entry from Slack."
            });
          }
        }

        logger.info("eta_manual_slack.approval_created", {
          poNumber: pending.poNumber,
          actionRequestId,
          slackUserId: input.slackUserId ?? null
        });
        await input.reply(`Saved manual ETA update for ${pending.poNumber}. Approval request: ${actionRequestId ?? "existing request"}.`);
        return true;
      } catch (error) {
        pendingManualEtaConversations.delete(key);
        logger.error("eta_manual_slack.failed", error);
        await input.reply("I hit an error while creating this ETA approval. Please try again.");
        return true;
      }
    }
  }

  const manualPoNumber = extractManualEtaIntentPoNumber(trimmedText);
  if (manualPoNumber && key) {
    pendingManualEtaConversations.set(key, {
      poNumber: manualPoNumber,
      slackUserId: input.slackUserId ?? "",
      slackChannelId: input.slackChannelId ?? "",
      threadTs: input.threadTs ?? input.slackMessageTs,
      awaiting: "eta_date"
    });
    logger.info("eta_manual_slack.started", {
      poNumber: manualPoNumber,
      slackUserId: input.slackUserId ?? null,
      slackChannelId: input.slackChannelId ?? null
    });
    logger.info("eta_manual_slack.date_requested", { poNumber: manualPoNumber });
    await input.reply(`Manual ETA update started for ${manualPoNumber}. What is the ETA date?`);
    return true;
  }

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
        slack_message_ts: input.slackMessageTs ?? null,
        eta_source: "manual_slack",
        eta_update_owner: input.slackUserId ?? null
      },
      previewJson: {
        eta_update_id: saved.id,
        po_number: saved.poNumber,
        eta_date: saved.etaDate,
        update_scope: saved.updateScope,
        tracking_number: saved.trackingNumber,
        eta_source: "manual_slack",
        eta_update_owner: input.slackUserId ?? null
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
        requestedBySlackUserId: input.slackUserId,
        etaSource: "manual_slack",
        confidence: "HIGH"
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
