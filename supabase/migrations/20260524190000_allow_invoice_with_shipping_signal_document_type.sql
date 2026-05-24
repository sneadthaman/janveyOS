alter table public.ingested_documents
  drop constraint if exists ingested_documents_document_type_check;

alter table public.ingested_documents
  add constraint ingested_documents_document_type_check
  check (
    document_type is null
    or document_type in (
      'unknown',
      'eta_update',
      'invoice_with_shipping_signal',
      'purchase_order',
      'quote',
      'invoice',
      'other'
    )
  );
