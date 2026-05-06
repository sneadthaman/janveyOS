import { Router } from "express";
import { z } from "zod";
import {
  createPlaybook,
  deletePlaybook,
  getPlaybook,
  listPlaybooks,
  updatePlaybook
} from "../../domain/repositories/playbook-repository.js";

const playbookSchema = z.object({
  category: z.string().min(1),
  segment: z.string().min(1),
  required_questions: z.array(z.string()).default([]),
  recommendation_rules: z.array(z.string()).default([]),
  selling_points: z.array(z.string()).default([]),
  objections: z.array(z.string()).default([]),
  products_to_prioritize: z.array(z.string()).default([]),
  products_to_avoid: z.array(z.string()).default([])
});

const patchSchema = playbookSchema.partial();

export const playbookRouter = Router();

playbookRouter.get("/", async (req, res) => {
  try {
    const category = typeof req.query.category === "string" ? req.query.category : undefined;
    const rows = await listPlaybooks(category);
    return res.json({ playbooks: rows });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown list playbooks error";
    return res.status(500).json({ error: message });
  }
});

playbookRouter.get("/:id", async (req, res) => {
  try {
    const row = await getPlaybook(req.params.id);
    return res.json({ playbook: row });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown get playbook error";
    return res.status(404).json({ error: message });
  }
});

playbookRouter.post("/", async (req, res) => {
  const parsed = playbookSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const row = await createPlaybook(parsed.data);
    return res.status(201).json({ playbook: row });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown create playbook error";
    return res.status(400).json({ error: message });
  }
});

playbookRouter.patch("/:id", async (req, res) => {
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const row = await updatePlaybook(req.params.id, parsed.data);
    return res.json({ playbook: row });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown update playbook error";
    return res.status(400).json({ error: message });
  }
});

playbookRouter.delete("/:id", async (req, res) => {
  try {
    await deletePlaybook(req.params.id);
    return res.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown delete playbook error";
    return res.status(400).json({ error: message });
  }
});
