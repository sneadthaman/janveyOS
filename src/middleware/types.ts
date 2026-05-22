export type JanveyRole = "rep" | "manager" | "admin" | "agent";

export type ToolName = "get_customer_profile" | "draft_vendor_email" | "create_netsuite_quote";

export interface ExecutionContext {
  actorId: string;
  role: JanveyRole;
  source: "slack" | "api" | "opclaw";
  requestId: string;
}

export interface ToolRequest {
  tool: ToolName;
  payload: Record<string, unknown>;
}

export interface ToolExecutionResult {
  status: "completed" | "pending_approval";
  result?: Record<string, unknown>;
  approval_id?: string;
}

export interface ApprovalItem {
  id: string;
  requested_at: string;
  requested_by: ExecutionContext;
  tool: ToolName;
  payload: Record<string, unknown>;
  reason: string;
  status: "pending" | "approved" | "rejected";
  reviewed_at?: string;
  reviewed_by?: string;
}

export interface AuditEvent {
  id: string;
  at: string;
  type:
    | "tool_invoked"
    | "tool_completed"
    | "tool_blocked"
    | "approval_requested"
    | "approval_approved"
    | "approval_rejected";
  actor_id: string;
  role: JanveyRole;
  request_id: string;
  tool: ToolName;
  details: Record<string, unknown>;
}
