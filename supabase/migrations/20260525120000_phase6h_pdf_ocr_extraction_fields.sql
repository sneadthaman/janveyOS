alter table if exists public.ingested_documents
  add column if not exists extraction_method text,
  add column if not exists ocr_used boolean not null default false;

create index if not exists idx_ingested_documents_extraction_method
  on public.ingested_documents (extraction_method);
