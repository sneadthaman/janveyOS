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
import { postSlackMessage, updateSlackMessage } from "./quote-to-so-notifier.js";
import { canExecuteActionRequest, isTerminalActionRequestStatus } from "../actions/action-request-status.js";

type SlackReplyPayload = {
  text: string;
  blocks?: Array<Record<string, unknown>>;
};

type QuoteToSoApprovalActionId = "quote_to_so_approve_request" | "quote_to_so_reject_request" | "quote_to_so_cancel_request";

type QuoteToSoApprovalButtonValue = {
  actionRequestId: string;
  quoteInternalId?: string;
  quoteTranId?: string;
  customerName?: string | null;
  poSource?: string | null;
  poNumber?: string | null;
  requestedBySlackUserId?: string | null;
};

type HandleApprovalActionResult =
  | { kind: "unauthorized"; message: string }
  | { kind: "ok"; message: string };

function statusEmoji(status: "executed" | "failed" | "rejected" | "cancelled" | "running") {
  if (status === "executed") return "✅";
  if (status === "failed") return "❌";
  if (status === "rejected") return "🚫";
  if (status === "cancelled") return "🛑";
  return "⏳";
}

function statusLabel(status: "executed" | "failed" | "rejected" | "cancelled" | "running") {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function buildApprovalStatusBlocks(input: {
  status: "executed" | "failed" | "rejected" | "cancelled" | "running";
  actionRequestId: string;
  quoteTranId?: string;
  actorSlackUserId: string;
  atIso?: string;
  details?: string[];
}) {
  const at = input.atIso ? new Date(input.atIso).toLocaleString("en-US") : new Date().toLocaleString("en-US");
  const details = input.details && input.details.length > 0 ? `\n${input.details.map((d) => `• ${d}`).join("\n")}` : "";
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          `${statusEmoji(input.status)} *${statusLabel(input.status)}*\n` +
          `• Request: ${input.actionRequestId}\n` +
          `• Quote: ${input.quoteTranId ?? "(unknown)"}\n` +
          `• By: <@${input.actorSlackUserId}>\n` +
          `• At: ${at}${details}`
      }
    }
  ] as Array<Record<string, unknown>>;
}

function buildSalesOrderUrl(input: { salesOrderInternalId?: string; netsuiteAccountBaseUrl?: string | null }) {
  if (!input.salesOrderInternalId) return null;
  const base = String(input.netsuiteAccountBaseUrl ?? "").trim();
  if (!base) return null;
  return `${base.replace(/\/+$/, "")}/app/accounting/transactions/salesord.nl?id=${encodeURIComponent(input.salesOrderInternalId)}`;
}

export function parseApproverSlackUserIds(raw: string | undefined): string[] {
  return String(raw ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export function isAuthorizedQuoteToSoApprover(slackUserId: string): boolean {
  const allowed = parseApproverSlackUserIds(config.QUOTE_TO_SO_APPROVER_SLACK_USER_IDS);
  if (allowed.length === 0) return true;
  return allowed.includes(slackUserId.trim());
}

function parseApprovalButtonValue(value: string): QuoteToSoApprovalButtonValue | null {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const actionRequestId = String(parsed.actionRequestId ?? "").trim();
    if (!actionRequestId) return null;
    return {
      actionRequestId,
      quoteInternalId: typeof parsed.quoteInternalId === "string" ? parsed.quoteInternalId : undefined,
      quoteTranId: typeof parsed.quoteTranId === "string" ? parsed.quoteTranId : undefined,
      customerName: typeof parsed.customerName === "string" ? parsed.customerName : null,
      poSource: typeof parsed.poSource === "string" ? parsed.poSource : null,
      poNumber: typeof parsed.poNumber === "string" ? parsed.poNumber : null,
      requestedBySlackUserId: typeof parsed.requestedBySlackUserId === "string" ? parsed.requestedBySlackUserId : null
    };
  } catch {
    return null;
  }
}

function extractSalesOrderDisplay(outputJson: unknown): string | null {
  const output = (outputJson ?? {}) as Record<string, unknown>;
  const target = (output.target ?? {}) as Record<string, unknown>;
  const userResult = (output.userResult ?? {}) as Record<string, unknown>;
  const tranId = String(target.tranId ?? userResult.salesOrderTranId ?? "").trim();
  const internalId = String(target.internalId ?? userResult.salesOrderInternalId ?? "").trim();
  return tranId || internalId || null;
}

function currentStatusMessage(row: { id: string; status: string; output_json?: unknown }) {
  if (row.status === "executed") {
    const so = extractSalesOrderDisplay(row.output_json);
    if (so) return `Request ${row.id} is already executed. Sales Order: ${so}.`;
    return `Request ${row.id} is already executed.`;
  }
  if (isTerminalActionRequestStatus(row.status) && row.status !== "executed") {
    if (row.status === "failed") return `Request ${row.id} already failed.`;
    if (row.status === "cancelled") return `Request ${row.id} is already cancelled.`;
    if (row.status === "rejected") return `Request ${row.id} is already rejected/cancelled.`;
  }
  if (row.status === "failed") return `Request ${row.id} already failed.`;
  if (row.status === "running") return `Request ${row.id} is already running.`;
  if (row.status === "cancelled") return `Request ${row.id} is already cancelled.`;
  if (row.status === "rejected") return `Request ${row.id} is already rejected/cancelled.`;
  if (row.status === "approved") return `Request ${row.id} is already approved and queued for execution.`;
  return `Request ${row.id} status is ${row.status}.`;
}

function normalizePoSourceText(input: { poSource?: string | null; poNumber?: string | null }) {
  const poNumber = String(input.poNumber ?? "").trim();
  const source = String(input.poSource ?? "").trim().toLowerCase();
  if (source === "user_supplied" && poNumber) return `Entered by user: ${poNumber}`;
  if (source === "original_quote_po" || source === "quote_po" || source === "quote_original_po") return "Original quote PO";
  if (source === "no_po") return "No PO";
  if (poNumber) return `Entered by user: ${poNumber}`;
  return "No PO";
}

function escapeMrkdwn(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function buildQuoteToSoApprovalBlocks(input: {
  actionRequestId: string;
  quoteTranId: string;
  quoteInternalId: string;
  customerName?: string | null;
  poSource?: string | null;
  poNumber?: string | null;
  requestedBySlackUserId?: string | null;
}) {
  const poSourceText = normalizePoSourceText({ poSource: input.poSource, poNumber: input.poNumber });
  const requestedByText = input.requestedBySlackUserId ? `<@${escapeMrkdwn(input.requestedBySlackUserId)}>` : "Unknown user";

  const value = (actionId: QuoteToSoApprovalActionId) =>
    JSON.stringify({
      actionId,
      actionRequestId: input.actionRequestId,
      quoteInternalId: input.quoteInternalId,
      quoteTranId: input.quoteTranId,
      customerName: input.customerName ?? null,
      poSource: input.poSource ?? null,
      poNumber: input.poNumber ?? null,
      requestedBySlackUserId: input.requestedBySlackUserId ?? null
    });

  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          "*Quote → Sales Order Approval Request*\n" +
          `• Quote #: ${escapeMrkdwn(input.quoteTranId)}\n` +
          `• Customer: ${escapeMrkdwn(input.customerName?.trim() || "Unknown Customer")}\n` +
          `• PO source: ${escapeMrkdwn(poSourceText)}\n` +
          `• Requested by: ${requestedByText}\n` +
          `• Request id: ${escapeMrkdwn(input.actionRequestId)}`
      }
    },
    {
      type: "actions",
      block_id: "quote_to_so_approval_decision",
      elements: [
        {
          type: "button",
          action_id: "quote_to_so_approve_request",
          text: { type: "plain_text", text: "Approve / Create Sales Order" },
          style: "primary",
          value: value("quote_to_so_approve_request")
        },
        {
          type: "button",
          action_id: "quote_to_so_reject_request",
          text: { type: "plain_text", text: "Reject" },
          style: "danger",
          value: value("quote_to_so_reject_request")
        },
        {
          type: "button",
          action_id: "quote_to_so_cancel_request",
          text: { type: "plain_text", text: "Cancel" },
          value: value("quote_to_so_cancel_request")
        }
      ]
    }
  ] as Array<Record<string, unknown>>;
}

export function formatQuoteToSoApprovalMessage(input: {
  quoteTranId: string;
  customerName?: string | null;
  poSource?: string | null;
  poNumber?: string | null;
  requestedBySlackUserId?: string | null;
  actionRequestId: string;
}) {
  const poSourceText = normalizePoSourceText({ poSource: input.poSource, poNumber: input.poNumber });
  const requestedByText = input.requestedBySlackUserId ? `<@${input.requestedBySlackUserId}>` : "Unknown user";
  return (
    "Quote → Sales Order approval needed.\n" +
    `Quote #: ${input.quoteTranId}\n` +
    `Customer: ${input.customerName?.trim() || "Unknown Customer"}\n` +
    `PO source: ${poSourceText}\n` +
    `Requested by: ${requestedByText}\n` +
    `Request id: ${input.actionRequestId}`
  );
}

export async function handleQuoteToSoApprovalAction(input: {
  actionId: QuoteToSoApprovalActionId;
  value: string;
  actorSlackUserId: string;
  slackChannelId?: string;
  slackMessageTs?: string;
}, deps: {
  approveAgentActionRequest: typeof approveAgentActionRequest;
  cancelAgentActionRequest: typeof cancelAgentActionRequest;
  rejectAgentActionRequest: typeof rejectAgentActionRequest;
  getAgentActionRequestById: typeof getAgentActionRequestById;
  claimApprovedActionRequest: typeof claimApprovedActionRequest;
  executeClaimedActionRequest: typeof executeClaimedActionRequest;
  markActionAttemptFailed: typeof markActionAttemptFailed;
  postSlackMessage: typeof postSlackMessage;
  updateSlackMessage: typeof updateSlackMessage;
  isAuthorizedApprover: (slackUserId: string) => boolean;
} = {
  approveAgentActionRequest,
  cancelAgentActionRequest,
  rejectAgentActionRequest,
  getAgentActionRequestById,
  claimApprovedActionRequest,
  executeClaimedActionRequest,
  markActionAttemptFailed,
  postSlackMessage,
  updateSlackMessage,
  isAuthorizedApprover: isAuthorizedQuoteToSoApprover
}): Promise<HandleApprovalActionResult> {
  if (!deps.isAuthorizedApprover(input.actorSlackUserId)) {
    return {
      kind: "unauthorized",
      message: "You are not authorized to approve Quote-to-Sales-Order requests."
    };
  }

  const parsed = parseApprovalButtonValue(input.value);
  if (!parsed) {
    return {
      kind: "ok",
      message: "This approval action payload is invalid. Please refresh and try again."
    };
  }

  const existing = await deps.getAgentActionRequestById(parsed.actionRequestId);
  if (!existing) {
    return { kind: "ok", message: `Request ${parsed.actionRequestId} was not found.` };
  }

  if (!canExecuteActionRequest(existing.status)) {
    return {
      kind: "ok",
      message: currentStatusMessage(existing as { id: string; status: string; output_json?: unknown })
    };
  }

  if (input.actionId === "quote_to_so_approve_request") {
    const approved = await deps.approveAgentActionRequest(existing.id, `slack:${input.actorSlackUserId}`);
    if (input.slackChannelId && input.slackMessageTs) {
      await deps.updateSlackMessage({
        channel: input.slackChannelId,
        ts: input.slackMessageTs,
        text: "⏳ Running",
        blocks: buildApprovalStatusBlocks({
          status: "running",
          actionRequestId: approved.id,
          quoteTranId: parsed.quoteTranId,
          actorSlackUserId: input.actorSlackUserId
        })
      });
    }
    const claimed = await deps.claimApprovedActionRequest(approved.id, `slack-approval-${input.actorSlackUserId}`);
    if (!claimed) {
      const refreshed = await deps.getAgentActionRequestById(approved.id);
      if (refreshed) {
        return { kind: "ok", message: currentStatusMessage(refreshed as { id: string; status: string; output_json?: unknown }) };
      }
      return { kind: "ok", message: `Request ${approved.id} is no longer available.` };
    }

    void (async () => {
      const run = await deps.executeClaimedActionRequest(claimed, `slack-approval-${input.actorSlackUserId}`, {
        suppressSlackCompletionNotification: true
      });
      const inputJson = (existing.input_json ?? {}) as Record<string, unknown>;
      const channel = String(inputJson.slack_channel_id ?? "").trim();
      if (!channel) return;

      if (run.ok) {
        const result = run.result as Record<string, unknown>;
        const target = (result.target ?? {}) as Record<string, unknown>;
        const soTranId = String(target.tranId ?? "").trim();
        const soInternalId = String(target.internalId ?? "").trim();
        const mode = String(result.mode ?? "");
        const wouldSubmit = result.wouldSubmit === true;
        const quoteTranId = String(inputJson.quote_tranid ?? parsed.quoteTranId ?? "").trim();

        if (mode !== "live" || !wouldSubmit) {
          if (input.slackChannelId && input.slackMessageTs) {
            await deps.updateSlackMessage({
              channel: input.slackChannelId,
              ts: input.slackMessageTs,
              text: "✅ Executed",
              blocks: buildApprovalStatusBlocks({
                status: "executed",
                actionRequestId: approved.id,
                quoteTranId: quoteTranId || parsed.quoteTranId,
                actorSlackUserId: input.actorSlackUserId,
                details: ["Live execution disabled (preview only)."]
              })
            });
          }
          await deps.postSlackMessage({
            channel,
            text:
              `ℹ️ Quote-to-Sales-Order request ${approved.id} was approved, but live execution is disabled.\n\n` +
              `Quote: ${quoteTranId || parsed.quoteTranId}\n` +
              `Mode: ${mode || "dry_run"}`
          });
          return;
        }

        const soLink = buildSalesOrderUrl({
          salesOrderInternalId: soInternalId || undefined,
          netsuiteAccountBaseUrl: config.NETSUITE_ACCOUNT_BASE_URL
        });
        if (input.slackChannelId && input.slackMessageTs) {
          await deps.updateSlackMessage({
            channel: input.slackChannelId,
            ts: input.slackMessageTs,
            text: "✅ Executed",
            blocks: buildApprovalStatusBlocks({
              status: "executed",
              actionRequestId: approved.id,
              quoteTranId: quoteTranId || parsed.quoteTranId,
              actorSlackUserId: input.actorSlackUserId,
              details: [
                `Sales Order: ${soTranId || "(unknown tranId)"}`,
                `Sales Order Internal ID: ${soInternalId || "(unknown internalId)"}`,
                ...(soLink ? [`Open Sales Order: ${soLink}`] : [])
              ]
            })
          });
        }
        logger.info("quote_to_so.slack.approval.live_execution_success", {
          requestId: approved.id,
          quoteTranId: quoteTranId || parsed.quoteTranId,
          salesOrderTranId: soTranId || null,
          salesOrderInternalId: soInternalId || null
        });
        await deps.postSlackMessage({
          channel,
          text:
            `✅ Sales Order created.\n` +
            `Quote: ${quoteTranId || parsed.quoteTranId}\n` +
            `Sales Order: ${soTranId || "(unknown tranId)"}\n` +
            `Sales Order Internal ID: ${soInternalId || "(unknown internalId)"}\n` +
            `Customer: ${String(inputJson.customer_name ?? parsed.customerName ?? "Unknown Customer")}\n` +
            `PO: ${String(inputJson.po_number ?? "").trim() || "No PO"}\n` +
            `Approved by: <@${input.actorSlackUserId}>` +
            (soLink ? `\nOpen Sales Order: ${soLink}` : "")
        });
        return;
      }

      const safeError = run.errorMessage || "Unknown quote_to_so execution failure.";
      if (/live execution .* disabled/i.test(safeError) || /NETSUITE_LIVE_QUOTE_TO_SO_ENABLED/i.test(safeError)) {
        if (input.slackChannelId && input.slackMessageTs) {
          await deps.updateSlackMessage({
            channel: input.slackChannelId,
            ts: input.slackMessageTs,
            text: "✅ Executed",
            blocks: buildApprovalStatusBlocks({
              status: "executed",
              actionRequestId: approved.id,
              quoteTranId: String(inputJson.quote_tranid ?? parsed.quoteTranId ?? "").trim() || parsed.quoteTranId,
              actorSlackUserId: input.actorSlackUserId,
              details: ["Live execution disabled."]
            })
          });
        }
        await deps.postSlackMessage({
          channel,
          text:
            `ℹ️ Quote-to-Sales-Order request ${approved.id} was approved, but live execution is disabled.\n\n` +
            `Quote: ${String(inputJson.quote_tranid ?? parsed.quoteTranId ?? "").trim() || parsed.quoteTranId}`
        });
        return;
      }
      if (input.slackChannelId && input.slackMessageTs) {
        await deps.updateSlackMessage({
          channel: input.slackChannelId,
          ts: input.slackMessageTs,
          text: "❌ Failed",
          blocks: buildApprovalStatusBlocks({
            status: "failed",
            actionRequestId: approved.id,
            quoteTranId: String(inputJson.quote_tranid ?? parsed.quoteTranId ?? "").trim() || parsed.quoteTranId,
            actorSlackUserId: input.actorSlackUserId,
            details: [safeError]
          })
        });
      }
      await deps.postSlackMessage({
        channel,
        text:
          `❌ Quote-to-Sales-Order failed.\n` +
          `Request: ${approved.id}\n` +
          `Reason: ${safeError}\n` +
          "Next step: Review logs or retry from dashboard."
      });
    })().catch(async (error) => {
      logger.error("quote_to_so.slack.approval.execute_async_failed", error);
      try {
        const safeMessage = error instanceof Error ? error.message : "Unknown approval execution failure.";
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
        logger.error("quote_to_so.slack.approval.execute_async_mark_failed_error", markErr);
      }
    });

    return {
      kind: "ok",
      message: "Approved. Creating Sales Order…"
    };
  }

  if (input.actionId === "quote_to_so_cancel_request") {
    const cancelled = await deps.cancelAgentActionRequest(existing.id);
    if (input.slackChannelId && input.slackMessageTs) {
      await deps.updateSlackMessage({
        channel: input.slackChannelId,
        ts: input.slackMessageTs,
        text: "🛑 Cancelled",
        blocks: buildApprovalStatusBlocks({
          status: "cancelled",
          actionRequestId: cancelled.id,
          quoteTranId: parsed.quoteTranId,
          actorSlackUserId: input.actorSlackUserId
        })
      });
    }
    return {
      kind: "ok",
      message: `Cancelled request ${cancelled.id}.`
    };
  }
  const rejected = await deps.rejectAgentActionRequest(existing.id);
  if (input.slackChannelId && input.slackMessageTs) {
    await deps.updateSlackMessage({
      channel: input.slackChannelId,
      ts: input.slackMessageTs,
      text: "🚫 Rejected",
      blocks: buildApprovalStatusBlocks({
        status: "rejected",
        actionRequestId: rejected.id,
        quoteTranId: parsed.quoteTranId,
        actorSlackUserId: input.actorSlackUserId
      })
    });
  }
  return {
    kind: "ok",
    message: `Rejected request ${rejected.id}.`
  };
}

export async function notifyQuoteToSoApprovalRequested(input: {
  postMessage: (payload: SlackReplyPayload) => Promise<void>;
  quoteTranId: string;
  quoteInternalId: string;
  customerName?: string | null;
  poSource?: string | null;
  poNumber?: string | null;
  requestedBySlackUserId?: string | null;
  actionRequestId: string;
}) {
  const text = formatQuoteToSoApprovalMessage(input);
  const blocks = buildQuoteToSoApprovalBlocks(input);
  await input.postMessage({ text, blocks });
  logger.info("quote_to_so.slack.approval_request_posted", {
    actionRequestId: input.actionRequestId,
    quoteTranId: input.quoteTranId,
    quoteInternalId: input.quoteInternalId
  });
}
