import { useState, type FormEvent } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { humanError } from '../lib/errors';
import { BRAND } from '../lib/brand';
import { useSession } from '../state/session';
import { Field, Icon } from '../components/ui';

type Mode = 'login' | 'register' | 'forgot';

export default function AuthPage() {
  const { session } = useSession();
  const [params] = useSearchParams();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [handle, setHandle] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const next = params.get('next') || '/app';
  if (session) return <Navigate to={next.startsWith('/') ? next : '/app'} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setMsg(null);
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else if (mode === 'register') {
        if (!/^[a-z0-9_.]{3,32}$/.test(handle)) throw new Error('invalid_handle');
        const { data, error } = await supabase.auth.signUp({
          email, password,
          options: { data: { handle, display_name: name || handle }, emailRedirectTo: `${location.origin}/app` },
        });
        if (error) throw error;
        if (!data.session) setMsg({ kind: 'ok', text: 'Проверьте почту: мы отправили ссылку для подтверждения адреса.' });
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/reset-password` });
        if (error) throw error;
        setMsg({ kind: 'ok', text: 'Если аккаунт существует, письмо со ссылкой для сброса уже отправлено.' });
      }
    } catch (err) {
      const t = humanError(err);
      setMsg({ kind: 'error', text: /Invalid login/i.test(t) ? 'Неверная почта или пароль.' : /Email not confirmed/i.test(t) ? 'Почта не подтверждена. Проверьте входящие.' : t });
    } finally { setBusy(false); }
  };

  return (
    <main className="auth">
      <section className="auth-card">
        <div className="brand-row"><Icon name="sprout" size={30} /><h1>{BRAND.name}</h1></div>
        <p className="muted">{BRAND.tagline}</p>
        <div className="tabs" role="tablist">
          {(['login', 'register'] as const).map((m) => (
            <button key={m} role="tab" aria-selected={mode === m} className={mode === m ? 'active' : ''} onClick={() => { setMode(m); setMsg(null); }}>
              {m === 'login' ? 'Вход' : 'Регистрация'}
            </button>
          ))}
        </div>
        <form onSubmit={submit} className="stack">
          <Field label="Почта"><input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          {mode !== 'forgot' && (
            <Field label="Пароль" hint={mode === 'register' ? 'Не короче 8 символов' : undefined}>
              <input type="password" required minLength={mode === 'register' ? 8 : 1} autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
          )}
          {mode === 'register' && <>
            <Field label="Handle (уникальное имя)" hint="латиница в нижнем регистре, цифры, _ и точка">
              <input required value={handle} onChange={(e) => setHandle(e.target.value.toLowerCase())} pattern="[a-z0-9_.]{3,32}" autoComplete="username" />
            </Field>
            <Field label="Отображаемое имя"><input maxLength={40} value={name} onChange={(e) => setName(e.target.value)} /></Field>
          </>}
          {msg && <div className={msg.kind === 'ok' ? 'ok-box' : 'error-box'} role="status">{msg.text}</div>}
          <button className="btn primary" disabled={busy}>
            {busy ? 'Подождите…' : mode === 'login' ? 'Войти' : mode === 'register' ? 'Создать аккаунт' : 'Отправить ссылку'}
          </button>
        </form>
        {mode === 'login' && <button className="link-btn" onClick={() => setMode('forgot')}>Забыли пароль?</button>}
        {mode === 'forgot' && <button className="link-btn" onClick={() => setMode('login')}>Назад ко входу</button>}
        <p className="fine">Базовые функции бесплатны для участников: сообщества, каналы, роли, звонки, оформление и ранги.</p>
      </section>
    </main>
  );
}
