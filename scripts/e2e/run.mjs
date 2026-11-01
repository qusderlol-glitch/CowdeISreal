// E2E-сценарий в настоящем Chromium поверх стенда (Postgres + RLS). Запуск: bash scripts/e2e.sh
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { Stand } from './stand.mjs';
import { mkdirSync } from 'node:fs';

const BASE = process.env.E2E_BASE;
const BASE_UNCONFIGURED = process.env.E2E_BASE_UNCONFIGURED;
const SHOTS = process.env.E2E_SHOTS || 'e2e-shots';
mkdirSync(SHOTS, { recursive: true });
const stand = new Stand(process.env.E2E_DB);
await stand.init();
const log = []; stand.log = (l) => log.push(l);

const browser = await chromium.launch();
const pageErrors = [];
const pages = [];
let step = 0;
const ok = (msg) => console.log(`  ✓ ${++step}. ${msg}`);

async function ctx(viewport = { width: 1366, height: 860 }) {
  const c = await browser.newContext({ viewport });
  await c.route('http://stand.test/**', (r) => stand.handle(r));
  await c.routeWebSocket(/stand\.test/, (ws) => ws.close()); // Realtime в стенде отсутствует
  const p = await c.newPage();
  pages.push(p);
  p.on('console', (m) => { if (m.type() === 'error' && !/WebSocket|realtime|ERR_|Failed to load resource/.test(m.text())) pageErrors.push(`console: ${m.text()}`); });
  p.on('pageerror', (e) => pageErrors.push(`${e.message}`));
  return p;
}
async function register(p, email, handle, name) {
  await p.goto(`${BASE}/app`);
  await p.waitForURL('**/login**');
  await p.getByRole('tab', { name: 'Регистрация' }).click();
  await p.getByLabel('Почта').fill(email);
  await p.getByLabel('Пароль').fill('correct-horse-1');
  await p.getByLabel('Handle (уникальное имя)').fill(handle);
  await p.getByLabel('Отображаемое имя').fill(name);
  await p.getByRole('button', { name: 'Создать аккаунт' }).click();
  await p.waitForURL(/\/app$/);
}
const composer = (p) => p.getByLabel('Текст сообщения');
async function send(p, text) { await composer(p).fill(text); await composer(p).press('Enter'); }
const expectText = async (p, text, timeout = 8000) => p.getByText(text).first().waitFor({ timeout });

try {
  // 0. Без настроек — честный экран настройки
  {
    const p = await ctx();
    await p.goto(BASE_UNCONFIGURED);
    await expectText(p, 'Инстанс ещё не подключён к бэкенду');
    await p.screenshot({ path: `${SHOTS}/00-setup.png` });
    ok('без VITE_SUPABASE_* показывается экран настройки, а не фальшивое приложение');
  }

  // 1. Алиса: регистрация, создание сообщества, сообщения
  const a = await ctx();
  await register(a, 'alice@example.com', 'alice', 'Алиса');
  await expectText(a, 'Добро пожаловать');
  ok('регистрация → вход → пустое состояние главной');
  await a.locator('.main').getByRole('button', { name: 'Создать или вступить' }).click();
  await a.getByLabel('Название').fill('Клуб садоводов');
  await a.getByRole('button', { name: 'Создать', exact: true }).click();
  await a.waitForURL(/\/app\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/);
  for (const n of ['объявления', 'общий', 'Общая комната']) await a.getByRole('link', { name: n }).waitFor();
  ok('создание сообщества: роли, категории, текстовые/голосовой/объявления каналы');
  await a.getByRole('link', { name: 'общий' }).click();
  await a.locator('.chat-head h2', { hasText: 'общий' }).waitFor();
  await send(a, 'Привет всем! Это первый тест');
  await expectText(a, 'Привет всем! Это первый тест');
  if (await a.getByText('Не отправлено').count()) throw new Error('message failed');
  ok('отправка сообщения через RPC send_message');
  await send(a, '/roll 2d6');
  await a.waitForTimeout(500);
  await a.reload();
  await expectText(a, /🎲 2d6: \d+ \+ \d+ = \d+/);
  await expectText(a, 'пример');
  ok('команда /roll исполнена на сервере, ответ бота помечен как «пример»');
  await expectText(a, 'Обновления в реальном времени недоступны', 15000);
  ok('без Realtime UI честно сообщает, что живые обновления недоступны');
  await a.screenshot({ path: `${SHOTS}/01-chat.png` });

  // приглашение
  await a.locator('.side-title').click();
  await a.getByRole('button', { name: 'Пригласить' }).click();
  await a.getByRole('button', { name: 'Создать ссылку' }).click();
  const invite = await a.locator('.copy-row input').inputValue();
  if (!/\/invite\/[0-9a-f]{10}$/.test(invite)) throw new Error(`bad invite ${invite}`);
  await a.keyboard.press('Escape');
  ok(`приглашение создано: ${invite.replace(BASE, '')}`);

  // роли и журнал
  await a.locator('.side-title').click();
  await a.getByRole('button', { name: 'Настройки сообщества' }).click();
  await a.getByRole('button', { name: 'Роли' }).click();
  await a.getByRole('button', { name: 'Создать роль' }).click();
  await expectText(a, 'Новая роль');
  await a.getByRole('button', { name: 'Журнал' }).click();
  await expectText(a, 'создал(а) роль');
  await a.getByRole('button', { name: 'Ресурсы и расходы' }).click();
  await expectText(a, 'Для участников всё бесплатно');
  await a.screenshot({ path: `${SHOTS}/02-settings.png` });
  await a.keyboard.press('Escape');
  ok('роль создана, действие записано в журнал аудита, раздел расходов доступен');

  // 2. Боб: регистрация по приглашению
  const b = await ctx();
  await register(b, 'bob@example.com', 'bob', 'Боб');
  await b.goto(invite);
  await expectText(b, 'Клуб садоводов');
  await b.getByRole('button', { name: 'Вступить' }).click();
  await b.waitForURL(/\/app\/[0-9a-f-]{36}/);
  await b.getByRole('link', { name: 'общий' }).click();
  await b.locator('.chat-head h2', { hasText: 'общий' }).waitFor();
  await expectText(b, 'Привет всем! Это первый тест');
  ok('второй пользователь вступил по ссылке и видит историю');
  await send(b, '@alice привет, это ответ Боба');
  await expectText(b, '@alice');
  await b.getByRole('link', { name: 'объявления' }).click();
  await expectText(b, 'В канал объявлений пишут только модераторы.');
  ok('права: участник не может писать в канал объявлений');
  if (await b.getByRole('button', { name: 'Настройки сообщества' }).count()) throw new Error('settings visible');

  // голос: RPC voice_join проходит, сигнализация без Realtime — понятная ошибка
  await b.getByRole('link', { name: 'Общая комната' }).click();
  await expectText(b, 'Сигнальный канал Realtime недоступен', 20000);
  if (await b.getByRole('toolbar', { name: 'Управление звонком' }).count()) throw new Error('call controls shown after failure');
  await b.getByRole('button', { name: 'Повторить' }).click();
  await b.waitForResponse((r) => r.url().includes('rpc/voice_join'));
  await b.screenshot({ path: `${SHOTS}/03-voice-error.png` });
  ok('голос без Realtime: понятная ошибка, нерабочие кнопки скрыты, «Повторить» снова вызывает voice_join');

  // 3. Алиса видит упоминание и заглушает Боба
  await a.reload();
  await expectText(a, 'привет, это ответ Боба');
  if (!(await a.locator('.msg.mentioned').count())) throw new Error('mention not highlighted');
  ok('упоминание @alice подсвечено у адресата');
  await a.locator('.members').getByText('Боб').click();
  await a.getByText('Модерация').click();
  await a.getByRole('button', { name: 'Заглушить 10 мин' }).click();
  await expectText(a, 'Заглушён на 10 мин');
  await a.keyboard.press('Escape');
  await b.getByRole('link', { name: 'общий' }).click();
  await b.locator('.chat-head h2', { hasText: 'общий' }).waitFor();
  await send(b, 'попробую написать в таймауте');
  await expectText(b, 'Не отправлено: Недостаточно прав.');
  ok('таймаут применён сервером: отправка отклонена, UI показывает причину и «Повторить»');

  // 4. Мобильная раскладка
  const m = await ctx({ width: 390, height: 844 });
  await m.goto(`${BASE}/login`);
  await m.getByLabel('Почта').fill('alice@example.com');
  await m.getByLabel('Пароль').fill('correct-horse-1');
  await m.getByRole('button', { name: 'Войти' }).click();
  await m.waitForURL(/\/app/);
  await m.goto(a.url());
  await expectText(m, 'Привет всем! Это первый тест');
  await m.screenshot({ path: `${SHOTS}/04-mobile.png` });
  await m.getByRole('button', { name: 'Каналы' }).click();
  await m.getByRole('link', { name: 'общий' }).waitFor();
  await m.screenshot({ path: `${SHOTS}/05-mobile-nav.png` });
  ok('мобильная раскладка: чат и отдельная панель каналов');

  // 5. Неверный пароль
  const w = await ctx();
  await w.goto(`${BASE}/login`);
  await w.getByLabel('Почта').fill('alice@example.com');
  await w.getByLabel('Пароль').fill('wrong');
  await w.getByRole('button', { name: 'Войти' }).click();
  await expectText(w, 'Неверная почта или пароль.');
  ok('ошибка входа показана по-русски');

  if (pageErrors.length) throw new Error(`Uncaught page errors:\n${pageErrors.join('\n')}`);
  console.log(`\nE2E OK: ${step} шагов, ${log.length} запросов к стенду, 0 необработанных ошибок страницы`);
} catch (e) {
  console.error('\nE2E FAILED:', e.message);
  for (const [i, p] of pages.entries()) await p.screenshot({ path: `${SHOTS}/fail-${i}.png` }).catch(() => {});
  console.error('Последние запросы стенда:\n' + log.slice(-15).join('\n'));
  if (pageErrors.length) console.error('Ошибки страницы:\n' + pageErrors.join('\n'));
  process.exitCode = 1;
} finally {
  await browser.close();
  await stand.pool.end();
}
