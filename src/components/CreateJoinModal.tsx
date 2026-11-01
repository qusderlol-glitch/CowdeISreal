import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { rpc } from '../lib/supabase';
import { appUrl } from '../lib/brand';
import { useToast } from '../state/toast';
import { Field, Icon, Modal } from './ui';

// Шаблоны совпадают с public.create_community(..., p_template) в миграции 20261104
const TEMPLATES: { id: string; title: string; icon: string; color: string; text: string[]; voice: string[] }[] = [
  { id: 'custom', title: 'Своё с нуля', icon: 'plus', color: 'var(--accent)', text: ['объявления', 'общий'], voice: ['Общая комната'] },
  { id: 'gaming', title: 'Игры', icon: 'trophy', color: '#38bdf8', text: ['объявления', 'общий', 'поиск-тиммейтов', 'клипы'], voice: ['Общая комната', 'Игра 1', 'Игра 2', 'Стрим'] },
  { id: 'friends', title: 'Друзья', icon: 'users', color: '#f472b6', text: ['общий', 'мемы', 'планы'], voice: ['Тусовка', 'Кино вместе'] },
  { id: 'study', title: 'Учёба', icon: 'edit', color: '#f59e0b', text: ['объявления', 'общий', 'домашка', 'вопросы'], voice: ['Учимся вместе', 'Консультация'] },
  { id: 'club', title: 'Клуб или кружок', icon: 'megaphone', color: '#a78bfa', text: ['объявления', 'общий', 'события', 'идеи'], voice: ['Собрание', 'Комната отдыха'] },
];

export default function CreateJoinModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const nav = useNavigate();
  const toast = useToast();
  const [tpl, setTpl] = useState<(typeof TEMPLATES)[number] | null>(null);
  const [name, setName] = useState(''); const [desc, setDesc] = useState(''); const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);

  const create = async (e: FormEvent) => {
    e.preventDefault(); if (!tpl) return; setBusy(true);
    try {
      const cid = await rpc<string>('create_community', { p_name: name, p_description: desc, p_template: tpl.id });
      onDone(); onClose(); nav(`/app/${cid}`);
    } catch (err) { toast.fail(err); } finally { setBusy(false); }
  };
  const join = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true);
    try {
      const code = link.trim().split('/').filter(Boolean).pop() ?? '';
      const cid = await rpc<string>('join_by_invite', { p_code: code });
      onDone(); onClose(); nav(`/app/${cid}`);
    } catch (err) { toast.fail(err); } finally { setBusy(false); }
  };

  return (
    <Modal title={tpl ? `Новое сообщество: ${tpl.title}` : 'Создать сообщество'} onClose={onClose}>
      {!tpl ? (
        <div className="stack">
          <p className="muted">Сообщество — место для вас и друзей: текстовые каналы, голосовые комнаты для игр и созвонов. Всё бесплатно.</p>
          <ul className="tpl-list">{TEMPLATES.map((t) => (
            <li key={t.id}>
              <button className="tpl" onClick={() => { setTpl(t); if (!name) setName(t.id === 'custom' ? '' : t.title); }}>
                <span className="tpl-icon" style={{ background: t.color }}><Icon name={t.icon} size={18} /></span>
                <span className="grow"><b>{t.title}</b><small>{t.text.map((c) => `#${c}`).join(' · ')} · {t.voice.length} голос.</small></span>
                <Icon name="chevron" size={16} />
              </button>
            </li>
          ))}</ul>
          <form className="join-box" onSubmit={join}>
            <b>Есть приглашение?</b>
            <div className="row"><input required value={link} onChange={(e) => setLink(e.target.value)} placeholder={appUrl('/invite/abc123')} aria-label="Ссылка или код приглашения" />
              <button className="btn" disabled={busy}>Вступить</button></div>
          </form>
        </div>
      ) : (
        <form className="stack" onSubmit={create}>
          <div className="tpl-preview">
            <div><small className="muted">Текстовые</small><p>{tpl.text.map((c) => <span key={c} className="chip">#{c}</span>)}</p></div>
            <div><small className="muted">Голосовые</small><p>{tpl.voice.map((c) => <span key={c} className="chip"><Icon name="speaker" size={12} /> {c}</span>)}</p></div>
          </div>
          <Field label="Название"><input required minLength={2} maxLength={60} value={name} autoFocus onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Описание" hint="Необязательно"><textarea maxLength={500} value={desc} onChange={(e) => setDesc(e.target.value)} /></Field>
          <p className="muted small">Роли «Участники» и «Модераторы» создадутся сами. Каналы потом можно добавить, переименовать или удалить.</p>
          <div className="row"><button type="button" className="btn ghost" onClick={() => setTpl(null)}>Назад</button>
            <button className="btn primary" disabled={busy}>{busy ? 'Создаём…' : 'Создать'}</button></div>
        </form>
      )}
    </Modal>
  );
}
