-- Demo-only server-side workspace. Apply to a dedicated Supabase project before
-- enabling optional manual backup. The shared event password is not user authentication.

create table if not exists public.tacit_processes (
  workspace_id text not null,
  id text not null,
  owner_id text not null,
  title text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  current_version integer not null default 0,
  payload jsonb not null,
  primary key (workspace_id, id),
  constraint tacit_process_payload_object check (jsonb_typeof(payload) = 'object')
);

create table if not exists public.tacit_process_versions (
  workspace_id text not null,
  id text not null,
  process_id text not null,
  version_number integer not null check (version_number > 0),
  based_on_version_id text,
  status text not null check (status in ('recorded')),
  created_at timestamptz not null,
  payload jsonb not null,
  primary key (workspace_id, id),
  unique (workspace_id, process_id, version_number),
  foreign key (workspace_id, process_id)
    references public.tacit_processes (workspace_id, id) on delete cascade,
  constraint tacit_version_payload_object check (jsonb_typeof(payload) = 'object')
);

create index if not exists tacit_processes_updated_idx
  on public.tacit_processes (workspace_id, updated_at desc);
create index if not exists tacit_versions_process_idx
  on public.tacit_process_versions (workspace_id, process_id, version_number);

alter table public.tacit_processes enable row level security;
alter table public.tacit_process_versions enable row level security;

-- No anon/authenticated policy: only the server-held secret/service role may
-- read or write. Revoke legacy public-schema grants explicitly.
revoke all on public.tacit_processes from anon, authenticated;
revoke all on public.tacit_process_versions from anon, authenticated;
grant select, insert, update, delete on public.tacit_processes to service_role;
grant select, insert, update, delete on public.tacit_process_versions to service_role;

-- Evidence must live outside JSONB. Storage is private; no browser grants or
-- public URLs are created by this migration.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tacit-evidence', 'tacit-evidence', false, 2097152, array['image/jpeg'])
on conflict (id) do nothing;
