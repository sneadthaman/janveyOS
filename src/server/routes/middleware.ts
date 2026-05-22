import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { approvalReasonForTool, isToolAllowed } from "../../middleware/policy.js";
import { appendAuditEvent, createApproval, getApproval, listApprovals, listAuditEvents, updateApproval } from "../../middleware/store.js";
import { executeSafeTool } from "../../middleware/tools.js";
import type { ExecutionContext, JanveyRole, ToolName } from "../../middleware/types.js";

const toolSchema = z.object({
  tool: z.enum(["get_customer_profile", "draft_vendor_email", "create_netsuite_quote"]),
  payload: z.record(z.unknown()).default({}),
  source: z.enum(["slack", "api", "opclaw"]).default("api"),
  actor_id: z.string().min(1).default("unknown_actor")
});

const statusSchema = z.object({ status: z.enum(["pending", "approved", "rejected"]).optional() });

const reviewSchema = z.object({
  reviewed_by: z.string().min(1),
  execute_now: z.boolean().default(true)
});

function resolveRole(rawRole: unknown): JanveyRole {
  if (rawRole === "rep" || rawRole === "manager" || rawRole === "admin" || rawRole === "agent") return rawRole;
  return "rep";
}

function buildContext(input: { actor_id: string; source: "slack" | "api" | "opclaw"; role: JanveyRole; requestId: string }): ExecutionContext {
  return {
    actorId: input.actor_id,
    role: input.role,
    source: input.source,
    requestId: input.requestId
  };
}

export const middlewareRouter = Router();

middlewareRouter.get("/tools", (_req, res) => {
  return res.json({
    tools: [
      {
        name: "get_customer_profile",
        approval_required: false,
        description: "Read-only customer profile lookup."
      },
      {
        name: "draft_vendor_email",
        approval_required: true,
        description: "Create a draft email; sending is blocked without manager approval."
      },
      {
        name: "create_netsuite_quote",
        approval_required: true,
        description: "NetSuite write boundary (stubbed in MVP)."
      }
    ]
  });
});

middlewareRouter.post("/tools/execute", async (req, res) => {
  const parsed = toolSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const requestId = randomUUID();
  const role = resolveRole(req.headers["x-janvey-role"]);
  const ctx = buildContext({ ...parsed.data, role, requestId });

  appendAuditEvent({
    type: "tool_invoked",
    actor_id: ctx.actorId,
    role: ctx.role,
    request_id: ctx.requestId,
    tool: parsed.data.tool,
    details: { source: ctx.source }
  });

  if (!isToolAllowed(ctx.role, parsed.data.tool as ToolName)) {
    appendAuditEvent({
      type: "tool_blocked",
      actor_id: ctx.actorId,
      role: ctx.role,
      request_id: ctx.requestId,
      tool: parsed.data.tool,
      details: { reason: "permission_denied" }
    });
    return res.status(403).json({ error: "Tool not permitted for this role." });
  }

  const approvalReason = approvalReasonForTool(parsed.data.tool as ToolName);
  if (approvalReason) {
    const approval = createApproval({
      ctx,
      tool: parsed.data.tool,
      payload: parsed.data.payload,
      reason: approvalReason
    });

    appendAuditEvent({
      type: "approval_requested",
      actor_id: ctx.actorId,
      role: ctx.role,
      request_id: ctx.requestId,
      tool: parsed.data.tool,
      details: { approval_id: approval.id }
    });

    return res.status(202).json({
      status: "pending_approval",
      request_id: requestId,
      approval_id: approval.id,
      reason: approvalReason
    });
  }

  const result = await executeSafeTool(parsed.data.tool as ToolName, parsed.data.payload);
  appendAuditEvent({
    type: "tool_completed",
    actor_id: ctx.actorId,
    role: ctx.role,
    request_id: ctx.requestId,
    tool: parsed.data.tool,
    details: { result_keys: Object.keys(result) }
  });

  return res.json({ status: "completed", request_id: requestId, result });
});

middlewareRouter.get("/approvals", (req, res) => {
  const parsed = statusSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  return res.json({ approvals: listApprovals(parsed.data.status) });
});

middlewareRouter.post("/approvals/:id/approve", async (req, res) => {
  const parsed = reviewSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const approval = getApproval(req.params.id);
  if (!approval) return res.status(404).json({ error: "Approval not found." });
  if (approval.status !== "pending") return res.status(409).json({ error: `Approval already ${approval.status}.` });

  const updated = updateApproval(approval.id, { status: "approved", reviewed_by: parsed.data.reviewed_by });
  if (!updated) return res.status(500).json({ error: "Failed to update approval." });

  appendAuditEvent({
    type: "approval_approved",
    actor_id: parsed.data.reviewed_by,
    role: "manager",
    request_id: approval.requested_by.requestId,
    tool: approval.tool,
    details: { approval_id: approval.id }
  });

  if (!parsed.data.execute_now) {
    return res.json({ ok: true, approval: updated, executed: false });
  }

  const result = await executeSafeTool(approval.tool, approval.payload);
  appendAuditEvent({
    type: "tool_completed",
    actor_id: approval.requested_by.actorId,
    role: approval.requested_by.role,
    request_id: approval.requested_by.requestId,
    tool: approval.tool,
    details: { approval_id: approval.id, result_keys: Object.keys(result) }
  });

  return res.json({ ok: true, approval: updated, executed: true, result });
});

middlewareRouter.post("/approvals/:id/reject", (req, res) => {
  const parsed = reviewSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const approval = getApproval(req.params.id);
  if (!approval) return res.status(404).json({ error: "Approval not found." });
  if (approval.status !== "pending") return res.status(409).json({ error: `Approval already ${approval.status}.` });

  const updated = updateApproval(approval.id, { status: "rejected", reviewed_by: parsed.data.reviewed_by });
  if (!updated) return res.status(500).json({ error: "Failed to update approval." });

  appendAuditEvent({
    type: "approval_rejected",
    actor_id: parsed.data.reviewed_by,
    role: "manager",
    request_id: approval.requested_by.requestId,
    tool: approval.tool,
    details: { approval_id: approval.id }
  });

  return res.json({ ok: true, approval: updated });
});

middlewareRouter.get("/audit", (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? 100), 500);
  return res.json({ events: listAuditEvents(Number.isFinite(limit) ? limit : 100) });
});
