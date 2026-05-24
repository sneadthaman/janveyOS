create table if not exists public.eta_candidate_reviews (
  id uuid primary key default gen_random_uuid(),
  eta_update_candidate_id uuid not null references public.eta_update_candidates(id),
  review_status text not null default 'pending' check (review_status in ('pending', 'approved', 'rejected')),
  reviewed_by text,
  reviewed_at timestamptz,
  reviewer_notes text,
  action_request_id uuid references public.agent_action_requests(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_eta_candidate_reviews_unique_candidate
  on public.eta_candidate_reviews (eta_update_candidate_id);

create index if not exists idx_eta_candidate_reviews_candidate_id
  on public.eta_candidate_reviews (eta_update_candidate_id);

create index if not exists idx_eta_candidate_reviews_status
  on public.eta_candidate_reviews (review_status);

create index if not exists idx_eta_candidate_reviews_reviewed_at
  on public.eta_candidate_reviews (reviewed_at desc);

create index if not exists idx_eta_candidate_reviews_action_request_id
  on public.eta_candidate_reviews (action_request_id);
