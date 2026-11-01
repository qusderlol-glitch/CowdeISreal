-- Поиск не должен падать на враждебном вводе
insert into auth.users (id, email, raw_user_meta_data) values ('e0000000-0000-0000-0000-00000000000e', 'eve@x', '{"handle":"eve"}');
set role authenticated; select set_config('request.jwt.claims', '{"sub":"e0000000-0000-0000-0000-00000000000e"}', false);
select public.create_community('Fuzz') as fc \gset
select id as fch from public.channels where community_id = :'fc' and name = 'общий' \gset
select public.send_message(:'fch', 'c++ и привет-мир, tõõ äö «кавычки»');
do $$ declare q text; n int; c uuid := (select id from public.communities where name = 'Fuzz'); begin
  foreach q in array array['a-b', 'c++', 'привет, мир', '%', '--', '''', '\', '&|!', ':*', '<->', 'a & !b', ' ', '', '((', 'tõõ', 'привет-мир', repeat('x', 500), E'line\nbreak'] loop
    select count(*) into n from public.search_messages(c, q);
  end loop;
  select count(*) into n from public.search_messages(c, 'привет');
  if n < 1 then raise exception 'cyrillic search failed'; end if;
  select count(*) into n from public.search_messages(c, 'tõõ');
  if n < 1 then raise exception 'estonian search failed'; end if;
end $$;
reset role;
