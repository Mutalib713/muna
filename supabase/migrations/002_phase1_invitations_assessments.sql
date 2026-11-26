-- ============================================================================
-- MUNA — Phase 1: Invitations, Assessments, Questions & Server-Enforced Attempts
-- Run this in your Supabase Dashboard -> SQL Editor -> New query
-- ============================================================================

-- 1. Invitations
create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  created_by uuid not null references auth.users (id) on delete cascade,
  email text,
  code_hash text not null unique,
  role text not null default 'mentee' check (role in ('admin', 'mentor', 'mentee')),
  max_uses int not null default 1 check (max_uses between 1 and 1000),
  uses_count int not null default 0 check (uses_count >= 0),
  expires_at timestamptz not null default (now() + interval '7 days'),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_invitations_org_id on public.invitations (organisation_id);

alter table public.invitations enable row level security;

create policy "Org mentors and admins can view invitations"
  on public.invitations
  for select
  using (public.has_org_role(organisation_id, array['owner', 'admin', 'mentor']));

create policy "Org mentors and admins can update invitations"
  on public.invitations
  for update
  using (public.has_org_role(organisation_id, array['owner', 'admin', 'mentor']))
  with check (public.has_org_role(organisation_id, array['owner', 'admin', 'mentor']));

-- Create invitation RPC (returns plaintext code once; stores only SHA-256 hash)
create or replace function public.create_invitation(
  p_org_id uuid,
  p_role text default 'mentee',
  p_email text default null,
  p_max_uses int default 1,
  p_expires_in_hours int default 168
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_code text;
  v_hash text;
  v_inv public.invitations;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if not public.has_org_role(p_org_id, array['owner', 'admin', 'mentor']) then
    raise exception 'Permission denied';
  end if;

  if p_role not in ('admin', 'mentor', 'mentee') then
    raise exception 'Invalid role';
  end if;

  if p_role in ('admin', 'mentor') and not public.has_org_role(p_org_id, array['owner', 'admin']) then
    raise exception 'Only owners or admins can invite mentors or admins';
  end if;

  v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  v_hash := encode(sha256(convert_to(v_code, 'utf8')), 'hex');

  insert into public.invitations (
    organisation_id, created_by, email, code_hash, role, max_uses, expires_at
  )
  values (
    p_org_id,
    v_user_id,
    nullif(lower(trim(coalesce(p_email, ''))), ''),
    v_hash,
    p_role,
    greatest(1, least(coalesce(p_max_uses, 1), 1000)),
    now() + (greatest(1, coalesce(p_expires_in_hours, 168)) || ' hours')::interval
  )
  returning * into v_inv;

  insert into public.audit_logs (organisation_id, actor_id, action, target_type, target_id, metadata)
  values (
    p_org_id,
    v_user_id,
    'invitation.created',
    'invitation',
    v_inv.id::text,
    jsonb_build_object('role', v_inv.role, 'max_uses', v_inv.max_uses, 'expires_at', v_inv.expires_at)
  );

  return jsonb_build_object(
    'id', v_inv.id,
    'code', v_code,
    'role', v_inv.role,
    'max_uses', v_inv.max_uses,
    'expires_at', v_inv.expires_at
  );
end;
$$;

-- Accept invitation RPC (idempotent, transactional, validates expiry & usage)
create or replace function public.accept_invitation(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_user_email text;
  v_hash text;
  v_inv public.invitations;
  v_org_status text;
  v_existing_status text;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  v_hash := encode(sha256(convert_to(upper(trim(coalesce(p_code, ''))), 'utf8')), 'hex');

  select * into v_inv
  from public.invitations
  where code_hash = v_hash
  for update;

  if not found then
    raise exception 'Invalid invitation code';
  end if;

  if v_inv.revoked_at is not null then
    raise exception 'This invitation has been revoked';
  end if;

  if v_inv.expires_at <= now() then
    raise exception 'This invitation has expired';
  end if;

  select status into v_org_status
  from public.organisations
  where id = v_inv.organisation_id;

  if v_org_status <> 'active' then
    raise exception 'This organisation is not currently accepting members';
  end if;

  if v_inv.email is not null then
    select lower(email) into v_user_email from public.profiles where id = v_user_id;
    if v_user_email is distinct from v_inv.email then
      raise exception 'This invitation is restricted to a different email address';
    end if;
  end if;

  select status into v_existing_status
  from public.memberships
  where organisation_id = v_inv.organisation_id
    and user_id = v_user_id;

  if v_existing_status = 'active' then
    return jsonb_build_object(
      'status', 'already_member',
      'organisation_id', v_inv.organisation_id
    );
  end if;

  if v_inv.uses_count >= v_inv.max_uses then
    raise exception 'This invitation has reached its maximum number of uses';
  end if;

  insert into public.memberships (organisation_id, user_id, role, status)
  values (v_inv.organisation_id, v_user_id, v_inv.role, 'active')
  on conflict (organisation_id, user_id)
  do update set status = 'active', updated_at = now();

  update public.invitations
  set uses_count = uses_count + 1
  where id = v_inv.id;

  insert into public.audit_logs (organisation_id, actor_id, action, target_type, target_id, metadata)
  values (
    v_inv.organisation_id,
    v_user_id,
    'invitation.accepted',
    'invitation',
    v_inv.id::text,
    jsonb_build_object('role', v_inv.role)
  );

  return jsonb_build_object(
    'status', 'joined',
    'organisation_id', v_inv.organisation_id,
    'role', v_inv.role
  );
end;
$$;

-- 2. Assessments
create table if not exists public.assessments (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  created_by uuid not null references auth.users (id),
  title text not null check (char_length(trim(title)) between 2 and 200),
  description text not null default '',
  status text not null default 'draft' check (status in ('draft', 'published', 'paused', 'archived')),
  max_attempts int not null default 3 check (max_attempts between 1 and 10),
  time_limit_minutes int check (time_limit_minutes is null or time_limit_minutes > 0),
  starts_at timestamptz,
  ends_at timestamptz,
  navigation_mode text not null default 'free' check (navigation_mode in ('free', 'sequential')),
  shuffle_questions boolean not null default false,
  feedback_release text not null default 'manual' check (feedback_release in ('immediate', 'after_deadline', 'manual')),
  security_profile text not null default 'standard' check (security_profile in ('standard', 'strict', 'seb_required')),
  results_released_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_assessments_org_id on public.assessments (organisation_id);

alter table public.assessments enable row level security;

create policy "Org members can view published assessments; mentors+ can view all"
  on public.assessments
  for select
  using (
    public.has_org_role(organisation_id, array['owner', 'admin', 'mentor'])
    or (public.is_org_member(organisation_id) and status = 'published')
  );

create policy "Org mentors and admins can manage assessments"
  on public.assessments
  for all
  using (public.has_org_role(organisation_id, array['owner', 'admin', 'mentor']))
  with check (public.has_org_role(organisation_id, array['owner', 'admin', 'mentor']));

-- 3. Questions & Options (Answer keys isolated in separate table)
create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  assessment_id uuid references public.assessments (id) on delete cascade,
  created_by uuid not null references auth.users (id),
  type text not null check (type in ('mcq_single', 'mcq_multi', 'short_answer', 'theory', 'drawing', 'true_false')),
  prompt text not null check (char_length(trim(prompt)) >= 1),
  instructions text not null default '',
  points numeric not null default 1 check (points >= 0),
  order_index int not null default 0,
  required boolean not null default true,
  tags text[] not null default '{}',
  difficulty text not null default 'medium' check (difficulty in ('easy', 'medium', 'hard')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_questions_assessment on public.questions (assessment_id, order_index);
create index if not exists idx_questions_org on public.questions (organisation_id);

alter table public.questions enable row level security;

create policy "Org mentors+ can manage questions; mentees can read published assessment questions"
  on public.questions
  for select
  using (
    public.has_org_role(organisation_id, array['owner', 'admin', 'mentor'])
    or (
      public.is_org_member(organisation_id)
      and exists (
        select 1 from public.assessments a
        where a.id = assessment_id and a.status = 'published'
      )
    )
  );

create policy "Org mentors+ can insert/update/delete questions"
  on public.questions
  for all
  using (public.has_org_role(organisation_id, array['owner', 'admin', 'mentor']))
  with check (public.has_org_role(organisation_id, array['owner', 'admin', 'mentor']));

create table if not exists public.question_options (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions (id) on delete cascade,
  label text not null,
  order_index int not null default 0
);

create index if not exists idx_question_options_q on public.question_options (question_id, order_index);

alter table public.question_options enable row level security;

create policy "Readers of question can read its options"
  on public.question_options
  for select
  using (
    exists (
      select 1 from public.questions q
      where q.id = question_id
        and (
          public.has_org_role(q.organisation_id, array['owner', 'admin', 'mentor'])
          or (
            public.is_org_member(q.organisation_id)
            and exists (select 1 from public.assessments a where a.id = q.assessment_id and a.status = 'published')
          )
        )
    )
  );

create policy "Org mentors+ can manage question options"
  on public.question_options
  for all
  using (
    exists (
      select 1 from public.questions q
      where q.id = question_id
        and public.has_org_role(q.organisation_id, array['owner', 'admin', 'mentor'])
    )
  )
  with check (
    exists (
      select 1 from public.questions q
      where q.id = question_id
        and public.has_org_role(q.organisation_id, array['owner', 'admin', 'mentor'])
    )
  );

-- Protected Answer Keys (NEVER readable by mentees via client queries)
create table if not exists public.question_answer_keys (
  question_id uuid primary key references public.questions (id) on delete cascade,
  correct_option_ids uuid[] not null default '{}',
  accepted_answers text[] not null default '{}',
  rubric text not null default ''
);

alter table public.question_answer_keys enable row level security;

create policy "Only org mentors, admins and owners can access answer keys"
  on public.question_answer_keys
  for all
  using (
    exists (
      select 1 from public.questions q
      where q.id = question_id
        and public.has_org_role(q.organisation_id, array['owner', 'admin', 'mentor'])
    )
  )
  with check (
    exists (
      select 1 from public.questions q
      where q.id = question_id
        and public.has_org_role(q.organisation_id, array['owner', 'admin', 'mentor'])
    )
  );

-- 4. Attempts & Responses
create table if not exists public.attempts (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  assessment_id uuid not null references public.assessments (id) on delete cascade,
  mentee_id uuid not null references auth.users (id) on delete cascade,
  attempt_number int not null check (attempt_number >= 1),
  status text not null default 'in_progress' check (
    status in ('in_progress', 'submitted', 'terminated_focus_lost', 'expired')
  ),
  started_at timestamptz not null default now(),
  expires_at timestamptz,
  submitted_at timestamptz,
  objective_score numeric not null default 0,
  manual_score numeric not null default 0,
  total_score numeric not null default 0,
  max_score numeric not null default 0,
  unique (assessment_id, mentee_id, attempt_number)
);

create index if not exists idx_attempts_mentee on public.attempts (mentee_id, assessment_id);
create index if not exists idx_attempts_org on public.attempts (organisation_id, assessment_id);

alter table public.attempts enable row level security;

create policy "Mentees can view own attempts; mentors+ can view org attempts"
  on public.attempts
  for select
  using (
    mentee_id = auth.uid()
    or public.has_org_role(organisation_id, array['owner', 'admin', 'mentor'])
  );

create table if not exists public.responses (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  attempt_id uuid not null references public.attempts (id) on delete cascade,
  question_id uuid not null references public.questions (id) on delete cascade,
  answer_payload jsonb not null default '{}'::jsonb,
  is_correct boolean,
  points_awarded numeric,
  mentor_feedback text not null default '',
  graded_by uuid references auth.users (id) on delete set null,
  graded_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (attempt_id, question_id)
);

create index if not exists idx_responses_attempt on public.responses (attempt_id);

alter table public.responses enable row level security;

create policy "Mentees can view own responses; mentors+ can view org responses"
  on public.responses
  for select
  using (
    exists (
      select 1 from public.attempts att
      where att.id = attempt_id and att.mentee_id = auth.uid()
    )
    or public.has_org_role(organisation_id, array['owner', 'admin', 'mentor'])
  );

-- 5. Server-Enforced Attempt RPCs
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

  -- Serialize concurrent start requests for the same (assessment, user)
  perform pg_advisory_xact_lock(hashtext(p_assessment_id::text || ':' || v_user_id::text));

  -- Resume existing in-progress attempt rather than consuming a new one
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

  if v_attempt_count >= v_assessment.max_attempts then
    raise exception 'Maximum number of attempts (%) reached', v_assessment.max_attempts;
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

create or replace function public.save_response(
  p_attempt_id uuid,
  p_question_id uuid,
  p_payload jsonb
)
returns public.responses
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_attempt public.attempts;
  v_resp public.responses;
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

  if v_attempt.status <> 'in_progress' then
    raise exception 'Attempt is already closed (%)', v_attempt.status;
  end if;

  if v_attempt.expires_at is not null and now() > v_attempt.expires_at + interval '15 seconds' then
    raise exception 'Attempt time limit has expired';
  end if;

  insert into public.responses (organisation_id, attempt_id, question_id, answer_payload, updated_at)
  values (v_attempt.organisation_id, p_attempt_id, p_question_id, coalesce(p_payload, '{}'::jsonb), now())
  on conflict (attempt_id, question_id)
  do update set answer_payload = excluded.answer_payload, updated_at = now()
  returning * into v_resp;

  return v_resp;
end;
$$;

create or replace function public.submit_attempt(p_attempt_id uuid)
returns public.attempts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_attempt public.attempts;
  v_obj_score numeric := 0;
  v_rec record;
  v_selected_id uuid;
  v_selected_ids uuid[];
  v_is_correct boolean;
  v_awarded numeric;
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

  if v_attempt.status <> 'in_progress' then
    return v_attempt;
  end if;

  -- Server-side objective grading
  for v_rec in
    select
      r.id as response_id,
      r.answer_payload,
      q.type,
      q.points,
      k.correct_option_ids,
      k.accepted_answers
    from public.responses r
    join public.questions q on q.id = r.question_id
    left join public.question_answer_keys k on k.question_id = q.id
    where r.attempt_id = p_attempt_id
  loop
    v_is_correct := null;
    v_awarded := null;

    if v_rec.type in ('mcq_single', 'true_false') and coalesce(array_length(v_rec.correct_option_ids, 1), 0) > 0 then
      begin
        v_selected_id := (v_rec.answer_payload ->> 'selectedOptionId')::uuid;
      exception when others then
        v_selected_id := null;
      end;
      v_is_correct := v_selected_id is not null and v_selected_id = v_rec.correct_option_ids[1];
      v_awarded := case when v_is_correct then v_rec.points else 0 end;
      v_obj_score := v_obj_score + v_awarded;
    elsif v_rec.type = 'mcq_multi' and coalesce(array_length(v_rec.correct_option_ids, 1), 0) > 0 then
      select coalesce(array_agg(val::uuid order by val), '{}')
      into v_selected_ids
      from jsonb_array_elements_text(coalesce(v_rec.answer_payload -> 'selectedOptionIds', '[]'::jsonb)) as val;
      v_is_correct := v_selected_ids = (select array_agg(x order by x) from unnest(v_rec.correct_option_ids) as x);
      v_awarded := case when v_is_correct then v_rec.points else 0 end;
      v_obj_score := v_obj_score + v_awarded;
    elsif v_rec.type = 'short_answer' and coalesce(array_length(v_rec.accepted_answers, 1), 0) > 0 then
      v_is_correct := exists (
        select 1 from unnest(v_rec.accepted_answers) as acc
        where lower(trim(acc)) = lower(trim(coalesce(v_rec.answer_payload ->> 'text', '')))
      );
      v_awarded := case when v_is_correct then v_rec.points else 0 end;
      v_obj_score := v_obj_score + v_awarded;
    end if;

    if v_is_correct is not null then
      update public.responses
      set is_correct = v_is_correct, points_awarded = v_awarded
      where id = v_rec.response_id;
    end if;
  end loop;

  update public.attempts
  set
    status = 'submitted',
    submitted_at = now(),
    objective_score = v_obj_score,
    total_score = v_obj_score + manual_score
  where id = p_attempt_id
  returning * into v_attempt;

  return v_attempt;
end;
$$;
