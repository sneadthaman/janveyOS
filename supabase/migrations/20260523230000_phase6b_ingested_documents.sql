create table if not exists public.ingested_documents (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  source_message_id text,
  source_thread_id text,
  source_sender text,
  source_subject text,
  file_name text not null,
  mime_type text not null default 'application/pdf',
  file_size_bytes integer,
  storage_path text,
  sha256_hash text,
  extracted_text text,
  extraction_status text not null default 'pending' check (extraction_status in ('pending', 'completed', 'failed')),
  extraction_error text,
  document_type text check (document_type in ('unknown', 'eta_update', 'purchase_order', 'quote', 'invoice', 'other')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_ingested_documents_sha256_hash
  on public.ingested_documents (sha256_hash);

create index if not exists idx_ingested_documents_source
  on public.ingested_documents (source);

create index if not exists idx_ingested_documents_document_type
  on public.ingested_documents (document_type);

create index if not exists idx_ingested_documents_created_at
  on public.ingested_documents (created_at desc);
