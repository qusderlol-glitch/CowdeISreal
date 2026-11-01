-- Звонки в ЛС и шаблоны сообществ.
insert into auth.users (id, email, raw_user_meta_data) values
 ('20000000-0000-0000-0000-000000000001', 'k1@x', '{"handle":"caller"}'),
 ('20000000-0000-0000-0000-000000000002', 'k2@x', '{"handle":"callee"}'),
 ('20000000-0000-0000-0000-000000000003', 'k3@x', '{"handle":"stranger"}');
\set K1 '20000000-0000-0000-0000-000000000001'
\set K2 '20000000-0000-0000-0000-000000000002'
\set k1 '{"sub":"20000000-0000-0000-0000-000000000001"}'
\set k2 '{"sub":"20000000-0000-0000-0000-000000000002"}'
\set k3 '{"sub":"20000000-0000-0000-0000-000000000003"}'
set role authenticated;
select set_config('request.jwt.claims', :'k1', false);
select public.send_friend_request(:'K2');
select set_config('request.jwt.claims', :'k2', false);
select public.respond_friend_request((select id from public.friend_requests where to_id = :'K2' and status = 'pending'), true);
select public.open_dm(:'K1') as th \gset

-- ── звонок
select set_config('request.jwt.claims', :'k1', false);
select tests.ok(public.dm_call_join(:'th') = 'started', 'first joiner starts the call');
select tests.ok((select kind = 'call' from public.direct_messages where thread_id = :'th' order by id desc limit 1), 'call message in DM');
select tests.ok((select call_active from public.dm_threads() where thread_id = :'th'), 'thread shows active call');
select set_config('request.jwt.claims', :'k2', false);
select tests.ok((select count(*) from public.dm_call_states where thread_id = :'th') = 1, 'callee sees caller in call (incoming)');
select tests.ok(public.dm_call_join(:'th') = 'joined', 'second joiner joins');
select tests.ok((select count(*) from public.direct_messages where thread_id = :'th' and kind = 'call') = 1, 'only one call message');
select public.dm_call_update(:'th', false, true, false);
select tests.ok(public.dm_call_heartbeat(:'th'), 'heartbeat ok while friends');
-- realtime-топик звонка: только участники-друзья
select set_config('realtime.topic', 'dmcall:' || :'th', false);
insert into realtime.messages (topic, extension, payload) values (realtime.topic(), 'broadcast', '{}');
select set_config('request.jwt.claims', :'k3', false);
select tests.expect_error($$insert into realtime.messages (topic, extension, payload) values (realtime.topic(), 'broadcast', '{}')$$, 'row-level security');
select tests.expect_error(format('select public.dm_call_join(%L)', :'th'), 'not_found');
select tests.ok((select count(*) from public.dm_call_states) = 0, 'stranger cannot see call states');

-- ── один звонок за раз: вход в комнату сообщества выводит из звонка в ЛС
select set_config('request.jwt.claims', :'k1', false);
select public.create_community('Игровая', '', 'gaming') as gc \gset
select tests.ok((select count(*) from public.channels where community_id = :'gc' and kind = 'voice') = 4, 'gaming template: 4 voice rooms');
select tests.ok(exists (select 1 from public.channels where community_id = :'gc' and name = 'поиск-тиммейтов'), 'gaming template channel');
select public.voice_join((select id from public.channels where community_id = :'gc' and name = 'Игра 1'));
select tests.ok(not exists (select 1 from public.dm_call_states where user_id = :'K1'), 'voice_join leaves DM call');
select tests.ok(public.dm_call_join(:'th') = 'joined', 'rejoin DM call while friend is there');
select tests.ok(not exists (select 1 from public.voice_states where user_id = :'K1'), 'dm_call_join leaves community voice');

-- ── конец дружбы обрывает звонок
select public.remove_friend(:'K2');
select tests.ok(not public.dm_call_heartbeat(:'th'), 'heartbeat fails after unfriend');
select tests.expect_error(format('select public.dm_call_join(%L)', :'th'), 'friends_only');
select set_config('realtime.topic', 'dmcall:' || :'th', false);
select tests.expect_error($$insert into realtime.messages (topic, extension, payload) values (realtime.topic(), 'broadcast', '{}')$$, 'row-level security');

-- ── шаблоны
select public.create_community('Учёба', '', 'study') as sc \gset
select tests.ok((select count(*) from public.channels where community_id = :'sc') = 6, 'study template: 6 channels');
select public.create_community('Своё') as cc \gset
select tests.ok((select count(*) from public.channels where community_id = :'cc') = 3, 'default template still 3 channels');
reset role;
