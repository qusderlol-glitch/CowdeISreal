import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { humanError } from '../lib/errors';
import { useSession } from '../state/session';
import { Field, Spinner } from '../components/ui';

export default function ResetPasswordPage() {
  const { session, loading } = useSession();
  const nav = useNavigate();
  const [pw, setPw] = useState(''); const [pw2, setPw2] = useState('');
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  if (loading) return <div className="center-screen"><Spinner /></div>;
  if (!session) return <main className="auth"><section className="auth-card"><h1>Ссылка недействительна</h1><p className="muted">Ссылка для сброса устарела или уже использована. Запросите новую на странице входа.</p><a className="btn" href="/login">Ко входу</a></section></main>;
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    if (pw !== pw2) { setErr('Пароли не совпадают.'); return; }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) setErr(humanError(error)); else nav('/app');
  };
  return (
    <main className="auth"><section className="auth-card">
      <h1>Новый пароль</h1>
      <form onSubmit={submit} className="stack">
        <Field label="Пароль"><input type="password" minLength={8} required value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /></Field>
        <Field label="Повторите"><input type="password" minLength={8} required value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" /></Field>
        {err && <div className="error-box">{err}</div>}
        <button className="btn primary" disabled={busy}>Сохранить</button>
      </form>
    </section></main>
  );
}
