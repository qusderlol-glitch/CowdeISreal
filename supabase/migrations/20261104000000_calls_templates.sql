-- CowdeISreal: звонки друзьям в личных сообщениях и шаблоны сообществ.
-- Запуск: после предыдущих миграций. SQL Editor -> вставить файл -> Run. Повторный запуск безопасен.
--
-- Звонок в ЛС: участники — двое друзей из диалога. Медиа идут по WebRTC; сигнализация — приватный Realtime-топик
-- dmcall:<thread_id>, доступ к нему только у участников диалога, если они друзья и не заблокировали друг друга.
-- Человек может быть одновременно только в одном звонке (комната сообщества ИЛИ звонок в ЛС).

-- ─────────────────────────────── 1. Таблицы ───────────────────────────────
alter table public.direct_messages add column if not exists kind text not null default 'user';
do $$ begin
  alter table public.direct_messages add constraint direct_messages_kind_check check (kind in ('user', 'call'));
exception when duplicate_object then null; end $$;

create table if not exists public.dm_call_states (
  thread_id  uuid not null references public.direct_threads (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  muted      boolean not null default true,
  video      boolean not null default false,
  screen     boolean not null default false,
  joined_at  timestamptz not null default now(),
  last_seen  timestamptz not null default now(),
  primary key (thread_id, user_id)
);
create unique index if not exists dm_call_states_one_call on public.dm_call_states (user_id);

alter table public.dm_call_states enable row level security;
revoke all on public.dm_call_states from anon, authenticated;
drop policy if exists sel on public.dm_call_states;
create policy sel on public.dm_call_states for select to authenticated
  using (thread_id in (select id from public.direct_threads where auth.uid() in (user_a, user_b)));
grant select on public.dm_call_states to authenticated;

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'dm_call_states') then
    alter publication supabase_realtime add table public.dm_call_states;
  end if;
end $$;
alter table public.dm_call_states replica identity full;

-- ─────────────────────────────── 2. Звонок в ЛС ───────────────────────────────
create or replace function public._dm_call_peer(p_thread uuid) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare t public.direct_threads; v_uid uuid := public._uid(); v_other uuid;
begin
  select * into t from public.direct_threads where id = p_thread;
  perform public._require(found and v_uid in (t.user_a, t.user_b), 'not_found');
  v_other := case when t.user_a = v_uid then t.user_b else t.user_a end;
  perform public._require(not public._is_blocked(v_uid, v_other), 'not_found');
  perform public._require(public._are_friends(v_uid, v_other), 'friends_only');
  return v_other;
end $$;

-- 'started' — вы начали звонок (другу придёт входящий), 'joined' — вы присоединились к уже идущему
create or replace function public.dm_call_join(p_thread uuid) returns text
language plpgsql volatile security definer set search_path = public as $$
declare v_uid uuid := public._uid(); v_other uuid; v_active boolean;
begin
  v_other := public._dm_call_peer(p_thread);
  perform public._rate_limit('dm_call', 10, 60);
  delete from public.dm_call_states where thread_id = p_thread and last_seen < now() - interval '45 seconds';
  v_active := exists (select 1 from public.dm_call_states where thread_id = p_thread and user_id = v_other);
  delete from public.voice_states where user_id = v_uid;
  delete from public.dm_call_states where user_id = v_uid and thread_id <> p_thread;
  insert into public.dm_call_states (thread_id, user_id) values (p_thread, v_uid)
  on conflict (thread_id, user_id) do update set last_seen = now(), video = false, screen = false;
  if not v_active then
    insert into public.direct_messages (thread_id, author_id, content, kind) values (p_thread, v_uid, 'начал(а) звонок', 'call');
    update public.direct_threads set last_message_at = now() where id = p_thread;
    return 'started';
  end if;
  return 'joined';
end $$;

create or replace function public.dm_call_update(p_thread uuid, p_muted boolean, p_video boolean, p_screen boolean) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  update public.dm_call_states set muted = p_muted, video = p_video, screen = p_screen, last_seen = now()
   where thread_id = p_thread and user_id = public._uid();
  perform public._require(found, 'not_in_room');
end $$;

create or replace function public.dm_call_heartbeat(p_thread uuid) returns boolean
language plpgsql volatile security definer set search_path = public as $$
declare v_uid uuid := public._uid();
begin
  -- если дружба закончилась или появилась блокировка — звонок обрывается
  if not exists (select 1 from public.direct_threads t where t.id = p_thread and v_uid in (t.user_a, t.user_b)
                  and public._are_friends(t.user_a, t.user_b) and not public._is_blocked(t.user_a, t.user_b)) then
    delete from public.dm_call_states where thread_id = p_thread and user_id = v_uid;
    return false;
  end if;
  update public.dm_call_states set last_seen = now() where thread_id = p_thread and user_id = v_uid;
  return found;
end $$;

create or replace function public.dm_call_leave(p_thread uuid) returns void
language sql volatile security definer set search_path = public as $$
  delete from public.dm_call_states where thread_id = p_thread and user_id = auth.uid();
$$;

-- Вход в комнату сообщества: + выход из звонка в ЛС (один звонок за раз)
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
  delete from public.dm_call_states where user_id = v_uid;
  select voice_mesh_limit into v_limit from public.communities where id = ch.community_id;
  perform public._require((select count(*) from public.voice_states where channel_id = p_channel and user_id <> v_uid) < v_limit, 'room_full');
  insert into public.voice_states (channel_id, user_id, community_id) values (p_channel, v_uid, ch.community_id)
  on conflict (channel_id, user_id) do update set last_seen = now(), video = false, screen = false;
end $$;

-- Realtime: + топик dmcall:<thread>
create or replace function public.realtime_topic_allowed(p_topic text, p_write boolean) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when p_topic like 'voice:%'  then public.has_channel_perm(public.try_uuid(substr(p_topic, 7)), 1 | 512)
    when p_topic like 'typing:%' then public.has_channel_perm(public.try_uuid(substr(p_topic, 8)), case when p_write then 3 else 1 end)
    when p_topic like 'community:%' then public.try_uuid(substr(p_topic, 11)) in (select public.my_communities())
    when p_topic like 'dmcall:%' then exists (
      select 1 from public.direct_threads t where t.id = public.try_uuid(substr(p_topic, 8))
         and auth.uid() in (t.user_a, t.user_b) and public._are_friends(t.user_a, t.user_b) and not public._is_blocked(t.user_a, t.user_b))
    else false end;
$$;

-- Список диалогов: + идёт ли сейчас звонок
drop function if exists public.dm_threads();
create function public.dm_threads()
returns table (thread_id uuid, other_id uuid, handle text, display_name text, avatar_path text, avatar_frame text,
               last_message_at timestamptz, last_content text, unread int, is_friend boolean, call_active boolean)
language sql stable security definer set search_path = public as $$
  select t.id, p.id, p.handle, p.display_name, p.avatar_path, p.avatar_frame, t.last_message_at,
         (select case when m.deleted_at is not null then 'сообщение удалено' when m.kind = 'call' then '📞 звонок' else left(m.content, 120) end
            from public.direct_messages m where m.thread_id = t.id order by m.id desc limit 1),
         (select count(*)::int from (select 1 from public.direct_messages m where m.thread_id = t.id and m.author_id <> auth.uid()
            and m.deleted_at is null and m.id > coalesce((select last_read_id from public.dm_read_states r where r.thread_id = t.id and r.user_id = auth.uid()), 0)
            limit 100) x),
         public._are_friends(auth.uid(), p.id),
         exists (select 1 from public.dm_call_states c where c.thread_id = t.id and c.last_seen > now() - interval '45 seconds')
    from public.direct_threads t
    join public.profiles p on p.id = case when t.user_a = auth.uid() then t.user_b else t.user_a end
   where auth.uid() in (t.user_a, t.user_b) and not public._is_blocked(t.user_a, t.user_b)
   order by t.last_message_at desc nulls last;
$$;

-- ─────────────────────────────── 3. Шаблоны сообществ ───────────────────────────────
drop function if exists public.create_community(text, text);
create or replace function public.create_community(p_name text, p_description text default '', p_template text default 'custom') returns uuid
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public._uid(); v_id uuid; v_text uuid; v_voice uuid;
        v_tpl text := case when p_template in ('custom','gaming','friends','study','club') then p_template else 'custom' end;
begin
  perform public._rate_limit('create_community', 5, 3600);
  perform public._require((select count(*) from public.communities where owner_id = v_uid) < 50, 'limit_reached');
  insert into public.communities (name, description, owner_id) values (btrim(p_name), coalesce(p_description, ''), v_uid) returning id into v_id;
  insert into public.community_members (community_id, user_id) values (v_id, v_uid);
  insert into public.roles (community_id, name, color, position, permissions, is_default)
    values (v_id, 'Участники', '#9aa7b2', 0, public.perm_default(), true);
  insert into public.roles (community_id, name, color, position, permissions)
    values (v_id, 'Модераторы', '#38bdf8', 1, public.perm_default() | 4 | 64 | 128 | 8192);
  insert into public.channel_categories (community_id, name, position) values (v_id, 'Текстовые', 0) returning id into v_text;
  insert into public.channel_categories (community_id, name, position) values (v_id, 'Голосовые', 1) returning id into v_voice;
  insert into public.channels (community_id, category_id, name, kind, position, topic)
  select v_id, case when x.kind = 'voice' then v_voice else v_text end, x.name, x.kind, x.pos, x.topic
    from (values
      ('custom','объявления','announcement',0,'Важные новости сообщества'), ('custom','общий','text',1,''), ('custom','Общая комната','voice',0,''),
      ('gaming','объявления','announcement',0,'Турниры и новости'), ('gaming','общий','text',1,''), ('gaming','поиск-тиммейтов','text',2,'Ищу, с кем поиграть'),
      ('gaming','клипы','text',3,'Лучшие моменты'), ('gaming','Общая комната','voice',0,''), ('gaming','Игра 1','voice',1,''), ('gaming','Игра 2','voice',2,''), ('gaming','Стрим','voice',3,'Демонстрация экрана'),
      ('friends','общий','text',0,''), ('friends','мемы','text',1,''), ('friends','планы','text',2,'Куда идём и когда'),
      ('friends','Тусовка','voice',0,''), ('friends','Кино вместе','voice',1,'Смотрим через демонстрацию экрана'),
      ('study','объявления','announcement',0,'Расписание и дедлайны'), ('study','общий','text',1,''), ('study','домашка','text',2,'Задания и решения'),
      ('study','вопросы','text',3,'Спроси — помогут'), ('study','Учимся вместе','voice',0,''), ('study','Консультация','voice',1,''),
      ('club','объявления','announcement',0,'Новости клуба'), ('club','общий','text',1,''), ('club','события','text',2,'Встречи и мероприятия'),
      ('club','идеи','text',3,'Предложения'), ('club','Собрание','voice',0,''), ('club','Комната отдыха','voice',1,'')
    ) as x(tpl, name, kind, pos, topic)
   where x.tpl = v_tpl;
  insert into public.community_bots (community_id, bot_key, enabled) values (v_id, 'examples', true);
  perform public._audit(v_id, 'community.create', 'community', v_id::text, jsonb_build_object('name', p_name, 'template', v_tpl));
  return v_id;
end $$;

-- ─────────────────────────────── 4. Права на функции ───────────────────────────────
do $$ declare f record; begin
  for f in select p.oid::regprocedure sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prokind = 'f' loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    if left(f.proname, 1) <> '_' and f.proname <> 'handle_new_user' then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
  end loop;
end $$;
notify pgrst, 'reload schema';
