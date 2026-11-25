-- ============================================================================
-- MUNA — Phase 2: Private Storage (Drawings & Media), Rubrics, Manual Grading
-- Run this in your Supabase Dashboard -> SQL Editor -> New query
-- ============================================================================

-- 1. Private Storage Buckets
insert into storage.buckets (id, name, public)
values
  ('assessment-media', 'assessment-media', false),
  ('attempt-drawings', 'attempt-drawings', false)
on conflict (id) do nothing;

-- 2. Media Assets Metadata Table (tracks ownership & tenant scope)
create table if not exists public.media_assets (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  bucket_id text not null check (bucket_id in ('assessment-media', 'attempt-drawings')),
  object_path text not null,
  uploaded_by uuid not null references auth.users (id) on delete cascade,
  attempt_id uuid references public.attempts (id) on delete cascade,
  question_id uuid references public.questions (id) on delete cascade,
  mime_type text,
  size_bytes bigint,
  created_at timestamptz not null default now(),
  unique (bucket_id, object_path)
);

create index if not exists idx_media_assets_org on public.media_assets (organisation_id);

alter table public.media_assets enable row level security;

create policy "Org mentors+ can view org media assets; mentees can view own attempt drawings"
  on public.media_assets
  for select
  using (
    public.has_org_role(organisation_id, array['owner', 'admin', 'mentor'])
    or uploaded_by = auth.uid()
    or (
      bucket_id = 'assessment-media'
      and public.is_org_member(organisation_id)
    )
  );

create policy "Org mentors+ can insert assessment media; mentees can insert own attempt drawings"
  on public.media_assets
  for insert
  with check (
    uploaded_by = auth.uid()
    and (
      (bucket_id = 'assessment-media' and public.has_org_role(organisation_id, array['owner', 'admin', 'mentor']))
      or (
        bucket_id = 'attempt-drawings'
        and public.is_org_member(organisation_id)
        and exists (
          select 1 from public.attempts a
          where a.id = attempt_id
            and a.mentee_id = auth.uid()
            and a.status = 'in_progress'
        )
      )
    )
  );

-- Storage object policies (object path convention: <organisation_id>/...)
create policy "Authenticated org members can read authorised storage objects"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id in ('assessment-media', 'attempt-drawings')
    and (
      public.has_org_role((storage.foldername(name))[1]::uuid, array['owner', 'admin', 'mentor'])
      or (
        bucket_id = 'assessment-media'
        and public.is_org_member((storage.foldername(name))[1]::uuid)
      )
      or (
        bucket_id = 'attempt-drawings'
        and owner = auth.uid()
      )
    )
  );

create policy "Authenticated users can upload to their org/attempt folder"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id in ('assessment-media', 'attempt-drawings')
    and (
      (
        bucket_id = 'assessment-media'
        and public.has_org_role((storage.foldername(name))[1]::uuid, array['owner', 'admin', 'mentor'])
      )
      or (
        bucket_id = 'attempt-drawings'
        and public.is_org_member((storage.foldername(name))[1]::uuid)
      )
    )
  );

-- 3. Grading Rubrics
create table if not exists public.grading_rubrics (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  question_id uuid not null references public.questions (id) on delete cascade,
  criteria jsonb not null default '[]'::jsonb,
  max_points numeric not null default 1 check (max_points >= 0),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (question_id)
);

alter table public.grading_rubrics enable row level security;

create policy "Only org mentors, admins and owners can manage rubrics"
  on public.grading_rubrics
  for all
  using (public.has_org_role(organisation_id, array['owner', 'admin', 'mentor']))
  with check (public.has_org_role(organisation_id, array['owner', 'admin', 'mentor']));

-- 4. Manual Grading RPC
create or replace function public.grade_response(
  p_response_id uuid,
  p_points_awarded numeric,
  p_feedback text default ''
)
returns public.responses
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_resp public.responses;
  v_max_points numeric;
  v_manual_sum numeric;
  v_obj_score numeric;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select r.* into v_resp
  from public.responses r
  where r.id = p_response_id
  for update;

  if not found then
    raise exception 'Response not found';
  end if;

  if not public.has_org_role(v_resp.organisation_id, array['owner', 'admin', 'mentor']) then
    raise exception 'Permission denied';
  end if;

  select points into v_max_points
  from public.questions
  where id = v_resp.question_id;

  if p_points_awarded < 0 or p_points_awarded > v_max_points then
    raise exception 'Points must be between 0 and %', v_max_points;
  end if;

  update public.responses
  set
    points_awarded = p_points_awarded,
    mentor_feedback = coalesce(p_feedback, ''),
    graded_by = v_user_id,
    graded_at = now()
  where id = p_response_id
  returning * into v_resp;

  -- Recompute manual_score & total_score on parent attempt
  select coalesce(sum(r.points_awarded), 0)
  into v_manual_sum
  from public.responses r
  join public.questions q on q.id = r.question_id
  where r.attempt_id = v_resp.attempt_id
    and q.type in ('theory', 'drawing', 'short_answer')
    and r.graded_by is not null;

  select objective_score into v_obj_score
  from public.attempts
  where id = v_resp.attempt_id;

  update public.attempts
  set
    manual_score = v_manual_sum,
    total_score = coalesce(v_obj_score, 0) + v_manual_sum
  where id = v_resp.attempt_id;

  insert into public.audit_logs (organisation_id, actor_id, action, target_type, target_id, metadata)
  values (
    v_resp.organisation_id,
    v_user_id,
    'response.graded',
    'response',
    v_resp.id::text,
    jsonb_build_object('attempt_id', v_resp.attempt_id, 'points_awarded', p_points_awarded)
  );

  return v_resp;
end;
$$;

-- 5. Release Assessment Results RPC
create or replace function public.release_results(p_assessment_id uuid)
returns public.assessments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_assessment public.assessments;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select * into v_assessment
  from public.assessments
  where id = p_assessment_id
  for update;

  if not found then
    raise exception 'Assessment not found';
  end if;

  if not public.has_org_role(v_assessment.organisation_id, array['owner', 'admin', 'mentor']) then
    raise exception 'Permission denied';
  end if;

  update public.assessments
  set results_released_at = now(), updated_at = now()
  where id = p_assessment_id
  returning * into v_assessment;

  insert into public.audit_logs (organisation_id, actor_id, action, target_type, target_id)
  values (v_assessment.organisation_id, v_user_id, 'assessment.results_released', 'assessment', p_assessment_id::text);

  return v_assessment;
end;
$$;

-- 6. Grant Extra Attempt Override (Audited)
create table if not exists public.attempt_overrides (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  assessment_id uuid not null references public.assessments (id) on delete cascade,
  mentee_id uuid not null references auth.users (id) on delete cascade,
  extra_attempts int not null default 1 check (extra_attempts between 1 and 5),
  reason text not null check (char_length(trim(reason)) >= 3),
  granted_by uuid not null references auth.users (id),
  created_at timestamptz not null default now()
);

alter table public.attempt_overrides enable row level security;

create policy "Mentors+ can view attempt overrides; mentees can view own"
  on public.attempt_overrides
  for select
  using (
    mentee_id = auth.uid()
    or public.has_org_role(organisation_id, array['owner', 'admin', 'mentor'])
  );

create or replace function public.grant_extra_attempt(
  p_assessment_id uuid,
  p_mentee_id uuid,
  p_reason text,
  p_extra int default 1
)
returns public.attempt_overrides
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_org_id uuid;
  v_override public.attempt_overrides;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select organisation_id into v_org_id
  from public.assessments
  where id = p_assessment_id;

  if v_org_id is null then
    raise exception 'Assessment not found';
  end if;

  if not public.has_org_role(v_org_id, array['owner', 'admin', 'mentor']) then
    raise exception 'Permission denied';
  end if;

  if char_length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'A reason is required to grant an extra attempt';
  end if;

  insert into public.attempt_overrides (
    organisation_id, assessment_id, mentee_id, extra_attempts, reason, granted_by
  )
  values (
    v_org_id, p_assessment_id, p_mentee_id, greatest(1, least(p_extra, 5)), trim(p_reason), v_user_id
  )
  returning * into v_override;

  insert into public.audit_logs (organisation_id, actor_id, action, target_type, target_id, metadata)
  values (
    v_org_id,
    v_user_id,
    'attempt.extra_granted',
    'mentee',
    p_mentee_id::text,
    jsonb_build_object('assessment_id', p_assessment_id, 'extra_attempts', v_override.extra_attempts, 'reason', v_override.reason)
  );

  return v_override;
end;
$$;

-- Update start_attempt to honor audited extra_attempts overrides
create or replace function public.start_attempt(p_assessment_id uuid)
returns public.attempts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_assessment public.assessments;
  v_existing public.attempts;
  v_attempt_count int;
  v_extra_attempts int := 0;
  v_max_score numeric;
  v_expires_at timestamptz;
  v_new public.attempts;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select * into v_assessment
  from public.assessments
  where id = p_assessment_id;

  if not found then
    raise exception 'Assessment not found';
  end if;

  if not public.is_org_member(v_assessment.organisation_id) then
    raise exception 'You are not a member of this organisation';
  end if;

  if v_assessment.status <> 'published' then
    raise exception 'Assessment is not currently open';
  end if;

  if v_assessment.starts_at is not null and now() < v_assessment.starts_at then
    raise exception 'Assessment has not started yet';
  end if;

  if v_assessment.ends_at is not null and now() > v_assessment.ends_at then
    raise exception 'Assessment deadline has passed';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_assessment_id::text || ':' || v_user_id::text));

  select * into v_existing
  from public.attempts
  where assessment_id = p_assessment_id
    and mentee_id = v_user_id
    and status = 'in_progress'
  limit 1;

  if found then
    return v_existing;
  end if;

  select count(*) into v_attempt_count
  from public.attempts
  where assessment_id = p_assessment_id
    and mentee_id = v_user_id;

  select coalesce(sum(extra_attempts), 0) into v_extra_attempts
  from public.attempt_overrides
  where assessment_id = p_assessment_id
    and mentee_id = v_user_id;

  if v_attempt_count >= (v_assessment.max_attempts + v_extra_attempts) then
    raise exception 'Maximum number of attempts (%) reached', (v_assessment.max_attempts + v_extra_attempts);
  end if;

  select coalesce(sum(points), 0) into v_max_score
  from public.questions
  where assessment_id = p_assessment_id;

  if v_assessment.time_limit_minutes is not null then
    v_expires_at := now() + (v_assessment.time_limit_minutes || ' minutes')::interval;
  end if;

  insert into public.attempts (
    organisation_id, assessment_id, mentee_id, attempt_number, status, expires_at, max_score
  )
  values (
    v_assessment.organisation_id,
    p_assessment_id,
    v_user_id,
    v_attempt_count + 1,
    'in_progress',
    v_expires_at,
    v_max_score
  )
  returning * into v_new;

  return v_new;
end;
$$;
