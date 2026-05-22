import { createAgentActionRequest } from "../../repositories/agent-log-repository.js";

export async function runNewItemDraftTool(input: {
  vendor: string;
  vendor_sku: string;
  description: string;
  approval_status_target?: string;
  approvalStatusTarget?: string;
  requested_by?: string;
  source?: string;
}) {
  try {
    const output = {
      status: true,
      action_type: "new_item_draft",
      draft: {
        vendor: input.vendor,
        vendor_sku: input.vendor_sku,
        description: input.description,
        missing_fields: ["item_type", "uom", "cost", "income_account", "expense_account"]
      },
      requires_approval: true,
      can_execute_now: false
    } as const;

    await createAgentActionRequest({
      requestedBy: input.requested_by,
      source: input.source,
      actionType: "new_item_draft",
      requiresApproval: true,
      approvalStatusTarget: input.approval_status_target ?? input.approvalStatusTarget ?? "Pending Approval",
      inputJson: input,
      previewJson: output.draft,
      status: "pending"
    });

    return output;
  } catch {
    return {
      status: false,
      action_type: "new_item_draft",
      error: "New item draft failed."
    } as const;
  }
}
