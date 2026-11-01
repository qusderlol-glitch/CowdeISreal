-- PostgREST (Supabase) выполняет STABLE/IMMUTABLE функции в транзакции «только для чтения».
-- Любая запись внутри такой функции падает с «cannot execute INSERT in a read-only transaction».
-- Проверяем: ни одна STABLE/IMMUTABLE функция в public не пишет напрямую и не вызывает пишущие функции.
do $$ declare bad text;
begin
  with recursive writers as (
    -- функции, которые пишут сами
    select p.oid, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosrc ~* '\m(insert\s+into|update\s+public\.|delete\s+from)\M'
    union
    -- и все, кто вызывает пишущие (транзитивно)
    select p.oid, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      join writers w on p.prosrc ~* ('\m(public\.)?' || w.proname || '\s*\(')
     where n.nspname = 'public' and p.oid <> w.oid
  )
  select string_agg(distinct w.proname, ', ') into bad
    from writers w join pg_proc p on p.oid = w.oid
   where p.provolatile in ('s', 'i') and p.prokind = 'f';
  if bad is not null then raise exception 'STABLE/IMMUTABLE функции пишут в базу (сломаются в Supabase): %', bad; end if;
end $$;
