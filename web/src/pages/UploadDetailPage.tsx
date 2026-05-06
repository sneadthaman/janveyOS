import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { approveUpload, getUploadDetail, rejectUpload, reprocessUpload } from "../api";
import type { ParsedRowRecord, SkippedRowRecord, UploadRecord } from "../types";

export function UploadDetailPage() {
  const { id } = useParams();
  const [upload, setUpload] = useState<UploadRecord | null>(null);
  const [parsedRows, setParsedRows] = useState<ParsedRowRecord[]>([]);
  const [skippedRows, setSkippedRows] = useState<SkippedRowRecord[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    if (!id) return;
    setError("");
    const detail = await getUploadDetail(id);
    setUpload(detail.upload);
    setParsedRows(detail.parsed_rows ?? []);
    setSkippedRows(detail.skipped_rows ?? []);
  }

  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : "Failed to load upload detail"));
  }, [id]);

  if (!id) return <p className="error">Missing upload id.</p>;

  return (
    <section>
      <h2>Upload Detail</h2>
      {upload && (
        <p>
          <strong>{upload.original_file_name}</strong> | parse: {upload.parse_status} | approval: {upload.approval_status}
        </p>
      )}
      <div className="actions">
        <button
          onClick={() =>
            void approveUpload(id)
              .then(() => load())
              .then(() => setMessage("Upload approved"))
              .catch((e) => setError(e instanceof Error ? e.message : "Approve failed"))
          }
        >
          Approve Upload
        </button>
        <button
          onClick={() =>
            void rejectUpload(id)
              .then(() => load())
              .then(() => setMessage("Upload rejected"))
              .catch((e) => setError(e instanceof Error ? e.message : "Reject failed"))
          }
        >
          Reject Upload
        </button>
        <button
          onClick={() =>
            void reprocessUpload(id)
              .then((r) => setMessage(r.error ?? "Reprocess requested"))
              .catch((e) => setError(e instanceof Error ? e.message : "Reprocess failed"))
          }
        >
          Reprocess Upload (Placeholder)
        </button>
      </div>
      {message ? <p>{message}</p> : null}
      {error ? <p className="error">{error}</p> : null}

      <h3>Parsed Product Rows</h3>
      <table>
        <thead>
          <tr>
            <th>SKU</th>
            <th>Product</th>
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
          {parsedRows.map((row) => (
            <tr key={row.id}>
              <td>{row.sku}</td>
              <td>{row.product_name}</td>
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

      <h3>Skipped Rows</h3>
      <table>
        <thead>
          <tr>
            <th>Row</th>
            <th>Reason</th>
            <th>Raw</th>
          </tr>
        </thead>
        <tbody>
          {skippedRows.map((row) => (
            <tr key={row.id}>
              <td>{row.row_number}</td>
              <td>{row.skip_reason}</td>
              <td>
                <code>{JSON.stringify(row.raw_json)}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
