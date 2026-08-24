-- ============================================================
--  Family Grocery List — Supabase Schema
--  Run this in: Supabase Dashboard → SQL Editor
-- ============================================================

-- ── Extensions ────────────────────────────────────────────────────────────
create extension if not exists "uuid-ossp";

-- ── Tables ────────────────────────────────────────────────────────────────

create table public.families (
  id         uuid primary key default gen_random_uuid(),
  name       text not null default 'My Family',
  join_code  text not null unique
               default upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  created_at timestamptz not null default now()
);

-- Profiles extend auth.users with a display name.
create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at   timestamptz not null default now()
);

-- family_members.user_id → profiles.id so PostgREST can auto-join.
create table public.family_members (
  family_id  uuid not null references public.families(id)  on delete cascade,
  user_id    uuid not null references public.profiles(id)  on delete cascade,
  role       text not null default 'member'
               check (role in ('member', 'admin')),
  created_at timestamptz not null default now(),
  primary key (family_id, user_id)
);

create table public.grocery_items (
  id           uuid primary key default gen_random_uuid(),
  family_id    uuid not null references public.families(id) on delete cascade,
  name         text not null
                 check (char_length(name) between 1 and 200),
  quantity     text
                 check (quantity is null or char_length(quantity) <= 100),
  notes        text
                 check (notes is null or char_length(notes) <= 1000),
  category     text,
  purchased    boolean not null default false,
  deleted      boolean not null default false,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  purchased_at timestamptz,
  purchased_by uuid references public.profiles(id) on delete set null
);

create table public.activity_log (
  id         uuid primary key default gen_random_uuid(),
  family_id  uuid not null references public.families(id) on delete cascade,
  user_id    uuid references public.profiles(id) on delete set null,
  icon       text not null,
  text       text not null,
  created_at timestamptz not null default now()
);

-- ── Indexes ───────────────────────────────────────────────────────────────

create index on public.grocery_items(family_id) where not deleted;
create index on public.activity_log(family_id, created_at desc);
create index on public.family_members(user_id);

-- ── Row Level Security ────────────────────────────────────────────────────

alter table public.families       enable row level security;
alter table public.profiles       enable row level security;
alter table public.family_members enable row level security;
alter table public.grocery_items  enable row level security;
alter table public.activity_log   enable row level security;

-- ── Helper: get current user's family_id ─────────────────────────────────

create or replace function public.get_user_family_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select family_id
  from   public.family_members
  where  user_id = auth.uid()
  limit  1;
$$;

-- ── RLS Policies ──────────────────────────────────────────────────────────

-- profiles: own row read/write; family members can read each other's name
create policy "profiles_own"
  on public.profiles
  using  (auth.uid() = id)
  with check (auth.uid() = id);

create policy "profiles_family_read"
  on public.profiles for select
  using (id in (
    select user_id from public.family_members
    where  family_id = public.get_user_family_id()
  ));

-- families: any member can read; only admin can update
create policy "families_select"
  on public.families for select
  using (id = public.get_user_family_id());

create policy "families_update"
  on public.families for update
  using (
    id = public.get_user_family_id()
    and exists (
      select 1 from public.family_members
      where family_id = public.get_user_family_id()
        and user_id   = auth.uid()
        and role      = 'admin'
    )
  );

-- family_members: read own family; insert own row; admin can delete
create policy "family_members_select"
  on public.family_members for select
  using (family_id = public.get_user_family_id());

create policy "family_members_insert"
  on public.family_members for insert
  with check (user_id = auth.uid());

create policy "family_members_delete"
  on public.family_members for delete
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.family_members fm
      where  fm.family_id = family_id
        and  fm.user_id   = auth.uid()
        and  fm.role      = 'admin'
    )
  );

-- grocery_items: all family members can CRUD
create policy "items_select"
  on public.grocery_items for select
  using (family_id = public.get_user_family_id());

create policy "items_insert"
  on public.grocery_items for insert
  with check (family_id = public.get_user_family_id());

create policy "items_update"
  on public.grocery_items for update
  using (family_id = public.get_user_family_id());

-- activity_log: all family members can read and insert
create policy "activity_select"
  on public.activity_log for select
  using (family_id = public.get_user_family_id());

create policy "activity_insert"
  on public.activity_log for insert
  with check (family_id = public.get_user_family_id());

-- ── RPC: create_family ────────────────────────────────────────────────────

create or replace function public.create_family(p_family_name text)
returns json
language plpgsql security definer set search_path = public
as $$
declare
  v_family_id uuid;
  v_join_code text;
  v_user_id   uuid := auth.uid();
begin
  if v_user_id is null then
    return json_build_object('error', 'not authenticated');
  end if;
  if exists (select 1 from public.family_members where user_id = v_user_id) then
    return json_build_object('error', 'already a member of a family');
  end if;
  -- Ensure profile exists (safety net if trigger was slow)
  insert into public.profiles (id) values (v_user_id) on conflict (id) do nothing;

  v_join_code := upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  insert into public.families (name, join_code)
    values (coalesce(nullif(trim(p_family_name), ''), 'My Family'), v_join_code)
    returning id into v_family_id;

  insert into public.family_members (family_id, user_id, role)
    values (v_family_id, v_user_id, 'admin');

  return json_build_object('success', true, 'family_id', v_family_id, 'join_code', v_join_code);
end;
$$;

-- ── RPC: join_family_with_code ────────────────────────────────────────────

create or replace function public.join_family_with_code(p_join_code text)
returns json
language plpgsql security definer set search_path = public
as $$
declare
  v_family_id uuid;
  v_user_id   uuid := auth.uid();
begin
  if v_user_id is null then
    return json_build_object('error', 'not authenticated');
  end if;
  select id into v_family_id
  from   public.families
  where  join_code = upper(trim(p_join_code));

  if v_family_id is null then
    return json_build_object('error', 'Invalid invite code. Please check with your family admin.');
  end if;

  -- Ensure profile exists
  insert into public.profiles (id) values (v_user_id) on conflict (id) do nothing;

  -- Idempotent join
  insert into public.family_members (family_id, user_id, role)
    values (v_family_id, v_user_id, 'member')
    on conflict (family_id, user_id) do nothing;

  return json_build_object('success', true, 'family_id', v_family_id);
end;
$$;

-- ── Trigger: auto-create profile on sign-up ───────────────────────────────

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data->>'display_name'), ''),
      split_part(new.email, '@', 1)
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ── Trigger: keep updated_at current ─────────────────────────────────────

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

create trigger grocery_items_updated_at
  before update on public.grocery_items
  for each row execute procedure public.set_updated_at();
