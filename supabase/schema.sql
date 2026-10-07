-- Light Up: accounts, cloud projects, shared stickers, usage events and admin.
-- Run once in the Supabase SQL editor (Dashboard → SQL → New query → paste → Run).
-- Then make yourself an admin:  update public.profiles set role = 'admin' where email = 'you@example.com';

-- ---------- profiles: one row per signed-up user ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  email text,
  name text,
  role text not null default 'user' check (role in ('user', 'admin')),
  banned boolean not null default false,
  created_at timestamptz not null default now(),
  last_seen timestamptz
);

-- every new sign-up gets a profile
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, name) values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)));
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- admin check used by the policies below (security definer so it can read profiles without recursion)
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and not banned);
$$;

-- users can't promote themselves or lift a ban: only admins change role or banned
create or replace function public.protect_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() and (new.role is distinct from old.role or new.banned is distinct from old.banned) then
    raise exception 'Only admins can change roles or bans';
  end if;
  return new;
end $$;
drop trigger if exists protect_profile on public.profiles;
create trigger protect_profile before update on public.profiles for each row execute function public.protect_profile();

alter table public.profiles enable row level security;
drop policy if exists "read own profile or admin" on public.profiles;
create policy "read own profile or admin" on public.profiles for select using (id = auth.uid() or public.is_admin());
drop policy if exists "update own profile or admin" on public.profiles;
create policy "update own profile or admin" on public.profiles for update using (id = auth.uid() or public.is_admin());

-- ---------- cloud projects ----------
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade default auth.uid(),
  name text not null default 'Untitled video',
  data jsonb not null,
  duration real not null default 0,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists projects_user on public.projects (user_id, updated_at desc);
alter table public.projects enable row level security;
drop policy if exists "own projects" on public.projects;
create policy "own projects" on public.projects for all using (user_id = auth.uid() and not exists (select 1 from public.profiles where id = auth.uid() and banned)) with check (user_id = auth.uid());
drop policy if exists "admins read projects" on public.projects;
create policy "admins read projects" on public.projects for select using (public.is_admin());
drop policy if exists "admins delete projects" on public.projects;
create policy "admins delete projects" on public.projects for delete using (public.is_admin());

-- ---------- usage events (exports, captions, live sessions...) ----------
create table if not exists public.events (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users on delete set null default auth.uid(),
  type text not null,
  meta jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists events_time on public.events (created_at desc);
create index if not exists events_type on public.events (type, created_at desc);
alter table public.events enable row level security;
drop policy if exists "log own events" on public.events;
create policy "log own events" on public.events for insert with check (user_id is null or user_id = auth.uid());
drop policy if exists "admins read events" on public.events;
create policy "admins read events" on public.events for select using (public.is_admin());

-- ---------- shared sticker library, curated by admins ----------
create table if not exists public.stickers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  path text not null,
  tags text[] not null default '{}',
  published boolean not null default true,
  created_by uuid references auth.users on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
alter table public.stickers enable row level security;
drop policy if exists "anyone reads published stickers" on public.stickers;
create policy "anyone reads published stickers" on public.stickers for select using (published or public.is_admin());
drop policy if exists "admins manage stickers" on public.stickers;
create policy "admins manage stickers" on public.stickers for all using (public.is_admin()) with check (public.is_admin());

-- ---------- app settings readable by signed-in users, editable by admins ----------
create table if not exists public.app_config (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
alter table public.app_config enable row level security;
drop policy if exists "signed-in users read config" on public.app_config;
create policy "signed-in users read config" on public.app_config for select using (auth.role() = 'authenticated');
drop policy if exists "admins write config" on public.app_config;
create policy "admins write config" on public.app_config for all using (public.is_admin()) with check (public.is_admin());

-- ---------- storage: private project media per user, public stickers ----------
insert into storage.buckets (id, name, public) values ('media', 'media', false) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('stickers', 'stickers', true) on conflict (id) do nothing;

drop policy if exists "own media" on storage.objects;
create policy "own media" on storage.objects for all
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "admins upload stickers" on storage.objects;
create policy "admins upload stickers" on storage.objects for all
  using (bucket_id = 'stickers' and public.is_admin())
  with check (bucket_id = 'stickers' and public.is_admin());
drop policy if exists "anyone reads stickers" on storage.objects;
create policy "anyone reads stickers" on storage.objects for select using (bucket_id = 'stickers');

-- ---------- admin dashboard numbers in one call ----------
create or replace function public.admin_stats(days int default 30) returns json
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  return json_build_object(
    'users', (select count(*) from profiles),
    'new_users', (select count(*) from profiles where created_at > now() - make_interval(days => days)),
    'active_users', (select count(distinct user_id) from events where created_at > now() - make_interval(days => days)),
    'projects', (select count(*) from projects),
    'banned', (select count(*) from profiles where banned),
    'by_type', (select coalesce(json_object_agg(type, n), '{}') from (select type, count(*) n from events where created_at > now() - make_interval(days => days) group by type) t),
    'daily', (select coalesce(json_agg(json_build_object('day', d, 'events', n, 'users', u) order by d), '[]') from (
      select date_trunc('day', created_at)::date d, count(*) n, count(distinct user_id) u from events
      where created_at > now() - make_interval(days => days) group by 1) t)
  );
end $$;
