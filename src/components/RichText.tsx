import type { ReactNode } from 'react';
import { linkify } from '../lib/format';
import type { UserSettings } from '../lib/types';

const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|‍|️|\s)+$/u;
export function isJumbo(text: string): boolean {
  const t = text.trim();
  if (!t || !EMOJI_ONLY.test(t) || /\d/.test(t)) return false;
  return [...t.replace(/\s/g, '')].filter((c) => /\p{Extended_Pictographic}/u.test(c)).length <= 6;
}

// **жирный**, _курсив_, `код`, ~~зачёркнутый~~ — без HTML, только React-узлы (никакого dangerouslySetInnerHTML)
const FMT = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(~~[^~\n]+~~)|((?<![\p{L}\p{N}])_[^_\n]+_(?![\p{L}\p{N}]))/gu;
function format(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = []; let last = 0; let m: RegExpExecArray | null; let i = 0;
  FMT.lastIndex = 0;
  while ((m = FMT.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0]; const k = `${key}-${i++}`;
    if (m[1]) out.push(<code key={k}>{tok.slice(1, -1)}</code>);
    else if (m[2]) out.push(<strong key={k}>{tok.slice(2, -2)}</strong>);
    else if (m[3]) out.push(<s key={k}>{tok.slice(2, -2)}</s>);
    else out.push(<em key={k}>{tok.slice(1, -1)}</em>);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export default function RichText({ text, s }: { text: string; s: UserSettings }) {
  const onLink = (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    if (s.confirmExternalLinks && !confirm(`Открыть внешнюю ссылку?\n${href}`)) e.preventDefault();
  };
  return <>{linkify(text).map((p, i) => p.type === 'link'
    ? <a key={i} href={p.value} target={s.openLinksNewTab ? '_blank' : '_self'} rel="noopener noreferrer nofollow" onClick={(e) => onLink(e, p.value)}>{p.value}</a>
    : p.type === 'mention' ? <span key={i} className="mention">{p.value}</span>
    : <span key={i}>{s.richText ? format(p.value, String(i)) : p.value}</span>)}</>;
}
