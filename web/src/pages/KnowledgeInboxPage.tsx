import { useEffect, useState } from "react";
import { approveKnowledge, getKnowledgePending, patchKnowledge, rejectKnowledge } from "../api";
import type { KnowledgeEntry } from "../types";

export function KnowledgeInboxPage() {
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [error, setError] = useState("");

  async function load() {
    setEntries(await getKnowledgePending());
  }

  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : "Failed to load knowledge inbox"));
  }, []);

  return (
    <section>
      <h2>Knowledge Inbox (Pending)</h2>
      {error ? <p className="error">{error}</p> : null}
      <div className="knowledge-list">
        {entries.map((entry) => (
          <article key={entry.id} className="knowledge-item">
            <h3>{entry.title}</h3>
            <p className="meta">
              Source upload: {String(entry.metadata_json?.uploaded_document_id ?? "")} | Vendor:{" "}
              {String(entry.metadata_json?.vendor ?? "")}
            </p>
            <textarea
              value={entry.body}
              onChange={(event) =>
                setEntries((prev) =>
                  prev.map((item) => (item.id === entry.id ? { ...item, body: event.target.value } : item))
                )
              }
              rows={8}
            />
            <div className="actions">
              <button
                onClick={() =>
                  void approveKnowledge(entry.id)
                    .then(() => load())
                    .catch((e) => setError(e instanceof Error ? e.message : "Approve failed"))
                }
              >
                Approve
              </button>
              <button
                onClick={() =>
                  void patchKnowledge(entry.id, { body: entry.body })
                    .then(() => load())
                    .catch((e) => setError(e instanceof Error ? e.message : "Edit failed"))
                }
              >
                Save Edit
              </button>
              <button
                onClick={() =>
                  void rejectKnowledge(entry.id)
                    .then(() => load())
                    .catch((e) => setError(e instanceof Error ? e.message : "Reject failed"))
                }
              >
                Reject
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
