import test from "node:test";
import assert from "node:assert/strict";
import { detectEtaVendorProfile, extractEtaUpdateCandidates, extractRjSchinnerItemLines } from "./eta-candidate-extractor.js";

test("extractor parses PO/date from bring PO289731 on 5/29", () => {
  const candidates = extractEtaUpdateCandidates("Please bring PO289731 on 5/29", { now: new Date("2026-01-10T00:00:00Z") });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.poNumber, "PO289731");
  assert.equal(candidates[0]?.etaDate, "2026-05-29");
});

test("extractor detects entire PO language", () => {
  const candidates = extractEtaUpdateCandidates("Deliver entire PO 289731 for all items by 05/29", {
    now: new Date("2026-01-10T00:00:00Z")
  });
  assert.equal(candidates[0]?.appliesToEntirePo, true);
});

test("extractor parses item code with DIV prefix", () => {
  const candidates = extractEtaUpdateCandidates("PO 289731 item DIV 123456 ETA 5/29");
  assert.equal(candidates[0]?.itemNumber, "123456");
});

test("extractor estimates ETA from invoice date when invoice has shipping signal but no explicit ETA", () => {
  const candidates = extractEtaUpdateCandidates(
    "Invoice #5532\nInvoice Date: 05/21/2026\nCarrier: FedEx\nTracking Number: 1234567890",
    { classification: "invoice_with_shipping_signal", now: new Date("2026-05-24T00:00:00Z") }
  );
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.etaDate, "2026-05-25");
  assert.equal(candidates[0]?.etaDateSource, "estimated_from_invoice_date_plus_4_days");
  assert.equal(candidates[0]?.etaDateIsEstimated, true);
  assert.equal(candidates[0]?.baseDate, "2026-05-21");
  assert.equal(candidates[0]?.baseDateSource, "invoice_date");
  assert.ok((candidates[0]?.confidence ?? 0) >= 0.55 && (candidates[0]?.confidence ?? 0) <= 0.7);
});

test("extractor estimates ETA from ship date for SSS invoice-like shipping doc even when classification is eta_update", () => {
  const text = [
    "PO # PO289798",
    "Date 5/21/2026",
    "Ship Date 5/21/2026",
    "Carrier Name ESTES EXPRESS LIN...",
    "Tracking # 5038059208",
    "Item 25118"
  ].join("\n");

  const candidates = extractEtaUpdateCandidates(text, {
    classification: "eta_update",
    now: new Date("2026-05-24T00:00:00Z")
  });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.poNumber, "PO289798");
  assert.equal(candidates[0]?.itemNumber, "25118");
  assert.equal(candidates[0]?.trackingNumber, "5038059208");
  assert.ok(candidates[0]?.carrier === "ESTES" || candidates[0]?.carrier === "ESTES EXPRESS");
  assert.equal(candidates[0]?.baseDate, "2026-05-21");
  assert.equal(candidates[0]?.baseDateSource, "ship_date");
  assert.equal(candidates[0]?.etaDate, "2026-05-25");
  assert.equal(candidates[0]?.etaDateIsEstimated, true);
  assert.equal(candidates[0]?.etaDateSource, "estimated_from_ship_date_plus_4_days");
});

test("SSS invoice shipped quantity without tracking still creates estimated ETA candidate", () => {
  const text = [
    "Triple S",
    "Invoice",
    "Member # 380",
    "Date 5/22/2026",
    "PO # PO289746",
    "Item 72485",
    "Shipped 7",
    "Vendor Berry Global Inc."
  ].join("\n");

  const profile = detectEtaVendorProfile(text, { fileName: "Invoice_INV245618_1779469256777.pdf" });
  assert.equal(profile, "sss_invoice");

  const candidates = extractEtaUpdateCandidates(text, {
    classification: "invoice_with_shipping_signal",
    fileName: "Invoice_INV245618_1779469256777.pdf",
    now: new Date("2026-05-24T00:00:00Z")
  });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.poNumber, "PO289746");
  assert.equal(candidates[0]?.itemNumber, "72485");
  assert.equal(candidates[0]?.baseDate, "2026-05-22");
  assert.equal(candidates[0]?.baseDateSource, "document_date");
  assert.equal(candidates[0]?.etaDate, "2026-05-26");
  assert.equal(candidates[0]?.etaDateIsEstimated, true);
  assert.equal(candidates[0]?.etaDateSource, "estimated_from_document_date_plus_4_days");
  assert.equal(candidates[0]?.trackingNumber, null);
});

test("RJ Schinner acknowledgement creates one whole-PO ETA candidate even when item lines exist", () => {
  const text = [
    "RJ Schinner",
    "Acknowledgement",
    "Date: 05/22/26",
    "Order No: S6509406",
    "Customer PO: PO289824",
    "Ship Date: 05/26/26",
    "Ship Via: OUR.TRUCK",
    "30359 qty 300",
    "02001 qty 20",
    "30358 qty 100"
  ].join("\n");

  const profile = detectEtaVendorProfile(text, { fileName: "S6509406-0001_3529484.pdf" });
  assert.equal(profile, "rj_schinner_acknowledgement");

  const candidates = extractEtaUpdateCandidates(text, {
    classification: "invoice_with_shipping_signal",
    fileName: "S6509406-0001_3529484.pdf",
    now: new Date("2026-05-24T00:00:00Z")
  });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.poNumber, "PO289824");
  assert.equal(candidates[0]?.etaDate, "2026-05-26");
  assert.equal(candidates[0]?.etaDateIsEstimated, false);
  assert.equal(candidates[0]?.etaDateSource, "ship_date");
  assert.equal(candidates[0]?.carrier, "RJ_SCHINNER_TRUCK");
  assert.equal(candidates[0]?.appliesToEntirePo, true);
  assert.equal(candidates[0]?.itemNumber, null);
});

test("RJ Schinner OCR-like acknowledgement text with P0O typo creates one whole-PO ETA candidate", () => {
  const text = [
    "R ¥Schinner Acknowledgement",
    "38294 P0O289824 Sam Janvey",
    "Michelle Duplicki OUR. TRUCK 1% 10 DAYS NET 30 DAY 05/26/26",
    "300 | 300 | 30359",
    "20 20 | 02001",
    "100 100 | 30358"
  ].join("\n");

  const candidates = extractEtaUpdateCandidates(text, {
    classification: "invoice_with_shipping_signal",
    fileName: "S6509406-0001_3529484.pdf",
    now: new Date("2026-05-24T00:00:00Z")
  });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.poNumber, "PO289824");
  assert.equal(candidates[0]?.etaDate, "2026-05-26");
  assert.equal(candidates[0]?.carrier, "RJ_SCHINNER_TRUCK");
  assert.equal(candidates[0]?.appliesToEntirePo, true);
  assert.equal(candidates[0]?.itemNumber, null);
});

test("RJ Schinner subtotal-like OCR number does not create separate ETA candidate", () => {
  const text = [
    "RJ Schinner",
    "Acknowledgement",
    "Customer PO: PO289824",
    "Ship Date: 05/26/26",
    "Ship Via: OUR.TRUCK",
    "30359 qty 300",
    "02001 qty 20",
    "30358 qty 100",
    "Subtotal 2011.2"
  ].join("\n");

  const candidates = extractEtaUpdateCandidates(text, {
    classification: "invoice_with_shipping_signal",
    fileName: "S6509406-0001_3529484.pdf",
    now: new Date("2026-05-24T00:00:00Z")
  });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.itemNumber, null);
  assert.equal(candidates[0]?.appliesToEntirePo, true);
});

test("RJ Schinner item lines are parsed into extraction metadata helper", () => {
  const text = ["30359 qty 300", "02001 qty 20", "30358 qty 100"].join("\n");
  const lines = extractRjSchinnerItemLines(text);
  assert.deepEqual(lines, [
    { itemNumber: "30359", quantity: 300 },
    { itemNumber: "02001", quantity: 20 },
    { itemNumber: "30358", quantity: 100 }
  ]);
});

test("Contec profile detection identifies order confirmation", () => {
  const text = ["CONTEC", "Order Confirmation", "Order Number: W12095", "PO Number:", "PO289827"].join("\n");
  const profile = detectEtaVendorProfile(text, { fileName: "PO# PO289827 Order confirmation W12095.pdf" });
  assert.equal(profile, "contec_order_confirmation");
});

test("Contec OCR-shaped text creates one whole-PO ETA candidate with planned ship date +4 days", () => {
  const text = [
    "CONTEC",
    "Order Confirmation",
    "Order Number: W12095",
    "PO Number:",
    "PO289827",
    "Ship Via: Most Economical",
    "Item 30001 Qty 5 Planned Ship Date 29-May-2026 Wanted Delivery Date 02-Jun-2026",
    "Item 30002 Qty 2 Planned Ship Date 29-May-2026"
  ].join("\n");

  const candidates = extractEtaUpdateCandidates(text, {
    classification: "invoice_with_shipping_signal",
    fileName: "PO# PO289827 Order confirmation W12095.pdf",
    now: new Date("2026-05-24T00:00:00Z")
  });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.poNumber, "PO289827");
  assert.equal(candidates[0]?.baseDate, "2026-05-29");
  assert.equal(candidates[0]?.baseDateSource, "planned_ship_date");
  assert.equal(candidates[0]?.etaDate, "2026-06-02");
  assert.equal(candidates[0]?.etaDateSource, "estimated_from_contec_ship_date_plus_4_days");
  assert.equal(candidates[0]?.etaDateIsEstimated, true);
  assert.equal(candidates[0]?.appliesToEntirePo, true);
  assert.equal(candidates[0]?.itemNumber, null);
  assert.ok((candidates[0]?.rawContext ?? "").toLowerCase().includes("contec order confirmation"));
});

test("Contec filename fallback extracts PO289827 from filename when OCR PO label is missing", () => {
  const text = [
    "CONTEC",
    "Order Confirmation",
    "Order Number: W12095",
    "Planned Ship Date 29-May-2026"
  ].join("\n");

  const candidates = extractEtaUpdateCandidates(text, {
    classification: "invoice_with_shipping_signal",
    fileName: "PO# PO289827 Order confirmation W12095.pdf",
    now: new Date("2026-05-24T00:00:00Z")
  });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.poNumber, "PO289827");
});

test("Contec profile does not create line-level candidates even when item lines exist", () => {
  const text = [
    "CONTEC",
    "Order Confirmation",
    "PO Number: PO289827",
    "Order Number: W12095",
    "30001 Qty 5 Planned Ship Date 29-May-2026",
    "30002 Qty 3 Planned Ship Date 29-May-2026"
  ].join("\n");

  const candidates = extractEtaUpdateCandidates(text, {
    classification: "invoice_with_shipping_signal",
    fileName: "PO# PO289827 Order confirmation W12095.pdf",
    now: new Date("2026-05-24T00:00:00Z")
  });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.itemNumber, null);
  assert.equal(candidates[0]?.appliesToEntirePo, true);
});
