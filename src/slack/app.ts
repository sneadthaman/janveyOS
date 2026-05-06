import { App } from "@slack/bolt";
import { config } from "../shared/config.js";
import { logger } from "../shared/logger.js";
import { generateRecommendation } from "../domain/services/recommendation-service.js";
import { generateAutoscrubberRecommendation, parseAutoscrubberOneMessage } from "../domain/services/autoscrubber-recommendation-service.js";

function formatRecommendation(response: Awaited<ReturnType<typeof generateRecommendation>>) {
  const lines: string[] = [];
  lines.push(`*Summary:* ${response.summary}`);
  if (response.productRecommendations.length > 0) {
    lines.push("*Top Product Options:*");
    for (const item of response.productRecommendations.slice(0, 3)) {
      lines.push(`• ${item.productName} (${item.vendor}) - ${Math.round(item.confidence * 100)}% confidence`);
      lines.push(`  Reason: ${item.reason}`);
    }
  }
  if (response.discoveryQuestions.length > 0) {
    lines.push("*Discovery Questions:*");
    for (const question of response.discoveryQuestions.slice(0, 5)) {
      lines.push(`• ${question}`);
    }
  }
  return lines.join("\n");
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
    const text = (command.text ?? "").trim();
    if (!text.toLowerCase().startsWith("autoscrubber")) {
      await respond("Use `/janvey autoscrubber ...` to run autoscrubber discovery and recommendation.");
      return;
    }
    const freeText = text.replace(/^autoscrubber/i, "").trim();
    const discovery = parseAutoscrubberOneMessage(freeText);
    discovery.slack_user_id = command.user_id;

    const missing: string[] = [];
    if (!discovery.floor_type) missing.push("floor_type");
    if (!discovery.square_footage) missing.push("square_footage");
    if (!discovery.cleaning_frequency) missing.push("cleaning_frequency");
    if (!discovery.budget) missing.push("budget");

    if (missing.length > 0) {
      await respond(
        `I can recommend now, but I still need: ${missing.join(", ")}.\n` +
          "Reply in one line like: `school, VCT, 40000 sqft, daily, ride-on, battery, budget 15k`"
      );
      return;
    }

    const recommendation = await generateAutoscrubberRecommendation({
      discovery,
      source: "slack",
      rawText: freeText
    });
    const best = recommendation.best_fit_product;
    const alt = recommendation.value_alternative;
    const lines = [
      `*Best Fit:* ${best?.product_name ?? "N/A"} (${best?.sku ?? "-"})`,
      `Vendor: ${best?.vendor ?? "-"} | Price: ${best?.price ?? "-"} | Margin: ${
        best ? `${(best.margin_percent * 100).toFixed(2)}%` : "-"
      }`,
      alt ? `*Value Alternative:* ${alt.product_name} (${alt.sku}) | Margin: ${(alt.margin_percent * 100).toFixed(2)}%` : "",
      `*Why It Fits:* ${recommendation.why_it_fits.join(" | ")}`,
      `*How To Sell:* ${recommendation.how_to_sell.join(" | ")}`,
      `*Questions Next:* ${recommendation.questions_to_ask_next.join(" | ")}`,
      `Confidence: ${recommendation.confidence_score}`
    ].filter(Boolean);
    await respond(lines.join("\n"));
  });

  app.message(async ({ message, say }) => {
    if (!("text" in message) || !message.text) return;
    if (message.subtype) return;

    try {
      const lower = message.text.toLowerCase();
      if (lower.includes("autoscrubber")) {
        const discovery = parseAutoscrubberOneMessage(message.text);
        discovery.slack_user_id = message.user;
        const recommendation = await generateAutoscrubberRecommendation({
          discovery,
          source: "slack",
          rawText: message.text
        });
        await say(
          `Best fit: ${recommendation.best_fit_product?.product_name ?? "N/A"} | ` +
            `Price: ${recommendation.best_fit_product?.price ?? "-"} | ` +
            `Margin: ${
              recommendation.best_fit_product
                ? `${(recommendation.best_fit_product.margin_percent * 100).toFixed(2)}%`
                : "-"
            }`
        );
        return;
      }
      const recommendation = await generateRecommendation({
        source: "slack",
        text: message.text,
        userId: message.user
      });
      await say(formatRecommendation(recommendation));
    } catch (error) {
      logger.error("Slack message handler failed", error);
      await say("I hit an error while generating guidance. Try again in a moment.");
    }
  });

  return app;
}
