import { Router } from "express";
import { z } from "zod";
import {
  approveAgentActionRequest,
  listActionExecutionLogs,
  listAgentActionRequests,
  listAgentToolCalls,
  rejectAgentActionRequest
} from "../../domain/repositories/agent-manager-repository.js";

const approveSchema = z.object({ approved_by: z.string().min(1).default("manager_console") });

export const agentRouter = Router();

agentRouter.get("/tool-calls", async (_req, res) => {
  try {
    const rows = await listAgentToolCalls();
    return res.json({ tool_calls: rows });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown tool calls list error";
    return res.status(500).json({ error: message });
  }
});

agentRouter.get("/action-requests", async (_req, res) => {
  try {
    const rows = await listAgentActionRequests();
    return res.json({ action_requests: rows });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown action requests list error";
    return res.status(500).json({ error: message });
  }
});

agentRouter.get("/action-requests/:id/execution-logs", async (req, res) => {
  try {
    const rows = await listActionExecutionLogs(req.params.id);
    return res.json({ execution_logs: rows });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown execution logs list error";
    return res.status(500).json({ error: message });
  }
});

agentRouter.post("/action-requests/:id/approve", async (req, res) => {
  try {
    const parsed = approveSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const row = await approveAgentActionRequest(req.params.id, parsed.data.approved_by);
    return res.json({ action_request: row });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown action request approve error";
    return res.status(400).json({ error: message });
  }
});

agentRouter.post("/action-requests/:id/reject", async (req, res) => {
  try {
    const row = await rejectAgentActionRequest(req.params.id);
    return res.json({ action_request: row });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown action request reject error";
    return res.status(400).json({ error: message });
  }
});
