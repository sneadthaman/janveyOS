alter table public.document_extractions
  drop constraint if exists document_extractions_classification_check;

alter table public.document_extractions
  add constraint document_extractions_classification_check
  check (classification in ('eta_update', 'invoice_with_shipping_signal', 'purchase_order', 'quote', 'invoice', 'unknown'));

alter table public.eta_update_candidates
  add column if not exists eta_date_source text,
  add column if not exists eta_date_is_estimated boolean not null default false,
  add column if not exists base_date date,
  add column if not exists base_date_source text;
