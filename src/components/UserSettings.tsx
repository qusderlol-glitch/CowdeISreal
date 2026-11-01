import { useEffect, useRef, useState } from 'react';
import { q, rpc, supabase } from '../lib/supabase';
import { humanError } from '../lib/errors';
import type { ProfilePrivate, ProfileSocial, ProfileStyle, Visibility } from '../lib/types';
import { GROUPS, REGISTRY_DEFAULTS, SETTINGS, type Group, type SettingDef, type SettingValue } from '../lib/customize';
import ProfileBanner from './ProfileBanner';
import { useSession } from '../state/session';
import { useToast } from '../state/toast';
import { getMic, levelMeter } from '../lib/rtc/devices';
import { Avatar, Field, Modal, Toggle } from './ui';
import { DevicePicker } from './VoiceView';

type Tab = 'profile' | 'style' | 'privacy' | 'customize' | 'devices' | 'account';
const TABS: [Tab, string][] = [['profile', 'Профиль'], ['style', 'Оформление профиля'], ['privacy', 'Друзья и приватность'],
  ['customize', `Кастомизация · ${SETTINGS.length}`], ['devices', 'Устройства'], ['account', 'Аккаунт']];
const ZONES = (() => { try { return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? ['UTC']; } catch { return ['UTC']; } })();

export default function UserSettings({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('profile');
  return (
    <Modal title="Настройки" onClose={onClose} wide>
      <div className="settings-layout">
        <nav className="settings-nav">{TABS.map(([k, l]) => <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{l}</button>)}</nav>
        <div className="settings-pane">
          {tab === 'profile' && <ProfileTab />}
          {tab === 'style' && <StyleTab />}
          {tab === 'privacy' && <PrivacyTab />}
          {tab === 'customize' && <CustomizeTab />}
          {tab === 'devices' && <DevicesTab />}
          {tab === 'account' && <AccountTab />}
        </div>
      </div>
    </Modal>
  );
}

async function savePriv(uid: string, patch: Partial<ProfilePrivate>) {
  await q(supabase.from('profile_private').update(patch).eq('user_id', uid));
}

function ProfileTab() {
  const { profile, priv, uid, reloadProfile } = useSession(); const toast = useToast();
  const [f, setF] = useState({ display_name: profile?.display_name ?? '', handle: profile?.handle ?? '', bio: priv?.bio ?? '', status_text: priv?.status_text ?? '',
    presence: priv?.presence ?? 'online', timezone: priv?.timezone ?? 'UTC' });
  if (!profile || !uid) return null;
  const save = async () => {
    try {
      await rpc('update_profile', { p: { display_name: f.display_name, handle: f.handle } });
      await savePriv(uid, { bio: f.bio, status_text: f.status_text, presence: f.presence as ProfilePrivate['presence'], timezone: f.timezone });
      await reloadProfile(); toast.push('Профиль сохранён', 'ok');
    } catch (e) { toast.fail(e); }
  };
  const upload = async (file?: File) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024 || !/^image\/(png|jpeg|gif|webp)$/.test(file.type)) { toast.push('Аватар: PNG/JPEG/GIF/WebP до 2 МБ', 'error'); return; }
    const path = `avatars/${uid}/a-${Date.now()}.${file.type.split('/')[1]}`;
    const { error } = await supabase.storage.from('public-media').upload(path, file, { contentType: file.type });
    if (error) { toast.fail(error); return; }
    try {
      await rpc('update_profile', { p: { avatar_path: path } });
      if (profile.avatar_path) await supabase.storage.from('public-media').remove([profile.avatar_path]);
      await reloadProfile(); toast.push('Аватар обновлён', 'ok');
    } catch (e) { toast.fail(e); }
  };
  return (
    <div className="stack">
      <div className="row"><Avatar name={profile.display_name} path={profile.avatar_path} size={72} />
        <label className="btn">Загрузить аватар<input type="file" hidden accept="image/png,image/jpeg,image/gif,image/webp" onChange={(e) => upload(e.target.files?.[0])} /></label>
        <span className="muted small">Аватары публичны по ссылке.</span></div>
      <Field label="Отображаемое имя"><input value={f.display_name} maxLength={40} onChange={(e) => setF({ ...f, display_name: e.target.value })} /></Field>
      <Field label="Handle" hint="Уникален; менять можно до 5 раз в сутки"><input value={f.handle} maxLength={32} onChange={(e) => setF({ ...f, handle: e.target.value.toLowerCase() })} /></Field>
      <Field label="О себе"><textarea value={f.bio} maxLength={300} onChange={(e) => setF({ ...f, bio: e.target.value })} /></Field>
      <div className="row wrap">
        <Field label="Статус"><select value={f.presence} onChange={(e) => setF({ ...f, presence: e.target.value as ProfilePrivate['presence'] })}>
          <option value="online">В сети</option><option value="idle">Отошёл</option><option value="dnd">Не беспокоить</option><option value="invisible">Невидимка</option></select></Field>
        <Field label="Текст статуса"><input value={f.status_text} maxLength={80} onChange={(e) => setF({ ...f, status_text: e.target.value })} /></Field>
      </div>
      <Field label="Часовой пояс"><select value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })}>{ZONES.map((z) => <option key={z}>{z}</option>)}</select></Field>
      <p className="muted small">Аккаунт создан {new Date(profile.created_at).toLocaleDateString('ru-RU')}.</p>
      <button className="btn primary" onClick={save}>Сохранить</button>
    </div>
  );
}

function PrivacyTab() {
  const { priv, uid, reloadProfile } = useSession(); const toast = useToast();
  if (!priv || !uid) return null;
  const sel = (k: keyof ProfilePrivate, label: string) => (
    <Field label={label}><select value={priv[k] as Visibility} onChange={async (e) => {
      try { await savePriv(uid, { [k]: e.target.value } as Partial<ProfilePrivate>); await reloadProfile(); } catch (err) { toast.fail(err); }
    }}><option value="everyone">Все</option><option value="members">Участники общих сообществ</option><option value="nobody">Никто</option></select></Field>
  );
  return (
    <div className="stack">
      <p className="muted small">Имя, handle и аватар видны всем, кто встречает вас в сообществах. Остальное — по вашему выбору. Проверка выполняется на сервере.</p>
      {sel('bio_visibility', 'Кто видит «О себе»')}
      {sel('status_visibility', 'Кто видит статус')}
      {sel('timezone_visibility', 'Кто видит часовой пояс')}
      {sel('created_visibility', 'Кто видит дату регистрации')}
      <p className="muted small">Режим «Невидимка» (Профиль → Статус) скрывает вас из списка «в сети».</p>
      <SocialPrivacy />
    </div>
  );
}

function SocialPrivacy() {
  const { uid } = useSession(); const toast = useToast();
  const [soc, setSoc] = useState<ProfileSocial | null>(null);
  useEffect(() => { if (uid) q<ProfileSocial>(supabase.from('profile_social').select('*').eq('user_id', uid).single()).then(setSoc).catch(() => {}); }, [uid]);
  if (!soc || !uid) return null;
  const save = async (patch: Partial<ProfileSocial>) => {
    try { await q(supabase.from('profile_social').update({ ...patch, updated_at: new Date().toISOString() }).eq('user_id', uid)); setSoc({ ...soc, ...patch }); toast.push('Сохранено', 'ok'); }
    catch (e) { toast.fail(e); }
  };
  return (
    <>
      <h4>Друзья</h4>
      <Field label="Кто может найти меня в поиске" hint="«По точному handle» — без подсказок при опечатке: найдут только те, кто знает ваш handle целиком">
        <select value={soc.find_me} onChange={(e) => save({ find_me: e.target.value as ProfileSocial['find_me'] })}>
          <option value="everyone">Все (с подсказками)</option><option value="exact">Только по точному handle</option><option value="nobody">Никто (только друзья)</option></select></Field>
      <Field label="Кто может присылать заявки в друзья">
        <select value={soc.requests_from} onChange={(e) => save({ requests_from: e.target.value as ProfileSocial['requests_from'] })}>
          <option value="everyone">Все</option><option value="mutual">Только с общими друзьями или сообществами</option><option value="nobody">Никто</option></select></Field>
      <Field label="Личные сообщения">
        <select value={soc.dm_from} onChange={(e) => save({ dm_from: e.target.value as ProfileSocial['dm_from'] })}>
          <option value="friends">От друзей</option><option value="nobody">Ни от кого</option></select></Field>
      <Toggle label="Показывать мою анкету в «Знакомствах»" hint="Выключено — вас нет в ленте и вы не видите ленту" checked={soc.discoverable} onChange={(v) => save({ discoverable: v })} />
    </>
  );
}

// ── Оформление профиля, которое видят другие (баннер, рамка, шрифт имени, эмодзи, местоимения)
const BANNERS: [ProfileStyle['banner_style'], string][] = [['gradient', 'Двухцветный'], ['solid', 'Однотонный'], ['dots', 'Точки'], ['waves', 'Кольца'], ['stripes', 'Полосы'], ['leaves', 'Ромбы'], ['grid', 'Сетка'], ['sunset', 'Три полосы']];
const FRAMES: [ProfileStyle['avatar_frame'], string][] = [['none', 'Без рамки'], ['ring', 'Кольцо'], ['double', 'Двойное'], ['dashed', 'Пунктир'], ['glow', 'Толстое кольцо'], ['leaf', 'Капля'], ['square', 'Квадрат']];
const NAME_FONTS: [ProfileStyle['name_font'], string][] = [['default', 'Обычный'], ['serif', 'С засечками'], ['mono', 'Моноширинный'], ['rounded', 'Округлый'], ['bold', 'Жирный'], ['italic', 'Курсив']];

function StyleTab() {
  const { profile, reloadProfile } = useSession(); const toast = useToast();
  const [f, setF] = useState<ProfileStyle>({ banner_color: profile?.banner_color ?? '#2f8a5f', banner_style: profile?.banner_style ?? 'gradient',
    profile_accent: profile?.profile_accent ?? '#2f8a5f', avatar_frame: profile?.avatar_frame ?? 'none', name_font: profile?.name_font ?? 'default',
    profile_emoji: profile?.profile_emoji ?? '', pronouns: profile?.pronouns ?? '' });
  if (!profile) return null;
  const save = async () => { try { await rpc('update_profile_style', { p: f }); await reloadProfile(); toast.push('Оформление сохранено', 'ok'); } catch (e) { toast.fail(e); } };
  return (
    <div className="stack">
      <div className="style-preview"><ProfileBanner p={{ ...f, display_name: profile.display_name, handle: profile.handle, avatar_path: profile.avatar_path }} /></div>
      <p className="muted small">Так вас видят другие: в карточке профиля, у друзей и в «Знакомствах».</p>
      <div className="row wrap">
        <Field label="Цвет баннера"><input type="color" value={f.banner_color} onChange={(e) => setF({ ...f, banner_color: e.target.value })} /></Field>
        <Field label="Узор баннера"><select value={f.banner_style} onChange={(e) => setF({ ...f, banner_style: e.target.value as ProfileStyle['banner_style'] })}>{BANNERS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
      </div>
      <div className="row wrap">
        <Field label="Цвет рамки"><input type="color" value={f.profile_accent} onChange={(e) => setF({ ...f, profile_accent: e.target.value })} /></Field>
        <Field label="Рамка аватара"><select value={f.avatar_frame} onChange={(e) => setF({ ...f, avatar_frame: e.target.value as ProfileStyle['avatar_frame'] })}>{FRAMES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
      </div>
      <div className="row wrap">
        <Field label="Шрифт имени"><select value={f.name_font} onChange={(e) => setF({ ...f, name_font: e.target.value as ProfileStyle['name_font'] })}>{NAME_FONTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Эмодзи у имени"><input value={f.profile_emoji} maxLength={8} onChange={(e) => setF({ ...f, profile_emoji: e.target.value })} placeholder="⚡" /></Field>
        <Field label="Местоимения"><input value={f.pronouns} maxLength={20} onChange={(e) => setF({ ...f, pronouns: e.target.value })} placeholder="он/его, она/её…" /></Field>
      </div>
      <button className="btn primary" onClick={save}>Сохранить оформление</button>
    </div>
  );
}

// ── Кастомизация: все настройки реестра с поиском
function CustomizeTab() {
  const { settings, setSettings } = useSession();
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<Group | 'all'>('all');
  const [perm, setPerm] = useState(typeof Notification !== 'undefined' ? Notification.permission : 'unsupported');
  const ql = query.trim().toLowerCase();
  const list = SETTINGS.filter((d) => (group === 'all' || d.group === group) && (!ql || d.label.toLowerCase().includes(ql) || d.group.toLowerCase().includes(ql) || (d.hint ?? '').toLowerCase().includes(ql)));
  const changed = SETTINGS.filter((d) => settings[d.key] !== undefined && settings[d.key] !== d.default).length;
  const set = async (d: SettingDef, v: SettingValue) => {
    if (d.key === 'notifyDesktop' && v === true && typeof Notification !== 'undefined' && Notification.permission !== 'granted') {
      const p = await Notification.requestPermission(); setPerm(p); if (p !== 'granted') return;
    }
    setSettings({ [d.key]: v });
  };
  const reset = (keys: string[]) => setSettings(Object.fromEntries(keys.map((k) => [k, REGISTRY_DEFAULTS[k]])));
  const shownGroups = GROUPS.filter((g) => list.some((d) => d.group === g));
  return (
    <div>
      <div className="settings-search">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Поиск по ${SETTINGS.length} настройкам`} aria-label="Поиск настроек" />
        <select value={group} onChange={(e) => setGroup(e.target.value as Group | 'all')} aria-label="Раздел"><option value="all">Все разделы</option>{GROUPS.map((g) => <option key={g}>{g}</option>)}</select>
      </div>
      <p className="muted small">Изменено: {changed}. Применяется сразу и синхронизируется через аккаунт. {changed > 0 && <button className="link-btn" onClick={() => confirm('Вернуть все настройки по умолчанию?') && reset(SETTINGS.map((d) => d.key))}>Сбросить всё</button>}</p>
      {!list.length && <p className="muted">Ничего не нашлось.</p>}
      {shownGroups.map((g) => (
        <section key={g}>
          <div className="group-title"><h4>{g}</h4><button className="link-btn small" onClick={() => reset(SETTINGS.filter((d) => d.group === g).map((d) => d.key))}>Сбросить раздел</button></div>
          {list.filter((d) => d.group === g).map((d) => <SettingRow key={d.key} d={d} value={settings[d.key] ?? d.default} onChange={(v) => set(d, v)}
            note={d.key === 'notifyDesktop' && perm === 'denied' ? 'Запрещено в настройках браузера' : undefined} />)}
        </section>
      ))}
    </div>
  );
}

function SettingRow({ d, value, onChange, note }: { d: SettingDef; value: SettingValue; onChange: (v: SettingValue) => void; note?: string }) {
  const changed = value !== d.default;
  const label = <span className="label"><b>{d.label}</b>{(note || d.hint) && <small>{note ?? d.hint}</small>}</span>;
  if (d.type === 'toggle') return <div className={`setting-row ${changed ? 'changed' : ''}`}>{label}<Toggle label="" checked={Boolean(value)} onChange={onChange} /></div>;
  return (
    <label className={`setting-row ${changed ? 'changed' : ''}`}>
      {label}
      {d.type === 'select' ? <select value={String(value)} onChange={(e) => onChange(e.target.value)}>{d.options!.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        : d.type === 'color' ? <input type="color" value={String(value)} onChange={(e) => onChange(e.target.value)} />
        : d.type === 'range' ? <span className="range-wrap"><input type="range" min={d.min} max={d.max} step={d.step} value={Number(value)} onChange={(e) => onChange(Number(e.target.value))} />
            <output>{Number(value)}{d.unit && d.unit !== '×' ? ` ${d.unit}` : d.unit}</output></span>
        : <input value={String(value)} maxLength={d.maxLength} onChange={(e) => onChange(e.target.value)} />}
    </label>
  );
}

function DevicesTab() {
  const { settings: s } = useSession(); const toast = useToast();
  const [picker, setPicker] = useState(false);
  const [level, setLevel] = useState<number | null>(null);
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => () => stop.current?.(), []);
  const test = async () => {
    if (stop.current) { stop.current(); stop.current = null; setLevel(null); return; }
    try {
      const m = await getMic(s.micId, s);
      const off = levelMeter(m, setLevel);
      stop.current = () => { off(); m.getTracks().forEach((t) => t.stop()); };
    } catch (e) { toast.fail(e); }
  };
  return (
    <div className="stack">
      <button className="btn" onClick={() => setPicker(true)}>Выбрать микрофон, камеру и динамики</button>
      <button className="btn" onClick={test}>{level === null ? 'Проверить микрофон' : 'Остановить проверку'}</button>
      {level !== null && <span className="bar big" aria-label="Уровень микрофона"><span style={{ width: `${Math.round(level * 100)}%` }} /></span>}
      <p className="muted small">Шумо- и эхоподавление, рация, качество камеры и экрана — в «Кастомизация → Голос и видео».</p>
      <p className="muted small">Звук и видео не записываются. Микрофон, камера и экран включаются только по вашему нажатию; индикатор показывает, что передаётся.</p>
      {picker && <DevicePicker onClose={() => setPicker(false)} />}
    </div>
  );
}

function AccountTab() {
  const { session } = useSession(); const toast = useToast();
  const [email, setEmail] = useState(''); const [pw, setPw] = useState('');
  return (
    <div className="stack">
      <p>Почта: <b className="account-email">{session?.user.email}</b></p>
      <form className="row" onSubmit={async (e) => { e.preventDefault(); const { error } = await supabase.auth.updateUser({ email }); if (error) toast.push(humanError(error), 'error'); else toast.push('Подтвердите смену по ссылке в письме', 'ok'); }}>
        <input type="email" required placeholder="Новая почта" value={email} onChange={(e) => setEmail(e.target.value)} /><button className="btn">Сменить почту</button></form>
      <form className="row" onSubmit={async (e) => { e.preventDefault(); const { error } = await supabase.auth.updateUser({ password: pw }); if (error) toast.push(humanError(error), 'error'); else { toast.push('Пароль изменён', 'ok'); setPw(''); } }}>
        <input type="password" minLength={8} required placeholder="Новый пароль" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /><button className="btn">Сменить пароль</button></form>
      <button className="btn" onClick={() => supabase.auth.signOut({ scope: 'local' })}>Выйти</button>
      <button className="btn ghost" onClick={() => supabase.auth.signOut({ scope: 'global' })}>Выйти на всех устройствах</button>
    </div>
  );
}
