import { config } from "./shared/config.js";
import { logger } from "./shared/logger.js";
import { createApiServer } from "./server/api.js";
import { createSlackApp } from "./slack/app.js";
import { startActionExecutionWorker } from "./domain/services/action-execution-worker.js";
import type { App } from "@slack/bolt";

function toErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function isTransientSlackSocketModeError(error: unknown) {
  const message = toErrorMessage(error).toLowerCase();
  return (
    message.includes("server explicit disconnect") ||
    (message.includes("unhandled event") && message.includes("connecting")) ||
    message.includes("@slack/socket-mode") ||
    message.includes("finity")
  );
}

function isValidSlackTokenPrefix(value: string | undefined, expectedPrefix: string) {
  return Boolean(value && value.startsWith(expectedPrefix));
}

function shouldAttemptSlackStartup() {
  const hasSigningSecret = Boolean(config.SLACK_SIGNING_SECRET);
  const hasValidAppToken = isValidSlackTokenPrefix(config.SLACK_APP_TOKEN, "xapp-");
  const hasValidBotToken = isValidSlackTokenPrefix(config.SLACK_BOT_TOKEN, "xoxb-");

  if (!hasSigningSecret || !hasValidAppToken || !hasValidBotToken) {
    logger.warn("Slack app startup skipped: missing/invalid Slack config.", {
      hasSigningSecret,
      hasValidAppToken,
      hasValidBotToken,
      env: config.NODE_ENV
    });
    return false;
  }
  return true;
}

function attachSlackSocketDiagnostics(slack: App) {
  const receiver = (slack as unknown as { receiver?: { client?: { on?: (event: string, cb: (...args: unknown[]) => void) => void } } }).receiver;
  const client = receiver?.client;
  if (!client?.on) return;

  client.on("connected", () => {
    logger.info("Slack socket connected");
  });
  client.on("disconnected", () => {
    logger.warn("Slack socket disconnected");
  });
  client.on("reconnecting", () => {
    logger.warn("Slack socket reconnecting");
  });
  client.on("error", (error: unknown) => {
    if (isTransientSlackSocketModeError(error)) {
      logger.warn("Slack socket transient error", { message: toErrorMessage(error) });
      return;
    }
    logger.error("Slack socket error", error);
  });
}

function registerProcessLevelHandlers() {
  process.on("unhandledRejection", (reason) => {
    if (isTransientSlackSocketModeError(reason)) {
      logger.warn("Slack socket transient unhandledRejection", { message: toErrorMessage(reason) });
      return;
    }
    logger.error("Unhandled promise rejection", reason);
  });

  process.on("uncaughtException", (error) => {
    if (isTransientSlackSocketModeError(error)) {
      logger.warn("Slack socket transient uncaughtException", { message: toErrorMessage(error) });
      return;
    }
    logger.error("Uncaught exception", error);
    process.exit(1);
  });
}

async function bootstrap() {
  registerProcessLevelHandlers();

  const server = createApiServer();
  let slack: App | null = null;
  const workerEnabled = config.EXECUTION_WORKER_ENABLED !== "false";
  const workerIntervalMs = config.EXECUTION_WORKER_INTERVAL_MS ?? 10_000;
  const worker = workerEnabled ? startActionExecutionWorker(workerIntervalMs) : null;

  const api = server.listen(config.PORT, () => {
    logger.info(`API listening on :${config.PORT}`);
  });

  if (shouldAttemptSlackStartup()) {
    try {
      slack = createSlackApp();
      attachSlackSocketDiagnostics(slack);
      await slack.start();
      logger.info("Slack app started");
    } catch (error) {
      logger.error("Slack app failed to start", error);
      slack = null;
    }
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
