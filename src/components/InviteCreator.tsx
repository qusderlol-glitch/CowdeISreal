import { useState } from 'react';
import { rpc } from '../lib/supabase';
import { useToast } from '../state/toast';
import { Field, Icon } from './ui';
import { appUrl } from '../lib/brand';

const EXPIRY = [
  { v: 1800, l: '30 минут' }, { v: 3600, l: '1 час' }, { v: 86400, l: '1 день' }, { v: 604800, l: '7 дней' }, { v: 2592000, l: '30 дней' }, { v: 0, l: 'Бессрочно' },
];
export function inviteUrl(code: string) { return appUrl(`/invite/${code}`); }

export default function InviteCreator({ cid, onCreated }: { cid: string; onCreated?: () => void }) {
  const toast = useToast();
  const [exp, setExp] = useState(604800);
  const [uses, setUses] = useState(0);
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    try {
      const c = await rpc<string>('create_invite', { p_community: cid, p_expires_seconds: exp || null, p_max_uses: uses || null });
      setCode(c); onCreated?.();
    } catch (e) { toast.fail(e); } finally { setBusy(false); }
  };
  const copy = async () => { if (code) { await navigator.clipboard.writeText(inviteUrl(code)).catch(() => {}); toast.push('Ссылка скопирована', 'ok'); } };
  return (
    <div className="stack">
      <div className="row wrap">
        <Field label="Срок действия"><select value={exp} onChange={(e) => setExp(Number(e.target.value))}>{EXPIRY.map((x) => <option key={x.v} value={x.v}>{x.l}</option>)}</select></Field>
        <Field label="Лимит использований"><select value={uses} onChange={(e) => setUses(Number(e.target.value))}>
          {[0, 1, 5, 10, 25, 100].map((n) => <option key={n} value={n}>{n || 'Без лимита'}</option>)}
        </select></Field>
      </div>
      <button className="btn primary" onClick={create} disabled={busy}><Icon name="link" /> Создать ссылку</button>
      {code && <div className="copy-row"><input readOnly value={inviteUrl(code)} onFocus={(e) => e.target.select()} /><button className="btn" onClick={copy}>Копировать</button></div>}
    </div>
  );
}
