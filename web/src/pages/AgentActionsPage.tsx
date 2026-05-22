import { Fragment, useEffect, useMemo, useState } from "react";
import {
  approveAgentActionRequest,
  getAgentActionExecutionLogs,
  getAgentActionRequests,
  rejectAgentActionRequest
} from "../api";
import type { AgentActionExecutionLog, AgentActionRequest } from "../types";

function statusLabel(row: AgentActionRequest) {
  if (row.status === "executed") return "Executed";
  if (row.status === "failed") return "Failed";
  if (row.status === "approved" && row.claimed_at) return "In Progress";
  if (row.status === "approved") return "Approved (Queued)";
  if (row.status === "rejected") return "Rejected";
  return "Pending Approval";
}

function dryRunSummary(row: AgentActionRequest) {
  const output = row.output_json ?? {};
  const source = (output.source as Record<string, unknown> | undefined) ?? {};
  const target = (output.target as Record<string, unknown> | undefined) ?? {};
  const post = (output.postTransformActions as Record<string, unknown> | undefined) ?? {};
  const safety = (output.safety as Record<string, unknown> | undefined) ?? {};
  if (!output.operation) return null;
  return (
    <div>
      <div>operation: {String(output.operation)}</div>
      <div>mode: {String(output.mode ?? "-")}</div>
      <div>wouldSubmit: {String(output.wouldSubmit ?? "-")}</div>
      <div>quoteInternalId: {String(source.fromId ?? "-")}</div>
      <div>targetType: {String(target.toType ?? "-")}</div>
      <div>approvalTarget: {String(post.setApprovalStatus ?? row.approval_status_target ?? "-")}</div>
      <div>safety: {String(safety.message ?? "-")}</div>
    </div>
  );
}

export function AgentActionsPage() {
  const [rows, setRows] = useState<AgentActionRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "pending">("pending");
  const [expandedActionId, setExpandedActionId] = useState<string | null>(null);
  const [executionLogsByActionId, setExecutionLogsByActionId] = useState<Record<string, AgentActionExecutionLog[]>>({});

  async function load() {
    setLoading(true);
    setError("");
    try {
      setRows(await getAgentActionRequests());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load agent action requests");
    } finally {
      setLoading(false);
    }
  }

  async function onApprove(id: string) {
    try {
      await approveAgentActionRequest(id, "manager_console");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to approve action request");
    }
  }

  async function onReject(id: string) {
    try {
      await rejectAgentActionRequest(id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to reject action request");
    }
  }

  async function onViewExecutionLogs(id: string) {
    try {
      if (expandedActionId === id) {
        setExpandedActionId(null);
        return;
      }
      if (!executionLogsByActionId[id]) {
        const logs = await getAgentActionExecutionLogs(id);
        setExecutionLogsByActionId((prev) => ({ ...prev, [id]: logs }));
      }
      setExpandedActionId(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load execution logs");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    if (statusFilter === "pending") return rows.filter((row) => row.status === "pending");
    return rows;
  }, [rows, statusFilter]);

  if (loading) return <p>Loading action requests...</p>;

  return (
    <section>
      <h2>Agent Actions</h2>
      <div className="actions">
        <button onClick={() => void load()}>Refresh</button>
        <button onClick={() => setStatusFilter("pending")}>Pending</button>
        <button onClick={() => setStatusFilter("all")}>All</button>
      </div>
      {error ? <p className="error">{error}</p> : null}
      <table>
        <thead>
          <tr>
            <th>Created</th>
            <th>Action</th>
            <th>Execution Status</th>
            <th>Requested By</th>
            <th>Source</th>
            <th>Requires Approval</th>
            <th>Approval Target</th>
            <th>Approved By</th>
            <th>Approved At</th>
            <th>Claimed By</th>
            <th>Claimed At</th>
            <th>Executed At</th>
            <th>Retry Count</th>
            <th>Last Attempted At</th>
            <th>Error</th>
            <th>Input</th>
            <th>Preview</th>
            <th>Output</th>
            <th>Controls</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((row) => (
            <Fragment key={row.id}>
              <tr key={row.id}>
                <td>{new Date(row.created_at).toLocaleString()}</td>
                <td>{row.action_type}</td>
                <td>{statusLabel(row)}</td>
                <td>{row.requested_by ?? "-"}</td>
                <td>{row.source ?? "-"}</td>
                <td>{row.requires_approval === false ? "No" : "Yes"}</td>
                <td>{row.approval_status_target ?? "-"}</td>
                <td>{row.approved_by ?? "-"}</td>
                <td>{row.approved_at ? new Date(row.approved_at).toLocaleString() : "-"}</td>
                <td>{row.claimed_by ?? "-"}</td>
                <td>{row.claimed_at ? new Date(row.claimed_at).toLocaleString() : "-"}</td>
                <td>{row.executed_at ? new Date(row.executed_at).toLocaleString() : "-"}</td>
                <td>{row.retry_count ?? 0}</td>
                <td>{row.last_attempted_at ? new Date(row.last_attempted_at).toLocaleString() : "-"}</td>
                <td>{row.error_message ?? "-"}</td>
                <td>
                  <pre>{JSON.stringify(row.input_json ?? {}, null, 2)}</pre>
                </td>
                <td>
                  <pre>{JSON.stringify(row.preview_json ?? {}, null, 2)}</pre>
                </td>
                <td>
                  {dryRunSummary(row)}
                  <pre>{JSON.stringify(row.output_json ?? {}, null, 2)}</pre>
                </td>
                <td>
                  <button disabled={row.status !== "pending"} onClick={() => void onApprove(row.id)}>
                    Approve
                  </button>
                  <button disabled={row.status !== "pending"} onClick={() => void onReject(row.id)}>
                    Reject
                  </button>
                  <button onClick={() => void onViewExecutionLogs(row.id)}>
                    {expandedActionId === row.id ? "Hide Execution Logs" : "View Execution Logs"}
                  </button>
                </td>
              </tr>
              {expandedActionId === row.id ? (
                <tr>
                  <td colSpan={19}>
                    <h4>Execution Logs</h4>
                    <table>
                      <thead>
                        <tr>
                          <th>Attempt #</th>
                          <th>Status</th>
                          <th>Started At</th>
                          <th>Completed At</th>
                          <th>Error Message</th>
                          <th>Request Payload</th>
                          <th>Response Payload</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(executionLogsByActionId[row.id] ?? []).map((log) => (
                          <tr key={`${row.id}-${log.attempt_number}-${log.started_at ?? "none"}`}>
                            <td>{log.attempt_number}</td>
                            <td>{log.status}</td>
                            <td>{log.started_at ? new Date(log.started_at).toLocaleString() : "-"}</td>
                            <td>{log.completed_at ? new Date(log.completed_at).toLocaleString() : "-"}</td>
                            <td>{log.error_message ?? "-"}</td>
                            <td>
                              <pre>{JSON.stringify(log.input_json ?? {}, null, 2)}</pre>
                            </td>
                            <td>
                              <pre>{JSON.stringify(log.output_json ?? {}, null, 2)}</pre>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </td>
                </tr>
              ) : null}
            </Fragment>
          ))}
        </tbody>
      </table>
    </section>
  );
}
