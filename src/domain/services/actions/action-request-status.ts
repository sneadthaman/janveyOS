export const ACTION_REQUEST_STATUSES = [
  "pending",
  "approved",
  "running",
  "executed",
  "failed",
  "rejected",
  "cancelled"
] as const;

export type ActionRequestStatus = (typeof ACTION_REQUEST_STATUSES)[number];

export const TERMINAL_ACTION_REQUEST_STATUSES = [
  "executed",
  "failed",
  "rejected",
  "cancelled"
] as const;

export function isTerminalActionRequestStatus(status: string): status is (typeof TERMINAL_ACTION_REQUEST_STATUSES)[number] {
  return (TERMINAL_ACTION_REQUEST_STATUSES as readonly string[]).includes(status);
}

export function canExecuteActionRequest(status: string): status is "pending" {
  return status === "pending";
}
