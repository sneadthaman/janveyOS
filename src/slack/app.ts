import { App } from "@slack/bolt";
import type { KnownBlock } from "@slack/types";
import { config } from "../shared/config.js";
import { logger } from "../shared/logger.js";
import { handleQuoteToSoButtonAction, handleQuoteToSoSlackMessage } from "../domain/services/slack/quote-to-so-conversation.js";
import { handleQuoteToSoApprovalAction } from "../domain/services/slack/quote-to-so-approval.js";
import { handleEtaSlackQuery } from "../domain/services/slack/eta-query-conversation.js";
import { handleEtaSlackCapture } from "../domain/services/slack/eta-capture-conversation.js";
import { handleEtaUpdateApprovalAction } from "../domain/services/slack/eta-update-approval.js";

type SlashTool =
  | "item_lookup"
  | "eta_lookup"
  | "pricing_lookup"
  | "quote_to_so_preview"
  | "new_item_draft"
  | "pricing_update_preview";

function parseCommandText(raw: string): { tool?: SlashTool; payload: Record<string, unknown>; error?: string } {
  const [toolRaw, ...rest] = raw.trim().split(" ");
  const tool = toolRaw as SlashTool | undefined;
  const allowed: SlashTool[] = [
    "item_lookup",
    "eta_lookup",
    "pricing_lookup",
    "quote_to_so_preview",
    "new_item_draft",
    "pricing_update_preview"
  ];

  if (!tool || !allowed.includes(tool)) {
    return {
      payload: {},
      error:
        "Usage: /janvey <tool> <json_payload>. Tools: item_lookup, eta_lookup, pricing_lookup, quote_to_so_preview, new_item_draft, pricing_update_preview"
    };
  }

  if (rest.length === 0) return { tool, payload: {} };

  const payloadText = rest.join(" ").trim();
  try {
    return { tool, payload: JSON.parse(payloadText) as Record<string, unknown> };
  } catch {
    return {
      payload: {},
      error: "Payload must be valid JSON."
    };
  }
}

function endpointForTool(tool: SlashTool) {
  switch (tool) {
    case "item_lookup":
      return "/api/tools/item-lookup";
    case "eta_lookup":
      return "/api/tools/eta-lookup";
    case "pricing_lookup":
      return "/api/tools/pricing-lookup";
    case "quote_to_so_preview":
      return "/api/tools/quote-to-so/preview";
    case "new_item_draft":
      return "/api/tools/new-item/draft";
    case "pricing_update_preview":
      return "/api/tools/pricing-update/preview";
  }
}

async function executeTool(tool: SlashTool, payload: Record<string, unknown>, actorId: string) {
  const endpoint = endpointForTool(tool);
  const response = await fetch(`http://localhost:${config.PORT}${endpoint}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(config.AGENT_SHARED_SECRET ? { "x-agent-secret": config.AGENT_SHARED_SECRET } : {})
    },
    body: JSON.stringify({ ...payload, requested_by: actorId, source: "slack" })
  });

  const body = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(typeof body.error === "string" ? body.error : `Tool error (${response.status})`);
  }
  return body;
}

export function createSlackApp() {
  const app = new App({
    token: config.SLACK_BOT_TOKEN,
    signingSecret: config.SLACK_SIGNING_SECRET,
    socketMode: true,
    appToken: config.SLACK_APP_TOKEN
  });

  app.command("/janvey", async ({ command, ack, respond }) => {
    await ack();

    const parsed = parseCommandText(command.text ?? "");
    if (parsed.error || !parsed.tool) {
      await respond(parsed.error ?? "Invalid command.");
      return;
    }

    try {
      const result = await executeTool(parsed.tool, parsed.payload, command.user_id);
      await respond(JSON.stringify(result, null, 2));
    } catch (error) {
      logger.error("Slack tool command failed", error);
      await respond("Command failed. Check Janvey OS logs and try again.");
    }
  });

  app.message(async ({ message, say }) => {
    if (!("text" in message) || !message.text) return;
    if (message.subtype) return;
    if (/^<@[^>]+>/.test(message.text.trim())) return;

    try {
      const etaCaptureHandled = await handleEtaSlackCapture({
        text: message.text,
        slackUserId: message.user,
        slackChannelId: message.channel,
        slackMessageTs: typeof message.ts === "string" ? message.ts : undefined,
        reply: async (out) => {
          await say(out);
        }
      });
      if (etaCaptureHandled) return;

      const etaHandled = await handleEtaSlackQuery({
        text: message.text,
        reply: async (out) => {
          await say(out);
        }
      });
      if (etaHandled) return;

      const handled = await handleQuoteToSoSlackMessage({
        slackUserId: message.user,
        channelId: message.channel,
        threadTs: "thread_ts" in message && typeof message.thread_ts === "string" ? message.thread_ts : undefined,
        messageTs: typeof message.ts === "string" ? message.ts : undefined,
        text: message.text,
        reply: async (out) => {
          if (typeof out === "string") {
            await say(out);
            return;
          }
          await say({ text: out.text, ...(out.blocks ? { blocks: out.blocks as unknown as KnownBlock[] } : {}) });
        }
      });
      if (handled) return;
    } catch (error) {
      logger.error("Slack quote conversion flow failed", error);
      await say("I hit an error while preparing quote conversion. Please try again.");
    }
  });

  app.event("app_mention", async ({ event, say }) => {
    try {
      if (!event.user) {
        console.log("[slack] app_mention missing user; skipping");
        return;
      }

      console.log("[slack] received app_mention event", {
        user: event.user,
        channel: event.channel,
        ts: event.ts,
        text: event.text
      });

      const rawText = (event.text ?? "").trim();
      const cleanedText = rawText.replace(/^<@[^>]+>\s*/, "").trim();
      console.log("[slack] app_mention cleaned text", { cleanedText });

      const etaCaptureHandled = await handleEtaSlackCapture({
        text: cleanedText,
        slackUserId: event.user,
        slackChannelId: event.channel,
        slackMessageTs: event.ts,
        reply: async (out) => {
          await say(out);
        }
      });
      if (etaCaptureHandled) return;

      const etaHandled = await handleEtaSlackQuery({
        text: cleanedText,
        reply: async (out) => {
          await say(out);
        }
      });
      if (etaHandled) return;

      const handled = await handleQuoteToSoSlackMessage({
        slackUserId: event.user,
        channelId: event.channel,
        threadTs: undefined,
        messageTs: event.ts,
        text: cleanedText,
        reply: async (out) => {
          if (typeof out === "string") {
            await say(out);
            return;
          }
          await say({ text: out.text, ...(out.blocks ? { blocks: out.blocks as unknown as KnownBlock[] } : {}) });
        }
      });

      console.log("[slack] app_mention quote_to_so intent matched", { matched: handled });
    } catch (error) {
      logger.error("Slack app_mention quote conversion flow failed", error);
      await say("I hit an error while preparing quote conversion. Please try again.");
    }
  });

  app.action("quote_to_so_add_po", async ({ ack, body, say, action }) => {
    await ack();
    if (!("user" in body) || !("channel" in body) || !say) return;
    const actionValue = "value" in action && typeof action.value === "string" ? action.value : "";
    await handleQuoteToSoButtonAction({
      actionId: "quote_to_so_add_po",
      value: actionValue,
      slackUserId: body.user.id,
      slackChannelId: body.channel?.id ?? "",
      slackMessageTs: "message" in body && typeof body.message?.ts === "string" ? body.message.ts : undefined,
      reply: async (out) => {
        if (typeof out === "string") {
          await say(out);
          return;
        }
        await say({ text: out.text, ...(out.blocks ? { blocks: out.blocks as unknown as KnownBlock[] } : {}) });
      }
    });
  });

  app.action("quote_to_so_no_po", async ({ ack, body, say, action }) => {
    await ack();
    if (!("user" in body) || !("channel" in body) || !say) return;
    const actionValue = "value" in action && typeof action.value === "string" ? action.value : "";
    await handleQuoteToSoButtonAction({
      actionId: "quote_to_so_no_po",
      value: actionValue,
      slackUserId: body.user.id,
      slackChannelId: body.channel?.id ?? "",
      slackMessageTs: "message" in body && typeof body.message?.ts === "string" ? body.message.ts : undefined,
      reply: async (out) => {
        if (typeof out === "string") {
          await say(out);
          return;
        }
        await say({ text: out.text, ...(out.blocks ? { blocks: out.blocks as unknown as KnownBlock[] } : {}) });
      }
    });
  });

  app.action("quote_to_so_cancel", async ({ ack, body, say, action }) => {
    await ack();
    if (!("user" in body) || !("channel" in body) || !say) return;
    const actionValue = "value" in action && typeof action.value === "string" ? action.value : "";
    await handleQuoteToSoButtonAction({
      actionId: "quote_to_so_cancel",
      value: actionValue,
      slackUserId: body.user.id,
      slackChannelId: body.channel?.id ?? "",
      slackMessageTs: "message" in body && typeof body.message?.ts === "string" ? body.message.ts : undefined,
      reply: async (out) => {
        if (typeof out === "string") {
          await say(out);
          return;
        }
        await say({ text: out.text, ...(out.blocks ? { blocks: out.blocks as unknown as KnownBlock[] } : {}) });
      }
    });
  });

  app.action("quote_to_so_approve_request", async ({ ack, action, body, respond, say }) => {
    await ack();
    if (!("user" in body)) return;
    const actionValue = "value" in action && typeof action.value === "string" ? action.value : "";
    const result = await handleQuoteToSoApprovalAction({
      actionId: "quote_to_so_approve_request",
      value: actionValue,
      actorSlackUserId: body.user.id,
      slackChannelId: "channel" in body && body.channel?.id ? body.channel.id : undefined,
      slackMessageTs: "message" in body && typeof body.message?.ts === "string" ? body.message.ts : undefined
    });
    if (result.kind === "unauthorized") {
      if (respond) await respond({ response_type: "ephemeral", text: result.message });
      return;
    }
    if (say && result.message.trim().length > 0) await say(result.message);
  });

  app.action("quote_to_so_reject_request", async ({ ack, action, body, respond, say }) => {
    await ack();
    if (!("user" in body)) return;
    const actionValue = "value" in action && typeof action.value === "string" ? action.value : "";
    const result = await handleQuoteToSoApprovalAction({
      actionId: "quote_to_so_reject_request",
      value: actionValue,
      actorSlackUserId: body.user.id,
      slackChannelId: "channel" in body && body.channel?.id ? body.channel.id : undefined,
      slackMessageTs: "message" in body && typeof body.message?.ts === "string" ? body.message.ts : undefined
    });
    if (result.kind === "unauthorized") {
      if (respond) await respond({ response_type: "ephemeral", text: result.message });
      return;
    }
    if (say && result.message.trim().length > 0) await say(result.message);
  });

  app.action("quote_to_so_cancel_request", async ({ ack, action, body, respond, say }) => {
    await ack();
    if (!("user" in body)) return;
    const actionValue = "value" in action && typeof action.value === "string" ? action.value : "";
    const result = await handleQuoteToSoApprovalAction({
      actionId: "quote_to_so_cancel_request",
      value: actionValue,
      actorSlackUserId: body.user.id,
      slackChannelId: "channel" in body && body.channel?.id ? body.channel.id : undefined,
      slackMessageTs: "message" in body && typeof body.message?.ts === "string" ? body.message.ts : undefined
    });
    if (result.kind === "unauthorized") {
      if (respond) await respond({ response_type: "ephemeral", text: result.message });
      return;
    }
    if (say && result.message.trim().length > 0) await say(result.message);
  });

  app.action("eta_update_approve_request", async ({ ack, action, body, respond, say }) => {
    await ack();
    if (!("user" in body)) return;
    const actionValue = "value" in action && typeof action.value === "string" ? action.value : "";
    const result = await handleEtaUpdateApprovalAction({
      actionId: "eta_update_approve_request",
      value: actionValue,
      actorSlackUserId: body.user.id,
      slackChannelId: "channel" in body && body.channel?.id ? body.channel.id : undefined,
      slackMessageTs: "message" in body && typeof body.message?.ts === "string" ? body.message.ts : undefined
    });
    if (result.kind === "unauthorized") {
      if (respond) await respond({ response_type: "ephemeral", text: result.message });
      return;
    }
    if (say) await say(result.message);
  });

  app.action("eta_update_reject_request", async ({ ack, action, body, respond, say }) => {
    await ack();
    if (!("user" in body)) return;
    const actionValue = "value" in action && typeof action.value === "string" ? action.value : "";
    const result = await handleEtaUpdateApprovalAction({
      actionId: "eta_update_reject_request",
      value: actionValue,
      actorSlackUserId: body.user.id,
      slackChannelId: "channel" in body && body.channel?.id ? body.channel.id : undefined,
      slackMessageTs: "message" in body && typeof body.message?.ts === "string" ? body.message.ts : undefined
    });
    if (result.kind === "unauthorized") {
      if (respond) await respond({ response_type: "ephemeral", text: result.message });
      return;
    }
    if (say) await say(result.message);
  });

  app.action("eta_update_cancel_request", async ({ ack, action, body, respond, say }) => {
    await ack();
    if (!("user" in body)) return;
    const actionValue = "value" in action && typeof action.value === "string" ? action.value : "";
    const result = await handleEtaUpdateApprovalAction({
      actionId: "eta_update_cancel_request",
      value: actionValue,
      actorSlackUserId: body.user.id,
      slackChannelId: "channel" in body && body.channel?.id ? body.channel.id : undefined,
      slackMessageTs: "message" in body && typeof body.message?.ts === "string" ? body.message.ts : undefined
    });
    if (result.kind === "unauthorized") {
      if (respond) await respond({ response_type: "ephemeral", text: result.message });
      return;
    }
    if (say) await say(result.message);
  });

  return app;
}
