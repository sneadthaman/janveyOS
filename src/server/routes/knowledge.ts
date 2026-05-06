import { Router } from "express";
import { z } from "zod";
import { listKnowledgeEntries, patchKnowledgeEntry, setKnowledgeStatus } from "../../domain/repositories/knowledge-inbox-repository.js";

const knowledgeQuerySchema = z.object({
  status: z.enum(["pending", "approved", "rejected"]).default("pending")
});

const patchSchema = z.object({
  title: z.string().min(1).optional(),
  body: z.string().min(1).optional(),
  approvedStatus: z.enum(["pending", "approved", "rejected"]).optional()
});

export const knowledgeRouter = Router();

knowledgeRouter.get("/", async (req, res) => {
  try {
    const parsed = knowledgeQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const entries = await listKnowledgeEntries(parsed.data.status);
    return res.json({ entries });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown knowledge list error";
    return res.status(500).json({ error: message });
  }
});

knowledgeRouter.patch("/:id", async (req, res) => {
  try {
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const updated = await patchKnowledgeEntry(req.params.id, parsed.data);
    return res.json({ entry: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown knowledge patch error";
    return res.status(400).json({ error: message });
  }
});

knowledgeRouter.post("/:id/approve", async (req, res) => {
  try {
    const entry = await setKnowledgeStatus(req.params.id, "approved");
    return res.json({ entry });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown knowledge approve error";
    return res.status(400).json({ error: message });
  }
});

knowledgeRouter.post("/:id/reject", async (req, res) => {
  try {
    const entry = await setKnowledgeStatus(req.params.id, "rejected");
    return res.json({ entry });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown knowledge reject error";
    return res.status(400).json({ error: message });
  }
});
