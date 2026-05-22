import type { ExecutionContext, ToolName } from "./types.js";

const rolePermissions: Record<ExecutionContext["role"], ToolName[]> = {
  rep: ["get_customer_profile", "draft_vendor_email"],
  manager: ["get_customer_profile", "draft_vendor_email", "create_netsuite_quote"],
  admin: ["get_customer_profile", "draft_vendor_email", "create_netsuite_quote"],
  agent: ["get_customer_profile", "draft_vendor_email"]
};

export function isToolAllowed(role: ExecutionContext["role"], tool: ToolName) {
  return rolePermissions[role]?.includes(tool) ?? false;
}

export function approvalReasonForTool(tool: ToolName) {
  if (tool === "create_netsuite_quote") {
    return "NetSuite boundary: quote creation requires manager approval.";
  }
  if (tool === "draft_vendor_email") {
    return "External communication draft requires manager approval before send.";
  }
  return null;
}
