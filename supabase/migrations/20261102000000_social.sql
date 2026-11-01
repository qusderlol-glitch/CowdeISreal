-- CowdeISreal: друзья, заявки, блокировки, поиск по handle с подсказками при опечатке, лента знакомств (поиск друзей),
-- жалобы, личные сообщения между друзьями и оформление профиля, видимое другим.
-- Запуск: после 20261101000000_init.sql. SQL Editor -> вставить файл -> Run. Повторный запуск безопасен.
--
-- Принципы те же: чтение через RLS, запись только через функции; user_id = auth.uid().
--   * Дружба только по взаимному согласию: заявка -> «Принять». Встречные заявки (оба хотят) объединяются сразу.
--   * Заблокированный пользователь не найдёт вас в поиске, не пришлёт заявку и не напишет. Факт блокировки не раскрывается.
--   * Лента знакомств — только для тех, кто сам включил её у себя. Нет геолокации. Лимиты на свайпы и заявки.

set search_path = public, extensions;
create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists fuzzystrmatch with schema extensions;

-- ─────────────────────────────── 1. Оформление профиля (видно всем, кто видит профиль) ───────────────────────────────
alter table public.profiles
  add column if not exists banner_color   text not null default '#2f8a5f',
  add column if not exists banner_style   text not null default 'gradient',
  add column if not exists profile_accent text not null default '#2f8a5f',
  add column if not exists avatar_frame   text not null default 'none',
  add column if not exists name_font      text not null default 'default',
  add column if not exists profile_emoji  text not null default '',
  add column if not exists pronouns       text not null default '';
do $$ begin
  alter table public.profiles add constraint profiles_style_check check (
    banner_color ~ '^#[0-9a-fA-F]{6}$' and profile_accent ~ '^#[0-9a-fA-F]{6}$'
    and banner_style in ('solid','gradient','dots','waves','stripes','leaves','grid','sunset')
    and avatar_frame in ('none','ring','double','dashed','glow','leaf','square')
    and name_font in ('default','serif','mono','rounded','bold','italic')
    and char_length(profile_emoji) <= 8 and char_length(pronouns) <= 20);
exception when duplicate_object then null; end $$;

create index if not exists profiles_handle_trgm on public.profiles using gin (handle gin_trgm_ops);
create index if not exists profiles_name_trgm on public.profiles using gin (lower(display_name) gin_trgm_ops);

-- цвет новых сообществ под тему «Графит» (существующие не меняются)
alter table public.communities alter column accent_color set default '#22c55e';

-- ─────────────────────────────── 2. Социальные настройки (видны только владельцу) ───────────────────────────────
create or replace function public.profile_tags_ok(p text[]) returns boolean language sql immutable as $$
  select coalesce(bool_and(char_length(btrim(t)) between 1 and 24), true) from unnest(p) t;
$$;

create table if not exists public.profile_social (
  user_id       uuid primary key references public.profiles (id) on delete cascade,
  find_me       text not null default 'everyone' check (find_me in ('everyone','exact','nobody')),
  requests_from text not null default 'everyone' check (requests_from in ('everyone','mutual','nobody')),
  dm_from       text not null default 'friends' check (dm_from in ('friends','nobody')),
  discoverable  boolean not null default false,
  discovery_bio text not null default '' check (char_length(discovery_bio) <= 200),
  interests     text[] not null default '{}' check (cardinality(interests) <= 8 and public.profile_tags_ok(interests)),
  looking_for   text[] not null default '{}' check (looking_for <@ array['chat','games','study','music','creative','voice','sport','tech']),
  updated_at    timestamptz not null default now()
);
insert into public.profile_social (user_id) select id from public.profiles on conflict do nothing;

create or replace function public._profile_social_row() returns trigger
language plpgsql security definer set search_path = public as $$
begin insert into public.profile_social (user_id) values (new.id) on conflict do nothing; return new; end $$;
drop trigger if exists on_profile_created_social on public.profiles;
create trigger on_profile_created_social after insert on public.profiles for each row execute function public._profile_social_row();

-- ─────────────────────────────── 3. Друзья, заявки, блокировки, жалобы ───────────────────────────────
create table if not exists public.friend_requests (
  id           bigint generated always as identity primary key,
  from_id      uuid not null references public.profiles (id) on delete cascade,
  to_id        uuid not null references public.profiles (id) on delete cascade,
  status       text not null default 'pending' check (status in ('pending','accepted','declined','cancelled')),
  source       text not null default 'search' check (source in ('search','discovery','profile')),
  created_at   timestamptz not null default now(),
  responded_at timestamptz,
  check (from_id <> to_id)
);
create unique index if not exists friend_requests_one_pending
  on public.friend_requests (least(from_id, to_id), greatest(from_id, to_id)) where status = 'pending';
create index if not exists friend_requests_to_idx on public.friend_requests (to_id, status);
create index if not exists friend_requests_from_idx on public.friend_requests (from_id, status);

create table if not exists public.friendships (
  user_a     uuid not null references public.profiles (id) on delete cascade,
  user_b     uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_a, user_b),
  check (user_a < user_b)
);
create index if not exists friendships_b_idx on public.friendships (user_b);

create table if not exists public.user_blocks (
  blocker    uuid not null references public.profiles (id) on delete cascade,
  blocked    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked),
  check (blocker <> blocked)
);

create table if not exists public.discovery_swipes (
  swiper     uuid not null references public.profiles (id) on delete cascade,
  target     uuid not null references public.profiles (id) on delete cascade,
  liked      boolean not null,
  created_at timestamptz not null default now(),
  primary key (swiper, target)
);

-- жалобы читает владелец инстанса (Supabase -> Table Editor -> user_reports); участникам они не видны
create table if not exists public.user_reports (
  id         bigint generated always as identity primary key,
  reporter   uuid references public.profiles (id) on delete set null,
  target     uuid not null references public.profiles (id) on delete cascade,
  reason     text not null check (reason in ('spam','harassment','inappropriate','underage','impersonation','other')),
  details    text not null default '' check (char_length(details) <= 500),
  context    text not null default 'profile' check (context in ('profile','discovery','dm','search')),
  created_at timestamptz not null default now()
);

-- ─────────────────────────────── 4. Личные сообщения ───────────────────────────────
create table if not exists public.direct_threads (
  id              uuid primary key default gen_random_uuid(),
  user_a          uuid not null references public.profiles (id) on delete cascade,
  user_b          uuid not null references public.profiles (id) on delete cascade,
  created_at      timestamptz not null default now(),
  last_message_at timestamptz,
  unique (user_a, user_b),
  check (user_a < user_b)
);

create table if not exists public.direct_messages (
  id         bigint generated always as identity primary key,
  thread_id  uuid not null references public.direct_threads (id) on delete cascade,
  author_id  uuid references public.profiles (id) on delete set null,
  content    text not null check (char_length(content) <= 4000),
  created_at timestamptz not null default now(),
  edited_at  timestamptz,
  deleted_at timestamptz
);
create index if not exists direct_messages_thread_idx on public.direct_messages (thread_id, id desc);

create table if not exists public.dm_read_states (
  user_id      uuid not null references public.profiles (id) on delete cascade,
  thread_id    uuid not null references public.direct_threads (id) on delete cascade,
  last_read_id bigint not null default 0,
  primary key (user_id, thread_id)
);

-- ─────────────────────────────── 5. Служебные функции ───────────────────────────────
create or replace function public._is_blocked(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_blocks where (blocker = a and blocked = b) or (blocker = b and blocked = a));
$$;

create or replace function public._are_friends(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.friendships where user_a = least(a, b) and user_b = greatest(a, b));
$$;

create or replace function public._relation(me uuid, other uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when me = other then 'self'
    when public._are_friends(me, other) then 'friend'
    when exists (select 1 from public.friend_requests where from_id = me and to_id = other and status = 'pending') then 'outgoing'
    when exists (select 1 from public.friend_requests where from_id = other and to_id = me and status = 'pending') then 'incoming'
    else 'none' end;
$$;

create or replace function public._make_friends(a uuid, b uuid) returns void
language sql security definer set search_path = public as $$
  insert into public.friendships (user_a, user_b) values (least(a, b), greatest(a, b)) on conflict do nothing;
$$;

-- ─────────────────────────────── 6. Поиск людей с подсказками при опечатке ───────────────────────────────
-- find_me: everyone — находят по похожему handle/имени; exact — только по точному handle; nobody — никто (кроме друзей)
create or replace function public.search_users(p_query text)
returns table (id uuid, handle text, display_name text, avatar_path text, avatar_frame text, profile_emoji text,
               relation text, exact boolean, score real)
-- VOLATILE, не STABLE: функция пишет счётчик лимита запросов, а Supabase выполняет STABLE-функции только на чтение
language plpgsql volatile security definer set search_path = public, extensions as $$
declare v_uid uuid := public._uid(); q text := lower(btrim(regexp_replace(coalesce(p_query, ''), '^@+', '')));
begin
  if char_length(q) < 2 or char_length(q) > 40 then return; end if;
  perform public._rate_limit('user_search', 60, 60);
  return query
    select p.id, p.handle, p.display_name, p.avatar_path, p.avatar_frame, p.profile_emoji,
           public._relation(v_uid, p.id),
           p.handle = q,
           greatest(similarity(p.handle, q), similarity(lower(p.display_name), q) * 0.9,
                    case when p.handle like q || '%' then 0.9 else 0 end,
                    -- опечатки в коротких никах (перестановка/замена букв): расстояние Левенштейна
                    1 - levenshtein(left(p.handle, 64), left(q, 64))::real / greatest(char_length(p.handle), char_length(q)))::real as sc
      from public.profiles p
      left join public.profile_social s on s.user_id = p.id
     where p.id <> v_uid
       and not public._is_blocked(v_uid, p.id)
       and (p.handle = q or public._are_friends(v_uid, p.id) or coalesce(s.find_me, 'everyone') = 'everyone')
       and (coalesce(s.find_me, 'everyone') <> 'nobody' or public._are_friends(v_uid, p.id))
       and (p.handle = q or p.handle like q || '%' or similarity(p.handle, q) > 0.25 or similarity(lower(p.display_name), q) > 0.3
            or levenshtein(left(p.handle, 64), left(q, 64)) <= case when char_length(q) <= 4 then 2 when char_length(q) <= 10 then 2 else 3 end)
     order by (p.handle = q) desc, sc desc, p.handle
     limit 8;
end $$;

-- ─────────────────────────────── 7. Заявки в друзья ───────────────────────────────
create or replace function public.send_friend_request(p_user uuid, p_source text default 'search') returns text
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public._uid(); v_policy text; v_rev bigint;
begin
  perform public._require(p_user is not null and p_user <> v_uid, 'invalid_target');
  perform public._require(exists (select 1 from public.profiles where id = p_user), 'not_found');
  -- блокировка не раскрывается: для заблокированного пользователь будто не существует
  perform public._require(not public._is_blocked(v_uid, p_user), 'not_found');
  if public._are_friends(v_uid, p_user) then return 'already_friends'; end if;
  -- встречная заявка: оба хотят дружить -> объединяем
  select id into v_rev from public.friend_requests where from_id = p_user and to_id = v_uid and status = 'pending' for update;
  if found then
    update public.friend_requests set status = 'accepted', responded_at = now() where id = v_rev;
    perform public._make_friends(v_uid, p_user);
    return 'accepted';
  end if;
  if exists (select 1 from public.friend_requests where from_id = v_uid and to_id = p_user and status = 'pending') then return 'already_sent'; end if;
  select requests_from into v_policy from public.profile_social where user_id = p_user;
  perform public._require(coalesce(v_policy, 'everyone') <> 'nobody', 'requests_closed');
  if v_policy = 'mutual' then
    perform public._require(
      exists (select 1 from public.friendships f1 join public.friendships f2
                on (case when f1.user_a = v_uid then f1.user_b else f1.user_a end) = (case when f2.user_a = p_user then f2.user_b else f2.user_a end)
               where v_uid in (f1.user_a, f1.user_b) and p_user in (f2.user_a, f2.user_b))
      or exists (select 1 from public.community_members a join public.community_members b on a.community_id = b.community_id
                  where a.user_id = v_uid and b.user_id = p_user), 'requests_mutual_only');
  end if;
  -- после отказа — пауза 7 дней, чтобы заявками нельзя было донимать
  perform public._require(not exists (select 1 from public.friend_requests where from_id = v_uid and to_id = p_user
    and status = 'declined' and responded_at > now() - interval '7 days'), 'try_later');
  perform public._rate_limit('friend_request', 30, 3600);
  perform public._require((select count(*) from public.friend_requests where from_id = v_uid and status = 'pending') < 100, 'limit_reached');
  insert into public.friend_requests (from_id, to_id, source)
  values (v_uid, p_user, case when p_source in ('search','discovery','profile') then p_source else 'search' end);
  return 'sent';
end $$;

create or replace function public.respond_friend_request(p_id bigint, p_accept boolean) returns void
language plpgsql security definer set search_path = public as $$
declare r public.friend_requests;
begin
  select * into r from public.friend_requests where id = p_id and to_id = public._uid() and status = 'pending' for update;
  perform public._require(found, 'not_found');
  update public.friend_requests set status = case when p_accept then 'accepted' else 'declined' end, responded_at = now() where id = p_id;
  if p_accept then perform public._make_friends(r.from_id, r.to_id); end if;
end $$;

create or replace function public.cancel_friend_request(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.friend_requests set status = 'cancelled', responded_at = now() where id = p_id and from_id = public._uid() and status = 'pending';
  perform public._require(found, 'not_found');
end $$;

create or replace function public.remove_friend(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public._uid();
begin
  delete from public.friendships where user_a = least(v_uid, p_user) and user_b = greatest(v_uid, p_user);
end $$;

create or replace function public.block_user(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public._uid();
begin
  perform public._require(p_user <> v_uid, 'invalid_target');
  insert into public.user_blocks (blocker, blocked) values (v_uid, p_user) on conflict do nothing;
  delete from public.friendships where user_a = least(v_uid, p_user) and user_b = greatest(v_uid, p_user);
  update public.friend_requests set status = 'cancelled', responded_at = now()
   where status = 'pending' and ((from_id = v_uid and to_id = p_user) or (from_id = p_user and to_id = v_uid));
end $$;

create or replace function public.unblock_user(p_user uuid) returns void
language sql security definer set search_path = public as $$
  delete from public.user_blocks where blocker = auth.uid() and blocked = p_user;
$$;

create or replace function public.report_user(p_user uuid, p_reason text, p_details text default '', p_context text default 'profile') returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._require(p_user <> public._uid(), 'invalid_target');
  perform public._rate_limit('report', 10, 86400);
  insert into public.user_reports (reporter, target, reason, details, context) values (auth.uid(), p_user, p_reason, left(coalesce(p_details, ''), 500), p_context);
end $$;

create or replace function public.my_friends()
returns table (user_id uuid, handle text, display_name text, avatar_path text, avatar_frame text, profile_emoji text, since timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id, p.handle, p.display_name, p.avatar_path, p.avatar_frame, p.profile_emoji, f.created_at
    from public.friendships f
    join public.profiles p on p.id = case when f.user_a = auth.uid() then f.user_b else f.user_a end
   where auth.uid() in (f.user_a, f.user_b)
   order by lower(p.display_name);
$$;

create or replace function public.my_blocks()
returns table (user_id uuid, handle text, display_name text, avatar_path text, since timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id, p.handle, p.display_name, p.avatar_path, b.created_at
    from public.user_blocks b join public.profiles p on p.id = b.blocked where b.blocker = auth.uid() order by b.created_at desc;
$$;

-- ─────────────────────────────── 8. Лента знакомств (поиск друзей) ───────────────────────────────
create or replace function public.discovery_deck(p_limit int default 15)
returns table (id uuid, handle text, display_name text, avatar_path text, banner_color text, banner_style text, profile_accent text,
               avatar_frame text, profile_emoji text, pronouns text, discovery_bio text, interests text[], looking_for text[],
               shared_interests int, mutual_friends int)
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := public._uid(); me public.profile_social;
begin
  select * into me from public.profile_social where user_id = v_uid;
  -- взаимность: смотреть ленту может только тот, кто сам в ней виден
  perform public._require(coalesce(me.discoverable, false), 'discovery_disabled');
  return query
    select p.id, p.handle, p.display_name, p.avatar_path, p.banner_color, p.banner_style, p.profile_accent, p.avatar_frame,
           p.profile_emoji, p.pronouns, s.discovery_bio, s.interests, s.looking_for,
           (select count(*)::int from unnest(s.interests) i where lower(i) in (select lower(x) from unnest(me.interests) x)),
           (select count(*)::int from public.friendships f1 join public.friendships f2
              on (case when f1.user_a = v_uid then f1.user_b else f1.user_a end) = (case when f2.user_a = p.id then f2.user_b else f2.user_a end)
             where v_uid in (f1.user_a, f1.user_b) and p.id in (f2.user_a, f2.user_b))
      from public.profile_social s join public.profiles p on p.id = s.user_id
     where s.discoverable and p.id <> v_uid
       and not public._is_blocked(v_uid, p.id)
       and not public._are_friends(v_uid, p.id)
       and not exists (select 1 from public.discovery_swipes w where w.swiper = v_uid and w.target = p.id)
       and not exists (select 1 from public.friend_requests r where r.status = 'pending'
                        and ((r.from_id = v_uid and r.to_id = p.id) or (r.from_id = p.id and r.to_id = v_uid)))
     order by 14 desc, random()
     limit least(greatest(p_limit, 1), 30);
end $$;

-- вправо = заявка в друзья (дружба начнётся, только когда другой примет; встречная заявка объединяется сразу)
create or replace function public.discovery_swipe(p_target uuid, p_like boolean) returns text
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public._uid(); v_res text;
begin
  perform public._require(coalesce((select discoverable from public.profile_social where user_id = v_uid), false), 'discovery_disabled');
  perform public._require(coalesce((select discoverable from public.profile_social where user_id = p_target), false)
    and not public._is_blocked(v_uid, p_target) and p_target <> v_uid, 'not_found');
  perform public._rate_limit('swipe', 300, 86400);
  if p_like then perform public._rate_limit('swipe_like', 50, 86400); end if;
  insert into public.discovery_swipes (swiper, target, liked) values (v_uid, p_target, p_like)
  on conflict (swiper, target) do update set liked = excluded.liked, created_at = now();
  if not p_like then return 'skipped'; end if;
  begin
    v_res := public.send_friend_request(p_target, 'discovery');
  exception when others then
    return 'liked';  -- человек закрыл заявки: лайк записан, заявка не отправлена
  end;
  return case v_res when 'accepted' then 'match' else 'requested' end;
end $$;

-- ─────────────────────────────── 9. Личные сообщения ───────────────────────────────
create or replace function public.open_dm(p_user uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public._uid(); v_id uuid;
begin
  perform public._require(p_user <> v_uid and not public._is_blocked(v_uid, p_user), 'not_found');
  perform public._require(public._are_friends(v_uid, p_user), 'friends_only');
  perform public._require(coalesce((select dm_from from public.profile_social where user_id = p_user), 'friends') <> 'nobody', 'dms_closed');
  select id into v_id from public.direct_threads where user_a = least(v_uid, p_user) and user_b = greatest(v_uid, p_user);
  if v_id is null then
    insert into public.direct_threads (user_a, user_b) values (least(v_uid, p_user), greatest(v_uid, p_user))
    on conflict (user_a, user_b) do update set user_a = excluded.user_a returning id into v_id;
  end if;
  return v_id;
end $$;

create or replace function public.send_dm(p_thread uuid, p_content text) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public._uid(); t public.direct_threads; v_other uuid; v_id bigint; v_text text := btrim(coalesce(p_content, ''));
begin
  select * into t from public.direct_threads where id = p_thread;
  perform public._require(found and v_uid in (t.user_a, t.user_b), 'not_found');
  v_other := case when t.user_a = v_uid then t.user_b else t.user_a end;
  perform public._require(not public._is_blocked(v_uid, v_other), 'not_found');
  perform public._require(public._are_friends(v_uid, v_other), 'friends_only');
  perform public._require(coalesce((select dm_from from public.profile_social where user_id = v_other), 'friends') <> 'nobody', 'dms_closed');
  perform public._require(v_text <> '', 'empty');
  perform public._require(char_length(v_text) <= 4000, 'too_long');
  perform public._rate_limit('dm', 8, 5);
  perform public._rate_limit('dm_min', 120, 60);
  insert into public.direct_messages (thread_id, author_id, content) values (p_thread, v_uid, v_text) returning id into v_id;
  update public.direct_threads set last_message_at = now() where id = p_thread;
  insert into public.dm_read_states (user_id, thread_id, last_read_id) values (v_uid, p_thread, v_id)
  on conflict (user_id, thread_id) do update set last_read_id = greatest(dm_read_states.last_read_id, excluded.last_read_id);
  return v_id;
end $$;

create or replace function public.edit_dm(p_id bigint, p_content text) returns void
language plpgsql security definer set search_path = public as $$
declare v_text text := btrim(coalesce(p_content, ''));
begin
  perform public._require(v_text <> '' and char_length(v_text) <= 4000, 'invalid_content');
  perform public._rate_limit('dm_edit', 10, 10);
  update public.direct_messages set content = v_text, edited_at = now() where id = p_id and author_id = public._uid() and deleted_at is null;
  perform public._require(found, 'forbidden');
end $$;

create or replace function public.delete_dm(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.direct_messages set content = '', deleted_at = now() where id = p_id and author_id = public._uid() and deleted_at is null;
  perform public._require(found, 'forbidden');
end $$;

create or replace function public.mark_dm_read(p_thread uuid, p_message bigint) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public._uid();
begin
  perform public._require(exists (select 1 from public.direct_threads where id = p_thread and v_uid in (user_a, user_b)), 'not_found');
  insert into public.dm_read_states (user_id, thread_id, last_read_id) values (v_uid, p_thread, p_message)
  on conflict (user_id, thread_id) do update set last_read_id = greatest(dm_read_states.last_read_id, excluded.last_read_id);
end $$;

drop function if exists public.dm_threads();  -- набор полей менялся в следующих миграциях
create function public.dm_threads()
returns table (thread_id uuid, other_id uuid, handle text, display_name text, avatar_path text, avatar_frame text,
               last_message_at timestamptz, last_content text, unread int, is_friend boolean)
language sql stable security definer set search_path = public as $$
  select t.id, p.id, p.handle, p.display_name, p.avatar_path, p.avatar_frame, t.last_message_at,
         (select case when m.deleted_at is not null then 'сообщение удалено' else left(m.content, 120) end
            from public.direct_messages m where m.thread_id = t.id order by m.id desc limit 1),
         (select count(*)::int from (select 1 from public.direct_messages m where m.thread_id = t.id and m.author_id <> auth.uid()
            and m.deleted_at is null and m.id > coalesce((select last_read_id from public.dm_read_states r where r.thread_id = t.id and r.user_id = auth.uid()), 0)
            limit 100) x),
         public._are_friends(auth.uid(), p.id)
    from public.direct_threads t
    join public.profiles p on p.id = case when t.user_a = auth.uid() then t.user_b else t.user_a end
   where auth.uid() in (t.user_a, t.user_b) and not public._is_blocked(t.user_a, t.user_b)
   order by t.last_message_at desc nulls last;
$$;

create or replace function public.social_counts() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'incoming', (select count(*) from public.friend_requests where to_id = auth.uid() and status = 'pending'),
    'unread_dms', (select coalesce(sum(unread), 0) from public.dm_threads()));
$$;

-- ─────────────────────────────── 10. Профиль: оформление и карточка ───────────────────────────────
create or replace function public.update_profile_style(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public._uid();
begin
  perform public._rate_limit('profile_style', 30, 60);
  update public.profiles set
    banner_color   = coalesce(p ->> 'banner_color', banner_color),
    banner_style   = coalesce(p ->> 'banner_style', banner_style),
    profile_accent = coalesce(p ->> 'profile_accent', profile_accent),
    avatar_frame   = coalesce(p ->> 'avatar_frame', avatar_frame),
    name_font      = coalesce(p ->> 'name_font', name_font),
    profile_emoji  = coalesce(p ->> 'profile_emoji', profile_emoji),
    pronouns       = coalesce(btrim(p ->> 'pronouns'), pronouns)
  where id = v_uid;
end $$;

-- переопределение: + оформление, + отношение (друг/заявка), друзья считаются «участниками общего круга»
create or replace function public.get_profile_card(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := public._uid(); pr public.profiles; pp public.profile_private; v_shared boolean; r jsonb;
begin
  select * into pr from public.profiles where id = p_user;
  if not found or (p_user <> v_uid and public._is_blocked(v_uid, p_user)) then return null; end if;
  select * into pp from public.profile_private where user_id = p_user;
  v_shared := v_uid = p_user or public._are_friends(v_uid, p_user) or exists (
    select 1 from public.community_members a join public.community_members b on a.community_id = b.community_id
     where a.user_id = v_uid and b.user_id = p_user);
  r := jsonb_build_object('id', pr.id, 'handle', pr.handle, 'display_name', pr.display_name, 'avatar_path', pr.avatar_path,
    'banner_color', pr.banner_color, 'banner_style', pr.banner_style, 'profile_accent', pr.profile_accent, 'avatar_frame', pr.avatar_frame,
    'name_font', pr.name_font, 'profile_emoji', pr.profile_emoji, 'pronouns', pr.pronouns, 'relation', public._relation(v_uid, p_user));
  if v_uid = p_user or pp.bio_visibility = 'everyone' or (pp.bio_visibility = 'members' and v_shared) then r := r || jsonb_build_object('bio', pp.bio); end if;
  if v_uid = p_user or pp.status_visibility = 'everyone' or (pp.status_visibility = 'members' and v_shared) then
    r := r || jsonb_build_object('status_text', pp.status_text,
      'presence', case when pp.presence = 'invisible' and v_uid <> p_user then 'offline' else pp.presence end);
  end if;
  if v_uid = p_user or pp.timezone_visibility = 'everyone' or (pp.timezone_visibility = 'members' and v_shared) then r := r || jsonb_build_object('timezone', pp.timezone); end if;
  if v_uid = p_user or pp.created_visibility = 'everyone' or (pp.created_visibility = 'members' and v_shared) then r := r || jsonb_build_object('created_at', pr.created_at); end if;
  return r;
end $$;

-- ─────────────────────────────── 11. RLS ───────────────────────────────
do $$ declare t text; begin
  foreach t in array array['profile_social','friend_requests','friendships','user_blocks','discovery_swipes','user_reports',
                           'direct_threads','direct_messages','dm_read_states'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

drop policy if exists sel on public.profile_social;   create policy sel on public.profile_social for select to authenticated using (user_id = auth.uid());
drop policy if exists upd on public.profile_social;   create policy upd on public.profile_social for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists sel on public.friend_requests;  create policy sel on public.friend_requests for select to authenticated using (auth.uid() in (from_id, to_id));
drop policy if exists sel on public.friendships;      create policy sel on public.friendships for select to authenticated using (auth.uid() in (user_a, user_b));
drop policy if exists sel on public.user_blocks;      create policy sel on public.user_blocks for select to authenticated using (blocker = auth.uid());
drop policy if exists sel on public.direct_threads;   create policy sel on public.direct_threads for select to authenticated using (auth.uid() in (user_a, user_b));
drop policy if exists sel on public.direct_messages;  create policy sel on public.direct_messages for select to authenticated
  using (thread_id in (select id from public.direct_threads where auth.uid() in (user_a, user_b)));
drop policy if exists sel on public.dm_read_states;   create policy sel on public.dm_read_states for select to authenticated using (user_id = auth.uid());
-- discovery_swipes и user_reports: прямого доступа нет вовсе

grant select on public.profile_social, public.friend_requests, public.friendships, public.user_blocks,
  public.direct_threads, public.direct_messages, public.dm_read_states to authenticated;
grant update (find_me, requests_from, dm_from, discoverable, discovery_bio, interests, looking_for, updated_at) on public.profile_social to authenticated;

-- ─────────────────────────────── 12. Realtime ───────────────────────────────
do $$ declare t text; begin
  foreach t in array array['friend_requests','friendships','direct_messages','direct_threads'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
alter table public.friendships replica identity full;

-- ─────────────────────────────── 13. Права на функции ───────────────────────────────
do $$ declare f record; begin
  for f in select p.oid::regprocedure sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prokind = 'f' loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    if left(f.proname, 1) <> '_' and f.proname <> 'handle_new_user' then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
  end loop;
end $$;
-- profile_tags_ok используется в CHECK: доступна authenticated через цикл выше
reset search_path;
