-- Сквозные тесты прав, RLS, лимитов, опыта, команд, голоса, Storage и Realtime.
\set QUIET on
create schema if not exists tests;
grant usage on schema tests to authenticated, anon;
create or replace function tests.expect_error(p_sql text, p_pattern text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'EXPECTED ERROR "%" BUT SUCCEEDED: %', p_pattern, p_sql;
exception when others then
  if sqlerrm like 'EXPECTED ERROR%' then raise; end if;
  if sqlerrm !~* p_pattern then raise exception 'WRONG ERROR for %: got "%" expected "%"', p_sql, sqlerrm, p_pattern; end if;
end $$;
create or replace function tests.ok(p boolean, p_msg text) returns void language plpgsql as $$
begin if not coalesce(p, false) then raise exception 'ASSERT FAILED: %', p_msg; end if; end $$;
grant execute on all functions in schema tests to authenticated, anon;

insert into auth.users (id, email, raw_user_meta_data) values
 ('a0000000-0000-0000-0000-00000000000a', 'alice@x', '{"handle":"alice","display_name":"Alice"}'),
 ('b0000000-0000-0000-0000-00000000000b', 'bob@x',   '{"handle":"bob"}'),
 ('c0000000-0000-0000-0000-00000000000c', 'carol@x', '{"handle":"carol"}'),
 ('d0000000-0000-0000-0000-00000000000d', 'mal@x',   '{"handle":"alice"}');  -- занятый handle -> автогенерация
select tests.ok((select handle from public.profiles where id = 'd0000000-0000-0000-0000-00000000000d') like 'user_%', 'handle collision fallback');

\set alice '{"sub":"a0000000-0000-0000-0000-00000000000a"}'
\set bob   '{"sub":"b0000000-0000-0000-0000-00000000000b"}'
\set carol '{"sub":"c0000000-0000-0000-0000-00000000000c"}'
\set mal   '{"sub":"d0000000-0000-0000-0000-00000000000d"}'
\set B 'b0000000-0000-0000-0000-00000000000b'
\set A 'a0000000-0000-0000-0000-00000000000a'
\set C 'c0000000-0000-0000-0000-00000000000c'
\set M 'd0000000-0000-0000-0000-00000000000d'

-- ── anon ничего не может
set role anon;
select tests.expect_error('select * from public.communities', 'permission denied');
select tests.expect_error($$select public.create_community('x')$$, 'permission denied');
reset role;

-- ── Алиса создаёт сообщество
set role authenticated; select set_config('request.jwt.claims', :'alice', false);
select public.create_community('Тестовое', 'описание') as cid \gset
select id as general from public.channels where community_id = :'cid' and name = 'общий' \gset
select id as announce from public.channels where community_id = :'cid' and kind = 'announcement' \gset
select id as voice from public.channels where community_id = :'cid' and kind = 'voice' \gset
select tests.ok((select count(*) from public.channels where community_id = :'cid') = 3, 'default channels');
select tests.ok(public.my_permissions(:'cid') = 65535, 'owner has all perms');
select public.create_invite(:'cid', 3600, 2) as code \gset
select tests.expect_error($$select public.create_invite('$$ || :'cid' || $$', 60, null)$$, 'invalid_expiry');

-- ── Боб не участник: ничего не видит и не пишет
select set_config('request.jwt.claims', :'bob', false);
select tests.ok((select count(*) from public.communities) = 0, 'non-member sees no community');
select tests.ok((select count(*) from public.channels) = 0, 'non-member sees no channels');
select tests.expect_error(format('select public.send_message(%L, %L)', :'general', 'hi'), 'forbidden');
select tests.ok((public.preview_invite(:'code') ->> 'valid')::boolean, 'invite preview valid');
select tests.ok(public.join_by_invite(:'code') = :'cid', 'bob joins');
select tests.ok((select count(*) from public.channels where community_id = :'cid') = 3, 'member sees channels');

-- ── прямые записи запрещены
select tests.expect_error(format('insert into public.messages (channel_id, community_id, author_id, content) values (%L, %L, %L, %L)', :'general', :'cid', :'B', 'x'), 'permission denied');
select tests.expect_error('update public.community_members set xp = 99999', 'permission denied');
select tests.expect_error(format('update public.communities set owner_id = %L', :'B'), 'permission denied');
select tests.expect_error('delete from public.audit_log', 'permission denied');

-- ── сообщения, опыт, лимиты
select public.send_message(:'general', 'hello world from bob') as m1 \gset
select tests.ok((select xp from public.community_members where community_id = :'cid' and user_id = :'B') = 10, 'xp awarded');
select public.send_message(:'general', 'second message quickly');
select tests.ok((select xp from public.community_members where community_id = :'cid' and user_id = :'B') = 10, 'xp cooldown');
select public.send_message(:'general', 'm3'); select public.send_message(:'general', 'm4'); select public.send_message(:'general', 'm5');
select tests.expect_error(format('select public.send_message(%L, %L)', :'general', 'spam'), 'rate_limited');
select tests.expect_error(format('select public.send_message(%L, %L)', :'announce', 'news'), 'forbidden');
select tests.expect_error(format('select public.send_message(%L, %L)', :'general', repeat('x', 4001)), 'too_long');
select tests.expect_error(format('select public.create_role(%L, %L, %L, 1)', :'cid', 'x', '#ffffff'), 'forbidden');
select tests.expect_error(format('select public.set_pinned(%s, true)', :'m1'), 'forbidden');
reset role; delete from public.rate_limits; set role authenticated;

-- ── повторная выдача XP за одно сообщение невозможна; дневной лимит
reset role;
update public.community_members set last_xp_at = null where user_id = :'B';
select tests.ok(public._award_message_xp(:'cid', :'B', :m1, 'hello world from bob') = 0, 'no double xp for same message');
insert into public.xp_events (community_id, user_id, amount, source, source_id) values (:'cid', :'B', 185, 'message', 'fake-1');
select id as m_new from public.messages where content = 'm5' \gset
select tests.ok(public._award_message_xp(:'cid', :'B', :m_new, 'totally different text') = 5, 'daily cap clamps');
update public.community_members set last_xp_at = null where user_id = :'B';
select tests.ok(public._award_message_xp(:'cid', :'B', :m_new + 1000, 'another different text') = 0, 'daily cap reached');
set role authenticated;

-- ── роли и иерархия
select set_config('request.jwt.claims', :'alice', false);
select public.create_role(:'cid', 'Helpers', '#ff8800', 32 | 64 | 1 | 2) as helpers \gset
select id as mods from public.roles where community_id = :'cid' and name = 'Модераторы' \gset
select id as everyone from public.roles where community_id = :'cid' and is_default \gset
select public.set_member_role(:'cid', :'B', :'helpers', true);
select set_config('request.jwt.claims', :'bob', false);
select tests.expect_error(format('select public.create_role(%L, %L, %L, 256)', :'cid', 'evil', '#000000'), 'cannot_grant_missing_permission');
select tests.expect_error(format('select public.set_member_role(%L, %L, %L, true)', :'cid', :'B', :'mods'), 'cannot_grant_missing_permission');
select tests.expect_error(format('select public.update_role(%L, %L)', :'helpers', '{"permissions": 65535}'), 'hierarchy');
select tests.expect_error(format('select public.update_role(%L, %L)', :'everyone', '{"permissions": 16384}'), 'cannot_grant_missing_permission');
select tests.expect_error(format('select public.kick_member(%L, %L)', :'cid', :'A'), 'hierarchy');
select tests.expect_error(format('select public.ban_member(%L, %L)', :'cid', :'A'), 'forbidden');
select tests.expect_error(format('select public.transfer_ownership(%L, %L, %L)', :'cid', :'B', 'Тестовое'), 'forbidden');
select public.create_role(:'cid', 'Low', '#123456', 1) as low \gset
select tests.ok((select position from public.roles where id = :'low') < (select position from public.roles where id = :'helpers'), 'new role below creator');

-- ── приглашение исчерпано, кик, бан
select set_config('request.jwt.claims', :'carol', false);
select public.join_by_invite(:'code');
select set_config('request.jwt.claims', :'mal', false);
select tests.expect_error(format('select public.join_by_invite(%L)', :'code'), 'invite_used_up');
select set_config('request.jwt.claims', :'bob', false);
select public.kick_member(:'cid', :'C', 'test');
select tests.ok(not exists (select 1 from public.community_members where user_id = :'C'), 'carol kicked');
select set_config('request.jwt.claims', :'alice', false);
select public.ban_member(:'cid', :'M', 'spam');
select public.create_invite(:'cid', null, null) as code2 \gset
select set_config('request.jwt.claims', :'mal', false);
select tests.expect_error(format('select public.join_by_invite(%L)', :'code2'), 'banned');
select set_config('request.jwt.claims', :'carol', false);
select tests.ok(public.join_by_invite(:'code2') = :'cid', 'carol rejoins');

-- ── приватный канал через переопределения
select set_config('request.jwt.claims', :'alice', false);
select public.create_channel(:'cid', 'staff', 'text') as staff \gset
select public.set_channel_overwrite(:'staff', :'everyone', 0, 1);
select public.send_message(:'staff', 'secret plans') as secret_msg \gset
select set_config('request.jwt.claims', :'bob', false);
select tests.ok(not exists (select 1 from public.channels where id = :'staff'), 'private channel hidden');
select tests.ok(not exists (select 1 from public.messages where id = :secret_msg), 'private messages hidden');
select tests.ok((select count(*) from public.search_messages(:'cid', 'secret')) = 0, 'search respects visibility');
select tests.ok((select count(*) from public.search_messages(:'cid', 'hel')) >= 1, 'prefix search works');
select set_config('request.jwt.claims', :'alice', false);
select public.set_channel_overwrite(:'staff', :'helpers', 1 | 2, 0);
select set_config('request.jwt.claims', :'bob', false);
select tests.ok(exists (select 1 from public.messages where id = :secret_msg), 'role overwrite grants view');
select set_config('request.jwt.claims', :'carol', false);
select tests.ok(not exists (select 1 from public.messages where id = :secret_msg), 'still hidden for others');

-- ── таймаут
select set_config('request.jwt.claims', :'alice', false);
select public.timeout_member(:'cid', :'C', 600, 'cool down');
select set_config('request.jwt.claims', :'carol', false);
select tests.expect_error(format('select public.send_message(%L, %L)', :'general', 'hi'), 'forbidden');
select set_config('request.jwt.claims', :'alice', false);
select public.timeout_member(:'cid', :'C', 0);
select set_config('request.jwt.claims', :'carol', false);
select public.send_message(:'general', 'back again');

-- ── реакции, правка, удаление, закрепы
select tests.ok(public.toggle_reaction(:m1, '👍'), 'reaction added');
select tests.ok(not public.toggle_reaction(:m1, '👍'), 'reaction removed');
select tests.expect_error(format('select public.edit_message(%s, %L)', :m1, 'hacked'), 'forbidden');
select tests.expect_error(format('select public.delete_message(%s)', :m1), 'forbidden');
select set_config('request.jwt.claims', :'alice', false);
select public.set_pinned(:m1, true);
select public.delete_message(:m1);
select tests.ok((select deleted_at is not null and content = '' from public.messages where id = :m1), 'soft deleted');
select tests.ok(exists (select 1 from public.audit_log where action = 'message.delete'), 'moderator delete audited');

-- ── команды
select set_config('request.jwt.claims', :'bob', false);
select public.send_message(:'general', '/roll 2d6') as cmd \gset
select tests.ok((select content like '🎲 2d6:%' from public.messages where reply_to_id = :cmd and kind = 'bot'), 'roll works');
select public.send_message(:'general', '/rank') as cmd2 \gset
select tests.ok((select content like 'Уровень%' from public.messages where reply_to_id = :cmd2), 'rank works');
select public.send_message(:'general', '/rm -rf') as cmd3 \gset
select tests.ok((select content like 'Неизвестная команда%' from public.messages where reply_to_id = :cmd3), 'unknown command');
select tests.expect_error(format('select public.set_bot_enabled(%L, %L, false)', :'cid', 'examples'), 'forbidden');
select set_config('request.jwt.claims', :'alice', false);
select public.set_bot_enabled(:'cid', 'examples', false);
select set_config('request.jwt.claims', :'bob', false);
select public.send_message(:'general', '/help') as cmd4 \gset
select tests.ok((select content like 'Модуль%выключен%' from public.messages where reply_to_id = :cmd4), 'disabled module');
select tests.ok((select count(*) from public.bot_command_log) = 0, 'non-moderator cannot read command log');
reset role; delete from public.rate_limits; set role authenticated;

-- ── непрочитанное и упоминания
select set_config('request.jwt.claims', :'carol', false);
select public.send_message(:'general', 'ping @alice look');
select set_config('request.jwt.claims', :'alice', false);
select tests.ok((select mentions >= 1 and unread >= 1 from public.unread_summary() where channel_id = :'general'), 'unread + mention');
select public.mark_read(:'general', (select max(id) from public.messages where channel_id = :'general'));
select tests.ok((select unread = 0 from public.unread_summary() where channel_id = :'general'), 'mark read');

-- ── голос
select set_config('request.jwt.claims', :'bob', false);
select public.voice_join(:'voice');
select public.voice_update(:'voice', false, false, true, false);
select tests.ok((select video from public.voice_states where user_id = :'B'), 'video flag');
select tests.expect_error(format('select public.voice_join(%L)', :'general'), 'not_voice_channel');
select set_config('request.jwt.claims', :'alice', false);
select public.update_community(:'cid', '{"voice_mesh_limit": 2}');
select public.voice_join(:'voice');
select set_config('request.jwt.claims', :'carol', false);
select tests.expect_error(format('select public.voice_join(%L)', :'voice'), 'room_full');
select set_config('request.jwt.claims', :'mal', false);
select tests.expect_error(format('select public.voice_join(%L)', :'voice'), 'forbidden');

-- ── Storage
select set_config('request.jwt.claims', :'bob', false);
insert into storage.objects (bucket_id, name, owner, metadata)
  values ('attachments', :'cid' || '/' || :'general' || '/' || :'B' || '/pic.png', :'B', '{"size": 1234, "mimetype": "image/png"}');
select tests.expect_error(format($$insert into storage.objects (bucket_id, name, metadata) values ('attachments', %L, '{}')$$,
  :'cid' || '/' || :'general' || '/' || :'A' || '/x.png'), 'row-level security');
select tests.expect_error(format($$insert into storage.objects (bucket_id, name, metadata) values ('attachments', %L, '{}')$$,
  :'cid' || '/' || :'announce' || '/' || :'B' || '/x.png'), 'row-level security');
select public.send_message(:'general', '', null, jsonb_build_array(jsonb_build_object('path', :'cid' || '/' || :'general' || '/' || :'B' || '/pic.png', 'name', 'pic.png'))) as att_msg \gset
select tests.ok((select size_bytes = 1234 and mime_type = 'image/png' from public.message_attachments where message_id = :att_msg), 'attachment metadata from storage');
select tests.expect_error(format('select public.send_message(%L, %L, null, %L::jsonb)', :'general', 'x',
  jsonb_build_array(jsonb_build_object('path', :'cid' || '/' || :'general' || '/' || :'B' || '/missing.png'))), 'attachment_not_uploaded');
insert into storage.objects (bucket_id, name, metadata) values ('public-media', 'avatars/' || :'B' || '/me.png', '{}');
select tests.expect_error(format($$insert into storage.objects (bucket_id, name, metadata) values ('public-media', %L, '{}')$$, 'avatars/' || :'A' || '/me.png'), 'row-level security');
select tests.expect_error(format($$insert into storage.objects (bucket_id, name, metadata) values ('public-media', %L, '{}')$$, 'communities/' || :'cid' || '/i.png'), 'row-level security');
select set_config('request.jwt.claims', :'carol', false);
select tests.ok(exists (select 1 from storage.objects where bucket_id = 'attachments' and name like '%/pic.png'), 'member reads attachment');
select set_config('request.jwt.claims', :'mal', false);
select tests.ok(not exists (select 1 from storage.objects where bucket_id = 'attachments'), 'outsider cannot read attachment');

-- ── Realtime-топики
select set_config('realtime.topic', 'voice:' || :'voice', false);
select tests.expect_error($$insert into realtime.messages (topic, extension, payload) values (realtime.topic(), 'broadcast', '{}')$$, 'row-level security');
select set_config('request.jwt.claims', :'bob', false);
insert into realtime.messages (topic, extension, payload) values (realtime.topic(), 'broadcast', '{}');
select set_config('realtime.topic', 'voice:not-a-uuid', false);
select tests.expect_error($$insert into realtime.messages (topic, extension, payload) values (realtime.topic(), 'broadcast', '{}')$$, 'row-level security');

select set_config('realtime.topic', 'community:' || :'cid', false);
insert into realtime.messages (topic, extension, payload) values (realtime.topic(), 'presence', '{}');
select set_config('request.jwt.claims', :'mal', false);
select tests.expect_error($$insert into realtime.messages (topic, extension, payload) values (realtime.topic(), 'presence', '{}')$$, 'row-level security');
select set_config('request.jwt.claims', :'bob', false);

-- ── приватность профиля
update public.profile_private set bio = 'secret bio', bio_visibility = 'nobody' where user_id = :'B';
update public.profile_private set bio = 'pwned' where user_id = :'A';  -- RLS: 0 строк
reset role; select tests.ok((select bio from public.profile_private where user_id = :'A') = '', 'cannot edit others private profile'); set role authenticated;
select set_config('request.jwt.claims', :'alice', false);
select tests.ok(not (public.get_profile_card(:'B') ? 'bio'), 'hidden bio');
select tests.ok((select bio from public.profile_private where user_id = :'A') = '' and (select count(*) from public.profile_private) = 1, 'only own private row');

-- ── передача владения
select tests.expect_error(format('select public.transfer_ownership(%L, %L, %L)', :'cid', :'B', 'wrong'), 'confirm_mismatch');
select public.transfer_ownership(:'cid', :'B', 'Тестовое');
select tests.expect_error(format('select public.create_channel(%L, %L, %L)', :'cid', 'x', 'text'), 'forbidden');
select set_config('request.jwt.claims', :'bob', false);
select tests.expect_error(format('select public.leave_community(%L)', :'cid'), 'owner_cannot_leave');
select tests.ok(public.my_permissions(:'cid') = 65535, 'new owner has all');
reset role;
select 'security tests passed' as result;
