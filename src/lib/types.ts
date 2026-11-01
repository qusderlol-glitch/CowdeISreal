export type ChannelKind = 'text' | 'voice' | 'announcement';
export interface Profile { id: string; handle: string; display_name: string; avatar_path: string | null; created_at: string }
export interface ProfilePrivate {
  user_id: string; bio: string; status_text: string; presence: 'online' | 'idle' | 'dnd' | 'invisible'; timezone: string;
  bio_visibility: Visibility; status_visibility: Visibility; timezone_visibility: Visibility; created_visibility: Visibility;
  settings: Partial<UserSettings>;
}
export type Visibility = 'everyone' | 'members' | 'nobody';
export interface Community {
  id: string; name: string; description: string; rules: string; icon_path: string | null; accent_color: string; owner_id: string;
  xp_enabled: boolean; xp_per_message: number; xp_cooldown_seconds: number; xp_daily_cap: number; xp_min_length: number;
  voice_mesh_limit: number; created_at: string;
}
export interface Member { community_id: string; user_id: string; nickname: string | null; joined_at: string; timeout_until: string | null; xp: number }
export interface Role { id: string; community_id: string; name: string; color: string; position: number; permissions: number; is_default: boolean }
export interface Category { id: string; community_id: string; name: string; position: number }
export interface Channel {
  id: string; community_id: string; category_id: string | null; name: string; kind: ChannelKind; topic: string; position: number; slowmode_seconds: number;
}
export interface Tag { id: string; community_id: string; name: string; color: string; description: string }
export interface Attachment { id: string; message_id: number; storage_path: string; file_name: string; mime_type: string; size_bytes: number }
export interface Reaction { message_id: number; user_id: string; emoji: string }
export interface Message {
  id: number; channel_id: string; community_id: string; author_id: string | null; kind: 'user' | 'bot' | 'system'; bot_key: string | null;
  content: string; reply_to_id: number | null; mentions: string[]; created_at: string; edited_at: string | null; deleted_at: string | null;
  pinned_at: string | null; message_attachments?: Attachment[]; message_reactions?: Reaction[];
  _pending?: boolean; _failed?: string; _tmp?: string;
}
export interface VoiceState { channel_id: string; user_id: string; community_id: string; muted: boolean; deafened: boolean; video: boolean; screen: boolean; last_seen: string }
export interface Invite { code: string; community_id: string; created_by: string | null; created_at: string; expires_at: string | null; max_uses: number | null; uses: number; revoked_at: string | null }

export interface UserSettings {
  theme: 'meadow' | 'moss' | 'clay' | 'night';
  accent: string;
  density: 'cozy' | 'compact';
  fontSize: number;
  showMemberList: boolean;
  reducedMotion: boolean;
  highContrast: boolean;
  notifyDesktop: boolean;
  notifyMentionsOnly: boolean;
  notifySound: boolean;
  micId: string; camId: string; speakerId: string;
  noiseSuppression: boolean; echoCancellation: boolean;
}
