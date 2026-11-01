-- Друзья, поиск с опечатками, приватность, заявки, блокировки, лента знакомств, личные сообщения.
-- tests.friends: проверка дружбы от имени владельца (внутренняя public._are_friends клиенту закрыта — это проверяем отдельно)
create or replace function tests.friends(a uuid, b uuid) returns boolean language sql security definer as $$ select public._are_friends(a, b) $$;
grant execute on function tests.friends(uuid, uuid) to authenticated;
insert into auth.users (id, email, raw_user_meta_data) values
 ('10000000-0000-0000-0000-000000000001', 's1@x', '{"handle":"qusderlol","display_name":"Кусдер"}'),
 ('10000000-0000-0000-0000-000000000002', 's2@x', '{"handle":"mashka","display_name":"Маша"}'),
 ('10000000-0000-0000-0000-000000000003', 's3@x', '{"handle":"hidden_one","display_name":"Скрытный"}'),
 ('10000000-0000-0000-0000-000000000004', 's4@x', '{"handle":"troll","display_name":"Тролль"}'),
 ('10000000-0000-0000-0000-000000000005', 's5@x', '{"handle":"closedgate","display_name":"Закрыто"}');
\set U1 '10000000-0000-0000-0000-000000000001'
\set U2 '10000000-0000-0000-0000-000000000002'
\set U3 '10000000-0000-0000-0000-000000000003'
\set U4 '10000000-0000-0000-0000-000000000004'
\set U5 '10000000-0000-0000-0000-000000000005'
\set c1 '{"sub":"10000000-0000-0000-0000-000000000001"}'
\set c2 '{"sub":"10000000-0000-0000-0000-000000000002"}'
\set c3 '{"sub":"10000000-0000-0000-0000-000000000003"}'
\set c4 '{"sub":"10000000-0000-0000-0000-000000000004"}'
\set c5 '{"sub":"10000000-0000-0000-0000-000000000005"}'
select tests.ok((select count(*) from public.profile_social where user_id in (:'U1', :'U2')) = 2, 'social row created by trigger');

set role authenticated;
-- настройки приватности: прямое обновление своих полей разрешено, чужих — нет
select set_config('request.jwt.claims', :'c3', false);
update public.profile_social set find_me = 'exact' where user_id = :'U3';
select set_config('request.jwt.claims', :'c5', false);
update public.profile_social set requests_from = 'nobody', interests = array['игры','музыка'] where user_id = :'U5';
select tests.expect_error($$update public.profile_social set interests = array['', 'x'] where user_id = '10000000-0000-0000-0000-000000000005'$$, 'check constraint');
select tests.expect_error($$update public.profile_social set looking_for = array['dating'] where user_id = '10000000-0000-0000-0000-000000000005'$$, 'check constraint');
update public.profile_social set find_me = 'nobody' where user_id = :'U1';  -- чужая строка: RLS, 0 строк
reset role; select tests.ok((select find_me from public.profile_social where user_id = :'U1') = 'everyone', 'cannot edit others social settings'); set role authenticated;

-- ── поиск с опечаткой
select set_config('request.jwt.claims', :'c2', false);
select tests.ok((select handle from public.search_users('qusdrlol') limit 1) = 'qusderlol', 'typo suggestion finds qusderlol');
select tests.ok((select handle from public.search_users('@qusd') limit 1) = 'qusderlol', 'prefix with @ works');
select tests.ok((select handle from public.search_users('tlorl') limit 1) = 'troll', 'short handle with swapped letters (levenshtein)');
select tests.ok((select handle from public.search_users('qusderlil') limit 1) = 'qusderlol', 'one wrong letter');
select tests.ok((select handle from public.search_users('кусдер') limit 1) = 'qusderlol', 'search by display name');
select tests.ok((select exact from public.search_users('qusderlol') limit 1), 'exact match flagged');
select tests.ok(not exists (select 1 from public.search_users('hidden_on')), 'find_me=exact hides from fuzzy search');
select tests.ok(exists (select 1 from public.search_users('hidden_one')), 'find_me=exact found by exact handle');
select tests.ok(not exists (select 1 from public.search_users('mashka')), 'self not in results');
select tests.ok(not exists (select 1 from public.search_users('q')), 'too short query returns nothing');

-- ── заявки
select tests.ok(public.send_friend_request(:'U1') = 'sent', 'request sent');
select tests.ok(public.send_friend_request(:'U1') = 'already_sent', 'duplicate request');
select tests.ok((select relation from public.search_users('qusderlol') limit 1) = 'outgoing', 'relation outgoing');
select tests.ok(not tests.friends(:'U1', :'U2'), 'not friends until accepted');
select tests.expect_error(format('select public._are_friends(%L, %L)', :'U1', :'U2'), 'permission denied');
reset role; select id as req12 from public.friend_requests where to_id = :'U1' and status = 'pending' \gset
set role authenticated; select set_config('request.jwt.claims', :'c4', false);
select tests.expect_error(format('select public.respond_friend_request(%s, true)', :req12), 'not_found');
select tests.ok((select count(*) from public.friend_requests) = 0, 'outsider cannot see others requests');
select set_config('request.jwt.claims', :'c1', false);
select tests.ok((select relation from public.search_users('mashka') limit 1) = 'incoming', 'relation incoming');
select public.respond_friend_request((select id from public.friend_requests where to_id = :'U1' and status = 'pending'), true);
select tests.ok(tests.friends(:'U1', :'U2'), 'friends after accept');
select tests.ok((select count(*) from public.my_friends()) = 1, 'my_friends');
-- встречные заявки объединяются
select set_config('request.jwt.claims', :'c4', false);
select public.send_friend_request(:'U1');
select set_config('request.jwt.claims', :'c1', false);
select tests.ok(public.send_friend_request(:'U4') = 'accepted', 'mutual requests merge');
select public.remove_friend(:'U4');
select tests.ok(not tests.friends(:'U1', :'U4'), 'remove friend');
-- отказ -> пауза
select set_config('request.jwt.claims', :'c4', false);
select public.send_friend_request(:'U1');
select set_config('request.jwt.claims', :'c1', false);
select public.respond_friend_request((select id from public.friend_requests where from_id = :'U4' and status = 'pending'), false);
select set_config('request.jwt.claims', :'c4', false);
select tests.expect_error(format('select public.send_friend_request(%L)', :'U1'), 'try_later');
select tests.expect_error(format('select public.send_friend_request(%L)', :'U5'), 'requests_closed');
-- блокировка: невидимость и запрет заявок без раскрытия
select set_config('request.jwt.claims', :'c1', false);
select public.block_user(:'U4');
select set_config('request.jwt.claims', :'c4', false);
select tests.ok(not exists (select 1 from public.search_users('qusderlol')), 'blocked user cannot find blocker');
reset role; delete from public.rate_limits; delete from public.friend_requests where from_id = :'U4'; set role authenticated;
select tests.expect_error(format('select public.send_friend_request(%L)', :'U1'), 'not_found');
select tests.ok(public.get_profile_card(:'U1') is null, 'blocked user cannot open profile card');

-- ── личные сообщения
select set_config('request.jwt.claims', :'c2', false);
select public.open_dm(:'U1') as th \gset
select public.send_dm(:'th', 'привет, это ЛС') as dm1 \gset
select set_config('request.jwt.claims', :'c1', false);
select tests.ok((select unread from public.dm_threads() where thread_id = :'th') = 1, 'unread dm');
select tests.ok((select (public.social_counts() ->> 'unread_dms')::int) = 1, 'social counts');
select public.mark_dm_read(:'th', :dm1);
select tests.ok((select unread from public.dm_threads() where thread_id = :'th') = 0, 'dm read');
select tests.expect_error(format('select public.edit_dm(%s, %L)', :dm1, 'hack'), 'forbidden');
select set_config('request.jwt.claims', :'c3', false);
select tests.ok(not exists (select 1 from public.direct_messages), 'outsider cannot read dms');
select tests.expect_error(format('select public.send_dm(%L, %L)', :'th', 'x'), 'not_found');
select tests.expect_error(format('select public.open_dm(%L)', :'U1'), 'friends_only');
select set_config('request.jwt.claims', :'c2', false);
select public.remove_friend(:'U1');
select tests.expect_error(format('select public.send_dm(%L, %L)', :'th', 'после удаления'), 'friends_only');

-- ── лента знакомств
select set_config('request.jwt.claims', :'c3', false);
select tests.expect_error('select * from public.discovery_deck()', 'discovery_disabled');
update public.profile_social set discoverable = true, interests = array['музыка','игры'] where user_id = :'U3';
select set_config('request.jwt.claims', :'c5', false);
update public.profile_social set discoverable = true where user_id = :'U5';
select set_config('request.jwt.claims', :'c2', false);
update public.profile_social set discoverable = true, interests = array['Музыка'] where user_id = :'U2';
select tests.ok((select count(*) from public.discovery_deck()) = 2, 'deck shows only opted-in people');
select tests.ok((select shared_interests from public.discovery_deck() where id = :'U3') = 1, 'shared interests case-insensitive');
select tests.ok(public.discovery_swipe(:'U3', true) = 'requested', 'like sends request, not instant friendship');
select tests.ok(not tests.friends(:'U2', :'U3'), 'swipe does not add friend');
select tests.ok(public.discovery_swipe(:'U5', true) = 'liked', 'closed requests: like recorded only');
select tests.ok((select count(*) from public.discovery_deck()) = 0, 'swiped people leave the deck');
select tests.expect_error(format('select public.discovery_swipe(%L, true)', :'U1'), 'not_found');
select set_config('request.jwt.claims', :'c3', false);
select tests.ok((select count(*) from public.friend_requests where to_id = :'U3' and source = 'discovery' and status = 'pending') = 1, 'discovery request visible to target');
select public.respond_friend_request((select id from public.friend_requests where to_id = :'U3' and status = 'pending'), true);
select tests.ok(tests.friends(:'U2', :'U3'), 'friends after accepting discovery request');
select tests.expect_error('select * from public.user_reports', 'permission denied');
select public.report_user(:'U5', 'spam', 'test', 'discovery');

-- ── оформление профиля
select public.update_profile_style('{"banner_style":"waves","avatar_frame":"leaf","pronouns":"он/его","profile_emoji":"🌱"}');
select tests.ok((select avatar_frame = 'leaf' and banner_style = 'waves' from public.profiles where id = :'U3'), 'profile style saved');
select tests.expect_error($$select public.update_profile_style('{"banner_style":"evil"}')$$, 'check constraint');
select set_config('request.jwt.claims', :'c2', false);
select tests.ok((public.get_profile_card(:'U3') ->> 'relation') = 'friend' and (public.get_profile_card(:'U3') ->> 'avatar_frame') = 'leaf', 'profile card has relation + style');
reset role;
