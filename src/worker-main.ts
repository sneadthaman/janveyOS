import { startActionExecutionWorker } from "./domain/services/action-execution-worker.js";
import { startEtaEmailIngestionWorker } from "./domain/services/eta-email-ingestion-worker.js";
import { config, assertProductionEnv, isRawEnvSet } from "./shared/config.js";
import { logger } from "./shared/logger.js";

async function bootstrapWorker() {
  assertProductionEnv({ requirePort: false });

  const workerIntervalMs = config.EXECUTION_WORKER_INTERVAL_MS ?? 10_000;
  const worker = startActionExecutionWorker(workerIntervalMs);
  const etaIngestionWorker = startEtaEmailIngestionWorker(config.MICROSOFT_GRAPH_POLL_INTERVAL_MS ?? 60_000);

  logger.info("Worker process started", {
    workerName: "janveyos-worker",
    intervalMs: workerIntervalMs,
    netsuiteLiveQuoteToSoEnv: isRawEnvSet("NETSUITE_LIVE_QUOTE_TO_SO_ENABLED") ? "set" : "missing",
    liveQuoteToSoEnabled: config.NETSUITE_LIVE_QUOTE_TO_SO_ENABLED,
    env: config.NODE_ENV
  });

  logger.info('netsuite eta env check', {
  hasPoEtaUpdateUrl: Boolean(process.env.NETSUITE_PO_ETA_UPDATE_RESTLET_URL),
  hasOpenPoLookupUrl: Boolean(process.env.NETSUITE_OPEN_PO_LOOKUP_RESTLET_URL),
});

  process.on("SIGTERM", async () => {
    logger.info("Shutting down worker...");
    await worker.stop();
    await etaIngestionWorker.stop();
    process.exit(0);
  });
}

bootstrapWorker().catch((error) => {
  logger.error("Fatal worker startup error", error);
  process.exit(1);
});
