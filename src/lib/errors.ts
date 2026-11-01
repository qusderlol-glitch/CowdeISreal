const MESSAGES: Record<string, string> = {
  not_authenticated: 'Нужно войти в аккаунт.',
  forbidden: 'Недостаточно прав.',
  hierarchy: 'Нельзя: цель равна или выше вас по иерархии ролей.',
  cannot_grant_missing_permission: 'Нельзя выдать право, которого нет у вас самих.',
  default_role_cannot_be_admin: 'Базовой роли нельзя дать права администратора.',
  cannot_delete_default_role: 'Базовую роль удалить нельзя.',
  rate_limited: 'Слишком часто. Подождите {n} с.',
  slowmode: 'В канале медленный режим. Подождите {n} с.',
  too_long: 'Сообщение длиннее 4000 символов.',
  empty: 'Пустое сообщение.',
  invalid_content: 'Некорректный текст.',
  too_many_attachments: 'Не более 5 вложений.',
  forbidden_attachments: 'В этом канале нельзя прикреплять файлы.',
  attachment_not_uploaded: 'Файл не загрузился. Попробуйте ещё раз.',
  attachment_too_large: 'Файл больше 10 МБ.',
  invalid_attachment_path: 'Некорректное вложение.',
  invalid_reply: 'Сообщение для ответа не найдено.',
  not_text_channel: 'Это не текстовый канал.',
  invite_not_found: 'Приглашение не найдено.',
  invite_revoked: 'Приглашение отозвано.',
  invite_expired: 'Срок приглашения истёк.',
  invite_used_up: 'Лимит использований приглашения исчерпан.',
  banned: 'Вы заблокированы в этом сообществе.',
  owner_cannot_leave: 'Владелец не может выйти. Сначала передайте владение.',
  confirm_mismatch: 'Название для подтверждения не совпадает.',
  limit_reached: 'Достигнут лимит.',
  not_found: 'Не найдено.',
  not_member: 'Пользователь не состоит в сообществе.',
  invalid_handle: 'Handle: 3–32 символа, латиница в нижнем регистре, цифры, _ и точка.',
  handle_taken: 'Этот handle уже занят.',
  invalid_expiry: 'Срок: от 30 минут до 30 дней или бессрочно.',
  room_full: 'Комната заполнена (лимит mesh-звонка). Для больших звонков нужен SFU — см. README.',
  not_voice_channel: 'Это не голосовой канал.',
  forbidden_video: 'Нет права включать камеру или экран.',
  not_in_room: 'Вы не в комнате.',
  invalid_duration: 'Некорректная длительность.',
  reason_required: 'Укажите причину (3–200 символов).',
  invalid_amount: 'Некорректное количество.',
  invalid_category: 'Категория не найдена.',
  too_many_reactions: 'Слишком много разных реакций.',
  invalid_emoji: 'Некорректная реакция.',
  invalid_path: 'Некорректный путь файла.',
  invalid_target: 'Нельзя выполнить это действие с самим собой.',
  requests_closed: 'Этот человек не принимает заявки в друзья.',
  requests_mutual_only: 'Этот человек принимает заявки только от тех, с кем есть общие друзья или сообщества.',
  try_later: 'Этот человек недавно отклонил заявку. Повторить можно позже.',
  friends_only: 'Писать можно только друзьям.',
  dms_closed: 'Этот человек закрыл личные сообщения.',
  discovery_disabled: 'Сначала включите свою анкету в «Знакомствах».',
};

export function humanError(err: unknown): string {
  const raw =
    typeof err === 'string' ? err :
    err && typeof err === 'object' && 'message' in err ? String((err as { message: unknown }).message) : 'Неизвестная ошибка';
  const m = /^([a-z_]+)(?::(\d+))?$/.exec(raw.trim());
  if (m && MESSAGES[m[1]]) return MESSAGES[m[1]].replace('{n}', m[2] ?? '…');
  if (/Failed to fetch|NetworkError|network/i.test(raw)) return 'Нет соединения с сервером. Проверьте интернет.';
  if (/check constraint/i.test(raw)) return 'Значение не прошло проверку (длина или формат).';
  if (/duplicate key/i.test(raw)) return 'Такое значение уже существует.';
  return raw;
}
