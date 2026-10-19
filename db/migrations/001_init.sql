-- Oilaviy Arxiv: initial schema. Every family-owned row carries family_id; all queries filter by it.

create table families (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  ai_enabled boolean not null default false,
  ai_consent_at timestamptz,
  ai_consent_by uuid,
  created_at timestamptz not null default now()
);

create table users (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  email text not null,
  name text not null,
  password_hash text not null,
  role text not null check (role in ('owner', 'admin', 'member', 'viewer')),
  is_tree_editor boolean not null default false,
  disabled_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index users_email_key on users (lower(email));
create unique index users_one_owner on users (family_id) where role = 'owner';

create table sessions (
  token_hash text primary key,
  user_id uuid not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index sessions_user on sessions (user_id);

create table invites (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  token_hash text not null unique,
  kind text not null check (kind in ('invite', 'reset')),
  role text check (role in ('admin', 'member', 'viewer')),
  user_id uuid references users(id) on delete cascade,
  created_by uuid references users(id) on delete set null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  check ((kind = 'invite' and role is not null) or (kind = 'reset' and user_id is not null))
);

create table albums (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  title text not null,
  description text not null default '',
  cover_media_id uuid,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index albums_title_key on albums (family_id, lower(title));

create table media (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  uploaded_by uuid references users(id) on delete set null,
  ingest_key text not null unique,
  source text not null check (source in ('web', 'telegram')),
  kind text not null check (kind in ('image', 'video')),
  status text not null default 'processing' check (status in ('processing', 'ready', 'failed')),
  error text,
  original_name text not null,
  mime text not null,
  size_bytes bigint not null,
  sha256 text not null,
  width int,
  height int,
  duration_ms int,
  taken_at timestamptz,
  title text not null default '',
  description text not null default '',
  tags text[] not null default '{}',
  variants text[] not null default '{}',
  ai_status text check (ai_status in ('pending', 'done', 'failed', 'skipped')),
  ai_caption text,
  ai_tags text[] not null default '{}',
  ai_model text,
  ai_error text,
  ai_at timestamptz,
  telegram_media_group text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
-- Duplicates are detected per family by content hash, including items in the trash.
create unique index media_dedupe on media (family_id, sha256);
create index media_timeline on media (family_id, (coalesce(taken_at, created_at)) desc, id desc) where deleted_at is null;
create index media_trash on media (family_id, deleted_at) where deleted_at is not null;

alter table albums add constraint albums_cover_fk foreign key (cover_media_id) references media(id) on delete set null;

create table album_items (
  album_id uuid not null references albums(id) on delete cascade,
  media_id uuid not null references media(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (album_id, media_id)
);
create index album_items_media on album_items (media_id);

create table uploads (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  file_name text not null,
  size_bytes bigint not null,
  kind text check (kind in ('image', 'video')),
  mime text,
  received_bytes bigint not null default 0,
  album_id uuid references albums(id) on delete set null,
  client_key text not null,
  status text not null default 'uploading'
    check (status in ('uploading', 'processing', 'done', 'duplicate', 'failed', 'cancelled')),
  media_id uuid references media(id) on delete set null,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index uploads_client_key on uploads (user_id, client_key) where status = 'uploading';

create table jobs (
  id bigserial primary key,
  type text not null,
  payload jsonb not null,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  attempts int not null default 0,
  max_attempts int not null default 5,
  run_at timestamptz not null default now(),
  locked_at timestamptz,
  last_error text,
  dedupe_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index jobs_ready on jobs (run_at) where status = 'queued';
create unique index jobs_dedupe on jobs (dedupe_key) where dedupe_key is not null and status in ('queued', 'running');

create table telegram_links (
  user_id uuid primary key references users(id) on delete cascade,
  telegram_user_id bigint not null unique,
  chat_id bigint not null,
  photo_hint_sent boolean not null default false,
  linked_at timestamptz not null default now()
);

create table telegram_link_codes (
  code_hash text primary key,
  user_id uuid not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz
);

create table telegram_updates (
  update_id bigint primary key,
  received_at timestamptz not null default now()
);

create table telegram_media_groups (
  chat_id bigint not null,
  media_group_id text not null,
  album_id uuid references albums(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (chat_id, media_group_id)
);

create table ai_usage (
  family_id uuid not null references families(id) on delete cascade,
  day date not null,
  requests int not null default 0,
  primary key (family_id, day)
);

create table people (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  first_name text not null,
  last_name text not null default '',
  patronymic text not null default '',
  gender text check (gender in ('male', 'female')),
  birth_date text check (birth_date ~ '^\d{4}(-\d{2}(-\d{2})?)?$'),
  death_date text check (death_date ~ '^\d{4}(-\d{2}(-\d{2})?)?$'),
  is_living boolean not null default true,
  birth_place text not null default '',
  notes text not null default '',
  user_id uuid unique references users(id) on delete set null,
  avatar_media_id uuid references media(id) on delete set null,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index people_family on people (family_id);

-- parent: person_a is the parent of person_b. spouse: stored once with person_a < person_b.
create table relationships (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  type text not null check (type in ('parent', 'spouse')),
  person_a uuid not null references people(id) on delete cascade,
  person_b uuid not null references people(id) on delete cascade,
  subtype text not null,
  start_date text check (start_date ~ '^\d{4}(-\d{2}(-\d{2})?)?$'),
  end_date text check (end_date ~ '^\d{4}(-\d{2}(-\d{2})?)?$'),
  created_at timestamptz not null default now(),
  check (person_a <> person_b),
  check ((type = 'parent' and subtype in ('biological', 'adoptive', 'step', 'foster'))
      or (type = 'spouse' and subtype in ('married', 'divorced', 'widowed', 'partner'))),
  check (type <> 'spouse' or person_a < person_b),
  unique (type, person_a, person_b)
);
create index relationships_family on relationships (family_id);
create index relationships_b on relationships (person_b);

create table media_people (
  media_id uuid not null references media(id) on delete cascade,
  person_id uuid not null references people(id) on delete cascade,
  primary key (media_id, person_id)
);
create index media_people_person on media_people (person_id);
