import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { bulkSetKnowledgeCardStatus, getKnowledgeCards, patchKnowledgeCard } from "../api";
import type { KnowledgeCard } from "../types";

export function KnowledgeInboxPage() {
  const [entries, setEntries] = useState<KnowledgeCard[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [searchParams] = useSearchParams();
  const uploadIdFilter = searchParams.get("uploadId") ?? undefined;
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  async function load() {
    setEntries(await getKnowledgeCards({ status: "pending", uploadId: uploadIdFilter }));
  }

  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : "Failed to load knowledge inbox"));
  }, [uploadIdFilter]);

  const selectedIds = useMemo(
    () => Object.entries(selected).filter(([, on]) => on).map(([id]) => id),
    [selected]
  );

  return (
    <section>
      <h2>Knowledge Inbox (Pending Cards)</h2>
      {uploadIdFilter ? <p className="meta">Filtered by upload: {uploadIdFilter}</p> : null}
      {error ? <p className="error">{error}</p> : null}
      {message ? <p>{message}</p> : null}

      <div className="actions">
        <button
          disabled={selectedIds.length === 0}
          onClick={() =>
            void bulkSetKnowledgeCardStatus(selectedIds, "approved")
              .then(() => load())
              .then(() => setMessage(`Approved ${selectedIds.length} cards`))
              .catch((e) => setError(e instanceof Error ? e.message : "Bulk approve failed"))
          }
        >
          Approve Selected Cards
        </button>
        <button
          disabled={selectedIds.length === 0}
          onClick={() =>
            void bulkSetKnowledgeCardStatus(selectedIds, "rejected")
              .then(() => load())
              .then(() => setMessage(`Rejected ${selectedIds.length} cards`))
              .catch((e) => setError(e instanceof Error ? e.message : "Bulk reject failed"))
          }
        >
          Reject Selected Cards
        </button>
      </div>

      <table>
        <thead>
          <tr>
            <th>Select</th>
            <th>Type</th>
            <th>Title</th>
            <th>Body</th>
            <th>Vendor</th>
            <th>Category</th>
            <th>Source</th>
            <th>Confidence</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id}>
              <td>
                <input
                  type="checkbox"
                  checked={Boolean(selected[entry.id])}
                  onChange={(e) => setSelected((prev) => ({ ...prev, [entry.id]: e.target.checked }))}
                />
              </td>
              <td>{entry.card_type}</td>
              <td>{entry.title}</td>
              <td>
                <textarea
                  value={entry.body}
                  onChange={(event) =>
                    setEntries((prev) => prev.map((item) => (item.id === entry.id ? { ...item, body: event.target.value } : item)))
                  }
                  rows={5}
                />
              </td>
              <td>{entry.vendor ?? ""}</td>
              <td>{entry.category ?? ""}</td>
              <td>
                {entry.source_type}
                {entry.source_url ? ` | ${entry.source_url}` : ""}
              </td>
              <td>
                {entry.confidence_score !== null && entry.confidence_score !== undefined
                  ? `${(Number(entry.confidence_score) * 100).toFixed(0)}%`
                  : "-"}
              </td>
              <td>
                <button
                  onClick={() =>
                    void patchKnowledgeCard(entry.id, { body: entry.body, title: entry.title })
                      .then(() => load())
                      .then(() => setMessage("Card updated"))
                      .catch((e) => setError(e instanceof Error ? e.message : "Edit failed"))
                  }
                >
                  Save Edit
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
