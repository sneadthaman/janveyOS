-- Phase 3G: normalize agent_action_requests statuses
-- Canonical statuses:
-- pending, approved, running, executed, failed, rejected, cancelled

begin;

do $$
declare
  table_ref regclass;
  rec record;
begin
  table_ref := to_regclass('public.agent_action_requests');
  if table_ref is null then
    return;
  end if;

  -- Preserve existing data while normalizing legacy success status naming.
  update public.agent_action_requests
  set status = 'executed'
  where status = 'completed';

  -- Drop any existing check constraints on status for this table so we can
  -- safely recreate the canonical one in idempotent runs.
  for rec in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.agent_action_requests'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%status%'
      and pg_get_constraintdef(c.oid) ilike '% in %'
  loop
    execute format('alter table public.agent_action_requests drop constraint if exists %I', rec.conname);
  end loop;
  
  alter table public.agent_action_requests
    add constraint agent_action_requests_status_check
    check (
      status in (
        'pending',
        'approved',
        'running',
        'executed',
        'failed',
        'rejected',
        'cancelled'
      )
    );
end $$;

commit;
