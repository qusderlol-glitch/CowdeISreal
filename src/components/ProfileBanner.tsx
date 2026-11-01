import type { ProfileStyle } from '../lib/types';
import { Avatar } from './ui';

// Шапка профиля с оформлением, которое выбрал сам пользователь (баннер, рамка, шрифт имени, эмодзи, местоимения).
export default function ProfileBanner({ p, size = 84 }: { p: Partial<ProfileStyle> & { display_name: string; handle: string; avatar_path: string | null }; size?: number }) {
  return (
    <div className={`pbanner banner-${p.banner_style ?? 'gradient'}`} style={{ ['--banner' as string]: p.banner_color ?? '#2f8a5f', ['--paccent' as string]: p.profile_accent ?? '#2f8a5f' }}>
      <div className="pbanner-art" />
      <div className="pbanner-id">
        <Avatar name={p.display_name} path={p.avatar_path} size={size} frame={p.avatar_frame} />
        <div>
          <h3 className={`name-font-${p.name_font ?? 'default'}`}>{p.display_name} {p.profile_emoji}</h3>
          <div className="muted">@{p.handle}{p.pronouns ? ` · ${p.pronouns}` : ''}</div>
        </div>
      </div>
    </div>
  );
}
