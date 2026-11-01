import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import { q, rpc, supabase } from '../lib/supabase';
import type { DeckCard, ProfileSocial } from '../lib/types';
import { useSession } from '../state/session';
import { useSocial } from '../state/social';
import { useToast } from '../state/toast';
import { Empty, ErrorBox, Field, Icon, Spinner, Toggle } from './ui';
import ProfileBanner from './ProfileBanner';

export const LOOKING_FOR: [string, string][] = [['chat', 'Пообщаться'], ['games', 'Игры'], ['voice', 'Созвоны'], ['study', 'Учёба'], ['music', 'Музыка'], ['creative', 'Творчество'], ['sport', 'Спорт'], ['tech', 'Технологии']];
const LF = Object.fromEntries(LOOKING_FOR);

// «Знакомства»: колода карточек людей, которые сами включили анкету. Вправо — заявка в друзья, влево — пропустить.
export default function DiscoverView() {
  const { uid } = useSession();
  const [social, setSocial] = useState<ProfileSocial | null>(null);
  const [editing, setEditing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => {
    q<ProfileSocial>(supabase.from('profile_social').select('*').eq('user_id', uid!).single()).then(setSocial).catch((e) => setErr(e.message));
  }, [uid]);
  useEffect(load, [load]);
  if (err) return <main className="main discover-main"><ErrorBox error={err} onRetry={load} /></main>;
  if (!social) return <main className="main discover-main"><Spinner /></main>;
  return (
    <main className="main discover-main">
      {!social.discoverable || editing
        ? <DiscoverySetup social={social} onSaved={(s) => { setSocial(s); setEditing(false); }} onCancel={social.discoverable ? () => setEditing(false) : undefined} />
        : <Deck onEdit={() => setEditing(true)} />}
    </main>
  );
}

function DiscoverySetup({ social, onSaved, onCancel }: { social: ProfileSocial; onSaved: (s: ProfileSocial) => void; onCancel?: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ discovery_bio: social.discovery_bio, interests: social.interests, looking_for: social.looking_for, discoverable: social.discoverable || !onCancel });
  const [tag, setTag] = useState('');
  const addTag = () => { const t = tag.trim().slice(0, 24); if (t && f.interests.length < 8 && !f.interests.includes(t)) setF({ ...f, interests: [...f.interests, t] }); setTag(''); };
  const save = async () => {
    try {
      const r = await q<ProfileSocial[]>(supabase.from('profile_social').update({ ...f, updated_at: new Date().toISOString() }).eq('user_id', social.user_id).select());
      onSaved(r?.[0] ?? { ...social, ...f }); toast.push(f.discoverable ? 'Анкета в ленте' : 'Вы скрыты из ленты', 'ok');
    } catch (e) { toast.fail(e); }
  };
  return (
    <div className="discover-setup">
      <h1>Знакомства</h1>
      <p className="lead">Находите людей для общения, игр и созвонов. Это поиск друзей, а не свиданий.</p>
      <ul className="safety">
        <li>Вы видите ленту, только пока сами в ней. Выключить можно в любой момент.</li>
        <li>Свайп вправо — это заявка в друзья. Дружба начнётся, только когда человек её примет.</li>
        <li>Писать можно лишь друзьям. Местоположение не используется.</li>
        <li>Не делитесь адресом, телефоном и школой. Подозрительное — кнопка «Пожаловаться».</li>
      </ul>
      <Field label="О себе для ленты" hint={`${f.discovery_bio.length}/200`}><textarea maxLength={200} value={f.discovery_bio} onChange={(e) => setF({ ...f, discovery_bio: e.target.value })} placeholder="Что любите, во что играете, о чём поговорить" /></Field>
      <Field label="Интересы (до 8)">
        <div className="tag-input">{f.interests.map((t) => <span key={t} className="chip">{t}<button onClick={() => setF({ ...f, interests: f.interests.filter((x) => x !== t) })} aria-label={`Убрать ${t}`}><Icon name="x" size={12} /></button></span>)}
          <input value={tag} maxLength={24} onChange={(e) => setTag(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(); } }} placeholder="Добавить и Enter" disabled={f.interests.length >= 8} /></div>
      </Field>
      <Field label="Ищу">
        <div className="check-grid">{LOOKING_FOR.map(([k, l]) => <label key={k}><input type="checkbox" checked={f.looking_for.includes(k)} onChange={(e) => setF({ ...f, looking_for: e.target.checked ? [...f.looking_for, k] : f.looking_for.filter((x) => x !== k) })} />{l}</label>)}</div>
      </Field>
      <Toggle label="Показывать мою анкету в ленте" hint="Выключите — и вы сразу исчезнете из ленты у других" checked={f.discoverable} onChange={(v) => setF({ ...f, discoverable: v })} />
      <div className="row"><button className="btn primary" onClick={save}>{f.discoverable ? 'Сохранить и смотреть ленту' : 'Сохранить'}</button>{onCancel && <button className="btn ghost" onClick={onCancel}>Отмена</button>}</div>
    </div>
  );
}

function Deck({ onEdit }: { onEdit: () => void }) {
  const toast = useToast();
  const { refresh } = useSocial();
  const [cards, setCards] = useState<DeckCard[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [dx, setDx] = useState(0);
  const [leaving, setLeaving] = useState<null | 'left' | 'right'>(null);
  const start = useRef<number | null>(null);

  const load = useCallback(() => { setErr(null); rpc<DeckCard[]>('discovery_deck', { p_limit: 15 }).then(setCards).catch((e) => setErr(e.message)); }, []);
  useEffect(load, [load]);
  const top = cards?.[0];

  const decide = useCallback(async (like: boolean) => {
    if (!top || leaving) return;
    setLeaving(like ? 'right' : 'left');
    try {
      const r = await rpc<string>('discovery_swipe', { p_target: top.id, p_like: like });
      if (r === 'match') toast.push(`Вы оба хотели дружить — теперь вы с ${top.display_name} друзья!`, 'ok');
      else if (r === 'requested') toast.push(`Заявка отправлена. Дружба начнётся, когда ${top.display_name} её примет.`, 'ok');
      else if (r === 'liked') toast.push('Этот человек сейчас не принимает заявки.', 'info');
      refresh();
    } catch (e) { toast.fail(e); }
    setTimeout(() => { setCards((c) => c?.slice(1) ?? c); setLeaving(null); setDx(0); }, 220);
  }, [top, leaving, toast, refresh]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input,textarea,select')) return;
      if (e.key === 'ArrowRight') void decide(true); if (e.key === 'ArrowLeft') void decide(false);
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [decide]);

  const down = (e: PointerEvent) => { start.current = e.clientX; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); };
  const move = (e: PointerEvent) => { if (start.current !== null) setDx(e.clientX - start.current); };
  const up = () => { if (start.current === null) return; start.current = null; if (dx > 110) void decide(true); else if (dx < -110) void decide(false); else setDx(0); };

  return (
    <div className="deck-wrap">
      <header className="deck-head"><h1>Знакомства</h1><button className="btn small" onClick={onEdit}><Icon name="edit" size={14} /> Моя анкета</button></header>
      {err ? <ErrorBox error={err} onRetry={load} /> : !cards ? <Spinner /> : !top ? (
        <Empty icon="compass" title="Пока никого нового">Загляните позже — люди включают анкеты постоянно. <button className="btn small" onClick={load}>Обновить</button></Empty>
      ) : (
        <>
          <div className="deck">
            {cards.slice(1, 3).reverse().map((c, i) => <div key={c.id} className="deck-card behind" style={{ transform: `scale(${0.94 + i * 0.03}) translateY(${(1 - i) * 14}px)` }} aria-hidden="true" />)}
            <article className={`deck-card ${leaving ?? ''}`} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
              style={leaving ? undefined : { transform: `translateX(${dx}px) rotate(${dx / 18}deg)` }} aria-label={`Анкета ${top.display_name}`}>
              {dx > 40 && <span className="stamp yes">Дружим</span>}{dx < -40 && <span className="stamp no">Пропустить</span>}
              <ProfileBanner p={top} size={96} />
              <div className="deck-body">
                {top.discovery_bio && <p className="deck-bio">{top.discovery_bio}</p>}
                {top.interests.length > 0 && <div className="chips">{top.interests.map((t) => <span key={t} className="chip">{t}</span>)}</div>}
                {top.looking_for.length > 0 && <p className="muted small">Ищет: {top.looking_for.map((k) => LF[k] ?? k).join(', ')}</p>}
                <p className="muted small">{top.shared_interests ? `Общих интересов: ${top.shared_interests}` : 'Общих интересов пока нет'}{top.mutual_friends ? ` · общих друзей: ${top.mutual_friends}` : ''}</p>
              </div>
            </article>
          </div>
          <div className="deck-actions">
            <button className="round-btn no" onClick={() => decide(false)} aria-label="Пропустить (стрелка влево)"><Icon name="x" size={28} /></button>
            <button className="round-btn flag" onClick={async () => { try { await rpc('report_user', { p_user: top.id, p_reason: 'inappropriate', p_details: '', p_context: 'discovery' }); toast.push('Жалоба отправлена', 'ok'); void decide(false); } catch (e) { toast.fail(e); } }} aria-label="Пожаловаться"><Icon name="flag" size={20} /></button>
            <button className="round-btn yes" onClick={() => decide(true)} aria-label="Добавить в друзья (стрелка вправо)"><Icon name="heart" size={28} /></button>
          </div>
          <p className="muted small center">Перетащите карточку или используйте ← и →</p>
        </>
      )}
    </div>
  );
}
