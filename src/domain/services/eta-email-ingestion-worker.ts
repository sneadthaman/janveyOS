import { logger } from "../../shared/logger.js";
import { config } from "../../shared/config.js";
import { runEtaOutlookIngestionOnce } from "../actions/eta-update/eta-email-ingestion-service.js";

export function startEtaEmailIngestionWorker(intervalMs?: number) {
  if (!config.MICROSOFT_GRAPH_ENABLED) {
    logger.info("ETA Outlook ingestion disabled", { enabled: false });
    return {
      async stop() {
        return;
      }
    };
  }

  const pollMs = intervalMs ?? config.MICROSOFT_GRAPH_POLL_INTERVAL_MS ?? 60_000;
  let inFlight = false;

  const tick = async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      const summary = await runEtaOutlookIngestionOnce();
      logger.info("ETA Outlook ingestion tick", summary);
    } catch (error) {
      logger.error("ETA Outlook ingestion tick failed", error);
    } finally {
      inFlight = false;
    }
  };

  const timer = setInterval(() => {
    void tick();
  }, pollMs);

  void tick();

  logger.info("ETA Outlook ingestion worker started", {
    enabled: true,
    pollMs,
    userEmail: config.MICROSOFT_GRAPH_USER_EMAIL ?? null,
    folderName: config.MICROSOFT_GRAPH_AI_ETA_FOLDER_NAME ?? "AI ETA"
  });

  return {
    async stop() {
      clearInterval(timer);
      logger.info("ETA Outlook ingestion worker stopped");
    }
  };
}
