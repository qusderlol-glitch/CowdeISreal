-- CowdeISreal: исправление «cannot execute INSERT in a read-only transaction» при поиске людей.
-- Причина: search_users была помечена STABLE, а Supabase (PostgREST) выполняет такие функции в транзакции
-- только для чтения; внутри же функция записывает счётчик защиты от частых запросов.
-- Запуск: SQL Editor -> вставить файл -> Run. Повторный запуск безопасен.
alter function public.search_users(text) volatile;
notify pgrst, 'reload schema';
