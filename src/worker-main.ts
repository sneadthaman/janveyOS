import { startActionExecutionWorker } from "./domain/services/action-execution-worker.js";
import { config, assertProductionEnv } from "./shared/config.js";
import { logger } from "./shared/logger.js";

async function bootstrapWorker() {
  assertProductionEnv({ requirePort: false });

  const workerIntervalMs = config.EXECUTION_WORKER_INTERVAL_MS ?? 10_000;
  const worker = startActionExecutionWorker(workerIntervalMs);

  logger.info("Worker process started", {
    workerName: "action-execution-worker",
    intervalMs: workerIntervalMs,
    liveQuoteToSoEnabled: config.NETSUITE_LIVE_QUOTE_TO_SO_ENABLED === "true",
    env: config.NODE_ENV
  });

  process.on("SIGTERM", async () => {
    logger.info("Shutting down worker...");
    await worker.stop();
    process.exit(0);
  });
}

bootstrapWorker().catch((error) => {
  logger.error("Fatal worker startup error", error);
  process.exit(1);
});
