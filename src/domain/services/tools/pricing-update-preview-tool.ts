import { createAgentActionRequest } from "../../repositories/agent-log-repository.js";

export async function runPricingUpdatePreviewTool(input: {
  sku: string;
  customer: string;
  new_price: number;
  approval_status_target?: string;
  approvalStatusTarget?: string;
  requested_by?: string;
  source?: string;
}) {
  try {
    const output = {
      status: true,
      action_type: "pricing_update",
      preview: {
        sku: input.sku,
        customer: input.customer,
        current_price: null,
        new_price: input.new_price,
        margin_impact: null,
        issues: ["NetSuite integration pending"]
      },
      requires_approval: true,
      can_execute_now: false
    } as const;

    await createAgentActionRequest({
      requestedBy: input.requested_by,
      source: input.source,
      actionType: "pricing_update",
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
      action_type: "pricing_update",
      error: "Pricing update preview failed."
    } as const;
  }
}
