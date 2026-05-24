alter table public.ingested_documents
  drop constraint if exists ingested_documents_document_type_check;

alter table public.ingested_documents
  add constraint ingested_documents_document_type_check
  check (
    document_type is null
    or document_type in (
      'unknown',
      'eta_update',
      'customer_purchase_order',
      'invoice_with_shipping_signal',
      'purchase_order',
      'quote',
      'invoice',
      'other'
    )
  );

alter table public.document_extractions
  drop constraint if exists document_extractions_classification_check;

alter table public.document_extractions
  add constraint document_extractions_classification_check
  check (
    classification in (
      'eta_update',
      'customer_purchase_order',
      'invoice_with_shipping_signal',
      'purchase_order',
      'quote',
      'invoice',
      'unknown'
    )
  );
