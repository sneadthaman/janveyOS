import { createAgentToolCall } from "../../repositories/agent-log-repository.js";

export async function runEtaLookupTool(input: {
  sku: string;
  customer: string;
  sales_order?: string;
  requested_by?: string;
  source?: string;
}) {
  const startedAt = Date.now();
  try {
    const output = {
      status: true,
      tool: "eta_lookup",
      data: {
        best_eta: null,
        confidence: "low",
        status_summary: "ETA lookup scaffold working. NetSuite/email integration pending.",
        sources_checked: ["mock_netsuite", "mock_email"],
        needs_human_review: true
      },
      source_trail: ["mock_data"],
      suggested_response: "I do not have a confirmed ETA yet. I am checking vendor/source data."
    } as const;

    await createAgentToolCall({
      requestedBy: input.requested_by,
      source: input.source,
      toolName: "eta_lookup",
      inputJson: input,
      outputJson: output,
      status: "completed",
      latencyMs: Date.now() - startedAt
    });

    return output;
  } catch {
    const output = { status: false, tool: "eta_lookup", error: "ETA lookup failed." } as const;
    try {
      await createAgentToolCall({
        requestedBy: input.requested_by,
        source: input.source,
        toolName: "eta_lookup",
        inputJson: input,
        outputJson: output,
        status: "failed",
        errorMessage: "ETA lookup failure",
        latencyMs: Date.now() - startedAt
      });
    } catch {}
    return output;
  }
}
