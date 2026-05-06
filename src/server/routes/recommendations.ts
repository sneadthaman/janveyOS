import { Router } from "express";
import { z } from "zod";
import { generateRecommendation } from "../../domain/services/recommendation-service.js";
import { storeFeedback } from "../../domain/repositories/recommendation-repository.js";
import {
  createRecommendationReview,
  listRecentAutoscrubberRecommendations,
  submitRecommendationFeedback
} from "../../domain/repositories/autoscrubber-recommendation-repository.js";
import { generateAutoscrubberRecommendation } from "../../domain/services/autoscrubber-recommendation-service.js";

const requestSchema = z.object({
  userId: z.string().min(1),
  source: z.enum(["slack", "web"]).default("web"),
  text: z.string().min(1),
  accountName: z.string().optional()
});

const feedbackSchema = z.object({
  recommendationId: z.string().min(1),
  userId: z.string().min(1),
  feedbackType: z.enum(["approve", "edit", "reject"]),
  notes: z.string().optional()
});

export const recommendationRouter = Router();

const autoscrubberSchema = z.object({
  customer_name: z.string().optional(),
  customer_segment: z.string().optional(),
  floor_type: z.string().optional(),
  square_footage: z.number().optional(),
  cleaning_frequency: z.string().optional(),
  walk_behind_or_ride_on: z.string().optional(),
  battery_preference: z.string().optional(),
  budget: z.number().optional(),
  existing_machine: z.string().optional(),
  notes: z.string().optional(),
  slack_user_id: z.string().optional()
});

const reviewSchema = z.object({
  feedback: z.enum(["good", "bad", "needs_correction"]),
  notes: z.string().optional(),
  created_by: z.string().optional()
});

const managerFeedbackSchema = z.object({
  feedback: z.enum([
    "good_recommendation",
    "bad_recommendation",
    "needs_correction",
    "wrong_product",
    "bad_tone",
    "missing_context"
  ]),
  free_text_feedback: z.string().optional(),
  created_by: z.string().optional()
});

recommendationRouter.post("/", async (req, res) => {
  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const recommendation = await generateRecommendation(parsed.data);
  return res.json({ recommendation });
});

recommendationRouter.post("/feedback", async (req, res) => {
  const parsed = feedbackSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  await storeFeedback(parsed.data);
  return res.json({ ok: true });
});

recommendationRouter.post("/autoscrubber", async (req, res) => {
  try {
    const parsed = autoscrubberSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const recommendation = await generateAutoscrubberRecommendation({
      discovery: parsed.data,
      source: "api"
    });
    return res.json(recommendation);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown autoscrubber recommendation error";
    return res.status(500).json({ error: message });
  }
});

recommendationRouter.get("/recent", async (_req, res) => {
  try {
    const rows = await listRecentAutoscrubberRecommendations();
    return res.json({ recommendations: rows });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown recommendations list error";
    return res.status(500).json({ error: message });
  }
});

recommendationRouter.post("/:id/review", async (req, res) => {
  const parsed = reviewSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  await createRecommendationReview({
    recommendationId: req.params.id,
    feedback: parsed.data.feedback,
    notes: parsed.data.notes,
    createdBy: parsed.data.created_by
  });
  return res.json({ ok: true });
});

recommendationRouter.post("/:id/feedback", async (req, res) => {
  const parsed = managerFeedbackSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  await submitRecommendationFeedback({
    recommendationId: req.params.id,
    feedback: parsed.data.feedback,
    freeText: parsed.data.free_text_feedback,
    createdBy: parsed.data.created_by
  });
  return res.json({ ok: true });
});
