import { useState } from "react";
import { Link } from "react-router-dom";
import { ingestUrl } from "../api";

export function IngestPage() {
  const [url, setUrl] = useState("");
  const [vendor, setVendor] = useState<"Nilfisk" | "Taski" | "Triple-S">("Nilfisk");
  const [category, setCategory] = useState("autoscrubber");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ uploaded_document_id: string } | null>(null);

  return (
    <section>
      <h2>URL Ingestion</h2>
      {error ? <p className="error">{error}</p> : null}
      <label>URL</label>
      <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/product-page" />
      <label>Vendor</label>
      <select value={vendor} onChange={(e) => setVendor(e.target.value as "Nilfisk" | "Taski" | "Triple-S")}>
        <option value="Nilfisk">Nilfisk</option>
        <option value="Taski">Taski</option>
        <option value="Triple-S">Triple-S</option>
      </select>
      <label>Category</label>
      <input value={category} onChange={(e) => setCategory(e.target.value)} />
      <label>Notes</label>
      <textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} />
      <div className="actions">
        <button
          onClick={() =>
            void ingestUrl({ url, vendor, category, notes: notes || undefined })
              .then((r) => {
                setResult(r);
                setError("");
              })
              .catch((e) => setError(e instanceof Error ? e.message : "Ingestion failed"))
          }
        >
          Ingest URL
        </button>
      </div>
      {result ? (
        <p>
          Ingestion complete. <Link to={`/uploads/${result.uploaded_document_id}`}>Open Upload Detail</Link> or{" "}
          <Link to={`/knowledge?uploadId=${result.uploaded_document_id}`}>Open in Knowledge Inbox</Link>
        </p>
      ) : null}
    </section>
  );
}
