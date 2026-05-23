import {
  createAgentActionRequest,
  findCompletedQuoteToSoByQuote,
  findLatestQuoteToSoActionRequestForQuote
} from "../../repositories/agent-log-repository.js";
import { getSalesOrderByInternalId, lookupQuoteByTranId } from "../../../integrations/netsuite/client.js";
import { logger } from "../../../shared/logger.js";
import { config } from "../../../shared/config.js";
import { notifyQuoteToSoApprovalRequested } from "./quote-to-so-approval.js";
import { postSlackMessage } from "./quote-to-so-notifier.js";

type Awaiting = "po_decision" | "po_number";
type QuoteToSoButtonActionId = "quote_to_so_add_po" | "quote_to_so_no_po" | "quote_to_so_cancel";

type SlackReplyMessage =
  | string
  | {
      text: string;
      blocks?: Array<Record<string, unknown>>;
    };

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
  slackChannelId: string;
  slackThreadTs?: string;
  slackMessageTs?: string;
  quoteTranId: string;
  quoteInternalId: string;
  customerName: string | null;
  total: string | number | null;
  poNumber?: string;
  poSource?: "user_supplied" | "no_po";
}) {
  const actionRequestId = await createAgentActionRequest({
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
      po_source: input.poSource ?? (input.poNumber ? "user_supplied" : "no_po"),
      approval_status_target: "Pending Approval",
      source: "slack",
      requested_by: input.slackUserId,
      slack_channel_id: input.slackChannelId,
      slack_user_id: input.slackUserId,
      slack_thread_ts: input.slackThreadTs ?? null,
      slack_message_ts: input.slackMessageTs ?? null,
      customer_name: input.customerName,
      quote_total: input.total
    },
    previewJson: {
      quote_tranid: input.quoteTranId,
      quote_internal_id: input.quoteInternalId,
      po_number: input.poNumber ?? null,
      po_source: input.poSource ?? (input.poNumber ? "user_supplied" : "no_po"),
      customer_name: input.customerName,
      quote_total: input.total,
      approval_status_target: "Pending Approval"
    },
    status: "pending"
  });

  if (config.SLACK_BOT_TOKEN) {
    try {
      await notifyQuoteToSoApprovalRequested({
        postMessage: async (payload) => {
          await postSlackMessage({
            channel: input.slackChannelId,
            text: payload.text,
            blocks: payload.blocks
          });
        },
        quoteTranId: input.quoteTranId,
        quoteInternalId: input.quoteInternalId,
        customerName: input.customerName,
        poSource: input.poSource ?? (input.poNumber ? "user_supplied" : "no_po"),
        poNumber: input.poNumber ?? null,
        requestedBySlackUserId: input.slackUserId,
        actionRequestId
      });
    } catch (error) {
      logger.error("quote_to_so.slack.approval_request_post_failed", error);
    }
  }

  return actionRequestId;
}

type QuoteToSoConversationDependencies = {
  lookupQuoteByTranId: typeof lookupQuoteByTranId;
  getSalesOrderByInternalId: typeof getSalesOrderByInternalId;
  createQuoteToSoActionRequest: typeof createQuoteToSoActionRequest;
  findCompletedQuoteToSoByQuote: typeof findCompletedQuoteToSoByQuote;
  findLatestQuoteToSoActionRequestForQuote: typeof findLatestQuoteToSoActionRequestForQuote;
};

const defaultDependencies: QuoteToSoConversationDependencies = {
  lookupQuoteByTranId,
  getSalesOrderByInternalId,
  createQuoteToSoActionRequest,
  findCompletedQuoteToSoByQuote,
  findLatestQuoteToSoActionRequestForQuote
};

function buildQuoteToSoPoDecisionBlocks(input: {
  quoteInternalId: string;
  quoteTranId: string;
  customerName?: string | null;
  quoteTotal?: string | number | null;
  slackChannelId: string;
  slackUserId: string;
  slackMessageTs?: string;
}) {
  const makeValue = (actionId: QuoteToSoButtonActionId) =>
    JSON.stringify({
      actionId,
      quoteInternalId: input.quoteInternalId,
      quoteTranId: input.quoteTranId,
      customerName: input.customerName ?? null,
      quoteTotal: input.quoteTotal ?? null,
      slackChannelId: input.slackChannelId,
      slackUserId: input.slackUserId,
      slackMessageTs: input.slackMessageTs ?? null
    });

  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "How would you like to proceed?"
      }
    },
    {
      type: "actions",
      block_id: "quote_to_so_po_decision",
      elements: [
        {
          type: "button",
          action_id: "quote_to_so_add_po",
          text: { type: "plain_text", text: "Add PO" },
          value: makeValue("quote_to_so_add_po")
        },
        {
          type: "button",
          action_id: "quote_to_so_no_po",
          text: { type: "plain_text", text: "Continue Without PO" },
          value: makeValue("quote_to_so_no_po")
        },
        {
          type: "button",
          action_id: "quote_to_so_cancel",
          text: { type: "plain_text", text: "Cancel" },
          value: makeValue("quote_to_so_cancel"),
          style: "danger"
        }
      ]
    }
  ] as Array<Record<string, unknown>>;
}

type ParsedQuoteToSoButtonValue = {
  actionId: QuoteToSoButtonActionId;
  quoteInternalId: string;
  quoteTranId: string;
  customerName?: string | null;
  quoteTotal?: string | number | null;
  slackChannelId: string;
  slackUserId: string;
  slackMessageTs?: string;
};

function parseQuoteToSoButtonValue(value: string): ParsedQuoteToSoButtonValue | null {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const actionId = String(parsed.actionId ?? "").trim() as QuoteToSoButtonActionId;
    const quoteInternalId = String(parsed.quoteInternalId ?? "").trim();
    const quoteTranId = String(parsed.quoteTranId ?? "").trim();
    const slackChannelId = String(parsed.slackChannelId ?? "").trim();
    const slackUserId = String(parsed.slackUserId ?? "").trim();
    if (!actionId || !quoteInternalId || !quoteTranId || !slackChannelId || !slackUserId) return null;
    return {
      actionId,
      quoteInternalId,
      quoteTranId,
      customerName: typeof parsed.customerName === "string" ? parsed.customerName : null,
      quoteTotal: typeof parsed.quoteTotal === "string" || typeof parsed.quoteTotal === "number" ? parsed.quoteTotal : null,
      slackChannelId,
      slackUserId,
      slackMessageTs: typeof parsed.slackMessageTs === "string" ? parsed.slackMessageTs : undefined
    };
  } catch {
    return null;
  }
}

function parsePoInput(rawText: string) {
  const trimmed = rawText.trim();
  const poMatch = trimmed.match(/^po\s+(.+)$/i);
  return (poMatch?.[1] ?? trimmed).trim();
}

function isLikelyPoNumber(text: string) {
  const normalized = text.trim();
  if (!normalized) return false;
  const lower = normalized.toLowerCase();

  if (
    /^(yes|y|add po|no|no po|skip|cancel)$/.test(lower) ||
    /^(convert|create|turn|make)\b/.test(lower) ||
    /^janveyos\b/.test(lower) ||
    /^(quote|estimate)\b/.test(lower)
  ) {
    return false;
  }

  if (/\best-?\d{1,10}\b/i.test(normalized)) return false;
  if (/\b(quote|estimate)\s*#?\s*\d{1,10}\b/i.test(normalized)) return false;

  return /^[A-Za-z0-9][A-Za-z0-9-]{1,39}$/.test(normalized);
}

export async function handleQuoteToSoSlackMessage(input: {
  slackUserId: string;
  channelId: string;
  threadTs?: string;
  messageTs?: string;
  text: string;
  reply: (message: SlackReplyMessage) => Promise<void>;
}, dependencies: QuoteToSoConversationDependencies = defaultDependencies) {
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
      logger.info("quote_to_so.slack.po_reply.received", {
        slackUserId: input.slackUserId,
        slackChannelId: input.channelId,
        quoteTranId: existing.quote_tranid,
        quoteInternalId: existing.quote_internal_id,
        rawTextNormalized: lower
      });

      if (!/^(yes|y|yes, add po|yes add po|add po|po|no po|no|skip|no po #|no po number|cancel)$/i.test(lower)) {
        const poNumber = parsePoInput(text);
        if (isLikelyPoNumber(poNumber)) {
          const actionRequestId = await dependencies.createQuoteToSoActionRequest({
            slackUserId: input.slackUserId,
            slackChannelId: input.channelId,
            slackThreadTs: input.threadTs,
            slackMessageTs: input.messageTs,
            quoteTranId: existing.quote_tranid,
            quoteInternalId: existing.quote_internal_id,
            customerName: existing.customer_name,
            total: existing.total,
            poNumber,
            poSource: "user_supplied"
          });
          logger.info("quote_to_so.slack.po_reply.saved", {
            quoteTranId: existing.quote_tranid,
            quoteInternalId: existing.quote_internal_id,
            poNumberPresent: true,
            actionRequestId
          });
          pendingByUser.delete(input.slackUserId);
          logger.info("quote_to_so.slack.po_reply.submitted_for_approval", {
            quoteTranId: existing.quote_tranid,
            quoteInternalId: existing.quote_internal_id,
            actionRequestId
          });
          await input.reply(
            `Got it — I added PO ${poNumber} to Quote ${existing.quote_tranid} and submitted it for manager approval.`
          );
          return true;
        }
      }

      if (/^(yes|y|yes, add po|yes add po|add po|po)$/i.test(lower)) {
        pendingByUser.set(input.slackUserId, { ...existing, awaiting: "po_number" });
        await input.reply(`Please send me the PO number for Quote ${existing.quote_tranid}.`);
        return true;
      }

      if (/^(no po|no|skip|no po #|no po number)$/i.test(lower)) {
        const actionRequestId = await dependencies.createQuoteToSoActionRequest({
          slackUserId: input.slackUserId,
          slackChannelId: input.channelId,
          slackThreadTs: input.threadTs,
          slackMessageTs: input.messageTs,
          quoteTranId: existing.quote_tranid,
          quoteInternalId: existing.quote_internal_id,
          customerName: existing.customer_name,
          total: existing.total,
          poSource: "no_po"
        });
        logger.info("quote_to_so.slack.po_reply.saved", {
          quoteTranId: existing.quote_tranid,
          quoteInternalId: existing.quote_internal_id,
          poNumberPresent: false,
          actionRequestId
        });
        pendingByUser.delete(input.slackUserId);
        logger.info("quote_to_so.slack.po_reply.submitted_for_approval", {
          quoteTranId: existing.quote_tranid,
          quoteInternalId: existing.quote_internal_id,
          actionRequestId
        });
        await input.reply(`Got it — I submitted Quote ${existing.quote_tranid} for manager approval with no PO.`);
        return true;
      }

      await input.reply("Reply with `po ABC123`, `no po`, or `cancel`.");
      return true;
    }

    if (existing.awaiting === "po_number") {
      logger.info("quote_to_so.slack.po_reply.received", {
        slackUserId: input.slackUserId,
        slackChannelId: input.channelId,
        quoteTranId: existing.quote_tranid,
        quoteInternalId: existing.quote_internal_id,
        rawTextNormalized: lower
      });
      if (/^(no po|no|skip)$/i.test(lower)) {
        const actionRequestId = await dependencies.createQuoteToSoActionRequest({
          slackUserId: input.slackUserId,
          slackChannelId: input.channelId,
          slackThreadTs: input.threadTs,
          slackMessageTs: input.messageTs,
          quoteTranId: existing.quote_tranid,
          quoteInternalId: existing.quote_internal_id,
          customerName: existing.customer_name,
          total: existing.total,
          poSource: "no_po"
        });
        logger.info("quote_to_so.slack.po_reply.saved", {
          quoteTranId: existing.quote_tranid,
          quoteInternalId: existing.quote_internal_id,
          poNumberPresent: false,
          actionRequestId
        });
        pendingByUser.delete(input.slackUserId);
        logger.info("quote_to_so.slack.po_reply.submitted_for_approval", {
          quoteTranId: existing.quote_tranid,
          quoteInternalId: existing.quote_internal_id,
          actionRequestId
        });
        await input.reply(`Got it — I submitted Quote ${existing.quote_tranid} for manager approval with no PO.`);
        return true;
      }

      const poNumber = parsePoInput(text);
      if (!poNumber) {
        await input.reply("Send a non-empty PO number, or `cancel`.");
        return true;
      }
      if (!isLikelyPoNumber(poNumber)) {
        await input.reply("That does not look like a PO number. Please send the PO number, reply `no po`, or reply `cancel`.");
        return true;
      }

      const actionRequestId = await dependencies.createQuoteToSoActionRequest({
        slackUserId: input.slackUserId,
        slackChannelId: input.channelId,
        slackThreadTs: input.threadTs,
        slackMessageTs: input.messageTs,
        quoteTranId: existing.quote_tranid,
        quoteInternalId: existing.quote_internal_id,
        customerName: existing.customer_name,
        total: existing.total,
        poNumber,
        poSource: "user_supplied"
      });
      logger.info("quote_to_so.slack.po_reply.saved", {
        quoteTranId: existing.quote_tranid,
        quoteInternalId: existing.quote_internal_id,
        poNumberPresent: true,
        actionRequestId
      });
      pendingByUser.delete(input.slackUserId);
      logger.info("quote_to_so.slack.po_reply.submitted_for_approval", {
        quoteTranId: existing.quote_tranid,
        quoteInternalId: existing.quote_internal_id,
        actionRequestId
      });
      await input.reply(`Got it — I added PO ${poNumber} to Quote ${existing.quote_tranid} and submitted it for manager approval.`);
      return true;
    }
  }

  if (!isQuoteConversionIntent(text)) return false;

  const quoteTranId = extractQuoteTranId(text);
  if (!quoteTranId) {
    await input.reply("Please provide the exact quote number, for example: `convert quote EST123`.");
    return true;
  }

  const lookup = await dependencies.lookupQuoteByTranId(quoteTranId);
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
  logger.info("quote_to_so.slack.duplicate_check.start", {
    quoteInternalId: String(quote.internalId),
    quoteTranId: resolvedTranId
  });
  const completed = await dependencies.findCompletedQuoteToSoByQuote({
    quoteInternalId: String(quote.internalId),
    quoteTranId: resolvedTranId
  });

  if (completed.found && completed.salesOrderInternalId) {
    logger.info("quote_to_so.slack.duplicate_check.completed_found", {
      quoteInternalId: String(quote.internalId),
      quoteTranId: resolvedTranId,
      salesOrderInternalId: completed.salesOrderInternalId,
      salesOrderTranId: completed.salesOrderTranId ?? null,
      source: completed.source
    });
    const salesOrderTranId = completed.salesOrderTranId ?? "";
    const salesOrderInternalId = completed.salesOrderInternalId;
    logger.info("quote_to_so.completed_so.verify.start", {
      quoteInternalId: String(quote.internalId),
      salesOrderInternalId,
      salesOrderTranId: salesOrderTranId || null,
      lookupRestletConfigured: Boolean(config.NETSUITE_SALES_ORDER_LOOKUP_RESTLET_URL)
    });

    const verification = await dependencies.getSalesOrderByInternalId(salesOrderInternalId);
    logger.info("quote_to_so.completed_so.verify.result", {
      quoteInternalId: String(quote.internalId),
      salesOrderInternalId,
      salesOrderTranId: salesOrderTranId || null,
      verificationStatus: verification.status,
      returnedInternalId: verification.status === "exists" ? verification.internalId : null,
      returnedTranId: verification.status === "exists" ? (verification.tranId ?? null) : null,
      nsStatus: verification.status === "exists" ? (verification.nsStatus ?? null) : null
    });

    if (verification.status === "exists") {
      const soDisplay = verification.tranId || salesOrderTranId || verification.internalId || salesOrderInternalId;
      await input.reply(`✅ Quote ${resolvedTranId} was already converted to Sales Order ${soDisplay}.`);
      return true;
    }

    if (verification.status === "missing") {
      const soDisplay = salesOrderTranId || salesOrderInternalId;
      await input.reply(
        `⚠️ I found a previous record that Quote ${resolvedTranId} was converted to Sales Order ${soDisplay}, but that Sales Order no longer appears to exist in NetSuite.\n\n` +
          "This may have been manually deleted. Please reset the Quote-to-SO workflow before trying again."
      );
      return true;
    }

    logger.error("quote_to_so.completed_so.verify.error", {
      quoteInternalId: String(quote.internalId),
      salesOrderInternalId,
      salesOrderTranId: salesOrderTranId || null,
      errorCode: verification.errorCode ?? null,
      safeErrorMessage: verification.safeMessage ?? "Could not verify Sales Order in NetSuite right now."
    });
    const soDisplay = salesOrderTranId || salesOrderInternalId;
    await input.reply(
      `⚠️ I found a previous record that Quote ${resolvedTranId} was converted to Sales Order ${soDisplay}, but I could not verify it in NetSuite right now.\n\n` +
        "Please check the Sales Order directly in NetSuite or retry later."
    );
    return true;
  }

  logger.info("quote_to_so.slack.duplicate_check.not_found", {
    quoteInternalId: String(quote.internalId),
    quoteTranId: resolvedTranId
  });

  const latestExisting = await dependencies.findLatestQuoteToSoActionRequestForQuote({
    quoteInternalId: String(quote.internalId),
    quoteTranId: resolvedTranId
  });

  if (latestExisting && (latestExisting.status === "pending" || latestExisting.status === "approved")) {
    const existingInput = (latestExisting.input_json ?? {}) as Record<string, unknown>;
    const poNumberRaw = existingInput.po_number ?? existingInput.poNumber ?? null;
    const poNumber = typeof poNumberRaw === "string" ? poNumberRaw.trim() : "";
    if (poNumber) {
      await input.reply(`I already have Quote ${resolvedTranId} pending manager approval with PO ${poNumber}.`);
      return true;
    }
    await input.reply(`Quote ${resolvedTranId} is already pending manager approval with no PO.`);
    return true;
  }

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
    {
      text: `I found Quote ${resolvedTranId} for ${quote.customerName ?? "Unknown Customer"}, total ${formatMoney(quote.total)}.\n\nHow would you like to proceed?`,
      blocks: buildQuoteToSoPoDecisionBlocks({
        quoteInternalId: String(quote.internalId),
        quoteTranId: resolvedTranId,
        customerName: quote.customerName ?? null,
        quoteTotal: quote.total ?? null,
        slackChannelId: input.channelId,
        slackUserId: input.slackUserId,
        slackMessageTs: input.messageTs
      })
    }
  );
  return true;
}

export async function handleQuoteToSoButtonAction(input: {
  actionId: QuoteToSoButtonActionId;
  value: string;
  slackUserId: string;
  slackChannelId: string;
  slackMessageTs?: string;
  reply: (message: SlackReplyMessage) => Promise<void>;
}, dependencies: QuoteToSoConversationDependencies = defaultDependencies) {
  const parsed = parseQuoteToSoButtonValue(input.value);
  if (!parsed || parsed.actionId !== input.actionId) {
    await input.reply("I couldn't read that action. Please run the convert command again.");
    return true;
  }

  const completed = await dependencies.findCompletedQuoteToSoByQuote({
    quoteInternalId: parsed.quoteInternalId,
    quoteTranId: parsed.quoteTranId
  });
  if (completed.found && completed.salesOrderInternalId) {
    const verification = await dependencies.getSalesOrderByInternalId(completed.salesOrderInternalId);
    const soDisplay = completed.salesOrderTranId || completed.salesOrderInternalId;
    if (verification.status === "exists") {
      await input.reply(`✅ Quote ${parsed.quoteTranId} was already converted to Sales Order ${verification.tranId ?? soDisplay}.`);
      return true;
    }
    if (verification.status === "missing") {
      await input.reply(
        `⚠️ I found a previous record that Quote ${parsed.quoteTranId} was converted to Sales Order ${soDisplay}, but that Sales Order no longer appears to exist in NetSuite.\n\n` +
          "This may have been manually deleted. Please reset the Quote-to-SO workflow before trying again."
      );
      return true;
    }
    await input.reply(
      `⚠️ I found a previous record that Quote ${parsed.quoteTranId} was converted to Sales Order ${soDisplay}, but I could not verify it in NetSuite right now.\n\n` +
        "Please check the Sales Order directly in NetSuite or retry later."
    );
    return true;
  }

  const pending = await dependencies.findLatestQuoteToSoActionRequestForQuote({
    quoteInternalId: parsed.quoteInternalId,
    quoteTranId: parsed.quoteTranId
  });
  if (pending && (pending.status === "pending" || pending.status === "approved")) {
    const existingInput = (pending.input_json ?? {}) as Record<string, unknown>;
    const poNumberRaw = existingInput.po_number ?? existingInput.poNumber ?? null;
    const poNumber = typeof poNumberRaw === "string" ? poNumberRaw.trim() : "";
    if (poNumber) {
      await input.reply(`I already have Quote ${parsed.quoteTranId} pending manager approval with PO ${poNumber}.`);
      return true;
    }
    await input.reply(`Quote ${parsed.quoteTranId} is already pending manager approval with no PO.`);
    return true;
  }

  if (input.actionId === "quote_to_so_cancel") {
    pendingByUser.delete(input.slackUserId);
    await input.reply(`Quote ${parsed.quoteTranId} request cancelled.`);
    return true;
  }

  if (input.actionId === "quote_to_so_add_po") {
    pendingByUser.set(input.slackUserId, {
      slack_user_id: input.slackUserId,
      channel_id: input.slackChannelId,
      quote_tranid: parsed.quoteTranId,
      quote_internal_id: parsed.quoteInternalId,
      customer_name: parsed.customerName ?? null,
      total: parsed.quoteTotal ?? null,
      expiration_date: null,
      awaiting: "po_number",
      created_at: new Date().toISOString()
    });
    await input.reply(`Please send me the PO number for Quote ${parsed.quoteTranId}.`);
    return true;
  }

  const actionRequestId = await dependencies.createQuoteToSoActionRequest({
    slackUserId: input.slackUserId,
    slackChannelId: input.slackChannelId,
    slackMessageTs: input.slackMessageTs,
    quoteTranId: parsed.quoteTranId,
    quoteInternalId: parsed.quoteInternalId,
    customerName: parsed.customerName ?? null,
    total: parsed.quoteTotal ?? null,
    poSource: "no_po"
  });
  logger.info("quote_to_so.slack.po_reply.saved", {
    quoteTranId: parsed.quoteTranId,
    quoteInternalId: parsed.quoteInternalId,
    poNumberPresent: false,
    actionRequestId
  });
  pendingByUser.delete(input.slackUserId);
  logger.info("quote_to_so.slack.po_reply.submitted_for_approval", {
    quoteTranId: parsed.quoteTranId,
    quoteInternalId: parsed.quoteInternalId,
    actionRequestId
  });
  await input.reply(`Got it — I submitted Quote ${parsed.quoteTranId} for manager approval with no PO.`);
  return true;
}

export function clearSlackConversationStateForUser(slackUserId: string) {
  pendingByUser.delete(slackUserId);
}
