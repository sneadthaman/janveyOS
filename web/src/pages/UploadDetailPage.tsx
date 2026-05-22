import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  approveSource,
  autoReviewKnowledgeCards,
  bulkSetKnowledgeCardStatus,
  getUploadDetail,
  patchKnowledgeCard,
  rejectSource,
  reprocessUpload
} from "../api";
import type { KnowledgeCard, KnowledgeEntry, ParsedRowRecord, SkippedRowRecord, UploadRecord } from "../types";

export function UploadDetailPage() {
  const { id } = useParams();
  const [upload, setUpload] = useState<UploadRecord | null>(null);
  const [parsedRows, setParsedRows] = useState<ParsedRowRecord[]>([]);
  const [skippedRows, setSkippedRows] = useState<SkippedRowRecord[]>([]);
  const [knowledgeChunks, setKnowledgeChunks] = useState<KnowledgeEntry[]>([]);
  const [knowledgeCards, setKnowledgeCards] = useState<KnowledgeCard[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [showSkippedOnly, setShowSkippedOnly] = useState(false);
  const [showRawChunks, setShowRawChunks] = useState(false);
  const [selectedCards, setSelectedCards] = useState<Record<string, boolean>>({});

  async function load() {
    if (!id) return;
    setError("");
    const detail = await getUploadDetail(id);
    setUpload(detail.upload);
    setParsedRows(detail.parsed_rows ?? []);
    setSkippedRows(detail.skipped_rows ?? []);
    setKnowledgeChunks(detail.knowledge_chunks ?? []);
    setKnowledgeCards(detail.knowledge_cards ?? []);
  }

  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : "Failed to load upload detail"));
  }, [id]);

  if (!id) return <p className="error">Missing upload id.</p>;

  const categories = Array.from(new Set(parsedRows.map((r) => r.category).filter(Boolean))).sort();
  const filteredParsed = parsedRows.filter((row) => (categoryFilter === "all" ? true : row.category === categoryFilter));
  const filteredSkipped = skippedRows.filter((row) => (categoryFilter === "all" ? true : row.category === categoryFilter));
  const cardStats = useMemo(() => {
    const matched = knowledgeCards.filter((k) => k.linked_product_id).length;
    return {
      total: knowledgeCards.length,
      matched,
      pending: knowledgeCards.filter((k) => k.approved_status === "pending").length,
      approved: knowledgeCards.filter((k) => k.approved_status === "approved").length,
      rejected: knowledgeCards.filter((k) => k.approved_status === "rejected").length
    };
  }, [knowledgeCards]);

  const selectedIds = Object.entries(selectedCards)
    .filter(([, checked]) => checked)
    .map(([cardId]) => cardId);

  return (
    <section>
      <h2>Upload Detail</h2>
      {upload && (
        <p>
          <strong>{upload.original_file_name}</strong> | parse: {upload.parse_status} | source status: {upload.approval_status}
        </p>
      )}
      {upload?.source_type === "url" ? <p className="meta">Source URL: {upload.source_url ?? "-"}</p> : null}

      <h3>Source Summary</h3>
      <div className="actions">
        <button
          onClick={() =>
            void approveSource(id)
              .then(() => load())
              .then(() => {
                sessionStorage.setItem("uploads_dashboard_dirty", "1");
                setMessage("Source approved");
              })
              .catch((e) => setError(e instanceof Error ? e.message : "Approve failed"))
          }
        >
          Approve Source
        </button>
        <button
          onClick={() =>
            void rejectSource(id)
              .then(() => load())
              .then(() => {
                sessionStorage.setItem("uploads_dashboard_dirty", "1");
                setMessage("Source rejected");
              })
              .catch((e) => setError(e instanceof Error ? e.message : "Reject failed"))
          }
        >
          Reject Source
        </button>
        <button
          onClick={() =>
            void reprocessUpload(id)
              .then((r) => setMessage(r.error ?? "Reprocess requested"))
              .catch((e) => setError(e instanceof Error ? e.message : "Reprocess failed"))
          }
        >
          Reprocess Source (Placeholder)
        </button>
      </div>

      {message ? <p>{message}</p> : null}
      {error ? <p className="error">{error}</p> : null}

      <div className="cards">
        <div className="card">knowledge cards: {cardStats.total}</div>
        <div className="card">matched products: {cardStats.matched}</div>
        <div className="card">pending: {cardStats.pending}</div>
        <div className="card">approved: {cardStats.approved}</div>
        <div className="card">rejected: {cardStats.rejected}</div>
      </div>
      <p>
        <Link to={`/knowledge?uploadId=${id}`}>Open in Knowledge Inbox</Link>
      </p>

      <h3>Extracted Knowledge Cards</h3>
      <div className="actions">
        <button
          disabled={selectedIds.length === 0}
          onClick={() =>
            void bulkSetKnowledgeCardStatus(selectedIds, "approved")
              .then(() => load())
              .then(() => setMessage(`Approved ${selectedIds.length} selected cards`))
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
              .then(() => setMessage(`Rejected ${selectedIds.length} selected cards`))
              .catch((e) => setError(e instanceof Error ? e.message : "Bulk reject failed"))
          }
        >
          Reject Selected Cards
        </button>
        <button
          onClick={() =>
            void autoReviewKnowledgeCards(id, 0.8, 0.35)
              .then((r) => setMessage(`Auto-review: approved ${r.approved}, rejected ${r.rejected}`))
              .then(() => load())
              .catch((e) => setError(e instanceof Error ? e.message : "Auto-review failed"))
          }
        >
          Approve High-Confidence / Reject Low-Confidence
        </button>
      </div>

      {knowledgeCards.length === 0 ? (
        <p>No extracted knowledge cards yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Select</th>
              <th>Type</th>
              <th>Status</th>
              <th>Matched Product</th>
              <th>Confidence / Reason</th>
              <th>Title</th>
              <th>Preview</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {knowledgeCards.map((card) => (
              <tr key={card.id}>
                <td>
                  <input
                    type="checkbox"
                    checked={Boolean(selectedCards[card.id])}
                    onChange={(e) => setSelectedCards((prev) => ({ ...prev, [card.id]: e.target.checked }))}
                  />
                </td>
                <td>{card.card_type}</td>
                <td>{card.approved_status}</td>
                <td>{card.linked_product_id ?? "-"}</td>
                <td>
                  {card.confidence_score !== null && card.confidence_score !== undefined
                    ? `${(Number(card.confidence_score) * 100).toFixed(0)}%`
                    : "-"}
                  {card.match_reason ? ` | ${card.match_reason}` : ""}
                </td>
                <td>{card.title}</td>
                <td>
                  <textarea
                    rows={4}
                    value={card.body}
                    onChange={(event) =>
                      setKnowledgeCards((prev) =>
                        prev.map((item) => (item.id === card.id ? { ...item, body: event.target.value } : item))
                      )
                    }
                  />
                </td>
                <td>
                  <div className="actions">
                    <button
                      onClick={() =>
                        void patchKnowledgeCard(card.id, { body: card.body, title: card.title })
                          .then(() => load())
                          .then(() => setMessage("Card updated"))
                          .catch((e) => setError(e instanceof Error ? e.message : "Card update failed"))
                      }
                    >
                      Save
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3>Pricing/Product Rows</h3>
      <div className="actions">
        <label>Category Filter</label>
        <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
          <option value="all">all</option>
          {categories.map((c) => (
            <option key={c!} value={c!}>
              {c}
            </option>
          ))}
        </select>
        <label>
          <input type="checkbox" checked={showSkippedOnly} onChange={(e) => setShowSkippedOnly(e.target.checked)} /> Show skipped rows only
        </label>
      </div>

      {!showSkippedOnly && (
        <table>
          <thead>
            <tr>
              <th>Sheet</th>
              <th>Raw Row</th>
              <th>SKU</th>
              <th>Product</th>
              <th>Category</th>
              <th>List Price</th>
              <th>Dealer Net</th>
              <th>True Cost</th>
              <th>Ed-Data Sell Price</th>
              <th>Gross Profit</th>
              <th>Margin %</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {filteredParsed.map((row) => (
              <tr key={row.id}>
                <td>{row.sheet_name ?? "-"}</td>
                <td>{row.raw_row_number ?? row.row_number}</td>
                <td>{row.sku}</td>
                <td>{row.product_name}</td>
                <td>{row.category ?? "-"}</td>
                <td>{row.list_price}</td>
                <td>{row.dealer_net}</td>
                <td>{row.true_cost}</td>
                <td>{row.ed_data_sell_price}</td>
                <td>{row.gross_profit}</td>
                <td>{row.margin_percent !== null ? `${(Number(row.margin_percent) * 100).toFixed(2)}%` : ""}</td>
                <td>{row.approved_status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3>Skipped Rows</h3>
      <table>
        <thead>
          <tr>
            <th>Sheet</th>
            <th>Raw Row</th>
            <th>Category</th>
            <th>Row</th>
            <th>Reason</th>
          </tr>
        </thead>
        <tbody>
          {filteredSkipped.map((row) => (
            <tr key={row.id}>
              <td>{row.sheet_name ?? "-"}</td>
              <td>{row.raw_row_number ?? "-"}</td>
              <td>{row.category ?? "-"}</td>
              <td>{row.row_number}</td>
              <td>{row.skip_reason}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>
        <button onClick={() => setShowRawChunks((s) => !s)}>{showRawChunks ? "Hide" : "Show"} Raw Extracted Chunks (Debug)</button>
      </h3>
      {showRawChunks ? (
        knowledgeChunks.length === 0 ? (
          <p>No raw chunks.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Category</th>
                <th>Status</th>
                <th>Preview</th>
              </tr>
            </thead>
            <tbody>
              {knowledgeChunks.map((chunk) => (
                <tr key={chunk.id}>
                  <td>{chunk.category ?? "-"}</td>
                  <td>{chunk.approved_status}</td>
                  <td>{chunk.body.slice(0, 220)}{chunk.body.length > 220 ? "..." : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      ) : null}
    </section>
  );
}
