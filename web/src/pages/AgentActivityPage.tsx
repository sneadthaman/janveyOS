import { useEffect, useState } from "react";
import { getAgentToolCalls } from "../api";
import type { AgentToolCall } from "../types";

export function AgentActivityPage() {
  const [rows, setRows] = useState<AgentToolCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      setRows(await getAgentToolCalls());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load agent tool calls");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  if (loading) return <p>Loading agent activity...</p>;
  if (error) return <p className="error">{error}</p>;

  return (
    <section>
      <h2>Agent Activity</h2>
      <div className="actions">
        <button onClick={() => void load()}>Refresh</button>
      </div>
      <table>
        <thead>
          <tr>
            <th>Created</th>
            <th>Tool</th>
            <th>Status</th>
            <th>Requested By</th>
            <th>Source</th>
            <th>Latency (ms)</th>
            <th>Error</th>
            <th>Input</th>
            <th>Output</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{new Date(row.created_at).toLocaleString()}</td>
              <td>{row.tool_name}</td>
              <td>{row.status}</td>
              <td>{row.requested_by ?? "-"}</td>
              <td>{row.source ?? "-"}</td>
              <td>{row.latency_ms ?? "-"}</td>
              <td>{row.error_message ?? "-"}</td>
              <td>
                <pre>{JSON.stringify(row.input_json ?? {}, null, 2)}</pre>
              </td>
              <td>
                <pre>{JSON.stringify(row.output_json ?? {}, null, 2)}</pre>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
