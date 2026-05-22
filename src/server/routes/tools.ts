import { Router } from "express";
import { z } from "zod";
import { config } from "../../shared/config.js";
import { runItemLookupTool } from "../../domain/services/tools/item-lookup-tool.js";
import { runEtaLookupTool } from "../../domain/services/tools/eta-lookup-tool.js";
import { runPricingLookupTool } from "../../domain/services/tools/pricing-lookup-tool.js";
import { runQuoteToSoPreviewTool } from "../../domain/services/tools/quote-to-so-preview-tool.js";
import { runNewItemDraftTool } from "../../domain/services/tools/new-item-draft-tool.js";
import { runPricingUpdatePreviewTool } from "../../domain/services/tools/pricing-update-preview-tool.js";

const withRequesterSchema = {
  requested_by: z.string().min(1).optional(),
  source: z.string().min(1).optional()
};

const itemLookupSchema = z.object({ query: z.string().min(1), ...withRequesterSchema });
const etaLookupSchema = z.object({
  sku: z.string().min(1),
  customer: z.string().min(1),
  sales_order: z.string().optional(),
  ...withRequesterSchema
});
const pricingLookupSchema = z.object({
  sku: z.string().min(1),
  customer: z.string().min(1),
  ...withRequesterSchema
});
const quotePreviewSchema = z.object({ estimate_number: z.string().min(1), ...withRequesterSchema });
const newItemDraftSchema = z.object({
  vendor: z.string().min(1),
  vendor_sku: z.string().min(1),
  description: z.string().min(1),
  ...withRequesterSchema
});
const pricingUpdateSchema = z.object({
  sku: z.string().min(1),
  customer: z.string().min(1),
  new_price: z.number(),
  ...withRequesterSchema
});

function isAuthorized(secretHeader: string | undefined) {
  if (!config.AGENT_SHARED_SECRET) return true;
  return secretHeader === config.AGENT_SHARED_SECRET;
}

export const toolsRouter = Router();

toolsRouter.use((req, res, next) => {
  const secretHeader = req.header("x-agent-secret") ?? undefined;
  if (!isAuthorized(secretHeader)) {
    return res.status(401).json({ status: false, error: "Unauthorized agent request." });
  }
  return next();
});

toolsRouter.post("/item-lookup", async (req, res) => {
  const parsed = itemLookupSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ status: false, error: parsed.error.flatten() });
  const result = await runItemLookupTool(parsed.data);
  return res.json(result);
});

toolsRouter.post("/eta-lookup", async (req, res) => {
  const parsed = etaLookupSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ status: false, error: parsed.error.flatten() });
  const result = await runEtaLookupTool(parsed.data);
  return res.json(result);
});

toolsRouter.post("/pricing-lookup", async (req, res) => {
  const parsed = pricingLookupSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ status: false, error: parsed.error.flatten() });
  const result = await runPricingLookupTool(parsed.data);
  return res.json(result);
});

toolsRouter.post("/quote-to-so/preview", async (req, res) => {
  const parsed = quotePreviewSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ status: false, error: parsed.error.flatten() });
  const result = await runQuoteToSoPreviewTool(parsed.data);
  return res.json(result);
});

toolsRouter.post("/new-item/draft", async (req, res) => {
  const parsed = newItemDraftSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ status: false, error: parsed.error.flatten() });
  const result = await runNewItemDraftTool(parsed.data);
  return res.json(result);
});

toolsRouter.post("/pricing-update/preview", async (req, res) => {
  const parsed = pricingUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ status: false, error: parsed.error.flatten() });
  const result = await runPricingUpdatePreviewTool(parsed.data);
  return res.json(result);
});
