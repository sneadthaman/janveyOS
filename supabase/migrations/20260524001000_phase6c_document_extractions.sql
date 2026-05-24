create table if not exists public.document_extractions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.ingested_documents(id),
  extractor_version text not null,
  classification text not null check (classification in ('eta_update', 'purchase_order', 'quote', 'invoice', 'unknown')),
  confidence numeric,
  raw_extraction_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_document_extractions_document_id
  on public.document_extractions (document_id);

create index if not exists idx_document_extractions_classification
  on public.document_extractions (classification);

create index if not exists idx_document_extractions_created_at
  on public.document_extractions (created_at desc);

create table if not exists public.eta_update_candidates (
  id uuid primary key default gen_random_uuid(),
  document_extraction_id uuid not null references public.document_extractions(id),
  po_number text,
  eta_date date,
  tracking_number text,
  carrier text,
  item_number text,
  applies_to_entire_po boolean not null default false,
  confidence numeric,
  raw_context text,
  created_at timestamptz not null default now()
);

create index if not exists idx_eta_update_candidates_document_extraction_id
  on public.eta_update_candidates (document_extraction_id);

create index if not exists idx_eta_update_candidates_po_number
  on public.eta_update_candidates (po_number);

create index if not exists idx_eta_update_candidates_eta_date
  on public.eta_update_candidates (eta_date);

create index if not exists idx_eta_update_candidates_item_number
  on public.eta_update_candidates (item_number);

create index if not exists idx_eta_update_candidates_applies_to_entire_po
  on public.eta_update_candidates (applies_to_entire_po);
