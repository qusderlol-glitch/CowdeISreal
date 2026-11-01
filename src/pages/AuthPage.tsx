import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { humanError } from '../lib/errors';
import { BRAND } from '../lib/brand';
import { useSession } from '../state/session';
import { Field, Icon } from '../components/ui';

// Шаги: вход → регистрация → ввод кода из письма; «забыли пароль» → код → новый пароль.
type Mode = 'login' | 'register' | 'verify' | 'forgot' | 'recover';
const CODE_RE = /^\d{6,10}$/;

function authError(err: unknown): string {
  const t = humanError(err);
  if (/Invalid login/i.test(t)) return 'Неверная почта или пароль.';
  if (/Email not confirmed/i.test(t)) return 'Почта не подтверждена. Введите код из письма.';
  if (/expired|invalid.*(otp|token)|Token has expired/i.test(t)) return 'Код неверный или устарел. Запросите новый.';
  if (/already registered|already exists/i.test(t)) return 'Этот адрес уже зарегистрирован. Войдите или восстановите пароль.';
  if (/rate limit|too many|security purposes/i.test(t)) return 'Слишком много попыток. Подождите минуту и попробуйте снова.';
  if (/Password should/i.test(t)) return 'Пароль слишком простой: минимум 8 символов.';
  return t;
}

export default function AuthPage() {
  const { session } = useSession();
  const [params] = useSearchParams();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [handle, setHandle] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const next = params.get('next') || '/app';

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  // при сбросе пароля сессия появляется после ввода кода — тогда не уводим со страницы
  if (session && mode !== 'recover') return <Navigate to={next.startsWith('/') ? next : '/app'} replace />;

  const go = (m: Mode) => { setMode(m); setMsg(null); setCode(''); };

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setMsg(null);
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          if (/Email not confirmed/i.test(error.message)) {
            await supabase.auth.resend({ type: 'signup', email });
            setMode('verify'); setCooldown(60);
            setMsg({ kind: 'ok', text: `Почта ещё не подтверждена. Мы отправили новый код на ${email}.` });
            return;
          }
          throw error;
        }
      } else if (mode === 'register') {
        if (!/^[a-z0-9_.]{3,32}$/.test(handle)) throw new Error('invalid_handle');
        const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { handle, display_name: name || handle } } });
        if (error) throw error;
        // Supabase не раскрывает, занят ли адрес: в этом случае identities пустой
        if (data.user && data.user.identities?.length === 0) throw new Error('already registered');
        if (!data.session) { setMode('verify'); setCooldown(60); setMsg({ kind: 'ok', text: `Мы отправили код подтверждения на ${email}.` }); }
      } else if (mode === 'verify') {
        if (!CODE_RE.test(code)) throw new Error('Введите цифры из письма.');
        const { error } = await supabase.auth.verifyOtp({ email, token: code, type: 'email' });
        if (error) throw error;
      } else if (mode === 'forgot') {
        const { error } = await supabase.auth.resetPasswordForEmail(email);
        if (error) throw error;
        setMode('recover'); setCooldown(60);
        setMsg({ kind: 'ok', text: `Если аккаунт с адресом ${email} существует, мы отправили на него код.` });
      } else if (mode === 'recover') {
        if (!CODE_RE.test(code)) throw new Error('Введите цифры из письма.');
        if (password.length < 8) throw new Error('Пароль слишком простой: минимум 8 символов.');
        const { error } = await supabase.auth.verifyOtp({ email, token: code, type: 'recovery' });
        if (error) throw error;
        const { error: e2 } = await supabase.auth.updateUser({ password });
        if (e2) throw e2;
        setMode('login'); // сессия уже есть → редирект в приложение
      }
    } catch (err) {
      setMsg({ kind: 'error', text: authError(err) });
    } finally { setBusy(false); }
  };

  const resend = async () => {
    setMsg(null);
    const { error } = mode === 'verify' ? await supabase.auth.resend({ type: 'signup', email }) : await supabase.auth.resetPasswordForEmail(email);
    if (error) setMsg({ kind: 'error', text: authError(error) });
    else { setCooldown(60); setMsg({ kind: 'ok', text: 'Новый код отправлен. Старый больше не действует.' }); }
  };

  const codeStep = mode === 'verify' || mode === 'recover';
  const title = { login: 'С возвращением', register: 'Новый аккаунт', verify: 'Подтвердите почту', forgot: 'Восстановление доступа', recover: 'Новый пароль' }[mode];

  return (
    <main className="auth">
      <section className="auth-hero" aria-hidden="true">
        <div className="brand-row"><Icon name="sprout" size={34} /><span>{BRAND.name}</span></div>
        <h1>Место, где растут сообщества.</h1>
        <p>{BRAND.tagline}</p>
        <ul className="hero-points"><li>Комнаты для разговоров и звонков</li><li>Роли и права без подписок</li><li>Ранги за живое участие, а не за флуд</li></ul>
      </section>
      <section className="auth-card">
        <h2>{title}</h2>
        {!codeStep && mode !== 'forgot' && (
          <div className="tabs" role="tablist">
            {(['login', 'register'] as const).map((m) => (
              <button key={m} role="tab" aria-selected={mode === m} className={mode === m ? 'active' : ''} onClick={() => go(m)}>
                {m === 'login' ? 'Вход' : 'Регистрация'}
              </button>
            ))}
          </div>
        )}
        <form onSubmit={submit} className="stack">
          {!codeStep && <Field label="Почта"><input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value.trim())} /></Field>}
          {codeStep && <p className="muted">Код отправлен на <b>{email}</b>. Проверьте папку «Спам», если письма нет.</p>}
          {codeStep && (
            <Field label="Код из письма">
              <input className="code-input" inputMode="numeric" autoComplete="one-time-code" required maxLength={10} value={code} autoFocus
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} placeholder="••••••" />
            </Field>
          )}
          {(mode === 'login' || mode === 'register' || mode === 'recover') && (
            <Field label={mode === 'recover' ? 'Новый пароль' : 'Пароль'} hint={mode !== 'login' ? 'Не короче 8 символов' : undefined}>
              <input type="password" required minLength={mode === 'login' ? 1 : 8} autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
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
            {busy ? 'Подождите…' : { login: 'Войти', register: 'Получить код', verify: 'Подтвердить', forgot: 'Получить код', recover: 'Сохранить пароль' }[mode]}
          </button>
        </form>
        {codeStep && (
          <div className="row between">
            <button className="link-btn" onClick={resend} disabled={cooldown > 0}>{cooldown > 0 ? `Отправить ещё раз через ${cooldown} с` : 'Отправить код ещё раз'}</button>
            <button className="link-btn" onClick={() => go(mode === 'verify' ? 'register' : 'login')}>Изменить почту</button>
          </div>
        )}
        {mode === 'login' && <button className="link-btn" onClick={() => go('forgot')}>Забыли пароль?</button>}
        {mode === 'forgot' && <button className="link-btn" onClick={() => go('login')}>Назад ко входу</button>}
        <p className="fine">Базовые функции бесплатны для участников: сообщества, комнаты, роли, звонки, оформление и ранги.</p>
      </section>
    </main>
  );
}
