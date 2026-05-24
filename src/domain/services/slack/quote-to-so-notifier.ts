import { config } from "../../../shared/config.js";
import { logger } from "../../../shared/logger.js";

export interface QuoteToSoCompletionNotificationInput {
  slackChannelId: string;
  slackUserId?: string;
  slackThreadTs?: string;
  quoteTranId: string;
  customerName?: string | null;
  salesOrderTranId?: string | null;
  salesOrderInternalId?: string | null;
  poNumber?: string | null;
  netsuiteSalesOrderUrl?: string | null;
}

function buildSalesOrderUrl(input: { netsuiteSalesOrderUrl?: string | null; salesOrderInternalId?: string | null }) {
  if (input.netsuiteSalesOrderUrl) return input.netsuiteSalesOrderUrl;
  if (input.salesOrderInternalId && config.NETSUITE_ACCOUNT_BASE_URL) {
    const base = config.NETSUITE_ACCOUNT_BASE_URL.replace(/\/+$/, "");
    return `${base}/app/accounting/transactions/salesord.nl?id=${encodeURIComponent(input.salesOrderInternalId)}`;
  }
  if (!input.salesOrderInternalId || !config.NETSUITE_ACCOUNT_ID) return null;
  return `https://${config.NETSUITE_ACCOUNT_ID.toLowerCase()}.app.netsuite.com/app/accounting/transactions/salesord.nl?id=${encodeURIComponent(
    input.salesOrderInternalId
  )}`;
}

export function formatQuoteToSoCompletionMessage(input: QuoteToSoCompletionNotificationInput): string {
  const poDisplay = input.poNumber && input.poNumber.trim() ? input.poNumber.trim() : "No PO";
  const soDisplay = input.salesOrderTranId || input.salesOrderInternalId || "(unknown)";
  const customerDisplay = input.customerName?.trim() || "Unknown Customer";
  const soUrl = buildSalesOrderUrl(input);

  let message =
    "✅ Sales Order Created\n\n" +
    `Quote: ${input.quoteTranId}\n` +
    `Customer: ${customerDisplay}\n` +
    `Sales Order: ${soDisplay}\n` +
    `PO: ${poDisplay}\n\n` +
    "Your Quote-to-Sales-Order request has been completed.";

  if (soUrl) message += `\n\nOpen Sales Order: ${soUrl}`;
  return message;
}

export async function postSlackMessage(payload: {
  channel: string;
  text: string;
  blocks?: Array<Record<string, unknown>>;
  thread_ts?: string;
}) {
  if (!config.SLACK_BOT_TOKEN) {
    logger.info("quote_to_so.slack.notify.skipped", { reason: "missing_slack_bot_token", channel: payload.channel });
    return;
  }

  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.SLACK_BOT_TOKEN}`,
      "content-type": "application/json; charset=utf-8"
    },
    body: JSON.stringify(payload)
  });

  const result = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  const ok = result.ok === true;
  if (!response.ok || !ok) {
    const error = typeof result.error === "string" ? result.error : `status_${response.status}`;
    throw new Error(`Slack completion notification failed: ${error}`);
  }
}

export async function updateSlackMessage(payload: {
  channel: string;
  ts: string;
  text: string;
  blocks?: Array<Record<string, unknown>>;
}) {
  if (!payload.channel || !payload.ts) {
    logger.info("eta_update.slack_update_message", {
      channel: payload.channel || null,
      ts: payload.ts || null,
      mode: "update_only",
      status: "missing_target_noop"
    });
    return;
  }
  if (!config.SLACK_BOT_TOKEN) return;
  logger.info("eta_update.slack_update_message", {
    channel: payload.channel,
    ts: payload.ts,
    mode: "update_only"
  });
  const response = await fetch("https://slack.com/api/chat.update", {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.SLACK_BOT_TOKEN}`,
      "content-type": "application/json; charset=utf-8"
    },
    body: JSON.stringify(payload)
  });
  const result = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  const ok = result.ok === true;
  if (!response.ok || !ok) {
    const error = typeof result.error === "string" ? result.error : `status_${response.status}`;
    throw new Error(`Slack message update failed: ${error}`);
  }
}

export async function notifyQuoteToSoCompleted(input: QuoteToSoCompletionNotificationInput) {
  const text = formatQuoteToSoCompletionMessage(input);
  await postSlackMessage({
    channel: input.slackChannelId,
    text
  });
}
