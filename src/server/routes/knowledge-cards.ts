import { Router } from "express";
import { z } from "zod";
import {
  bulkAutoReviewByConfidence,
  bulkSetKnowledgeCardStatus,
  listKnowledgeCards,
  patchKnowledgeCard,
  setKnowledgeCardStatus
} from "../../domain/repositories/knowledge-card-repository.js";

const querySchema = z.object({
  status: z.enum(["pending", "approved", "rejected"]).optional(),
  uploadId: z.string().uuid().optional()
});

const patchSchema = z.object({
  title: z.string().min(1).optional(),
  body: z.string().min(1).optional(),
  approvedStatus: z.enum(["pending", "approved", "rejected"]).optional()
});

const bulkSchema = z.object({
  ids: z.array(z.string().uuid()).min(1),
  status: z.enum(["approved", "rejected"])
});

const autoSchema = z.object({
  uploadId: z.string().uuid(),
  minConfidenceForApprove: z.number().min(0).max(1).default(0.8),
  maxConfidenceForReject: z.number().min(0).max(1).default(0.35)
});

export const knowledgeCardsRouter = Router();

knowledgeCardsRouter.get("/", async (req, res) => {
  try {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const cards = await listKnowledgeCards(parsed.data);
    return res.json({ cards });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown knowledge cards list error";
    return res.status(500).json({ error: message });
  }
});

knowledgeCardsRouter.patch("/:id", async (req, res) => {
  try {
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const card = await patchKnowledgeCard(req.params.id, parsed.data);
    return res.json({ card });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown knowledge card patch error";
    return res.status(400).json({ error: message });
  }
});

knowledgeCardsRouter.post("/:id/approve", async (req, res) => {
  try {
    const card = await setKnowledgeCardStatus(req.params.id, "approved");
    return res.json({ card });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown knowledge card approve error";
    return res.status(400).json({ error: message });
  }
});

knowledgeCardsRouter.post("/:id/reject", async (req, res) => {
  try {
    const card = await setKnowledgeCardStatus(req.params.id, "rejected");
    return res.json({ card });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown knowledge card reject error";
    return res.status(400).json({ error: message });
  }
});

knowledgeCardsRouter.post("/bulk-status", async (req, res) => {
  try {
    const parsed = bulkSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const result = await bulkSetKnowledgeCardStatus(parsed.data.ids, parsed.data.status);
    return res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown bulk knowledge card update error";
    return res.status(400).json({ error: message });
  }
});

knowledgeCardsRouter.post("/auto-review", async (req, res) => {
  try {
    const parsed = autoSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const result = await bulkAutoReviewByConfidence(parsed.data);
    return res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown knowledge card auto-review error";
    return res.status(400).json({ error: message });
  }
});
