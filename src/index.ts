import { config } from "./shared/config.js";
import { logger } from "./shared/logger.js";
import { createApiServer } from "./server/api.js";
import { createSlackApp } from "./slack/app.js";
import { startActionExecutionWorker } from "./domain/services/action-execution-worker.js";
import type { App } from "@slack/bolt";

async function bootstrap() {
  const server = createApiServer();
  let slack: App | null = null;
  const workerEnabled = config.EXECUTION_WORKER_ENABLED !== "false";
  const workerIntervalMs = config.EXECUTION_WORKER_INTERVAL_MS ?? 10_000;
  const worker = workerEnabled ? startActionExecutionWorker(workerIntervalMs) : null;

  const api = server.listen(config.PORT, () => {
    logger.info(`API listening on :${config.PORT}`);
  });

  if (config.SLACK_APP_TOKEN && config.SLACK_BOT_TOKEN && config.SLACK_SIGNING_SECRET) {
    slack = createSlackApp();
    await slack.start();
    logger.info("Slack app started");
  } else {
    logger.warn("Slack app disabled. Missing one or more Slack env vars.");
  }

  process.on("SIGTERM", async () => {
    logger.info("Shutting down...");
    api.close();
    if (worker) await worker.stop();
    if (slack) await slack.stop();
    process.exit(0);
  });
}

bootstrap().catch((error) => {
  logger.error("Fatal startup error", error);
  process.exit(1);
});
