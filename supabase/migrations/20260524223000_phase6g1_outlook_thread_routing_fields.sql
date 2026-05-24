alter table public.ingested_documents
  add column if not exists routed_by_message_id text,
  add column if not exists routed_by_subject text,
  add column if not exists routed_by_sender text;

create index if not exists idx_ingested_documents_source_thread_id
  on public.ingested_documents (source_thread_id);

create index if not exists idx_ingested_documents_routed_by_message_id
  on public.ingested_documents (routed_by_message_id);
