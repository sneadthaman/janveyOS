import { logger } from "../../../shared/logger.js";
import { config } from "../../../shared/config.js";
import {
  approveAgentActionRequest,
  cancelAgentActionRequest,
  getAgentActionRequestById,
  rejectAgentActionRequest
} from "../../repositories/agent-manager-repository.js";
import { claimApprovedActionRequest, markActionAttemptFailed } from "../../repositories/agent-worker-repository.js";
import { executeClaimedActionRequest } from "../action-execution-worker.js";
import { updateSlackMessage } from "./quote-to-so-notifier.js";
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

function buildEtaRunningBlocks(input: { poNumber?: string | null; etaDate?: string | null }) {
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "⏳ *Applying ETA update...*\n" + `• PO: ${input.poNumber || "-"}\n` + `• ETA: ${input.etaDate || "-"}`
      }
    }
  ] as Array<Record<string, unknown>>;
}

function buildEtaQueuedBlocks(input: { actionRequestId: string; poNumber?: string | null; etaDate?: string | null }) {
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          "✅ *Approved — queued for NetSuite ETA update*\n" +
          `• PO: ${input.poNumber || "-"}\n` +
          `• ETA: ${input.etaDate || "-"}\n` +
          `• Request: ${input.actionRequestId}`
      }
    }
  ] as Array<Record<string, unknown>>;
}

function buildEtaCompletionBlocks(input: {
  success: boolean;
  actionRequestId: string;
  poNumber?: string | null;
  etaDate?: string | null;
  confidence?: string | null;
  linesUpdated?: number | null;
  netsuiteMessage?: string | null;
  requestedItemCount?: number | null;
  unmatchedItemNumbers?: string[] | null;
  safeErrorMessage?: string | null;
}) {
  if (input.success) {
    const hasPartialWarning =
      typeof input.requestedItemCount === "number" &&
      input.requestedItemCount > 0 &&
      typeof input.linesUpdated === "number" &&
      input.linesUpdated < input.requestedItemCount;
    const unmatchedText =
      input.unmatchedItemNumbers && input.unmatchedItemNumbers.length > 0 ? input.unmatchedItemNumbers.join(", ") : "-";
    return [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            "✅ *ETA update applied*\n" +
            `• PO: ${input.poNumber || "-"}\n` +
            `• ETA: ${input.etaDate || "-"}\n` +
            `• Confidence: ${input.confidence || "-"}\n` +
            `• Updated line count: ${typeof input.linesUpdated === "number" ? String(input.linesUpdated) : "-"}\n` +
            `• NetSuite: ${input.netsuiteMessage || "-"}\n` +
            `_Ref: ${input.actionRequestId}_`
        }
      },
      ...(hasPartialWarning
        ? [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text:
                  "⚠️ *Some requested lines were not updated*\n" +
                  `• Requested item count: ${input.requestedItemCount}\n` +
                  `• Updated line count: ${typeof input.linesUpdated === "number" ? input.linesUpdated : "-"}\n` +
                  `• Unmatched item numbers: ${unmatchedText}`
              }
            }
          ]
        : [])
    ] as Array<Record<string, unknown>>;
  }

  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          "❌ *ETA update failed*\n" +
          `• PO: ${input.poNumber || "-"}\n` +
          `• Reason: ${input.safeErrorMessage || "Unknown execution failure."}\n` +
          "• No NetSuite changes were applied.\n" +
          `_Ref: ${input.actionRequestId}_`
      }
    }
  ] as Array<Record<string, unknown>>;
}

export function buildEtaUpdateApprovalBlocks(input: {
  actionRequestId: string;
  etaUpdateId: string;
  vendorName: string;
  poNumber: string;
  etaDate: string;
  trackingNumber?: string | null;
  requestedBySlackUserId?: string | null;
  etaUpdateOwner?: string | null;
  sender?: string | null;
  subject?: string | null;
  confidence?: string | null;
  etaSource?: string | null;
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
          `• ETA source: ${input.etaSource || "vendor_provided_or_unknown"}\n` +
          `• ETA Update Owner: ${input.etaUpdateOwner || "-"}\n` +
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
  etaUpdateOwner?: string | null;
  sender?: string | null;
  subject?: string | null;
  confidence?: string | null;
  etaSource?: string | null;
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
    if (input.slackChannelId && input.slackMessageTs) {
      const inputJson = (existing.input_json ?? {}) as Record<string, unknown>;
      const poNumber = parsed.poNumber ?? (String(inputJson.po_number ?? "").trim() || "-");
      const etaDate = parsed.etaDate ?? (String(inputJson.eta_date ?? "").trim() || "-");
      if (existing.status === "running") {
        await deps.updateSlackMessage({
          channel: input.slackChannelId,
          ts: input.slackMessageTs,
          text: "⏳ Applying ETA update...",
          blocks: buildEtaRunningBlocks({ poNumber, etaDate })
        });
        return { kind: "ok" as const, message: "" };
      }
      if (existing.status === "executed") {
        await deps.updateSlackMessage({
          channel: input.slackChannelId,
          ts: input.slackMessageTs,
          text: "✅ ETA update applied",
          blocks: buildEtaCompletionBlocks({
            success: true,
            actionRequestId: existing.id,
            poNumber,
            etaDate,
            confidence: String(inputJson.extraction_confidence ?? inputJson.eta_confidence ?? "-"),
            linesUpdated: null,
            netsuiteMessage: typeof (existing.output_json as Record<string, unknown> | null)?.message === "string"
              ? String((existing.output_json as Record<string, unknown>).message)
              : null
          })
        });
        return { kind: "ok" as const, message: "" };
      }
    }
    return { kind: "ok" as const, message: statusMessage(existing as { id: string; status: string }) };
  }

  if (input.actionId === "eta_update_approve_request") {
    const approved = await deps.approveAgentActionRequest(existing.id, `slack:${input.actorSlackUserId}`);
    if (input.slackChannelId && input.slackMessageTs) {
      await deps.updateSlackMessage({
        channel: input.slackChannelId,
        ts: input.slackMessageTs,
        text: "Approved — queued for NetSuite ETA update",
        blocks: buildEtaQueuedBlocks({ actionRequestId: approved.id, poNumber: parsed.poNumber ?? "-", etaDate: parsed.etaDate ?? "-" })
      });
    }

    const claimed = await deps.claimApprovedActionRequest(approved.id, `slack-approval-${input.actorSlackUserId}`);
    if (!claimed) {
      const refreshed = await deps.getAgentActionRequestById(approved.id);
      return { kind: "ok" as const, message: refreshed ? statusMessage(refreshed as { id: string; status: string }) : "Request unavailable." };
    }

    void (async () => {
      logger.info("eta_update.approval_env_check", {
        hasPoEtaUpdateUrl: Boolean(process.env.NETSUITE_PO_ETA_UPDATE_RESTLET_URL),
        hasPoEtaUpdateUrlInConfig: Boolean(config.NETSUITE_PO_ETA_UPDATE_RESTLET_URL)
      });
      logger.info("eta_update.execution.start", {
        actionRequestId: approved.id,
        po: parsed.poNumber ?? (String(existing.input_json?.po_number ?? "").trim() || null),
        slackChannelId: input.slackChannelId ?? null,
        slackMessageTs: input.slackMessageTs ?? null
      });
      const run = await deps.executeClaimedActionRequest(claimed, `slack-approval-${input.actorSlackUserId}`, {
        suppressSlackCompletionNotification: true
      });
      logger.info("eta_update.execution.returned", {
        actionRequestId: approved.id,
        po: parsed.poNumber ?? (String(existing.input_json?.po_number ?? "").trim() || null),
        slackChannelId: input.slackChannelId ?? null,
        slackMessageTs: input.slackMessageTs ?? null,
        executionStatus: run.ok ? "success" : "failed",
        hasOutputJson: run.ok ? Boolean(run.result && typeof run.result === "object") : false
      });
      const inputJson = (existing.input_json ?? {}) as Record<string, unknown>;
      const output = run.ok && run.result && typeof run.result === "object" ? (run.result as Record<string, unknown>) : null;
      const rawExecutionStatus = String(output?.executionStatus ?? (run.ok ? "success" : "failed")).trim().toLowerCase();
      const successStatuses = new Set(["success", "executed", "applied"]);
      const failureStatuses = new Set(["failed", "error"]);
      let isSuccess = successStatuses.has(rawExecutionStatus);
      if (!successStatuses.has(rawExecutionStatus) && !failureStatuses.has(rawExecutionStatus)) {
        logger.info("eta_update.slack_completion_update.unhandled_status", {
          actionRequestId: approved.id,
          po: parsed.poNumber ?? (String(existing.input_json?.po_number ?? "").trim() || null),
          slackChannelId: input.slackChannelId ?? null,
          slackMessageTs: input.slackMessageTs ?? null,
          executionStatus: rawExecutionStatus,
          hasOutputJson: Boolean(output)
        });
        isSuccess = run.ok;
      } else if (failureStatuses.has(rawExecutionStatus)) {
        isSuccess = false;
      }

      if (isSuccess) {
        const output = (run.result as Record<string, unknown>) ?? {};
        const poNumber = String(output.poNumber ?? parsed.poNumber ?? inputJson.po_number ?? "").trim() || parsed.poNumber || "-";
        const etaDate = String(output.etaDate ?? parsed.etaDate ?? inputJson.eta_date ?? "").trim() || parsed.etaDate || "-";
        const confidence = String(
          output.etaConfidence ?? inputJson.confidence_label ?? inputJson.eta_confidence ?? inputJson.extraction_confidence ?? "-"
        ).trim();
        const linesUpdated =
          typeof output.linesUpdated === "number" ? output.linesUpdated : null;
        const requestedItemCount = Array.isArray(inputJson.requested_item_numbers)
          ? inputJson.requested_item_numbers.length
          : typeof inputJson.item_number === "string" && inputJson.item_number.trim()
            ? 1
            : null;
        const unmatchedItemNumbers = Array.isArray(output.unmatchedItemNumbers)
          ? output.unmatchedItemNumbers.filter((v) => typeof v === "string") as string[]
          : null;
        const netsuiteResponse =
          output.netsuiteResponse && typeof output.netsuiteResponse === "object"
            ? (output.netsuiteResponse as Record<string, unknown>)
            : null;
        const netsuiteMessage =
          typeof output.message === "string"
            ? output.message
            : typeof netsuiteResponse?.message === "string"
              ? netsuiteResponse.message
              : null;

        if (input.slackChannelId && input.slackMessageTs) {
          logger.info("eta_update.slack_completion_update.before", {
            actionRequestId: approved.id,
            po: poNumber,
            slackChannelId: input.slackChannelId,
            slackMessageTs: input.slackMessageTs,
            executionStatus: "success",
            hasOutputJson: true
          });
          try {
            await deps.updateSlackMessage({
              channel: input.slackChannelId,
              ts: input.slackMessageTs,
              text: "✅ ETA update applied",
              blocks: buildEtaCompletionBlocks({
                success: true,
                actionRequestId: approved.id,
                poNumber,
                etaDate,
                confidence,
                linesUpdated,
                requestedItemCount,
                unmatchedItemNumbers,
                netsuiteMessage
              })
            });
            logger.info("eta_update.slack_completion_update.after", {
              actionRequestId: approved.id,
              po: poNumber,
              slackChannelId: input.slackChannelId,
              slackMessageTs: input.slackMessageTs,
              executionStatus: "success",
              hasOutputJson: true
            });
          } catch (slackError) {
            const slackErr = slackError as { code?: string; message?: string };
            logger.error("eta_update.slack_completion_update.failed", {
              actionRequestId: approved.id,
              po: poNumber,
              slackChannelId: input.slackChannelId,
              slackMessageTs: input.slackMessageTs,
              executionStatus: "success",
              hasOutputJson: true,
              slackErrorCode: typeof slackErr?.code === "string" ? slackErr.code : undefined,
              slackErrorMessage: slackErr?.message ?? String(slackError)
            });
          }
        }
        logger.info("eta_update.slack_completion_update", {
          actionRequestId: approved.id,
          status: "success",
          po: poNumber
        });
        return;
      }

      const safeError = run.errorMessage || "ETA update execution failed.";
      const poNumber = parsed.poNumber ?? (String(inputJson.po_number ?? "").trim() || "-");
      if (input.slackChannelId && input.slackMessageTs) {
        logger.info("eta_update.slack_completion_update.before", {
          actionRequestId: approved.id,
          po: poNumber,
          slackChannelId: input.slackChannelId,
          slackMessageTs: input.slackMessageTs,
          executionStatus: "failed",
          hasOutputJson: false
        });
        try {
          await deps.updateSlackMessage({
            channel: input.slackChannelId,
            ts: input.slackMessageTs,
            text: "❌ ETA update failed",
            blocks: buildEtaCompletionBlocks({
              success: false,
              actionRequestId: approved.id,
              poNumber,
              safeErrorMessage: safeError
            })
          });
          logger.info("eta_update.slack_completion_update.after", {
            actionRequestId: approved.id,
            po: poNumber,
            slackChannelId: input.slackChannelId,
            slackMessageTs: input.slackMessageTs,
            executionStatus: "failed",
            hasOutputJson: false
          });
        } catch (slackError) {
          const slackErr = slackError as { code?: string; message?: string };
          logger.error("eta_update.slack_completion_update.failed", {
            actionRequestId: approved.id,
            po: poNumber,
            slackChannelId: input.slackChannelId,
            slackMessageTs: input.slackMessageTs,
            executionStatus: "failed",
            hasOutputJson: false,
            slackErrorCode: typeof slackErr?.code === "string" ? slackErr.code : undefined,
            slackErrorMessage: slackErr?.message ?? String(slackError)
          });
        }
      }
      logger.info("eta_update.slack_completion_update", {
        actionRequestId: approved.id,
        status: "failed",
        po: poNumber
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
