-- ============================================================================
-- MUNA — Phase 3: Secure Web Mode & Server-Side Security Event Telemetry
-- Run this in your Supabase Dashboard -> SQL Editor -> New query
-- ============================================================================

-- 1. Security Events Table
create table if not exists public.security_events (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  attempt_id uuid not null references public.attempts (id) on delete cascade,
  mentee_id uuid not null references auth.users (id) on delete cascade,
  event_type text not null check (
    event_type in (
      'fullscreen_entered',
      'fullscreen_exited',
      'visibility_hidden',
      'visibility_visible',
      'window_blur',
      'window_focus',
      'copy_blocked',
      'context_menu_blocked'
    )
  ),
  client_ts timestamptz,
  server_ts timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists idx_security_events_attempt on public.security_events (attempt_id, server_ts asc);
create index if not exists idx_security_events_org on public.security_events (organisation_id, server_ts desc);

alter table public.security_events enable row level security;

create policy "Mentors+ can view org security events; mentees can view own attempt events"
  on public.security_events
  for select
  using (
    mentee_id = auth.uid()
    or public.has_org_role(organisation_id, array['owner', 'admin', 'mentor'])
  );

-- 2. Record Security Event RPC (enforces strict focus-loss termination on server)
create or replace function public.record_security_event(
  p_attempt_id uuid,
  p_event_type text,
  p_client_ts timestamptz default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_attempt public.attempts;
  v_profile text;
  v_event public.security_events;
  v_terminated boolean := false;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select * into v_attempt
  from public.attempts
  where id = p_attempt_id
    and mentee_id = v_user_id
  for update;

  if not found then
    raise exception 'Attempt not found';
  end if;

  select security_profile into v_profile
  from public.assessments
  where id = v_attempt.assessment_id;

  insert into public.security_events (
    organisation_id, attempt_id, mentee_id, event_type, client_ts, metadata
  )
  values (
    v_attempt.organisation_id, p_attempt_id, v_user_id, p_event_type, p_client_ts, coalesce(p_metadata, '{}'::jsonb)
  )
  returning * into v_event;

  -- Strict web mode: first confirmed visibility_hidden terminates and grades last saved answers
  if v_attempt.status = 'in_progress'
     and v_profile = 'strict'
     and p_event_type = 'visibility_hidden' then
    perform public.submit_attempt(p_attempt_id);

    update public.attempts
    set status = 'terminated_focus_lost'
    where id = p_attempt_id;

    insert into public.audit_logs (organisation_id, actor_id, action, target_type, target_id, metadata)
    values (
      v_attempt.organisation_id,
      v_user_id,
      'attempt.terminated_focus_lost',
      'attempt',
      p_attempt_id::text,
      jsonb_build_object('event_id', v_event.id, 'event_type', p_event_type)
    );

    v_terminated := true;
  end if;

  return jsonb_build_object(
    'event_id', v_event.id,
    'terminated', v_terminated
  );
end;
$$;
