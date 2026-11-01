-- CowdeISreal: схема, права, RLS, RPC, Storage и Realtime-авторизация.
-- Запуск: `supabase db push` ИЛИ Supabase -> SQL Editor -> вставить весь файл -> Run. Повторный запуск безопасен.
--
-- Принципы:
--   * Клиент читает данные через RLS (SELECT), а ПИШЕТ только через функции ниже (security definer).
--     Прямые INSERT/UPDATE/DELETE из браузера запрещены (кроме избранного и своих приватных настроек профиля).
--   * user_id всегда берётся из auth.uid(), а не из аргументов. community_id выводится из канала/сообщения.
--   * Права — битовая маска (те же значения в src/lib/permissions.ts). Владелец сообщества имеет все права.
--   * Иерархия: действовать можно только на тех, чья верхняя роль СТРОГО ниже вашей; выдавать — только роли ниже вашей
--     и только те права, которые есть у вас самих. Владельца нельзя кикнуть, забанить, заглушить.

-- ─────────────────────────────── 0. Права (битовая маска) ───────────────────────────────
--  1 VIEW_CHANNELS      2 SEND_MESSAGES     4 MANAGE_MESSAGES   8 CREATE_INVITES
-- 16 MANAGE_CHANNELS   32 MANAGE_ROLES     64 MANAGE_MEMBERS  128 MODERATE
-- 256 ADMINISTRATOR   512 CONNECT_VOICE  1024 STREAM_VIDEO   2048 ATTACH_FILES
-- 4096 ADD_REACTIONS 8192 MANAGE_TAGS   16384 MANAGE_COMMUNITY 32768 USE_COMMANDS
create or replace function public.perm_all() returns bigint language sql immutable as 'select 65535::bigint';
create or replace function public.perm_default() returns bigint language sql immutable
  as 'select (1|2|8|512|1024|2048|4096|32768)::bigint';

-- ─────────────────────────────── 1. Таблицы ───────────────────────────────
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  handle      text not null unique check (handle ~ '^[a-z0-9_.]{3,32}$'),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 40),
  avatar_path text check (avatar_path is null or avatar_path ~ '^avatars/[0-9a-f-]{36}/[A-Za-z0-9._-]{1,120}$'),
  created_at  timestamptz not null default now()
);

create table if not exists public.profile_private (
  user_id     uuid primary key references public.profiles (id) on delete cascade,
  bio         text not null default '' check (char_length(bio) <= 300),
  status_text text not null default '' check (char_length(status_text) <= 80),
  presence    text not null default 'online' check (presence in ('online','idle','dnd','invisible')),
  timezone    text not null default 'UTC' check (char_length(timezone) between 1 and 64),
  bio_visibility      text not null default 'everyone' check (bio_visibility in ('everyone','members','nobody')),
  status_visibility   text not null default 'everyone' check (status_visibility in ('everyone','members','nobody')),
  timezone_visibility text not null default 'members'  check (timezone_visibility in ('everyone','members','nobody')),
  created_visibility  text not null default 'everyone' check (created_visibility in ('everyone','members','nobody')),
  settings    jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object' and pg_column_size(settings) < 16000),
  updated_at  timestamptz not null default now()
);

create table if not exists public.communities (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (char_length(btrim(name)) between 2 and 60),
  description  text not null default '' check (char_length(description) <= 500),
  rules        text not null default '' check (char_length(rules) <= 4000),
  icon_path    text check (icon_path is null or icon_path ~ '^communities/[0-9a-f-]{36}/[A-Za-z0-9._-]{1,120}$'),
  accent_color text not null default '#5be3a8' check (accent_color ~ '^#[0-9a-fA-F]{6}$'),
  owner_id     uuid not null references public.profiles (id),
  xp_enabled          boolean not null default true,
  xp_per_message      int not null default 10  check (xp_per_message between 1 and 100),
  xp_cooldown_seconds int not null default 60  check (xp_cooldown_seconds between 10 and 3600),
  xp_daily_cap        int not null default 200 check (xp_daily_cap between 10 and 5000),
  xp_min_length       int not null default 8   check (xp_min_length between 1 and 200),
  voice_mesh_limit    int not null default 6   check (voice_mesh_limit between 2 and 8),
  created_at   timestamptz not null default now()
);
create index if not exists communities_owner_idx on public.communities (owner_id);

create table if not exists public.community_members (
  community_id  uuid not null references public.communities (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  nickname      text check (nickname is null or char_length(btrim(nickname)) between 1 and 32),
  joined_at     timestamptz not null default now(),
  timeout_until timestamptz,
  xp            int not null default 0 check (xp >= 0),
  last_xp_at    timestamptz,
  primary key (community_id, user_id)
);
create index if not exists community_members_user_idx on public.community_members (user_id);

create table if not exists public.community_bans (
  community_id uuid not null references public.communities (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  reason       text not null default '' check (char_length(reason) <= 300),
  banned_by    uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  primary key (community_id, user_id)
);

create table if not exists public.roles (
  id           uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities (id) on delete cascade,
  name         text not null check (char_length(btrim(name)) between 1 and 32),
  color        text not null default '#9aa7b2' check (color ~ '^#[0-9a-fA-F]{6}$'),
  position     int not null default 1 check (position between 0 and 1000),
  permissions  bigint not null default 0 check (permissions between 0 and 65535),
  is_default   boolean not null default false,
  created_at   timestamptz not null default now()
);
create unique index if not exists roles_one_default on public.roles (community_id) where is_default;
create index if not exists roles_community_idx on public.roles (community_id);

create table if not exists public.member_roles (
  community_id uuid not null,
  user_id      uuid not null,
  role_id      uuid not null references public.roles (id) on delete cascade,
  primary key (community_id, user_id, role_id),
  foreign key (community_id, user_id) references public.community_members (community_id, user_id) on delete cascade
);
create index if not exists member_roles_role_idx on public.member_roles (role_id);

create table if not exists public.member_tags (
  id           uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities (id) on delete cascade,
  name         text not null check (char_length(btrim(name)) between 1 and 24),
  color        text not null default '#c9a227' check (color ~ '^#[0-9a-fA-F]{6}$'),
  description  text not null default '' check (char_length(description) <= 120),
  created_at   timestamptz not null default now()
);
create unique index if not exists member_tags_name_uq on public.member_tags (community_id, lower(name));

create table if not exists public.member_tag_assignments (
  community_id uuid not null,
  user_id      uuid not null,
  tag_id       uuid not null references public.member_tags (id) on delete cascade,
  assigned_by  uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  primary key (user_id, tag_id),
  foreign key (community_id, user_id) references public.community_members (community_id, user_id) on delete cascade
);

create table if not exists public.channel_categories (
  id           uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities (id) on delete cascade,
  name         text not null check (char_length(btrim(name)) between 1 and 40),
  position     int not null default 0,
  created_at   timestamptz not null default now()
);

create table if not exists public.channels (
  id           uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities (id) on delete cascade,
  category_id  uuid references public.channel_categories (id) on delete set null,
  name         text not null check (char_length(btrim(name)) between 1 and 40),
  kind         text not null default 'text' check (kind in ('text','voice','announcement')),
  topic        text not null default '' check (char_length(topic) <= 300),
  position     int not null default 0,
  slowmode_seconds int not null default 0 check (slowmode_seconds between 0 and 21600),
  created_at   timestamptz not null default now()
);
create index if not exists channels_community_idx on public.channels (community_id);

create table if not exists public.channel_overwrites (
  channel_id uuid not null references public.channels (id) on delete cascade,
  role_id    uuid not null references public.roles (id) on delete cascade,
  allow      bigint not null default 0 check (allow between 0 and 65535),
  deny       bigint not null default 0 check (deny between 0 and 65535),
  primary key (channel_id, role_id)
);

create table if not exists public.messages (
  id           bigint generated always as identity primary key,
  channel_id   uuid not null references public.channels (id) on delete cascade,
  community_id uuid not null references public.communities (id) on delete cascade,
  author_id    uuid references public.profiles (id) on delete set null,
  kind         text not null default 'user' check (kind in ('user','bot','system')),
  bot_key      text,
  content      text not null default '' check (char_length(content) <= 4000),
  reply_to_id  bigint references public.messages (id) on delete set null,
  mentions     uuid[] not null default '{}',
  created_at   timestamptz not null default now(),
  edited_at    timestamptz,
  deleted_at   timestamptz,
  pinned_at    timestamptz,
  pinned_by    uuid references public.profiles (id) on delete set null
);
create index if not exists messages_channel_idx on public.messages (channel_id, id desc);
create index if not exists messages_author_idx on public.messages (author_id, created_at desc);
create index if not exists messages_search_idx on public.messages using gin (to_tsvector('simple', content));
create index if not exists messages_pinned_idx on public.messages (channel_id) where pinned_at is not null;

create table if not exists public.message_attachments (
  id           uuid primary key default gen_random_uuid(),
  message_id   bigint not null references public.messages (id) on delete cascade,
  channel_id   uuid not null references public.channels (id) on delete cascade,
  storage_path text not null unique,
  file_name    text not null check (char_length(file_name) between 1 and 200),
  mime_type    text not null,
  size_bytes   bigint not null check (size_bytes >= 0),
  created_at   timestamptz not null default now()
);
create index if not exists message_attachments_msg_idx on public.message_attachments (message_id);

create table if not exists public.message_reactions (
  message_id bigint not null references public.messages (id) on delete cascade,
  channel_id uuid not null references public.channels (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  emoji      text not null check (char_length(emoji) between 1 and 32),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

create table if not exists public.channel_read_states (
  user_id      uuid not null references public.profiles (id) on delete cascade,
  channel_id   uuid not null references public.channels (id) on delete cascade,
  last_read_id bigint not null default 0,
  updated_at   timestamptz not null default now(),
  primary key (user_id, channel_id)
);

create table if not exists public.channel_favorites (
  user_id    uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  channel_id uuid not null references public.channels (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, channel_id)
);

create table if not exists public.invites (
  code         text primary key,
  community_id uuid not null references public.communities (id) on delete cascade,
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz,
  max_uses     int check (max_uses is null or max_uses between 1 and 1000),
  uses         int not null default 0,
  revoked_at   timestamptz
);
create index if not exists invites_community_idx on public.invites (community_id);

create table if not exists public.audit_log (
  id           bigint generated always as identity primary key,
  community_id uuid not null references public.communities (id) on delete cascade,
  actor_id     uuid references public.profiles (id) on delete set null,
  action       text not null,
  target_type  text,
  target_id    text,
  details      jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);
create index if not exists audit_log_community_idx on public.audit_log (community_id, id desc);

create table if not exists public.xp_events (
  id           bigint generated always as identity primary key,
  community_id uuid not null references public.communities (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  amount       int not null,
  source       text not null check (source in ('message','manual')),
  source_id    text,
  reason       text not null default '',
  actor_id     uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now()
);
-- одна выдача за одно сообщение: повторная выдача невозможна на уровне БД
create unique index if not exists xp_events_once on public.xp_events (community_id, source, source_id) where source = 'message';
create index if not exists xp_events_user_day on public.xp_events (community_id, user_id, created_at desc);

create table if not exists public.rate_limits (
  user_id      uuid not null,
  bucket       text not null,
  window_start timestamptz not null,
  hits         int not null,
  primary key (user_id, bucket)
);

create table if not exists public.bot_modules (
  bot_key     text primary key check (bot_key ~ '^[a-z][a-z0-9_]{1,31}$'),
  name        text not null,
  description text not null default '',
  is_example  boolean not null default false
);

create table if not exists public.community_bots (
  community_id uuid not null references public.communities (id) on delete cascade,
  bot_key      text not null references public.bot_modules (bot_key) on delete cascade,
  enabled      boolean not null default true,
  settings     jsonb not null default '{}'::jsonb check (pg_column_size(settings) < 8000),
  primary key (community_id, bot_key)
);

create table if not exists public.bot_command_log (
  id           bigint generated always as identity primary key,
  community_id uuid not null references public.communities (id) on delete cascade,
  channel_id   uuid references public.channels (id) on delete set null,
  user_id      uuid references public.profiles (id) on delete set null,
  command      text not null,
  ok           boolean not null,
  error        text,
  created_at   timestamptz not null default now()
);
create index if not exists bot_command_log_idx on public.bot_command_log (community_id, id desc);

create table if not exists public.voice_states (
  channel_id   uuid not null references public.channels (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  community_id uuid not null references public.communities (id) on delete cascade,
  muted        boolean not null default true,
  deafened     boolean not null default false,
  video        boolean not null default false,
  screen       boolean not null default false,
  joined_at    timestamptz not null default now(),
  last_seen    timestamptz not null default now(),
  primary key (channel_id, user_id)
);
create unique index if not exists voice_states_one_room on public.voice_states (user_id);

insert into public.bot_modules (bot_key, name, description, is_example) values
  ('examples', 'Помощник (пример)', 'Демонстрационные команды: /help, /rank, /top, /roll, /coin. Не является ботом DiggersBtwModes; можно выключить.', true)
on conflict (bot_key) do update set name = excluded.name, description = excluded.description, is_example = excluded.is_example;

-- ─────────────────────────────── 2. Служебные функции ───────────────────────────────
create or replace function public._uid() returns uuid
language plpgsql stable set search_path = public as $$
declare v uuid := auth.uid();
begin
  if v is null then raise exception 'not_authenticated'; end if;
  return v;
end $$;

create or replace function public.try_uuid(p text) returns uuid
language plpgsql immutable as $$
begin return p::uuid; exception when others then return null; end $$;

create or replace function public._rate_limit(p_bucket text, p_max int, p_window_seconds int) returns void
language plpgsql security definer set search_path = public as $$
declare v_hits int; v_start timestamptz; v_uid uuid := public._uid();
begin
  insert into public.rate_limits as r (user_id, bucket, window_start, hits)
  values (v_uid, p_bucket, clock_timestamp(), 1)
  on conflict (user_id, bucket) do update set
    hits = case when r.window_start < clock_timestamp() - make_interval(secs => p_window_seconds) then 1 else r.hits + 1 end,
    window_start = case when r.window_start < clock_timestamp() - make_interval(secs => p_window_seconds) then clock_timestamp() else r.window_start end
  returning hits, window_start into v_hits, v_start;
  if v_hits > p_max then
    raise exception 'rate_limited:%', greatest(1, ceil(extract(epoch from v_start + make_interval(secs => p_window_seconds) - clock_timestamp())))::int;
  end if;
end $$;

create or replace function public._audit(p_community uuid, p_action text, p_target_type text, p_target_id text, p_details jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.audit_log (community_id, actor_id, action, target_type, target_id, details)
  values (p_community, auth.uid(), p_action, p_target_type, p_target_id, coalesce(p_details, '{}'::jsonb));
$$;

-- верхняя позиция роли участника: владелец = 1_000_000, не участник = -1
create or replace function public._member_top(p_community uuid, p_user uuid) returns int
language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from public.communities c where c.id = p_community and c.owner_id = p_user) then 1000000
    when not exists (select 1 from public.community_members m where m.community_id = p_community and m.user_id = p_user) then -1
    else coalesce((select max(r.position) from public.member_roles mr join public.roles r on r.id = mr.role_id
                   where mr.community_id = p_community and mr.user_id = p_user), 0)
  end;
$$;

-- права участника в сообществе (без учёта каналов)
create or replace function public._member_permissions(p_community uuid, p_user uuid) returns bigint
language plpgsql stable security definer set search_path = public as $$
declare v_owner uuid; v_perms bigint; v_timeout timestamptz;
begin
  if p_user is null then return 0; end if;
  select owner_id into v_owner from public.communities where id = p_community;
  if v_owner is null then return 0; end if;
  if v_owner = p_user then return public.perm_all(); end if;
  select timeout_until into v_timeout from public.community_members where community_id = p_community and user_id = p_user;
  if not found then return 0; end if;
  select coalesce(bit_or(r.permissions), 0) into v_perms from public.roles r
   where r.community_id = p_community
     and (r.is_default or r.id in (select role_id from public.member_roles where community_id = p_community and user_id = p_user));
  if v_perms & 256 <> 0 then return public.perm_all(); end if;
  if v_timeout is not null and v_timeout > now() then v_perms := v_perms & ~(2|512|1024|2048|4096|32768)::bigint; end if;
  return v_perms;
end $$;

-- права участника в конкретном канале (с учётом переопределений ролей)
create or replace function public._channel_permissions(p_channel uuid, p_user uuid) returns bigint
language plpgsql stable security definer set search_path = public as $$
declare v_comm uuid; v_kind text; v bigint; v_allow bigint; v_deny bigint; v_timeout timestamptz; v_send_allowed boolean := false;
begin
  select community_id, kind into v_comm, v_kind from public.channels where id = p_channel;
  if v_comm is null then return 0; end if;
  v := public._member_permissions(v_comm, p_user);
  if v = 0 then return 0; end if;
  if v = public.perm_all() then return v; end if;
  select o.allow, o.deny into v_allow, v_deny from public.channel_overwrites o join public.roles r on r.id = o.role_id
   where o.channel_id = p_channel and r.is_default;
  if found then v := (v & ~v_deny) | v_allow; v_send_allowed := v_allow & 2 <> 0; end if;
  select coalesce(bit_or(o.allow), 0), coalesce(bit_or(o.deny), 0) into v_allow, v_deny
    from public.channel_overwrites o join public.member_roles mr on mr.role_id = o.role_id
   where o.channel_id = p_channel and mr.community_id = v_comm and mr.user_id = p_user;
  v := (v & ~v_deny) | v_allow; v_send_allowed := v_send_allowed or v_allow & 2 <> 0;
  select timeout_until into v_timeout from public.community_members where community_id = v_comm and user_id = p_user;
  if v_timeout is not null and v_timeout > now() then v := v & ~(2|512|1024|2048|4096|32768)::bigint; end if;
  -- объявления: писать могут только с MANAGE_MESSAGES или явным разрешением в канале
  if v_kind = 'announcement' and v & 4 = 0 and not v_send_allowed then v := v & ~2::bigint; end if;
  if v & 1 = 0 then return 0; end if;
  return v;
end $$;

create or replace function public.has_community_perm(p_community uuid, p_perm bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (public._member_permissions(p_community, auth.uid()) & p_perm) = p_perm;
$$;

create or replace function public.has_channel_perm(p_channel uuid, p_perm bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and p_channel is not null and (public._channel_permissions(p_channel, auth.uid()) & p_perm) = p_perm;
$$;

create or replace function public.my_communities() returns setof uuid
language sql stable security definer set search_path = public as $$
  select community_id from public.community_members where user_id = auth.uid();
$$;

create or replace function public.my_visible_channels() returns setof uuid
language sql stable security definer set search_path = public as $$
  select c.id from public.channels c
   where c.community_id in (select community_id from public.community_members where user_id = auth.uid())
     and (public._channel_permissions(c.id, auth.uid()) & 1) = 1;
$$;

create or replace function public.my_permissions(p_community uuid) returns bigint
language sql stable security definer set search_path = public as $$
  select public._member_permissions(p_community, auth.uid());
$$;

create or replace function public.my_channel_permissions(p_community uuid)
returns table (channel_id uuid, permissions bigint)
language sql stable security definer set search_path = public as $$
  select c.id, public._channel_permissions(c.id, auth.uid()) from public.channels c where c.community_id = p_community;
$$;

create or replace function public.my_top_position(p_community uuid) returns int
language sql stable security definer set search_path = public as $$
  select public._member_top(p_community, auth.uid());
$$;

-- может ли текущий пользователь действовать на участника (кик/бан/таймаут/xp)
create or replace function public._can_act_on(p_community uuid, p_target uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() <> p_target
     and not exists (select 1 from public.communities where id = p_community and owner_id = p_target)
     and public._member_top(p_community, auth.uid()) > public._member_top(p_community, p_target);
$$;

create or replace function public._require(p_ok boolean, p_err text default 'forbidden') returns void
language plpgsql as $$ begin if not coalesce(p_ok, false) then raise exception '%', p_err; end if; end $$;

-- ─────────────────────────────── 3. Профили ───────────────────────────────
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_handle text := lower(coalesce(new.raw_user_meta_data ->> 'handle', ''));
        v_name text := btrim(coalesce(new.raw_user_meta_data ->> 'display_name', ''));
begin
  if v_handle !~ '^[a-z0-9_.]{3,32}$' or exists (select 1 from public.profiles where handle = v_handle) then
    v_handle := 'user_' || substr(replace(new.id::text, '-', ''), 1, 10);
  end if;
  if char_length(v_name) not between 1 and 40 then v_name := v_handle; end if;
  insert into public.profiles (id, handle, display_name) values (new.id, v_handle, v_name) on conflict (id) do nothing;
  insert into public.profile_private (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create or replace function public.update_profile(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public._uid(); v_handle text;
begin
  perform public._rate_limit('profile', 20, 60);
  if p ? 'handle' then
    v_handle := lower(btrim(p ->> 'handle'));
    if v_handle is distinct from (select handle from public.profiles where id = v_uid) then
      perform public._rate_limit('handle', 5, 86400);
      perform public._require(v_handle ~ '^[a-z0-9_.]{3,32}$', 'invalid_handle');
      perform public._require(not exists (select 1 from public.profiles where handle = v_handle and id <> v_uid), 'handle_taken');
      update public.profiles set handle = v_handle where id = v_uid;
    end if;
  end if;
  if p ? 'display_name' then update public.profiles set display_name = btrim(p ->> 'display_name') where id = v_uid; end if;
  if p ? 'avatar_path' then
    perform public._require(p ->> 'avatar_path' is null or (p ->> 'avatar_path') like 'avatars/' || v_uid::text || '/%', 'invalid_path');
    update public.profiles set avatar_path = p ->> 'avatar_path' where id = v_uid;
  end if;
end $$;

-- карточка профиля с учётом приватности: everyone / members (есть общее сообщество) / nobody
create or replace function public.get_profile_card(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := public._uid(); pr public.profiles; pp public.profile_private; v_shared boolean; r jsonb;
begin
  select * into pr from public.profiles where id = p_user;
  if not found then return null; end if;
  select * into pp from public.profile_private where user_id = p_user;
  v_shared := v_uid = p_user or exists (
    select 1 from public.community_members a join public.community_members b on a.community_id = b.community_id
     where a.user_id = v_uid and b.user_id = p_user);
  r := jsonb_build_object('id', pr.id, 'handle', pr.handle, 'display_name', pr.display_name, 'avatar_path', pr.avatar_path);
  if v_uid = p_user or pp.bio_visibility = 'everyone' or (pp.bio_visibility = 'members' and v_shared) then r := r || jsonb_build_object('bio', pp.bio); end if;
  if v_uid = p_user or pp.status_visibility = 'everyone' or (pp.status_visibility = 'members' and v_shared) then
    r := r || jsonb_build_object('status_text', pp.status_text,
      'presence', case when pp.presence = 'invisible' and v_uid <> p_user then 'offline' else pp.presence end);
  end if;
  if v_uid = p_user or pp.timezone_visibility = 'everyone' or (pp.timezone_visibility = 'members' and v_shared) then r := r || jsonb_build_object('timezone', pp.timezone); end if;
  if v_uid = p_user or pp.created_visibility = 'everyone' or (pp.created_visibility = 'members' and v_shared) then r := r || jsonb_build_object('created_at', pr.created_at); end if;
  return r;
end $$;

-- ─────────────────────────────── 4. Сообщества ───────────────────────────────
drop function if exists public.create_community(text, text);  -- сигнатура с шаблоном (p_template) — в 20261104
create or replace function public.create_community(p_name text, p_description text default '', p_template text default 'custom') returns uuid
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public._uid(); v_id uuid; v_cat_text uuid; v_cat_voice uuid;
begin
  perform public._rate_limit('create_community', 5, 3600);
  perform public._require((select count(*) from public.communities where owner_id = v_uid) < 50, 'limit_reached');
  insert into public.communities (name, description, owner_id) values (btrim(p_name), coalesce(p_description, ''), v_uid) returning id into v_id;
  insert into public.community_members (community_id, user_id) values (v_id, v_uid);
  insert into public.roles (community_id, name, color, position, permissions, is_default)
    values (v_id, 'Участники', '#9aa7b2', 0, public.perm_default(), true);
  insert into public.roles (community_id, name, color, position, permissions)
    values (v_id, 'Модераторы', '#5bb8e3', 1, public.perm_default() | 4 | 64 | 128 | 8192);
  insert into public.channel_categories (community_id, name, position) values (v_id, 'Текстовые', 0) returning id into v_cat_text;
  insert into public.channel_categories (community_id, name, position) values (v_id, 'Голосовые', 1) returning id into v_cat_voice;
  insert into public.channels (community_id, category_id, name, kind, position, topic) values
    (v_id, v_cat_text, 'объявления', 'announcement', 0, 'Важные новости сообщества'),
    (v_id, v_cat_text, 'общий', 'text', 1, ''),
    (v_id, v_cat_voice, 'Общая комната', 'voice', 0, '');
  insert into public.community_bots (community_id, bot_key, enabled) values (v_id, 'examples', true);
  perform public._audit(v_id, 'community.create', 'community', v_id::text, jsonb_build_object('name', p_name));
  return v_id;
end $$;

create or replace function public.update_community(p_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._uid();
  perform public._require(public.has_community_perm(p_id, 16384));
  if p ? 'icon_path' then
    perform public._require(p ->> 'icon_path' is null or (p ->> 'icon_path') like 'communities/' || p_id::text || '/%', 'invalid_path');
  end if;
  update public.communities set
    name         = coalesce(btrim(p ->> 'name'), name),
    description  = coalesce(p ->> 'description', description),
    rules        = coalesce(p ->> 'rules', rules),
    icon_path    = case when p ? 'icon_path' then p ->> 'icon_path' else icon_path end,
    accent_color = coalesce(p ->> 'accent_color', accent_color),
    xp_enabled          = coalesce((p ->> 'xp_enabled')::boolean, xp_enabled),
    xp_per_message      = coalesce((p ->> 'xp_per_message')::int, xp_per_message),
    xp_cooldown_seconds = coalesce((p ->> 'xp_cooldown_seconds')::int, xp_cooldown_seconds),
    xp_daily_cap        = coalesce((p ->> 'xp_daily_cap')::int, xp_daily_cap),
    xp_min_length       = coalesce((p ->> 'xp_min_length')::int, xp_min_length),
    voice_mesh_limit    = coalesce((p ->> 'voice_mesh_limit')::int, voice_mesh_limit)
  where id = p_id;
  perform public._audit(p_id, 'community.update', 'community', p_id::text, p);
end $$;

create or replace function public.delete_community(p_id uuid, p_confirm_name text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._require(exists (select 1 from public.communities where id = p_id and owner_id = public._uid() and name = p_confirm_name));
  delete from public.communities where id = p_id;
end $$;

create or replace function public.set_bot_enabled(p_community uuid, p_bot_key text, p_enabled boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._require(public.has_community_perm(p_community, 16384));
  perform public._require(exists (select 1 from public.bot_modules where bot_key = p_bot_key), 'not_found');
  insert into public.community_bots (community_id, bot_key, enabled) values (p_community, p_bot_key, p_enabled)
  on conflict (community_id, bot_key) do update set enabled = excluded.enabled;
  perform public._audit(p_community, 'bot.toggle', 'bot', p_bot_key, jsonb_build_object('enabled', p_enabled));
end $$;

-- ─────────────────────────────── 5. Приглашения ───────────────────────────────
create or replace function public.create_invite(p_community uuid, p_expires_seconds int default 604800, p_max_uses int default null) returns text
language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  perform public._uid();
  perform public._require(public.has_community_perm(p_community, 8));
  perform public._rate_limit('invite', 20, 3600);
  perform public._require(p_expires_seconds is null or p_expires_seconds between 1800 and 2592000, 'invalid_expiry');
  perform public._require(p_max_uses is null or p_max_uses between 1 and 1000, 'invalid_max_uses');
  perform public._require((select count(*) from public.invites where community_id = p_community and revoked_at is null
                           and (expires_at is null or expires_at > now())) < 100, 'limit_reached');
  v_code := substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
  insert into public.invites (code, community_id, created_by, expires_at, max_uses)
  values (v_code, p_community, auth.uid(), case when p_expires_seconds is null then null else now() + make_interval(secs => p_expires_seconds) end, p_max_uses);
  perform public._audit(p_community, 'invite.create', 'invite', v_code, jsonb_build_object('expires_seconds', p_expires_seconds, 'max_uses', p_max_uses));
  return v_code;
end $$;

create or replace function public.revoke_invite(p_code text) returns void
language plpgsql security definer set search_path = public as $$
declare v public.invites;
begin
  select * into v from public.invites where code = p_code;
  perform public._require(found, 'not_found');
  perform public._require(v.created_by = public._uid() or public.has_community_perm(v.community_id, 16384) or public.has_community_perm(v.community_id, 128));
  update public.invites set revoked_at = now() where code = p_code and revoked_at is null;
  perform public._audit(v.community_id, 'invite.revoke', 'invite', p_code);
end $$;

create or replace function public.preview_invite(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v public.invites; c public.communities; v_reason text;
begin
  perform public._uid();
  perform public._rate_limit('invite_preview', 30, 60);
  select * into v from public.invites where code = p_code;
  if not found then return jsonb_build_object('valid', false, 'reason', 'not_found'); end if;
  select * into c from public.communities where id = v.community_id;
  v_reason := case when v.revoked_at is not null then 'revoked'
                   when v.expires_at is not null and v.expires_at <= now() then 'expired'
                   when v.max_uses is not null and v.uses >= v.max_uses then 'used_up'
                   when exists (select 1 from public.community_bans where community_id = c.id and user_id = auth.uid()) then 'banned' end;
  return jsonb_build_object('valid', v_reason is null, 'reason', v_reason, 'community_id', c.id, 'name', c.name,
    'description', c.description, 'icon_path', c.icon_path, 'accent_color', c.accent_color,
    'member_count', (select count(*) from public.community_members where community_id = c.id),
    'already_member', exists (select 1 from public.community_members where community_id = c.id and user_id = auth.uid()));
end $$;

create or replace function public.join_by_invite(p_code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public._uid(); v public.invites;
begin
  perform public._rate_limit('join', 10, 600);
  select * into v from public.invites where code = p_code for update;
  perform public._require(found, 'invite_not_found');
  if exists (select 1 from public.community_members where community_id = v.community_id and user_id = v_uid) then return v.community_id; end if;
  perform public._require(v.revoked_at is null, 'invite_revoked');
  perform public._require(v.expires_at is null or v.expires_at > now(), 'invite_expired');
  perform public._require(v.max_uses is null or v.uses < v.max_uses, 'invite_used_up');
  perform public._require(not exists (select 1 from public.community_bans where community_id = v.community_id and user_id = v_uid), 'banned');
  perform public._require((select count(*) from public.community_members where user_id = v_uid) < 200, 'limit_reached');
  insert into public.community_members (community_id, user_id) values (v.community_id, v_uid);
  update public.invites set uses = uses + 1 where code = p_code;
  perform public._audit(v.community_id, 'member.join', 'user', v_uid::text, jsonb_build_object('invite', p_code));
  return v.community_id;
end $$;

create or replace function public.leave_community(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public._uid();
begin
  perform public._require(not exists (select 1 from public.communities where id = p_id and owner_id = v_uid), 'owner_cannot_leave');
  delete from public.voice_states where community_id = p_id and user_id = v_uid;
  delete from public.community_members where community_id = p_id and user_id = v_uid;
end $$;

-- ─────────────────────────────── 6. Категории и каналы ───────────────────────────────
create or replace function public.create_category(p_community uuid, p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform public._require(public.has_community_perm(p_community, 16));
  perform public._require((select count(*) from public.channel_categories where community_id = p_community) < 50, 'limit_reached');
  insert into public.channel_categories (community_id, name, position)
  values (p_community, btrim(p_name), coalesce((select max(position) + 1 from public.channel_categories where community_id = p_community), 0))
  returning id into v_id;
  perform public._audit(p_community, 'category.create', 'category', v_id::text, jsonb_build_object('name', p_name));
  return v_id;
end $$;

create or replace function public.update_category(p_id uuid, p_name text) returns void
language plpgsql security definer set search_path = public as $$
declare v_comm uuid;
begin
  select community_id into v_comm from public.channel_categories where id = p_id;
  perform public._require(public.has_community_perm(v_comm, 16));
  update public.channel_categories set name = btrim(p_name) where id = p_id;
  perform public._audit(v_comm, 'category.update', 'category', p_id::text, jsonb_build_object('name', p_name));
end $$;

create or replace function public.delete_category(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_comm uuid;
begin
  select community_id into v_comm from public.channel_categories where id = p_id;
  perform public._require(public.has_community_perm(v_comm, 16));
  delete from public.channel_categories where id = p_id;
  perform public._audit(v_comm, 'category.delete', 'category', p_id::text);
end $$;

create or replace function public.create_channel(p_community uuid, p_name text, p_kind text, p_category uuid default null, p_topic text default '') returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform public._require(public.has_community_perm(p_community, 16));
  perform public._require(p_category is null or exists (select 1 from public.channel_categories where id = p_category and community_id = p_community), 'invalid_category');
  perform public._require((select count(*) from public.channels where community_id = p_community) < 200, 'limit_reached');
  insert into public.channels (community_id, category_id, name, kind, topic, position)
  values (p_community, p_category, btrim(p_name), p_kind, coalesce(p_topic, ''),
          coalesce((select max(position) + 1 from public.channels where community_id = p_community and category_id is not distinct from p_category), 0))
  returning id into v_id;
  perform public._audit(p_community, 'channel.create', 'channel', v_id::text, jsonb_build_object('name', p_name, 'kind', p_kind));
  return v_id;
end $$;

create or replace function public.update_channel(p_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_comm uuid;
begin
  select community_id into v_comm from public.channels where id = p_id;
  perform public._require(public.has_community_perm(v_comm, 16));
  if p ? 'category_id' and p ->> 'category_id' is not null then
    perform public._require(exists (select 1 from public.channel_categories where id = (p ->> 'category_id')::uuid and community_id = v_comm), 'invalid_category');
  end if;
  update public.channels set
    name = coalesce(btrim(p ->> 'name'), name),
    topic = coalesce(p ->> 'topic', topic),
    slowmode_seconds = coalesce((p ->> 'slowmode_seconds')::int, slowmode_seconds),
    category_id = case when p ? 'category_id' then (p ->> 'category_id')::uuid else category_id end,
    position = coalesce((p ->> 'position')::int, position)
  where id = p_id;
  perform public._audit(v_comm, 'channel.update', 'channel', p_id::text, p);
end $$;

create or replace function public.delete_channel(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_comm uuid; v_name text;
begin
  select community_id, name into v_comm, v_name from public.channels where id = p_id;
  perform public._require(public.has_community_perm(v_comm, 16));
  delete from public.channels where id = p_id;
  perform public._audit(v_comm, 'channel.delete', 'channel', p_id::text, jsonb_build_object('name', v_name));
end $$;

-- p_items: [{"type":"channel"|"category","id":"…","position":0,"category_id":"…"|null}]
create or replace function public.reorder_layout(p_community uuid, p_items jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare it jsonb;
begin
  perform public._require(public.has_community_perm(p_community, 16));
  perform public._require(jsonb_array_length(p_items) <= 250, 'too_many');
  for it in select * from jsonb_array_elements(p_items) loop
    if it ->> 'type' = 'category' then
      update public.channel_categories set position = (it ->> 'position')::int where id = (it ->> 'id')::uuid and community_id = p_community;
    else
      if it ->> 'category_id' is not null then
        perform public._require(exists (select 1 from public.channel_categories where id = (it ->> 'category_id')::uuid and community_id = p_community), 'invalid_category');
      end if;
      update public.channels set position = (it ->> 'position')::int, category_id = (it ->> 'category_id')::uuid
       where id = (it ->> 'id')::uuid and community_id = p_community;
    end if;
  end loop;
  perform public._audit(p_community, 'layout.reorder', 'community', p_community::text);
end $$;

create or replace function public.set_channel_overwrite(p_channel uuid, p_role uuid, p_allow bigint, p_deny bigint) returns void
language plpgsql security definer set search_path = public as $$
declare v_comm uuid; v_mine bigint; v_role public.roles;
begin
  select community_id into v_comm from public.channels where id = p_channel;
  perform public._require(public.has_community_perm(v_comm, 16 | 32));
  select * into v_role from public.roles where id = p_role and community_id = v_comm;
  perform public._require(found, 'not_found');
  perform public._require(v_role.is_default or v_role.position < public._member_top(v_comm, auth.uid()), 'hierarchy');
  v_mine := public._member_permissions(v_comm, auth.uid());
  perform public._require(((p_allow | p_deny) & ~v_mine) = 0, 'cannot_grant_missing_permission');
  if coalesce(p_allow, 0) = 0 and coalesce(p_deny, 0) = 0 then
    delete from public.channel_overwrites where channel_id = p_channel and role_id = p_role;
  else
    insert into public.channel_overwrites (channel_id, role_id, allow, deny) values (p_channel, p_role, p_allow, p_deny & ~p_allow)
    on conflict (channel_id, role_id) do update set allow = excluded.allow, deny = excluded.deny;
  end if;
  perform public._audit(v_comm, 'channel.overwrite', 'channel', p_channel::text, jsonb_build_object('role', p_role, 'allow', p_allow, 'deny', p_deny));
end $$;

-- ─────────────────────────────── 7. Роли ───────────────────────────────
create or replace function public.create_role(p_community uuid, p_name text, p_color text, p_permissions bigint) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_top int; v_pos int;
begin
  perform public._require(public.has_community_perm(p_community, 32));
  perform public._require((p_permissions & ~public._member_permissions(p_community, auth.uid())) = 0, 'cannot_grant_missing_permission');
  perform public._require((select count(*) from public.roles where community_id = p_community) < 100, 'limit_reached');
  v_top := public._member_top(p_community, auth.uid());
  select coalesce(max(position), 0) + 1 into v_pos from public.roles where community_id = p_community and position < v_top;
  v_pos := least(v_pos, v_top - 1, 1000);
  perform public._require(v_pos >= 1, 'hierarchy');
  insert into public.roles (community_id, name, color, position, permissions) values (p_community, btrim(p_name), p_color, v_pos, p_permissions)
  returning id into v_id;
  perform public._audit(p_community, 'role.create', 'role', v_id::text, jsonb_build_object('name', p_name, 'permissions', p_permissions));
  return v_id;
end $$;

create or replace function public.update_role(p_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare r public.roles; v_top int; v_perm bigint; v_pos int;
begin
  select * into r from public.roles where id = p_id;
  perform public._require(found, 'not_found');
  perform public._require(public.has_community_perm(r.community_id, 32));
  v_top := public._member_top(r.community_id, auth.uid());
  perform public._require(r.is_default or r.position < v_top, 'hierarchy');
  v_perm := coalesce((p ->> 'permissions')::bigint, r.permissions);
  -- можно менять только биты, которые есть у самого редактора
  perform public._require(((v_perm # r.permissions) & ~public._member_permissions(r.community_id, auth.uid())) = 0, 'cannot_grant_missing_permission');
  perform public._require(not (r.is_default and v_perm & 256 <> 0), 'default_role_cannot_be_admin');
  v_pos := case when r.is_default then 0 else coalesce((p ->> 'position')::int, r.position) end;
  perform public._require(r.is_default or (v_pos >= 1 and v_pos < v_top), 'hierarchy');
  update public.roles set name = coalesce(btrim(p ->> 'name'), name), color = coalesce(p ->> 'color', color),
    permissions = v_perm, position = v_pos where id = p_id;
  perform public._audit(r.community_id, 'role.update', 'role', p_id::text, p);
end $$;

create or replace function public.delete_role(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r public.roles;
begin
  select * into r from public.roles where id = p_id;
  perform public._require(found, 'not_found');
  perform public._require(public.has_community_perm(r.community_id, 32));
  perform public._require(not r.is_default, 'cannot_delete_default_role');
  perform public._require(r.position < public._member_top(r.community_id, auth.uid()), 'hierarchy');
  delete from public.roles where id = p_id;
  perform public._audit(r.community_id, 'role.delete', 'role', p_id::text, jsonb_build_object('name', r.name));
end $$;

create or replace function public.set_member_role(p_community uuid, p_user uuid, p_role uuid, p_assign boolean) returns void
language plpgsql security definer set search_path = public as $$
declare r public.roles;
begin
  perform public._require(public.has_community_perm(p_community, 32));
  select * into r from public.roles where id = p_role and community_id = p_community;
  perform public._require(found and not r.is_default, 'not_found');
  perform public._require(r.position < public._member_top(p_community, auth.uid()), 'hierarchy');
  perform public._require((r.permissions & ~public._member_permissions(p_community, auth.uid())) = 0, 'cannot_grant_missing_permission');
  perform public._require(p_user = auth.uid() or public._member_top(p_community, p_user) < public._member_top(p_community, auth.uid()), 'hierarchy');
  perform public._require(exists (select 1 from public.community_members where community_id = p_community and user_id = p_user), 'not_member');
  if p_assign then
    insert into public.member_roles (community_id, user_id, role_id) values (p_community, p_user, p_role) on conflict do nothing;
  else
    delete from public.member_roles where community_id = p_community and user_id = p_user and role_id = p_role;
  end if;
  perform public._audit(p_community, case when p_assign then 'role.assign' else 'role.remove' end, 'user', p_user::text, jsonb_build_object('role', r.name));
end $$;

-- ─────────────────────────────── 8. Метки участников ───────────────────────────────
create or replace function public.upsert_tag(p_community uuid, p_id uuid, p_name text, p_color text, p_description text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := p_id;
begin
  perform public._require(public.has_community_perm(p_community, 8192));
  if v_id is null then
    perform public._require((select count(*) from public.member_tags where community_id = p_community) < 50, 'limit_reached');
    insert into public.member_tags (community_id, name, color, description) values (p_community, btrim(p_name), p_color, coalesce(p_description, '')) returning id into v_id;
  else
    update public.member_tags set name = btrim(p_name), color = p_color, description = coalesce(p_description, '') where id = v_id and community_id = p_community;
    perform public._require(found, 'not_found');
  end if;
  perform public._audit(p_community, 'tag.upsert', 'tag', v_id::text, jsonb_build_object('name', p_name));
  return v_id;
end $$;

create or replace function public.delete_tag(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_comm uuid;
begin
  select community_id into v_comm from public.member_tags where id = p_id;
  perform public._require(public.has_community_perm(v_comm, 8192));
  delete from public.member_tags where id = p_id;
  perform public._audit(v_comm, 'tag.delete', 'tag', p_id::text);
end $$;

create or replace function public.set_member_tag(p_user uuid, p_tag uuid, p_assign boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_comm uuid;
begin
  select community_id into v_comm from public.member_tags where id = p_tag;
  perform public._require(public.has_community_perm(v_comm, 8192));
  perform public._require(exists (select 1 from public.community_members where community_id = v_comm and user_id = p_user), 'not_member');
  if p_assign then
    insert into public.member_tag_assignments (community_id, user_id, tag_id, assigned_by) values (v_comm, p_user, p_tag, auth.uid()) on conflict do nothing;
  else
    delete from public.member_tag_assignments where user_id = p_user and tag_id = p_tag;
  end if;
  perform public._audit(v_comm, case when p_assign then 'tag.assign' else 'tag.remove' end, 'user', p_user::text, jsonb_build_object('tag', p_tag));
end $$;

-- ─────────────────────────────── 9. Модерация ───────────────────────────────
create or replace function public.kick_member(p_community uuid, p_user uuid, p_reason text default '') returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._require(public.has_community_perm(p_community, 64));
  perform public._require(public._can_act_on(p_community, p_user), 'hierarchy');
  delete from public.voice_states where community_id = p_community and user_id = p_user;
  delete from public.community_members where community_id = p_community and user_id = p_user;
  perform public._audit(p_community, 'member.kick', 'user', p_user::text, jsonb_build_object('reason', p_reason));
end $$;

create or replace function public.ban_member(p_community uuid, p_user uuid, p_reason text default '') returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._require(public.has_community_perm(p_community, 128));
  perform public._require(public._can_act_on(p_community, p_user), 'hierarchy');
  insert into public.community_bans (community_id, user_id, reason, banned_by) values (p_community, p_user, left(coalesce(p_reason, ''), 300), auth.uid())
  on conflict (community_id, user_id) do update set reason = excluded.reason, banned_by = excluded.banned_by, created_at = now();
  delete from public.voice_states where community_id = p_community and user_id = p_user;
  delete from public.community_members where community_id = p_community and user_id = p_user;
  perform public._audit(p_community, 'member.ban', 'user', p_user::text, jsonb_build_object('reason', p_reason));
end $$;

create or replace function public.unban_member(p_community uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._require(public.has_community_perm(p_community, 128));
  delete from public.community_bans where community_id = p_community and user_id = p_user;
  perform public._audit(p_community, 'member.unban', 'user', p_user::text);
end $$;

create or replace function public.timeout_member(p_community uuid, p_user uuid, p_seconds int, p_reason text default '') returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._require(public.has_community_perm(p_community, 64));
  perform public._require(public._can_act_on(p_community, p_user), 'hierarchy');
  perform public._require(p_seconds between 0 and 2419200, 'invalid_duration');
  update public.community_members set timeout_until = case when p_seconds = 0 then null else now() + make_interval(secs => p_seconds) end
   where community_id = p_community and user_id = p_user;
  delete from public.voice_states where community_id = p_community and user_id = p_user and p_seconds > 0;
  perform public._audit(p_community, 'member.timeout', 'user', p_user::text, jsonb_build_object('seconds', p_seconds, 'reason', p_reason));
end $$;

create or replace function public.set_nickname(p_community uuid, p_user uuid, p_nickname text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._require(p_user = public._uid() or (public.has_community_perm(p_community, 64) and public._can_act_on(p_community, p_user)));
  update public.community_members set nickname = nullif(btrim(coalesce(p_nickname, '')), '') where community_id = p_community and user_id = p_user;
end $$;

create or replace function public.transfer_ownership(p_community uuid, p_new_owner uuid, p_confirm_name text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._require(exists (select 1 from public.communities where id = p_community and owner_id = public._uid()), 'forbidden');
  perform public._require(exists (select 1 from public.communities where id = p_community and name = p_confirm_name), 'confirm_mismatch');
  perform public._require(p_new_owner <> auth.uid(), 'invalid_target');
  perform public._require(exists (select 1 from public.community_members where community_id = p_community and user_id = p_new_owner), 'not_member');
  update public.community_members set timeout_until = null where community_id = p_community and user_id = p_new_owner;
  update public.communities set owner_id = p_new_owner where id = p_community;
  perform public._audit(p_community, 'community.transfer', 'user', p_new_owner::text);
end $$;

-- ─────────────────────────────── 10. Ранги (опыт) ───────────────────────────────
-- уровень L достигается при xp >= 25*L*(L+1): 50, 150, 300, 500, …  (то же в src/lib/xp.ts)
create or replace function public.xp_level(p_xp int) returns int language plpgsql immutable as $$
declare l int := floor((sqrt(1 + 4.0 * greatest(p_xp, 0) / 25) - 1) / 2);
begin
  while 25 * (l + 1) * (l + 2) <= p_xp loop l := l + 1; end loop;
  while l > 0 and 25 * l * (l + 1) > p_xp loop l := l - 1; end loop;
  return l;
end $$;

create or replace function public._award_message_xp(p_community uuid, p_user uuid, p_message bigint, p_content text) returns int
language plpgsql security definer set search_path = public as $$
declare c public.communities; m public.community_members; v_today int; v_amount int; v_prev text;
begin
  select * into c from public.communities where id = p_community;
  if not c.xp_enabled or char_length(btrim(p_content)) < c.xp_min_length then return 0; end if;
  select * into m from public.community_members where community_id = p_community and user_id = p_user for update;
  if not found then return 0; end if;
  if m.last_xp_at is not null and m.last_xp_at > now() - make_interval(secs => c.xp_cooldown_seconds) then return 0; end if;
  -- одинаковые сообщения подряд не награждаются
  select content into v_prev from public.messages where community_id = p_community and author_id = p_user and id < p_message and kind = 'user'
   order by id desc limit 1;
  if v_prev is not null and lower(btrim(v_prev)) = lower(btrim(p_content)) then return 0; end if;
  select coalesce(sum(amount), 0) into v_today from public.xp_events
   where community_id = p_community and user_id = p_user and source = 'message' and created_at >= date_trunc('day', now());
  v_amount := least(c.xp_per_message, c.xp_daily_cap - v_today);
  if v_amount <= 0 then return 0; end if;
  insert into public.xp_events (community_id, user_id, amount, source, source_id) values (p_community, p_user, v_amount, 'message', p_message::text)
  on conflict do nothing;
  if not found then return 0; end if;
  update public.community_members set xp = xp + v_amount, last_xp_at = now() where community_id = p_community and user_id = p_user;
  return v_amount;
end $$;

create or replace function public.adjust_xp(p_community uuid, p_user uuid, p_delta int, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._require(public.has_community_perm(p_community, 128));
  perform public._require(public._can_act_on(p_community, p_user), 'hierarchy');
  perform public._require(p_delta between -100000 and 100000 and p_delta <> 0, 'invalid_amount');
  perform public._require(char_length(btrim(coalesce(p_reason, ''))) between 3 and 200, 'reason_required');
  update public.community_members set xp = greatest(0, xp + p_delta) where community_id = p_community and user_id = p_user;
  perform public._require(found, 'not_member');
  insert into public.xp_events (community_id, user_id, amount, source, reason, actor_id) values (p_community, p_user, p_delta, 'manual', p_reason, auth.uid());
  perform public._audit(p_community, 'xp.adjust', 'user', p_user::text, jsonb_build_object('delta', p_delta, 'reason', p_reason));
end $$;

create or replace function public.get_leaderboard(p_community uuid, p_limit int default 50)
returns table (user_id uuid, xp int, level int, place bigint)
language sql stable security definer set search_path = public as $$
  select m.user_id, m.xp, public.xp_level(m.xp), rank() over (order by m.xp desc)
    from public.community_members m
   where m.community_id = p_community and p_community in (select public.my_communities())
   order by m.xp desc, m.joined_at limit least(greatest(p_limit, 1), 100);
$$;

-- ─────────────────────────────── 11. Команды ботов (только фиксированные ветки, без eval) ───────────────────────────────
create or replace function public._command_module(p_cmd text) returns text language sql immutable as $$
  select case p_cmd when 'help' then 'examples' when 'rank' then 'examples' when 'top' then 'examples'
                    when 'roll' then 'examples' when 'coin' then 'examples' end;
$$;

create or replace function public._run_command(p_community uuid, p_channel uuid, p_user uuid, p_msg bigint, p_text text) returns void
language plpgsql security definer set search_path = public as $$
declare v_cmd text; v_args text; v_module text; v_reply text; v_err text; n int; s int; i int; v_rolls int[] := '{}'; m record;
begin
  v_cmd := lower(split_part(substr(btrim(p_text), 2), ' ', 1));
  v_args := btrim(substr(btrim(p_text), 2 + char_length(v_cmd)));
  v_module := public._command_module(v_cmd);
  if v_module is null then
    v_err := 'unknown_command'; v_reply := 'Неизвестная команда «/' || left(v_cmd, 32) || '». Список команд: /help';
  elsif not exists (select 1 from public.community_bots where community_id = p_community and bot_key = v_module and enabled) then
    v_err := 'module_disabled'; v_reply := 'Модуль «' || v_module || '» выключен в этом сообществе.';
  elsif not public.has_channel_perm(p_channel, 32768) then
    v_err := 'forbidden'; v_reply := 'У вас нет права использовать команды в этом канале.';
  else
    case v_cmd
      when 'help' then
        v_reply := E'Команды модуля «Помощник (пример)»:\n/rank — ваш уровень и опыт\n/top — пятёрка лидеров\n/roll [NdM] — бросок кубиков, напр. /roll 2d6\n/coin — орёл или решка';
      when 'rank' then
        select x.xp, x.level, x.place into m from public.get_leaderboard(p_community, 100) x where x.user_id = p_user;
        if m is null then v_reply := 'Опыт пока не начислен.';
        else v_reply := format('Уровень %s · %s XP · место %s · до следующего уровня %s XP', m.level, m.xp, m.place,
                               25 * (m.level + 1) * (m.level + 2) - m.xp);
        end if;
      when 'top' then
        select string_agg(format('%s. @%s — ур. %s (%s XP)', x.place, p.handle, x.level, x.xp), E'\n' order by x.place) into v_reply
          from public.get_leaderboard(p_community, 5) x join public.profiles p on p.id = x.user_id;
      when 'roll' then
        if v_args = '' then n := 1; s := 6;
        elsif v_args ~ '^\d{1,2}d\d{1,4}$' then n := split_part(v_args, 'd', 1)::int; s := split_part(v_args, 'd', 2)::int;
        elsif v_args ~ '^\d{1,4}$' then n := 1; s := v_args::int;
        else n := 0; end if;
        if n not between 1 and 10 or s not between 2 and 1000 then
          v_err := 'bad_args'; v_reply := 'Формат: /roll, /roll 20 или /roll 2d6 (1–10 кубиков, 2–1000 граней).';
        else
          for i in 1..n loop v_rolls := v_rolls || (1 + floor(random() * s))::int; end loop;
          v_reply := format('🎲 %sd%s: %s = %s', n, s, array_to_string(v_rolls, ' + '), (select sum(x) from unnest(v_rolls) x));
        end if;
      when 'coin' then v_reply := case when random() < 0.5 then 'Орёл' else 'Решка' end;
    end case;
  end if;
  insert into public.messages (channel_id, community_id, author_id, kind, bot_key, content, reply_to_id)
  values (p_channel, p_community, null, 'bot', coalesce(v_module, 'system'), left(coalesce(v_reply, 'Пусто.'), 4000), p_msg);
  insert into public.bot_command_log (community_id, channel_id, user_id, command, ok, error)
  values (p_community, p_channel, p_user, left(v_cmd, 32), v_err is null, v_err);
end $$;

-- ─────────────────────────────── 12. Сообщения ───────────────────────────────
-- p_attachments: [{"path":"<community>/<channel>/<uid>/<file>","name":"file.png"}]; размер и тип берутся из storage.objects
create or replace function public.send_message(p_channel uuid, p_content text, p_reply_to bigint default null, p_attachments jsonb default '[]'::jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public._uid(); ch public.channels; v_perms bigint; v_id bigint; v_text text := btrim(coalesce(p_content, ''));
        a jsonb; v_obj record; v_mentions uuid[]; v_last timestamptz; v_is_cmd boolean;
begin
  select * into ch from public.channels where id = p_channel;
  perform public._require(found, 'not_found');
  perform public._require(ch.kind in ('text','announcement'), 'not_text_channel');
  v_perms := public._channel_permissions(p_channel, v_uid);
  perform public._require(v_perms & 3 = 3, 'forbidden');
  p_attachments := coalesce(p_attachments, '[]'::jsonb);
  perform public._require(jsonb_typeof(p_attachments) = 'array' and jsonb_array_length(p_attachments) <= 5, 'too_many_attachments');
  perform public._require(jsonb_array_length(p_attachments) = 0 or v_perms & 2048 <> 0, 'forbidden_attachments');
  perform public._require(v_text <> '' or jsonb_array_length(p_attachments) > 0, 'empty');
  perform public._require(char_length(v_text) <= 4000, 'too_long');
  perform public._rate_limit('msg', 5, 5);
  perform public._rate_limit('msg_min', 60, 60);
  if ch.slowmode_seconds > 0 and v_perms & 4 = 0 then
    select max(created_at) into v_last from public.messages where channel_id = p_channel and author_id = v_uid;
    if v_last is not null and v_last > now() - make_interval(secs => ch.slowmode_seconds) then
      raise exception 'slowmode:%', ceil(extract(epoch from v_last + make_interval(secs => ch.slowmode_seconds) - now()))::int;
    end if;
  end if;
  perform public._require(p_reply_to is null or exists (select 1 from public.messages where id = p_reply_to and channel_id = p_channel), 'invalid_reply');
  v_is_cmd := left(v_text, 1) = '/' and v_text ~ '^/[a-zA-Z]' and jsonb_array_length(p_attachments) = 0;
  if v_is_cmd then perform public._rate_limit('cmd', 10, 60); end if;

  select coalesce(array_agg(distinct p.id), '{}') into v_mentions from (
    select (regexp_matches(lower(v_text), '@([a-z0-9_.]{3,32})', 'g'))[1] h limit 20) t
    join public.profiles p on p.handle = t.h
    join public.community_members cm on cm.user_id = p.id and cm.community_id = ch.community_id;

  insert into public.messages (channel_id, community_id, author_id, content, reply_to_id, mentions)
  values (p_channel, ch.community_id, v_uid, v_text, p_reply_to, v_mentions) returning id into v_id;

  for a in select * from jsonb_array_elements(p_attachments) loop
    perform public._require((a ->> 'path') like ch.community_id::text || '/' || p_channel::text || '/' || v_uid::text || '/%', 'invalid_attachment_path');
    select o.name, coalesce((o.metadata ->> 'size')::bigint, 0) size, coalesce(o.metadata ->> 'mimetype', 'application/octet-stream') mime
      into v_obj from storage.objects o where o.bucket_id = 'attachments' and o.name = a ->> 'path';
    perform public._require(v_obj is not null and v_obj.name is not null, 'attachment_not_uploaded');
    perform public._require(v_obj.size <= 10485760, 'attachment_too_large');
    insert into public.message_attachments (message_id, channel_id, storage_path, file_name, mime_type, size_bytes)
    values (v_id, p_channel, a ->> 'path', left(coalesce(nullif(a ->> 'name', ''), 'file'), 200), v_obj.mime, v_obj.size);
  end loop;

  if v_is_cmd then
    perform public._run_command(ch.community_id, p_channel, v_uid, v_id, v_text);
  else
    perform public._award_message_xp(ch.community_id, v_uid, v_id, v_text);
  end if;
  insert into public.channel_read_states (user_id, channel_id, last_read_id) values (v_uid, p_channel, v_id)
  on conflict (user_id, channel_id) do update set last_read_id = greatest(channel_read_states.last_read_id, excluded.last_read_id), updated_at = now();
  return v_id;
end $$;

create or replace function public.edit_message(p_id bigint, p_content text) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public._uid(); m public.messages; v_text text := btrim(coalesce(p_content, ''));
begin
  select * into m from public.messages where id = p_id;
  perform public._require(found and m.author_id = v_uid and m.kind = 'user' and m.deleted_at is null, 'forbidden');
  perform public._require(public.has_channel_perm(m.channel_id, 3));
  perform public._require(v_text <> '' and char_length(v_text) <= 4000, 'invalid_content');
  perform public._rate_limit('edit', 10, 10);
  update public.messages set content = v_text, edited_at = now() where id = p_id;
end $$;

-- возвращает пути вложений: клиент удаляет файлы из Storage (политика разрешает автору и модераторам)
create or replace function public.delete_message(p_id bigint) returns text[]
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public._uid(); m public.messages; v_paths text[];
begin
  select * into m from public.messages where id = p_id;
  perform public._require(found and m.deleted_at is null, 'not_found');
  perform public._require(m.author_id = v_uid or public.has_channel_perm(m.channel_id, 4), 'forbidden');
  select coalesce(array_agg(storage_path), '{}') into v_paths from public.message_attachments where message_id = p_id;
  delete from public.message_attachments where message_id = p_id;
  delete from public.message_reactions where message_id = p_id;
  update public.messages set content = '', deleted_at = now(), pinned_at = null, pinned_by = null, mentions = '{}' where id = p_id;
  if m.author_id is distinct from v_uid then
    perform public._audit(m.community_id, 'message.delete', 'message', p_id::text, jsonb_build_object('author', m.author_id, 'channel', m.channel_id));
  end if;
  return v_paths;
end $$;

create or replace function public.toggle_reaction(p_message bigint, p_emoji text) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public._uid(); m public.messages;
begin
  select * into m from public.messages where id = p_message;
  perform public._require(found and m.deleted_at is null, 'not_found');
  perform public._require(public.has_channel_perm(m.channel_id, 1 | 4096));
  perform public._require(char_length(p_emoji) between 1 and 32 and p_emoji !~ '\s', 'invalid_emoji');
  perform public._rate_limit('react', 20, 10);
  delete from public.message_reactions where message_id = p_message and user_id = v_uid and emoji = p_emoji;
  if found then return false; end if;
  perform public._require((select count(distinct emoji) from public.message_reactions where message_id = p_message) < 20
    or exists (select 1 from public.message_reactions where message_id = p_message and emoji = p_emoji), 'too_many_reactions');
  insert into public.message_reactions (message_id, channel_id, user_id, emoji) values (p_message, m.channel_id, v_uid, p_emoji);
  return true;
end $$;

create or replace function public.set_pinned(p_message bigint, p_pinned boolean) returns void
language plpgsql security definer set search_path = public as $$
declare m public.messages;
begin
  select * into m from public.messages where id = p_message;
  perform public._require(found and m.deleted_at is null, 'not_found');
  perform public._require(public.has_channel_perm(m.channel_id, 4));
  if p_pinned then
    perform public._require((select count(*) from public.messages where channel_id = m.channel_id and pinned_at is not null) < 50, 'limit_reached');
  end if;
  update public.messages set pinned_at = case when p_pinned then now() end, pinned_by = case when p_pinned then auth.uid() end where id = p_message;
  perform public._audit(m.community_id, case when p_pinned then 'message.pin' else 'message.unpin' end, 'message', p_message::text);
end $$;

create or replace function public.mark_read(p_channel uuid, p_message bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._require(public.has_channel_perm(p_channel, 1));
  insert into public.channel_read_states (user_id, channel_id, last_read_id) values (public._uid(), p_channel, p_message)
  on conflict (user_id, channel_id) do update set last_read_id = greatest(channel_read_states.last_read_id, excluded.last_read_id), updated_at = now();
end $$;

-- непрочитанное по всем доступным каналам (счётчик ограничен 100)
create or replace function public.unread_summary()
returns table (channel_id uuid, community_id uuid, unread int, mentions int)
language sql stable security definer set search_path = public as $$
  with vis as (
    select c.id, c.community_id, coalesce(rs.last_read_id, 0) last_read, cm.joined_at
      from public.channels c
      join public.community_members cm on cm.community_id = c.community_id and cm.user_id = auth.uid()
      left join public.channel_read_states rs on rs.channel_id = c.id and rs.user_id = auth.uid()
     where c.kind <> 'voice' and (public._channel_permissions(c.id, auth.uid()) & 1) = 1)
  select v.id, v.community_id,
    (select count(*) from (select 1 from public.messages m where m.channel_id = v.id and m.id > v.last_read
       and m.created_at > v.joined_at and m.author_id is distinct from auth.uid() and m.deleted_at is null limit 100) x)::int,
    (select count(*) from (select 1 from public.messages m where m.channel_id = v.id and m.id > v.last_read
       and m.created_at > v.joined_at and auth.uid() = any (m.mentions) and m.deleted_at is null limit 100) y)::int
  from vis v;
$$;

-- поиск по доступным сообщениям сообщества (префиксный, по словам)
create or replace function public.search_messages(p_community uuid, p_query text, p_limit int default 30)
returns setof public.messages
language plpgsql stable security definer set search_path = public as $$
declare v_q text;
begin
  perform public._uid();
  select string_agg(t || ':*', ' & ') into v_q from (
    select regexp_replace(w, '[&|!:()''"\\<>*@]', '', 'g') t
      from regexp_split_to_table(lower(left(coalesce(p_query, ''), 200)), '\s+') w) s
   where t <> '' ;
  if v_q is null then return; end if;
  return query
    select m.* from public.messages m
     where m.community_id = p_community and m.deleted_at is null
       and m.channel_id in (select public.my_visible_channels())
       and to_tsvector('simple', m.content) @@ to_tsquery('simple', v_q)
     order by m.id desc limit least(greatest(p_limit, 1), 100);
end $$;

-- ─────────────────────────────── 13. Голос (состояния; медиа идут по WebRTC) ───────────────────────────────
create or replace function public.voice_join(p_channel uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public._uid(); ch public.channels; v_limit int;
begin
  select * into ch from public.channels where id = p_channel;
  perform public._require(found and ch.kind = 'voice', 'not_voice_channel');
  perform public._require(public.has_channel_perm(p_channel, 1 | 512));
  perform public._rate_limit('voice_join', 10, 60);
  delete from public.voice_states where channel_id = p_channel and last_seen < now() - interval '45 seconds';
  delete from public.voice_states where user_id = v_uid and channel_id <> p_channel;
  select voice_mesh_limit into v_limit from public.communities where id = ch.community_id;
  perform public._require((select count(*) from public.voice_states where channel_id = p_channel and user_id <> v_uid) < v_limit, 'room_full');
  insert into public.voice_states (channel_id, user_id, community_id) values (p_channel, v_uid, ch.community_id)
  on conflict (channel_id, user_id) do update set last_seen = now(), video = false, screen = false;
end $$;

create or replace function public.voice_update(p_channel uuid, p_muted boolean, p_deafened boolean, p_video boolean, p_screen boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public._uid();
begin
  perform public._require(not (p_video or p_screen) or public.has_channel_perm(p_channel, 1024), 'forbidden_video');
  update public.voice_states set muted = p_muted, deafened = p_deafened, video = p_video, screen = p_screen, last_seen = now()
   where channel_id = p_channel and user_id = v_uid;
  perform public._require(found, 'not_in_room');
end $$;

create or replace function public.voice_heartbeat(p_channel uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update public.voice_states set last_seen = now() where channel_id = p_channel and user_id = public._uid()
     and public.has_channel_perm(p_channel, 512);
  return found;
end $$;

create or replace function public.voice_leave(p_channel uuid) returns void
language sql security definer set search_path = public as $$
  delete from public.voice_states where channel_id = p_channel and user_id = auth.uid();
$$;

create or replace function public.voice_disconnect(p_channel uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_comm uuid;
begin
  select community_id into v_comm from public.channels where id = p_channel;
  perform public._require(public.has_community_perm(v_comm, 64));
  perform public._require(public._can_act_on(v_comm, p_user), 'hierarchy');
  delete from public.voice_states where channel_id = p_channel and user_id = p_user;
  perform public._audit(v_comm, 'voice.disconnect', 'user', p_user::text);
end $$;

-- ─────────────────────────────── 14. RLS ───────────────────────────────
do $$ declare t text; begin
  foreach t in array array['profiles','profile_private','communities','community_members','community_bans','roles','member_roles',
    'member_tags','member_tag_assignments','channel_categories','channels','channel_overwrites','messages','message_attachments',
    'message_reactions','channel_read_states','channel_favorites','invites','audit_log','xp_events','rate_limits','bot_modules',
    'community_bots','bot_command_log','voice_states'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

drop policy if exists sel on public.profiles;                create policy sel on public.profiles for select to authenticated using (true);
drop policy if exists sel on public.profile_private;         create policy sel on public.profile_private for select to authenticated using (user_id = auth.uid());
drop policy if exists upd on public.profile_private;         create policy upd on public.profile_private for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists sel on public.communities;             create policy sel on public.communities for select to authenticated using (id in (select public.my_communities()));
drop policy if exists sel on public.community_members;       create policy sel on public.community_members for select to authenticated using (community_id in (select public.my_communities()));
drop policy if exists sel on public.community_bans;          create policy sel on public.community_bans for select to authenticated using (public.has_community_perm(community_id, 128));
drop policy if exists sel on public.roles;                   create policy sel on public.roles for select to authenticated using (community_id in (select public.my_communities()));
drop policy if exists sel on public.member_roles;            create policy sel on public.member_roles for select to authenticated using (community_id in (select public.my_communities()));
drop policy if exists sel on public.member_tags;             create policy sel on public.member_tags for select to authenticated using (community_id in (select public.my_communities()));
drop policy if exists sel on public.member_tag_assignments;  create policy sel on public.member_tag_assignments for select to authenticated using (community_id in (select public.my_communities()));
drop policy if exists sel on public.channel_categories;      create policy sel on public.channel_categories for select to authenticated using (community_id in (select public.my_communities()));
drop policy if exists sel on public.channels;                create policy sel on public.channels for select to authenticated using (id in (select public.my_visible_channels()));
drop policy if exists sel on public.channel_overwrites;      create policy sel on public.channel_overwrites for select to authenticated
  using (exists (select 1 from public.channels c where c.id = channel_id and (public.has_community_perm(c.community_id, 16) or public.has_community_perm(c.community_id, 32))));
drop policy if exists sel on public.messages;                create policy sel on public.messages for select to authenticated using (channel_id in (select public.my_visible_channels()));
drop policy if exists sel on public.message_attachments;     create policy sel on public.message_attachments for select to authenticated using (channel_id in (select public.my_visible_channels()));
drop policy if exists sel on public.message_reactions;       create policy sel on public.message_reactions for select to authenticated using (channel_id in (select public.my_visible_channels()));
drop policy if exists sel on public.channel_read_states;     create policy sel on public.channel_read_states for select to authenticated using (user_id = auth.uid());
drop policy if exists sel on public.channel_favorites;       create policy sel on public.channel_favorites for select to authenticated using (user_id = auth.uid());
drop policy if exists ins on public.channel_favorites;       create policy ins on public.channel_favorites for insert to authenticated
  with check (user_id = auth.uid() and channel_id in (select public.my_visible_channels()));
drop policy if exists del on public.channel_favorites;       create policy del on public.channel_favorites for delete to authenticated using (user_id = auth.uid());
drop policy if exists sel on public.invites;                 create policy sel on public.invites for select to authenticated
  using (created_by = auth.uid() or public.has_community_perm(community_id, 16384) or public.has_community_perm(community_id, 128));
drop policy if exists sel on public.audit_log;               create policy sel on public.audit_log for select to authenticated using (public.has_community_perm(community_id, 128));
drop policy if exists sel on public.xp_events;               create policy sel on public.xp_events for select to authenticated using (user_id = auth.uid() or public.has_community_perm(community_id, 128));
drop policy if exists sel on public.bot_modules;             create policy sel on public.bot_modules for select to authenticated using (true);
drop policy if exists sel on public.community_bots;          create policy sel on public.community_bots for select to authenticated using (community_id in (select public.my_communities()));
drop policy if exists sel on public.bot_command_log;         create policy sel on public.bot_command_log for select to authenticated using (public.has_community_perm(community_id, 128));
drop policy if exists sel on public.voice_states;            create policy sel on public.voice_states for select to authenticated using (channel_id in (select public.my_visible_channels()));

grant select on public.profiles, public.profile_private, public.communities, public.community_members, public.community_bans,
  public.roles, public.member_roles, public.member_tags, public.member_tag_assignments, public.channel_categories, public.channels,
  public.channel_overwrites, public.messages, public.message_attachments, public.message_reactions, public.channel_read_states,
  public.channel_favorites, public.invites, public.audit_log, public.xp_events, public.bot_modules, public.community_bots,
  public.bot_command_log, public.voice_states to authenticated;
grant update (bio, status_text, presence, timezone, bio_visibility, status_visibility, timezone_visibility, created_visibility, settings)
  on public.profile_private to authenticated;
grant insert (channel_id), delete on public.channel_favorites to authenticated;

-- ─────────────────────────────── 15. Storage ───────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('attachments', 'attachments', false, 10485760, array['image/png','image/jpeg','image/gif','image/webp','application/pdf','text/plain',
    'application/zip','audio/mpeg','audio/ogg','video/mp4','video/webm']),
  ('public-media', 'public-media', true, 2097152, array['image/png','image/jpeg','image/gif','image/webp'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- путь вложения: <community_id>/<channel_id>/<user_id>/<файл>
create or replace function public.attachment_upload_allowed(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select (storage.foldername(p_name))[3] = auth.uid()::text
     and exists (select 1 from public.channels c where c.id = public.try_uuid((storage.foldername(p_name))[2])
                  and c.community_id::text = (storage.foldername(p_name))[1])
     and public.has_channel_perm(public.try_uuid((storage.foldername(p_name))[2]), 1 | 2 | 2048);
$$;
grant execute on function public.attachment_upload_allowed(text) to authenticated;

drop policy if exists "attachments insert" on storage.objects;
create policy "attachments insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and public.attachment_upload_allowed(name));
drop policy if exists "attachments read" on storage.objects;
create policy "attachments read" on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and public.has_channel_perm(public.try_uuid((storage.foldername(name))[2]), 1));
drop policy if exists "attachments delete" on storage.objects;
create policy "attachments delete" on storage.objects for delete to authenticated
  using (bucket_id = 'attachments' and ((storage.foldername(name))[3] = auth.uid()::text
         or public.has_channel_perm(public.try_uuid((storage.foldername(name))[2]), 4)));

-- public-media: avatars/<uid>/… (только сам пользователь) и communities/<id>/… (MANAGE_COMMUNITY)
create or replace function public.public_media_write_allowed(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select case (storage.foldername(p_name))[1]
    when 'avatars' then (storage.foldername(p_name))[2] = auth.uid()::text
    when 'communities' then public.has_community_perm(public.try_uuid((storage.foldername(p_name))[2]), 16384)
    else false end;
$$;
grant execute on function public.public_media_write_allowed(text) to authenticated;

drop policy if exists "public media read" on storage.objects;
create policy "public media read" on storage.objects for select to authenticated using (bucket_id = 'public-media');
drop policy if exists "public media insert" on storage.objects;
create policy "public media insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'public-media' and public.public_media_write_allowed(name));
drop policy if exists "public media update" on storage.objects;
create policy "public media update" on storage.objects for update to authenticated
  using (bucket_id = 'public-media' and public.public_media_write_allowed(name));
drop policy if exists "public media delete" on storage.objects;
create policy "public media delete" on storage.objects for delete to authenticated
  using (bucket_id = 'public-media' and public.public_media_write_allowed(name));

-- ─────────────────────────────── 16. Realtime ───────────────────────────────
-- postgres_changes (учитывает RLS): сообщения, реакции, голосовые состояния, структура сообщества
do $$ declare t text; begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['messages','message_reactions','voice_states','channels','channel_categories','community_members','roles','member_roles'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
alter table public.voice_states replica identity full;
alter table public.message_reactions replica identity full;

-- приватные топики: voice:<channel_id> (сигнализация WebRTC), typing:<channel_id> (кто печатает), community:<id> (кто онлайн)
create or replace function public.realtime_topic_allowed(p_topic text, p_write boolean) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when p_topic like 'voice:%'  then public.has_channel_perm(public.try_uuid(substr(p_topic, 7)), 1 | 512)
    when p_topic like 'typing:%' then public.has_channel_perm(public.try_uuid(substr(p_topic, 8)), case when p_write then 3 else 1 end)
    when p_topic like 'community:%' then public.try_uuid(substr(p_topic, 11)) in (select public.my_communities())
    else false end;
$$;
grant execute on function public.realtime_topic_allowed(text, boolean) to authenticated;

do $$ begin
  if to_regclass('realtime.messages') is not null then
    execute 'drop policy if exists "rootapp topics read" on realtime.messages';  -- старое имя политики
    execute 'drop policy if exists "rootapp topics write" on realtime.messages';
    execute 'drop policy if exists "cowdeisreal topics read" on realtime.messages';
    execute $p$create policy "cowdeisreal topics read" on realtime.messages for select to authenticated
      using (extension in ('broadcast','presence') and public.realtime_topic_allowed(realtime.topic(), false))$p$;
    execute 'drop policy if exists "cowdeisreal topics write" on realtime.messages';
    execute $p$create policy "cowdeisreal topics write" on realtime.messages for insert to authenticated
      with check (extension in ('broadcast','presence') and public.realtime_topic_allowed(realtime.topic(), true))$p$;
  end if;
end $$;

-- ─────────────────────────────── 17. Права на функции (в самом конце, чтобы покрыть все) ───────────────────────────────
-- функции: всё закрыто, кроме публичного API для authenticated
do $$ declare f record; begin
  for f in select p.oid::regprocedure sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prokind = 'f' loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    if left(f.proname, 1) <> '_' and f.proname <> 'handle_new_user' then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
  end loop;
end $$;

