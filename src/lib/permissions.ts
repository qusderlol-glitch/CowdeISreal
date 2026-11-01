// Те же значения, что в supabase/migrations/*_init.sql. Меняйте только вместе.
export const PERM = {
  VIEW_CHANNELS: 1,
  SEND_MESSAGES: 2,
  MANAGE_MESSAGES: 4,
  CREATE_INVITES: 8,
  MANAGE_CHANNELS: 16,
  MANAGE_ROLES: 32,
  MANAGE_MEMBERS: 64,
  MODERATE: 128,
  ADMINISTRATOR: 256,
  CONNECT_VOICE: 512,
  STREAM_VIDEO: 1024,
  ATTACH_FILES: 2048,
  ADD_REACTIONS: 4096,
  MANAGE_TAGS: 8192,
  MANAGE_COMMUNITY: 16384,
  USE_COMMANDS: 32768,
} as const;
export type PermKey = keyof typeof PERM;
export const PERM_ALL = 65535;
export const PERM_DEFAULT =
  PERM.VIEW_CHANNELS | PERM.SEND_MESSAGES | PERM.CREATE_INVITES | PERM.CONNECT_VOICE | PERM.STREAM_VIDEO |
  PERM.ATTACH_FILES | PERM.ADD_REACTIONS | PERM.USE_COMMANDS;

export const PERM_INFO: { key: PermKey; label: string; hint: string; group: 'Общие' | 'Сообщения' | 'Голос' | 'Управление' }[] = [
  { key: 'VIEW_CHANNELS', label: 'Просмотр каналов', hint: 'Видеть каналы и читать историю', group: 'Общие' },
  { key: 'CREATE_INVITES', label: 'Создание приглашений', hint: 'Делать ссылки-приглашения', group: 'Общие' },
  { key: 'USE_COMMANDS', label: 'Команды ботов', hint: 'Вызывать /команды', group: 'Общие' },
  { key: 'SEND_MESSAGES', label: 'Отправка сообщений', hint: 'Писать в текстовые каналы', group: 'Сообщения' },
  { key: 'ATTACH_FILES', label: 'Вложения', hint: 'Прикреплять файлы до 10 МБ', group: 'Сообщения' },
  { key: 'ADD_REACTIONS', label: 'Реакции', hint: 'Ставить реакции', group: 'Сообщения' },
  { key: 'MANAGE_MESSAGES', label: 'Управление сообщениями', hint: 'Удалять чужие, закреплять, писать в объявления', group: 'Сообщения' },
  { key: 'CONNECT_VOICE', label: 'Голосовые комнаты', hint: 'Подключаться и говорить', group: 'Голос' },
  { key: 'STREAM_VIDEO', label: 'Камера и экран', hint: 'Включать камеру и демонстрацию экрана', group: 'Голос' },
  { key: 'MANAGE_CHANNELS', label: 'Управление каналами', hint: 'Создавать, менять, упорядочивать каналы', group: 'Управление' },
  { key: 'MANAGE_ROLES', label: 'Управление ролями', hint: 'Роли ниже своей; только свои права', group: 'Управление' },
  { key: 'MANAGE_MEMBERS', label: 'Управление участниками', hint: 'Исключать, заглушать, менять ники', group: 'Управление' },
  { key: 'MANAGE_TAGS', label: 'Метки участников', hint: 'Создавать и выдавать метки', group: 'Управление' },
  { key: 'MODERATE', label: 'Модерация', hint: 'Баны, журнал аудита, корректировка опыта', group: 'Управление' },
  { key: 'MANAGE_COMMUNITY', label: 'Настройки сообщества', hint: 'Название, иконка, правила, ранги, боты', group: 'Управление' },
  { key: 'ADMINISTRATOR', label: 'Администратор', hint: 'Все права. Выдавайте осторожно', group: 'Управление' },
];

export function has(perms: number | null | undefined, ...bits: number[]): boolean {
  const p = perms ?? 0;
  return bits.every((b) => (p & b) === b);
}
export function toggleBit(perms: number, bit: number, on: boolean): number {
  return on ? perms | bit : perms & ~bit;
}
