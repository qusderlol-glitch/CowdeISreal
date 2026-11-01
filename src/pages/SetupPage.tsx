import { BRAND } from '../lib/brand';
import { Icon } from '../components/ui';

// Честное состояние: без настроек Supabase приложение не притворяется рабочим.
export default function SetupPage() {
  return (
    <main className="setup">
      <div className="setup-card">
        <div className="brand-row"><Icon name="sprout" size={32} /><h1>{BRAND.name}</h1></div>
        <p className="lead">Инстанс ещё не подключён к бэкенду. Регистрация, сообщества, сообщения и звонки появятся после настройки Supabase.</p>
        <ol className="steps">
          <li>Создайте проект на <b>supabase.com</b> (бесплатный тариф подходит для старта).</li>
          <li>Примените миграцию <code>supabase/migrations/20261101000000_init.sql</code>: <code>supabase db push</code> или SQL Editor → Run.</li>
          <li>Скопируйте <code>.env.example</code> в <code>.env</code> и укажите <code>VITE_SUPABASE_URL</code> и <code>VITE_SUPABASE_ANON_KEY</code> (Project Settings → API).</li>
          <li>Authentication → URL Configuration: добавьте адрес сайта и <code>/reset-password</code> в Redirect URLs.</li>
          <li>Перезапустите <code>npm run dev</code> или пересоберите сайт.</li>
        </ol>
        <p className="muted">Ключ <code>service_role</code> в браузер не нужен и не должен туда попадать. Подробности, лимиты и расходы — в README.</p>
      </div>
    </main>
  );
}
