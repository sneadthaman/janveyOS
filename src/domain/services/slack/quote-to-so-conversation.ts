import { createAgentActionRequest } from "../../repositories/agent-log-repository.js";
import { lookupQuoteByTranId } from "../../../integrations/netsuite/client.js";

type Awaiting = "po_decision" | "po_number";

interface PendingConversation {
  slack_user_id: string;
  channel_id: string;
  quote_tranid: string;
  quote_internal_id: string;
  customer_name: string | null;
  total: string | number | null;
  expiration_date: string | null;
  awaiting: Awaiting;
  created_at: string;
}

const pendingByUser = new Map<string, PendingConversation>();

function normalizeQuoteTranId(raw: string) {
  const cleaned = raw.trim().replace(/^#/, "").toUpperCase();
  const estMatch = cleaned.match(/^EST-?(\d{1,10})$/i);
  if (estMatch) return `EST${estMatch[1]}`;

  const numericMatch = cleaned.match(/^(\d{1,10})$/);
  if (numericMatch) return `EST${numericMatch[1]}`;

  return null;
}

function extractQuoteTranId(text: string) {
  const estIdMatch = text.match(/\b(EST-?\d{1,10})\b/i);
  if (estIdMatch?.[1]) {
    return normalizeQuoteTranId(estIdMatch[1]);
  }

  const quoteOrEstimateNumberMatch = text.match(/\b(?:quote|estimate)\s*#?\s*(\d{1,10})\b/i);
  if (quoteOrEstimateNumberMatch?.[1]) {
    return normalizeQuoteTranId(quoteOrEstimateNumberMatch[1]);
  }

  return null;
}

function isQuoteConversionIntent(text: string) {
  const quoteTranId = extractQuoteTranId(text);
  if (!quoteTranId) return false;

  const lower = text.toLowerCase();
  const hasConversionSignal = /\b(convert|create|turn|make|sales\s*order|order|so)\b/.test(lower);
  return hasConversionSignal;
}

export function debugExtractQuoteToSoIntent(text: string) {
  return {
    text,
    quoteTranId: extractQuoteTranId(text),
    matched: isQuoteConversionIntent(text)
  };
}

function formatMoney(input: unknown) {
  const n = Number(input);
  if (!Number.isFinite(n)) return String(input ?? "-");
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

function formatDate(input: string | null | undefined) {
  if (!input) return "-";
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return input;
  return d.toLocaleDateString("en-US");
}

async function createQuoteToSoActionRequest(input: {
  slackUserId: string;
  quoteTranId: string;
  quoteInternalId: string;
  customerName: string | null;
  total: string | number | null;
  poNumber?: string;
}) {
  await createAgentActionRequest({
    requestedBy: input.slackUserId,
    source: "slack",
    actionType: "quote_to_so",
    requiresApproval: true,
    approvalStatusTarget: "Pending Approval",
    inputJson: {
      action_type: "quote_to_so",
      quote_tranid: input.quoteTranId,
      quote_internal_id: input.quoteInternalId,
      po_number: input.poNumber ?? null,
      approval_status_target: "Pending Approval",
      source: "slack",
      requested_by: input.slackUserId,
      customer_name: input.customerName,
      quote_total: input.total
    },
    previewJson: {
      quote_tranid: input.quoteTranId,
      quote_internal_id: input.quoteInternalId,
      po_number: input.poNumber ?? null,
      customer_name: input.customerName,
      quote_total: input.total,
      approval_status_target: "Pending Approval"
    },
    status: "pending"
  });
}

export async function handleQuoteToSoSlackMessage(input: {
  slackUserId: string;
  channelId: string;
  text: string;
  reply: (message: string) => Promise<void>;
}) {
  const text = input.text.trim();
  const lower = text.toLowerCase();

  const existing = pendingByUser.get(input.slackUserId);
  if (existing) {
    if (lower === "cancel") {
      pendingByUser.delete(input.slackUserId);
      await input.reply(`Canceled. I won't submit Quote ${existing.quote_tranid}.`);
      return true;
    }

    if (existing.awaiting === "po_decision") {
      if (/^(yes|yes, add po|yes add po|add po|po)$/i.test(lower)) {
        pendingByUser.set(input.slackUserId, { ...existing, awaiting: "po_number" });
        await input.reply(`Send me the PO number to use for Quote ${existing.quote_tranid}.`);
        return true;
      }

      if (/^(no po|no|no po #|no po number)$/i.test(lower)) {
        await createQuoteToSoActionRequest({
          slackUserId: input.slackUserId,
          quoteTranId: existing.quote_tranid,
          quoteInternalId: existing.quote_internal_id,
          customerName: existing.customer_name,
          total: existing.total
        });
        pendingByUser.delete(input.slackUserId);
        await input.reply(
          `Submitted Quote ${existing.quote_tranid} for manager approval. It will be converted to a Sales Order in Pending Approval after approval.`
        );
        return true;
      }

      await input.reply("Reply with `po ABC123`, `no po`, or `cancel`.");
      return true;
    }

    if (existing.awaiting === "po_number") {
      const poMatch = text.match(/^po\s+(.+)$/i);
      const poNumber = (poMatch?.[1] ?? text).trim();
      if (!poNumber) {
        await input.reply("Send a non-empty PO number, or `cancel`.");
        return true;
      }

      await createQuoteToSoActionRequest({
        slackUserId: input.slackUserId,
        quoteTranId: existing.quote_tranid,
        quoteInternalId: existing.quote_internal_id,
        customerName: existing.customer_name,
        total: existing.total,
        poNumber
      });
      pendingByUser.delete(input.slackUserId);
      await input.reply(`Submitted Quote ${existing.quote_tranid} with PO # ${poNumber} for manager approval.`);
      return true;
    }
  }

  if (!isQuoteConversionIntent(text)) return false;

  const quoteTranId = extractQuoteTranId(text);
  if (!quoteTranId) {
    await input.reply("Please provide the exact quote number, for example: `convert quote EST123`.");
    return true;
  }

  const lookup = await lookupQuoteByTranId(quoteTranId);
  if (!lookup.success) {
    await input.reply(`I couldn't find Quote ${quoteTranId} in NetSuite.`);
    return true;
  }

  if (Array.isArray(lookup.quotes) && lookup.quotes.length > 1) {
    await input.reply(`I found multiple quotes matching ${quoteTranId}. Please use the exact quote number.`);
    return true;
  }

  const quote = lookup.quote ?? lookup.quotes?.[0];
  if (!quote?.internalId) {
    await input.reply(`I couldn't find Quote ${quoteTranId} in NetSuite.`);
    return true;
  }

  if (quote.expired === true) {
    await input.reply(
      `Quote ${quote.tranId ?? quoteTranId} is expired as of ${formatDate(quote.expirationDate)}. I won't submit it for conversion unless we add an override flow.`
    );
    return true;
  }

  const resolvedTranId = quote.tranId ?? quoteTranId;
  pendingByUser.set(input.slackUserId, {
    slack_user_id: input.slackUserId,
    channel_id: input.channelId,
    quote_tranid: resolvedTranId,
    quote_internal_id: String(quote.internalId),
    customer_name: quote.customerName ?? null,
    total: quote.total ?? null,
    expiration_date: quote.expirationDate ?? null,
    awaiting: "po_decision",
    created_at: new Date().toISOString()
  });

  await input.reply(
    `I found Quote ${resolvedTranId} for ${quote.customerName ?? "Unknown Customer"}, total ${formatMoney(quote.total)}. ` +
      "Do you want to add a PO number before I submit this for manager approval? Reply with `yes`, `no po`, or `cancel`."
  );
  return true;
}

export function clearSlackConversationStateForUser(slackUserId: string) {
  pendingByUser.delete(slackUserId);
}
