import test from "node:test";
import assert from "node:assert/strict";
import { classifyDocumentText } from "./document-classifier.js";

test("classifier identifies eta_update", () => {
  const result = classifyDocumentText("PO289731 tracking 1Z999 expected delivery 5/29 ETA update");
  assert.equal(result.classification, "eta_update");
  assert.ok(result.confidence > 0.8);
});

test("classifier identifies purchase_order", () => {
  const result = classifyDocumentText("Purchase Order 289731\nCustomer PO: 289731\nOrder Number: 55");
  assert.equal(result.classification, "purchase_order");
});

test("classifier identifies invoice_with_shipping_signal", () => {
  const result = classifyDocumentText("Invoice #9981\nShip Date: 05/21/2026\nCarrier: UPS\nTracking 1Z999AA10123456784");
  assert.equal(result.classification, "invoice_with_shipping_signal");
});

test("classifier identifies unknown", () => {
  const result = classifyDocumentText("Hello team, attached is a general update with no logistics info.");
  assert.equal(result.classification, "unknown");
});

test("classifier identifies RJ Schinner acknowledgement as invoice_with_shipping_signal", () => {
  const text = [
    "R ¥Schinner Acknowledgement",
    "Customer PO: PO289824",
    "Ship Via: OUR.TRUCK",
    "30359 qty 300"
  ].join("\n");
  const result = classifyDocumentText(text);
  assert.equal(result.classification, "invoice_with_shipping_signal");
});

test("classifier prioritizes strong customer PO signals from customer_po folder", () => {
  const text = [
    "Purchase Order",
    "PO Number 6030666782",
    "Bill To",
    "Ship To",
    "Item 33295380"
  ].join("\n");

  const result = classifyDocumentText(text, {
    fileName: "PO_NYCTA_6030666782_33295380.PDF",
    sourceSubject: "Dispatched Purchase Order # 6030666782",
    sourceSender: "Gail.Garibaldi@nyct.com",
    sourceFolderHint: "customer_po"
  });

  assert.ok(result.classification === "customer_purchase_order" || result.classification === "purchase_order");
});
