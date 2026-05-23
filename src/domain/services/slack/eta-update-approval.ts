import { logger } from "../../../shared/logger.js";
import {
  approveAgentActionRequest,
  cancelAgentActionRequest,
  getAgentActionRequestById,
  rejectAgentActionRequest
} from "../../repositories/agent-manager-repository.js";
import { claimApprovedActionRequest, markActionAttemptFailed } from "../../repositories/agent-worker-repository.js";
import { executeClaimedActionRequest } from "../action-execution-worker.js";
import { postSlackMessage, updateSlackMessage } from "./quote-to-so-notifier.js";
import { canExecuteActionRequest, isTerminalActionRequestStatus } from "../actions/action-request-status.js";
import { isAuthorizedQuoteToSoApprover } from "./quote-to-so-approval.js";

type EtaApprovalActionId = "eta_update_approve_request" | "eta_update_reject_request" | "eta_update_cancel_request";

type EtaApprovalButtonValue = {
  actionRequestId: string;
  etaUpdateId: string;
  poNumber?: string | null;
  vendorName?: string | null;
  etaDate?: string | null;
  trackingNumber?: string | null;
  requestedBySlackUserId?: string | null;
};

function parseApprovalButtonValue(value: string): EtaApprovalButtonValue | null {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const actionRequestId = String(parsed.actionRequestId ?? "").trim();
    const etaUpdateId = String(parsed.etaUpdateId ?? "").trim();
    if (!actionRequestId || !etaUpdateId) return null;
    return {
      actionRequestId,
      etaUpdateId,
      poNumber: typeof parsed.poNumber === "string" ? parsed.poNumber : null,
      vendorName: typeof parsed.vendorName === "string" ? parsed.vendorName : null,
      etaDate: typeof parsed.etaDate === "string" ? parsed.etaDate : null,
      trackingNumber: typeof parsed.trackingNumber === "string" ? parsed.trackingNumber : null,
      requestedBySlackUserId: typeof parsed.requestedBySlackUserId === "string" ? parsed.requestedBySlackUserId : null
    };
  } catch {
    return null;
  }
}

function statusMessage(row: { id: string; status: string }) {
  if (row.status === "executed") return `ETA update request ${row.id} is already executed.`;
  if (row.status === "running") return `ETA update request ${row.id} is already running.`;
  if (row.status === "approved") return `ETA update request ${row.id} is already approved and queued.`;
  if (row.status === "failed") return `ETA update request ${row.id} already failed.`;
  if (row.status === "cancelled") return `ETA update request ${row.id} is already cancelled.`;
  if (row.status === "rejected") return `ETA update request ${row.id} is already rejected.`;
  if (isTerminalActionRequestStatus(row.status)) return `ETA update request ${row.id} is already ${row.status}.`;
  return `ETA update request ${row.id} status is ${row.status}.`;
}

export function buildEtaUpdateApprovalBlocks(input: {
  actionRequestId: string;
  etaUpdateId: string;
  vendorName: string;
  poNumber: string;
  etaDate: string;
  trackingNumber?: string | null;
  requestedBySlackUserId?: string | null;
  sender?: string | null;
  subject?: string | null;
  confidence?: string | null;
  sourceFolder?: string | null;
  proposedAffectedLines?: string | null;
  notes?: string | null;
}) {
  const value = (actionId: EtaApprovalActionId) =>
    JSON.stringify({
      actionId,
      actionRequestId: input.actionRequestId,
      etaUpdateId: input.etaUpdateId,
      poNumber: input.poNumber,
      vendorName: input.vendorName,
      etaDate: input.etaDate,
      trackingNumber: input.trackingNumber ?? null,
      requestedBySlackUserId: input.requestedBySlackUserId ?? null
    });

  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          "*ETA Update Approval Request*\n" +
          `• Vendor: ${input.vendorName}\n` +
          `• PO: ${input.poNumber}\n` +
          `• ETA: ${input.etaDate}\n` +
          `• Tracking: ${input.trackingNumber || "-"}\n` +
          `• Sender: ${input.sender || "-"}\n` +
          `• Subject: ${input.subject || "-"}\n` +
          `• Confidence: ${input.confidence || "-"}\n` +
          `• Source folder: ${input.sourceFolder || "AI ETA"}\n` +
          `• Proposed affected lines: ${input.proposedAffectedLines || "-"}\n` +
          `• Notes: ${input.notes || "-"}\n` +
          `• Requested by: ${input.requestedBySlackUserId ? `<@${input.requestedBySlackUserId}>` : "Unknown user"}\n` +
          `• Request id: ${input.actionRequestId}`
      }
    },
    {
      type: "actions",
      block_id: "eta_update_approval_decision",
      elements: [
        {
          type: "button",
          action_id: "eta_update_approve_request",
          text: { type: "plain_text", text: "Approve ETA Update" },
          style: "primary",
          value: value("eta_update_approve_request")
        },
        {
          type: "button",
          action_id: "eta_update_reject_request",
          text: { type: "plain_text", text: "Reject" },
          style: "danger",
          value: value("eta_update_reject_request")
        },
        {
          type: "button",
          action_id: "eta_update_cancel_request",
          text: { type: "plain_text", text: "Cancel" },
          value: value("eta_update_cancel_request")
        }
      ]
    }
  ] as Array<Record<string, unknown>>;
}

export async function notifyEtaUpdateApprovalRequested(input: {
  postMessage: (payload: { text: string; blocks?: Array<Record<string, unknown>> }) => Promise<void>;
  actionRequestId: string;
  etaUpdateId: string;
  vendorName: string;
  poNumber: string;
  etaDate: string;
  trackingNumber?: string | null;
  requestedBySlackUserId?: string | null;
  sender?: string | null;
  subject?: string | null;
  confidence?: string | null;
  sourceFolder?: string | null;
  proposedAffectedLines?: string | null;
  notes?: string | null;
}) {
  await input.postMessage({
    text: `ETA update approval needed for ${input.poNumber} (${input.etaDate}). Request: ${input.actionRequestId}`,
    blocks: buildEtaUpdateApprovalBlocks(input)
  });
}

export async function handleEtaUpdateApprovalAction(input: {
  actionId: EtaApprovalActionId;
  value: string;
  actorSlackUserId: string;
  slackChannelId?: string;
  slackMessageTs?: string;
}, deps: {
  isAuthorizedApprover: (slackUserId: string) => boolean;
  getAgentActionRequestById: typeof getAgentActionRequestById;
  approveAgentActionRequest: typeof approveAgentActionRequest;
  cancelAgentActionRequest: typeof cancelAgentActionRequest;
  rejectAgentActionRequest: typeof rejectAgentActionRequest;
  claimApprovedActionRequest: typeof claimApprovedActionRequest;
  executeClaimedActionRequest: typeof executeClaimedActionRequest;
  markActionAttemptFailed: typeof markActionAttemptFailed;
  postSlackMessage: typeof postSlackMessage;
  updateSlackMessage: typeof updateSlackMessage;
} = {
  isAuthorizedApprover: isAuthorizedQuoteToSoApprover,
  getAgentActionRequestById,
  approveAgentActionRequest,
  cancelAgentActionRequest,
  rejectAgentActionRequest,
  claimApprovedActionRequest,
  executeClaimedActionRequest,
  markActionAttemptFailed,
  postSlackMessage,
  updateSlackMessage
}) {
  if (!deps.isAuthorizedApprover(input.actorSlackUserId)) {
    return { kind: "unauthorized" as const, message: "You are not authorized to approve ETA update requests." };
  }

  const parsed = parseApprovalButtonValue(input.value);
  if (!parsed) return { kind: "ok" as const, message: "Invalid ETA approval payload." };

  const existing = await deps.getAgentActionRequestById(parsed.actionRequestId);
  if (!existing) return { kind: "ok" as const, message: `Request ${parsed.actionRequestId} was not found.` };
  if (!canExecuteActionRequest(existing.status)) {
    return { kind: "ok" as const, message: statusMessage(existing as { id: string; status: string }) };
  }

  if (input.actionId === "eta_update_approve_request") {
    const approved = await deps.approveAgentActionRequest(existing.id, `slack:${input.actorSlackUserId}`);
    if (input.slackChannelId && input.slackMessageTs) {
      await deps.updateSlackMessage({
        channel: input.slackChannelId,
        ts: input.slackMessageTs,
        text: "⏳ Running",
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text: `⏳ *Running*\n• Request: ${approved.id}\n• PO: ${parsed.poNumber ?? "-"}` }
          }
        ]
      });
    }

    const claimed = await deps.claimApprovedActionRequest(approved.id, `slack-approval-${input.actorSlackUserId}`);
    if (!claimed) {
      const refreshed = await deps.getAgentActionRequestById(approved.id);
      return { kind: "ok" as const, message: refreshed ? statusMessage(refreshed as { id: string; status: string }) : "Request unavailable." };
    }

    void (async () => {
      const run = await deps.executeClaimedActionRequest(claimed, `slack-approval-${input.actorSlackUserId}`, {
        suppressSlackCompletionNotification: true
      });
      const inputJson = (existing.input_json ?? {}) as Record<string, unknown>;
      const channel = String(inputJson.slack_channel_id ?? "").trim();
      if (!channel) return;

      if (run.ok) {
        if (input.slackChannelId && input.slackMessageTs) {
          await deps.updateSlackMessage({
            channel: input.slackChannelId,
            ts: input.slackMessageTs,
            text: "✅ Executed",
            blocks: [
              {
                type: "section",
                text: { type: "mrkdwn", text: `✅ *Executed*\n• Request: ${approved.id}\n• PO: ${parsed.poNumber ?? "-"}\n• ETA: ${parsed.etaDate ?? "-"}` }
              }
            ]
          });
        }
        await deps.postSlackMessage({
          channel,
          text:
            `✅ ETA update applied.\n` +
            `PO: ${parsed.poNumber ?? "-"}\n` +
            `ETA: ${parsed.etaDate ?? "-"}\n` +
            `Request: ${approved.id}`
        });
        return;
      }

      const safeError = run.errorMessage || "ETA update execution failed.";
      if (input.slackChannelId && input.slackMessageTs) {
        await deps.updateSlackMessage({
          channel: input.slackChannelId,
          ts: input.slackMessageTs,
          text: "❌ Failed",
          blocks: [
            {
              type: "section",
              text: { type: "mrkdwn", text: `❌ *Failed*\n• Request: ${approved.id}\n• Reason: ${safeError}` }
            }
          ]
        });
      }
      await deps.postSlackMessage({
        channel,
        text: `❌ ETA update failed.\nRequest: ${approved.id}\nReason: ${safeError}`
      });
    })().catch(async (error) => {
      logger.error("eta_update.slack.approval.execute_async_failed", error);
      try {
        const safeMessage = error instanceof Error ? error.message : "Unknown ETA approval failure.";
        const refreshed = await deps.getAgentActionRequestById(existing.id);
        if (refreshed?.status === "running") {
          await deps.markActionAttemptFailed({
            id: existing.id,
            currentRetryCount: Number(refreshed.retry_count ?? 0),
            forceTerminal: true,
            errorMessage: safeMessage,
            outputJson: {
              execution_meta: {
                approvedBySlackUserId: input.actorSlackUserId,
                failedAt: new Date().toISOString(),
                safeErrorMessage: safeMessage
              }
            }
          });
        }
      } catch (markErr) {
        logger.error("eta_update.slack.approval.execute_async_mark_failed_error", markErr);
      }
    });

    return { kind: "ok" as const, message: "Approved. Applying ETA update…" };
  }

  if (input.actionId === "eta_update_cancel_request") {
    const cancelled = await deps.cancelAgentActionRequest(existing.id);
    if (input.slackChannelId && input.slackMessageTs) {
      await deps.updateSlackMessage({
        channel: input.slackChannelId,
        ts: input.slackMessageTs,
        text: "🛑 Cancelled",
        blocks: [
          { type: "section", text: { type: "mrkdwn", text: `🛑 *Cancelled*\n• Request: ${cancelled.id}` } }
        ]
      });
    }
    return { kind: "ok" as const, message: `Cancelled request ${cancelled.id}.` };
  }

  const rejected = await deps.rejectAgentActionRequest(existing.id);
  if (input.slackChannelId && input.slackMessageTs) {
    await deps.updateSlackMessage({
      channel: input.slackChannelId,
      ts: input.slackMessageTs,
      text: "🚫 Rejected",
      blocks: [{ type: "section", text: { type: "mrkdwn", text: `🚫 *Rejected*\n• Request: ${rejected.id}` } }]
    });
  }
  return { kind: "ok" as const, message: `Rejected request ${rejected.id}.` };
}
