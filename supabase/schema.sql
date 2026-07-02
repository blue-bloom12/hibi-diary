-- Supabase Dashboard > SQL Editor で一度だけ実行してください。
create extension if not exists pg_trgm;

create table if not exists public.diary_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null default '',
  body text not null default '',
  entry_date date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.diary_entries enable row level security;

create policy "Users can read their own entries"
  on public.diary_entries for select
  using (auth.uid() = user_id);

create policy "Users can create their own entries"
  on public.diary_entries for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own entries"
  on public.diary_entries for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete their own entries"
  on public.diary_entries for delete
  using (auth.uid() = user_id);

create index diary_entries_user_date_idx
  on public.diary_entries (user_id, entry_date desc);
create index diary_entries_title_search_idx
  on public.diary_entries using gin (title gin_trgm_ops);
create index diary_entries_body_search_idx
  on public.diary_entries using gin (body gin_trgm_ops);

create or replace function public.set_updated_at()
returns trigger language plpgsql security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_diary_entries_updated_at on public.diary_entries;
create trigger set_diary_entries_updated_at
  before update on public.diary_entries
  for each row execute function public.set_updated_at();
