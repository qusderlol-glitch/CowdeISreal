import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { publicMediaUrl, rpc } from '../lib/supabase';
import { ErrorBox, Icon, Spinner } from '../components/ui';

interface Preview { valid: boolean; reason: string | null; community_id?: string; name?: string; description?: string; icon_path?: string | null; member_count?: number; already_member?: boolean }
const REASONS: Record<string, string> = { not_found: 'Приглашение не найдено.', revoked: 'Приглашение отозвано.', expired: 'Срок приглашения истёк.', used_up: 'Лимит использований исчерпан.', banned: 'Вы заблокированы в этом сообществе.' };

export default function InvitePage() {
  const { code = '' } = useParams();
  const nav = useNavigate();
  const [p, setP] = useState<Preview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { rpc<Preview>('preview_invite', { p_code: code }).then(setP).catch((e) => setErr(e.message)); }, [code]);
  const join = async () => {
    setBusy(true);
    try { const cid = await rpc<string>('join_by_invite', { p_code: code }); nav(`/app/${cid}`); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <main className="auth"><section className="auth-card center">
      {!p && !err && <Spinner />}
      {err && <ErrorBox error={err} />}
      {p && (p.valid || p.already_member ? (
        <>
          <div className="invite-icon">{p.icon_path ? <img src={publicMediaUrl(p.icon_path)!} alt="" /> : <Icon name="sprout" size={40} />}</div>
          <p className="muted">Вас пригласили в сообщество</p>
          <h1>{p.name}</h1>
          {p.description && <p>{p.description}</p>}
          <p className="muted">{p.member_count} участн.</p>
          <button className="btn primary" disabled={busy} onClick={() => (p.already_member ? nav(`/app/${p.community_id}`) : join())}>
            {p.already_member ? 'Открыть' : busy ? 'Вступаем…' : 'Вступить'}
          </button>
        </>
      ) : <><h1>Не получится вступить</h1><p>{REASONS[p.reason ?? ''] ?? 'Приглашение недействительно.'}</p><a className="btn" href="/app">На главную</a></>)}
    </section></main>
  );
}
