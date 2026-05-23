import { Router } from "express";
import { config } from "../../shared/config.js";

export const healthRouter = Router();

healthRouter.get("/", (_req, res) => {
  res.json({
    status: "ok",
    service: "quote-to-so-api",
    timestamp: new Date().toISOString(),
    env: config.NODE_ENV
  });
});
