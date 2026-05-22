import express from "express";
import multer from "multer";
import { recommendationRouter } from "./routes/recommendations.js";
import { healthRouter } from "./routes/health.js";
import { uploadsRouter } from "./routes/uploads.js";
import { knowledgeRouter } from "./routes/knowledge.js";
import { playbookRouter } from "./routes/playbooks.js";
import { ingestRouter } from "./routes/ingest.js";
import { knowledgeCardsRouter } from "./routes/knowledge-cards.js";
import { toolsRouter } from "./routes/tools.js";
import { agentRouter } from "./routes/agent.js";
import { logger } from "../shared/logger.js";

export function createApiServer() {
  const app = express();
  app.use(express.json({ limit: "10mb" }));

  app.use("/health", healthRouter);
  app.use("/api/recommendations", recommendationRouter);
  app.use("/api/uploads", uploadsRouter);
  app.use("/api/knowledge", knowledgeRouter);
  app.use("/api/playbooks", playbookRouter);
  app.use("/api/ingest", ingestRouter);
  app.use("/api/knowledge-cards", knowledgeCardsRouter);
  app.use("/api/tools", toolsRouter);
  app.use("/api/agent", agentRouter);

  app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof multer.MulterError) {
      return res.status(400).json({ error: `Upload error: ${error.message}` });
    }
    if (error.message.includes("Unsupported file type")) {
      return res.status(400).json({ error: error.message });
    }
    logger.error("Unhandled API error", error);
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}
