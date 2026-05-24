alter table public.ingested_documents
  add column if not exists source_mailbox text,
  add column if not exists source_folder text,
  add column if not exists source_folder_hint text,
  add column if not exists source_received_at timestamptz,
  add column if not exists classification_mismatch boolean not null default false,
  add column if not exists needs_manual_triage boolean not null default false;

create index if not exists idx_ingested_documents_source_mailbox
  on public.ingested_documents (source_mailbox);

create index if not exists idx_ingested_documents_source_folder
  on public.ingested_documents (source_folder);

create index if not exists idx_ingested_documents_source_folder_hint
  on public.ingested_documents (source_folder_hint);

create index if not exists idx_ingested_documents_source_received_at
  on public.ingested_documents (source_received_at desc);

create index if not exists idx_ingested_documents_needs_manual_triage
  on public.ingested_documents (needs_manual_triage);
