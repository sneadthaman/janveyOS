import { useEffect, useMemo, useState } from "react";
import { createPlaybook, getPlaybooks, patchPlaybook, removePlaybook } from "../api";
import type { SalesPlaybook } from "../types";

function parseLines(value: string) {
  return value
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

function joinLines(values: string[]) {
  return (values ?? []).join("\n");
}

export function PlaybooksPage() {
  const [rows, setRows] = useState<SalesPlaybook[]>([]);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string>("");
  const [form, setForm] = useState({
    category: "autoscrubber",
    segment: "school",
    required_questions: "",
    recommendation_rules: "",
    selling_points: "",
    objections: "",
    products_to_prioritize: "",
    products_to_avoid: ""
  });

  async function load() {
    const items = await getPlaybooks("autoscrubber");
    setRows(items);
    if (items.length > 0 && !selectedId) setSelectedId(items[0].id);
  }

  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : "Failed to load playbooks"));
  }, []);

  const selected = useMemo(() => rows.find((r) => r.id === selectedId) ?? null, [rows, selectedId]);

  useEffect(() => {
    if (!selected) return;
    setForm({
      category: selected.category,
      segment: selected.segment,
      required_questions: joinLines(selected.required_questions),
      recommendation_rules: joinLines(selected.recommendation_rules),
      selling_points: joinLines(selected.selling_points),
      objections: joinLines(selected.objections),
      products_to_prioritize: joinLines(selected.products_to_prioritize),
      products_to_avoid: joinLines(selected.products_to_avoid)
    });
  }, [selected]);

  function payloadFromForm() {
    return {
      category: form.category,
      segment: form.segment,
      required_questions: parseLines(form.required_questions),
      recommendation_rules: parseLines(form.recommendation_rules),
      selling_points: parseLines(form.selling_points),
      objections: parseLines(form.objections),
      products_to_prioritize: parseLines(form.products_to_prioritize),
      products_to_avoid: parseLines(form.products_to_avoid)
    };
  }

  return (
    <section>
      <h2>Autoscrubber Playbooks</h2>
      {error ? <p className="error">{error}</p> : null}
      <div className="actions">
        <button
          onClick={() =>
            void createPlaybook(payloadFromForm())
              .then(() => load())
              .catch((e) => setError(e instanceof Error ? e.message : "Create failed"))
          }
        >
          Create Playbook
        </button>
        {selected && (
          <>
            <button
              onClick={() =>
                void patchPlaybook(selected.id, payloadFromForm())
                  .then(() => load())
                  .catch((e) => setError(e instanceof Error ? e.message : "Update failed"))
              }
            >
              Save Changes
            </button>
            <button
              onClick={() =>
                void removePlaybook(selected.id)
                  .then(() => {
                    setSelectedId("");
                    return load();
                  })
                  .catch((e) => setError(e instanceof Error ? e.message : "Delete failed"))
              }
            >
              Delete
            </button>
          </>
        )}
      </div>

      <table>
        <thead>
          <tr>
            <th>Segment</th>
            <th>Updated</th>
            <th>Select</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.segment}</td>
              <td>{new Date(r.updated_at).toLocaleString()}</td>
              <td>
                <button onClick={() => setSelectedId(r.id)}>Edit</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <label>Segment</label>
      <select value={form.segment} onChange={(e) => setForm((p) => ({ ...p, segment: e.target.value }))}>
        <option value="school">school</option>
        <option value="healthcare">healthcare</option>
        <option value="warehouse">warehouse</option>
        <option value="commercial">commercial</option>
        <option value="other">other</option>
      </select>

      <label>Required Questions</label>
      <textarea rows={6} value={form.required_questions} onChange={(e) => setForm((p) => ({ ...p, required_questions: e.target.value }))} />
      <label>Recommendation Rules</label>
      <textarea rows={6} value={form.recommendation_rules} onChange={(e) => setForm((p) => ({ ...p, recommendation_rules: e.target.value }))} />
      <label>Selling Points</label>
      <textarea rows={6} value={form.selling_points} onChange={(e) => setForm((p) => ({ ...p, selling_points: e.target.value }))} />
      <label>Objections</label>
      <textarea rows={6} value={form.objections} onChange={(e) => setForm((p) => ({ ...p, objections: e.target.value }))} />
      <label>Products to Prioritize</label>
      <textarea
        rows={4}
        value={form.products_to_prioritize}
        onChange={(e) => setForm((p) => ({ ...p, products_to_prioritize: e.target.value }))}
      />
      <label>Products to Avoid</label>
      <textarea rows={4} value={form.products_to_avoid} onChange={(e) => setForm((p) => ({ ...p, products_to_avoid: e.target.value }))} />
    </section>
  );
}
