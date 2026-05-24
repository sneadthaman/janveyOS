import test from "node:test";
import assert from "node:assert/strict";
import {
  createDocumentExtractionWithDeps,
  createEtaUpdateCandidatesWithDeps
} from "./document-extraction-repository.js";

test("repository creates extraction", async () => {
  const extraction = await createDocumentExtractionWithDeps(
    {
      documentId: "doc-1",
      extractorVersion: "v1",
      classification: "eta_update",
      confidence: 0.9,
      rawExtractionJson: { reasons: ["eta"] }
    },
    {
      insertDocumentExtraction: async (row) => ({
        id: "ex-1",
        created_at: "2026-05-24T00:00:00Z",
        ...row
      }),
      insertEtaUpdateCandidates: async (rows) => rows,
      findExtractionByDocumentId: async () => null,
      findEtaCandidatesByExtractionId: async () => []
    }
  );

  assert.equal(extraction.id, "ex-1");
  assert.equal(extraction.classification, "eta_update");
});

test("repository creates eta candidates", async () => {
  const candidates = await createEtaUpdateCandidatesWithDeps(
    [
      {
        documentExtractionId: "ex-1",
        poNumber: "PO289731",
        etaDate: "2026-05-29",
        appliesToEntirePo: true,
        confidence: 0.9
      }
    ],
    {
      insertDocumentExtraction: async () => ({ id: "ex-1" }),
      insertEtaUpdateCandidates: async (rows) =>
        rows.map((row, idx) => ({
          id: `cand-${idx + 1}`,
          created_at: "2026-05-24T00:00:00Z",
          ...row
        })),
      findExtractionByDocumentId: async () => null,
      findEtaCandidatesByExtractionId: async () => []
    }
  );

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.poNumber, "PO289731");
  assert.equal(candidates[0]?.appliesToEntirePo, true);
  assert.equal(candidates[0]?.etaDateIsEstimated, false);
});
