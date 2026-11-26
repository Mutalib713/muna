-- ============================================================================
-- MUNA — Phase 0: Foundation, Profiles, Organisations & Tenant Isolation
-- Run this in your Supabase Dashboard -> SQL Editor -> New query
-- ============================================================================

-- 1. Profiles (mirrors auth.users for display names & lookup)
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Users can view their own profile"
  on public.profiles
  for select
  using (auth.uid() = id);

create policy "Users can update their own profile"
  on public.profiles
  for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Automatically create a profile row when a user signs up via Supabase Auth
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 2. Organisations
create table if not exists public.organisations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 2 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' and char_length(slug) between 2 and 64),
  status text not null default 'active' check (status in ('active', 'suspended', 'archived')),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.organisations enable row level security;

-- 3. Memberships (role scoped per organisation)
create table if not exists public.memberships (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'mentor', 'mentee')),
  status text not null default 'active' check (status in ('active', 'suspended', 'revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, user_id)
);

create index if not exists idx_memberships_user_id on public.memberships (user_id);
create index if not exists idx_memberships_org_id on public.memberships (organisation_id);

alter table public.memberships enable row level security;

-- 4. Audit Logs
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null,
  action text not null,
  target_type text,
  target_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_logs_org_created on public.audit_logs (organisation_id, created_at desc);

alter table public.audit_logs enable row level security;

-- 5. Tenant Isolation Helper Functions
create or replace function public.is_org_member(org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships m
    where m.organisation_id = org_id
      and m.user_id = auth.uid()
      and m.status = 'active'
  );
$$;

create or replace function public.has_org_role(org_id uuid, allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships m
    where m.organisation_id = org_id
      and m.user_id = auth.uid()
      and m.status = 'active'
      and m.role = any (allowed_roles)
  );
$$;

-- 6. RLS Policies for Organisations, Memberships & Audit Logs
create policy "Members can view their organisations"
  on public.organisations
  for select
  using (public.is_org_member(id));

create policy "Owners and admins can update their organisation"
  on public.organisations
  for update
  using (public.has_org_role(id, array['owner', 'admin']))
  with check (public.has_org_role(id, array['owner', 'admin']));

create policy "Members can view memberships in their organisation"
  on public.memberships
  for select
  using (
    user_id = auth.uid()
    or public.has_org_role(organisation_id, array['owner', 'admin', 'mentor'])
  );

create policy "Owners and admins can update memberships in their organisation"
  on public.memberships
  for update
  using (public.has_org_role(organisation_id, array['owner', 'admin']))
  with check (public.has_org_role(organisation_id, array['owner', 'admin']));

create policy "Owners and admins can view audit logs"
  on public.audit_logs
  for select
  using (public.has_org_role(organisation_id, array['owner', 'admin']));

-- 7. Atomic RPC: Create Organisation + Owner Membership
create or replace function public.create_organisation(org_name text, org_slug text default null)
returns public.organisations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_clean_name text := trim(coalesce(org_name, ''));
  v_slug text;
  v_org public.organisations;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if char_length(v_clean_name) < 2 then
    raise exception 'Organisation name must be at least 2 characters';
  end if;

  if org_slug is not null and trim(org_slug) <> '' then
    v_slug := lower(trim(org_slug));
  else
    v_slug := regexp_replace(lower(v_clean_name), '[^a-z0-9]+', '-', 'g');
    v_slug := trim(both '-' from v_slug);
    if char_length(v_slug) < 2 then
      v_slug := 'org';
    end if;
    -- Append short random suffix if slug already exists
    if exists (select 1 from public.organisations where slug = v_slug) then
      v_slug := left(v_slug, 54) || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
    end if;
  end if;

  insert into public.organisations (name, slug, created_by)
  values (v_clean_name, v_slug, v_user_id)
  returning * into v_org;

  insert into public.memberships (organisation_id, user_id, role, status)
  values (v_org.id, v_user_id, 'owner', 'active');

  insert into public.audit_logs (organisation_id, actor_id, action, target_type, target_id, metadata)
  values (
    v_org.id,
    v_user_id,
    'organisation.created',
    'organisation',
    v_org.id::text,
    jsonb_build_object('name', v_org.name, 'slug', v_org.slug)
  );

  return v_org;
end;
$$;
