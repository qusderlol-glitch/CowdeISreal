import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { rpc } from '../lib/supabase';
import { useToast } from '../state/toast';
import { Field, Modal } from './ui';

export default function CreateJoinModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const nav = useNavigate();
  const toast = useToast();
  const [tab, setTab] = useState<'create' | 'join'>('create');
  const [name, setName] = useState(''); const [desc, setDesc] = useState(''); const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true);
    try {
      let cid: string;
      if (tab === 'create') cid = await rpc<string>('create_community', { p_name: name, p_description: desc });
      else {
        const code = link.trim().split('/').filter(Boolean).pop() ?? '';
        cid = await rpc<string>('join_by_invite', { p_code: code });
      }
      onDone(); onClose(); nav(`/app/${cid}`);
    } catch (err) { toast.fail(err); } finally { setBusy(false); }
  };
  return (
    <Modal title="Сообщество" onClose={onClose}>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'create'} className={tab === 'create' ? 'active' : ''} onClick={() => setTab('create')}>Создать</button>
        <button role="tab" aria-selected={tab === 'join'} className={tab === 'join' ? 'active' : ''} onClick={() => setTab('join')}>Вступить по ссылке</button>
      </div>
      <form className="stack" onSubmit={submit}>
        {tab === 'create' ? <>
          <Field label="Название"><input required minLength={2} maxLength={60} value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Описание" hint="Необязательно"><textarea maxLength={500} value={desc} onChange={(e) => setDesc(e.target.value)} /></Field>
          <p className="muted small">Будут созданы роли «Участники» и «Модераторы», каналы #объявления, #общий и голосовая комната. Всё можно изменить.</p>
        </> : <Field label="Ссылка или код приглашения"><input required value={link} onChange={(e) => setLink(e.target.value)} placeholder={`${location.origin}/invite/abc123`} /></Field>}
        <button className="btn primary" disabled={busy}>{busy ? 'Подождите…' : tab === 'create' ? 'Создать' : 'Вступить'}</button>
      </form>
    </Modal>
  );
}
