import { createAgentActionRequest } from "../../repositories/agent-log-repository.js";

export async function runQuoteToSoPreviewTool(input: {
  estimate_number: string;
  approval_status_target?: string;
  approvalStatusTarget?: string;
  requested_by?: string;
  source?: string;
}) {
  try {
    const output = {
      status: true,
      action_type: "quote_to_so",
      preview: {
        estimate_number: input.estimate_number,
        customer: null,
        line_count: null,
        total: null,
        issues: ["NetSuite integration pending"]
      },
      requires_approval: true,
      can_execute_now: false
    } as const;

    await createAgentActionRequest({
      requestedBy: input.requested_by,
      source: input.source,
      actionType: "quote_to_so",
      requiresApproval: true,
      approvalStatusTarget: input.approval_status_target ?? input.approvalStatusTarget ?? "Pending Approval",
      inputJson: input,
      previewJson: output.preview,
      status: "pending"
    });

    return output;
  } catch {
    return {
      status: false,
      action_type: "quote_to_so",
      error: "Quote to sales order preview failed."
    } as const;
  }
}
