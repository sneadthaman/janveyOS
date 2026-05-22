import { App } from "@slack/bolt";
import { config } from "../shared/config.js";
import { logger } from "../shared/logger.js";
import { handleQuoteToSoSlackMessage } from "../domain/services/slack/quote-to-so-conversation.js";

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

    try {
      const handled = await handleQuoteToSoSlackMessage({
        slackUserId: message.user,
        channelId: message.channel,
        text: message.text,
        reply: async (text) => {
          await say(text);
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

      const handled = await handleQuoteToSoSlackMessage({
        slackUserId: event.user,
        channelId: event.channel,
        text: cleanedText,
        reply: async (text) => {
          await say({
            text,
            thread_ts: event.ts
          });
        }
      });

      console.log("[slack] app_mention quote_to_so intent matched", { matched: handled });
    } catch (error) {
      logger.error("Slack app_mention quote conversion flow failed", error);
      await say({
        text: "I hit an error while preparing quote conversion. Please try again.",
        thread_ts: event.ts
      });
    }
  });

  return app;
}
