-- Supabase Dashboard > SQL Editor で一度だけ実行してください。
-- 同じユーザー・同じ日付の日記が複数ある場合、更新日時が最も新しい1件を残します。
-- 削除対象は diary_entries_duplicate_archive に退避されます。

begin;

create table if not exists public.diary_entries_duplicate_archive (
  archived_id bigint generated always as identity primary key,
  original_id uuid not null unique,
  user_id uuid not null,
  title text not null default '',
  body text not null default '',
  entry_date date not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  archived_at timestamptz not null default now()
);

alter table public.diary_entries_duplicate_archive enable row level security;

with ranked_entries as (
  select
    id,
    row_number() over (
      partition by user_id, entry_date
      order by updated_at desc, created_at desc, id desc
    ) as duplicate_rank
  from public.diary_entries
)
insert into public.diary_entries_duplicate_archive (
  original_id,
  user_id,
  title,
  body,
  entry_date,
  created_at,
  updated_at
)
select
  entry.id,
  entry.user_id,
  entry.title,
  entry.body,
  entry.entry_date,
  entry.created_at,
  entry.updated_at
from public.diary_entries as entry
join ranked_entries as ranked on ranked.id = entry.id
where ranked.duplicate_rank > 1
on conflict (original_id) do nothing;

with ranked_entries as (
  select
    id,
    row_number() over (
      partition by user_id, entry_date
      order by updated_at desc, created_at desc, id desc
    ) as duplicate_rank
  from public.diary_entries
)
delete from public.diary_entries as entry
using ranked_entries as ranked
where entry.id = ranked.id
  and ranked.duplicate_rank > 1;

create unique index if not exists diary_entries_user_entry_date_unique_idx
  on public.diary_entries (user_id, entry_date);

commit;
