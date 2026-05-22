import { randomUUID } from "node:crypto";
import type { ApprovalItem, AuditEvent, ExecutionContext, ToolName } from "./types.js";

const approvals = new Map<string, ApprovalItem>();
const auditEvents: AuditEvent[] = [];

export function createApproval(input: {
  ctx: ExecutionContext;
  tool: ToolName;
  payload: Record<string, unknown>;
  reason: string;
}) {
  const item: ApprovalItem = {
    id: randomUUID(),
    requested_at: new Date().toISOString(),
    requested_by: input.ctx,
    tool: input.tool,
    payload: input.payload,
    reason: input.reason,
    status: "pending"
  };
  approvals.set(item.id, item);
  return item;
}

export function listApprovals(status?: ApprovalItem["status"]) {
  const rows = Array.from(approvals.values()).sort((a, b) => b.requested_at.localeCompare(a.requested_at));
  if (!status) return rows;
  return rows.filter((row) => row.status === status);
}

export function getApproval(id: string) {
  return approvals.get(id);
}

export function updateApproval(id: string, update: { status: "approved" | "rejected"; reviewed_by: string }) {
  const item = approvals.get(id);
  if (!item) return null;
  const next: ApprovalItem = {
    ...item,
    status: update.status,
    reviewed_at: new Date().toISOString(),
    reviewed_by: update.reviewed_by
  };
  approvals.set(id, next);
  return next;
}

export function appendAuditEvent(event: Omit<AuditEvent, "id" | "at">) {
  const entry: AuditEvent = {
    id: randomUUID(),
    at: new Date().toISOString(),
    ...event
  };
  auditEvents.push(entry);
  return entry;
}

export function listAuditEvents(limit = 100) {
  return [...auditEvents].sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}
