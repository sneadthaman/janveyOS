import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { getUploads } from "../api";
import type { UploadRecord } from "../types";

export function DashboardPage() {
  const [uploads, setUploads] = useState<UploadRecord[]>([]);
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        setUploads(await getUploads());
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load uploads");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const stats = useMemo(() => {
    return uploads.reduce(
      (acc, item) => {
        acc.parsed += Number(item.parsed_rows ?? 0);
        acc.skipped += Number(item.skipped_rows ?? 0);
        acc.pending += Number(item.pending_approval_count ?? 0);
        acc.approved += Number(item.approved_count ?? 0);
        return acc;
      },
      { parsed: 0, skipped: 0, pending: 0, approved: 0 }
    );
  }, [uploads]);

  if (loading) return <p>Loading uploads...</p>;
  if (error) return <p className="error">{error}</p>;

  return (
    <section>
      <h2>Recent Uploads</h2>
      <div className="cards">
        <div className="card">Parsed: {stats.parsed}</div>
        <div className="card">Skipped: {stats.skipped}</div>
        <div className="card">Pending Approval: {stats.pending}</div>
        <div className="card">Approved: {stats.approved}</div>
      </div>

      <table>
        <thead>
          <tr>
            <th>File</th>
            <th>Parse Status</th>
            <th>Approval Status</th>
            <th>Parsed</th>
            <th>Skipped</th>
            <th>Pending</th>
            <th>Approved</th>
          </tr>
        </thead>
        <tbody>
          {uploads.map((upload) => (
            <tr key={upload.id}>
              <td>
                <Link to={`/uploads/${upload.id}`}>{upload.original_file_name}</Link>
              </td>
              <td>{upload.parse_status}</td>
              <td>{upload.approval_status}</td>
              <td>{upload.parsed_rows}</td>
              <td>{upload.skipped_rows}</td>
              <td>{upload.pending_approval_count}</td>
              <td>{upload.approved_count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
