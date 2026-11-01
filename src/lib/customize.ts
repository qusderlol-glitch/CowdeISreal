// Реестр настроек кастомизации. Каждая настройка ДЕЙСТВИТЕЛЬНО что-то меняет — это проверяет src/lib/customize.test.ts:
//   kind 'attr'  -> атрибут data-* на <html>; в app.css обязано быть правило для КАЖДОГО значения, кроме значения по умолчанию;
//   kind 'var'   -> CSS-переменная; в app.css обязано быть её использование var(--name);
//   kind 'logic' -> читается кодом приложения (settings.<key>); тест ищет это обращение в исходниках.
export type SettingValue = string | number | boolean;
export type Group =
  | 'Тема и цвета' | 'Шрифты и текст' | 'Форма и плотность' | 'Фон и узоры' | 'Пузыри сообщений' | 'Лента сообщений'
  | 'Поле ввода' | 'Раскладка' | 'Комнаты и сообщества' | 'Аватары и люди' | 'Уведомления' | 'Звуки' | 'Голос и видео'
  | 'Доступность' | 'Время и дата' | 'Поведение' | 'Приватность на экране';

export interface SettingDef {
  key: string; label: string; group: Group; hint?: string;
  type: 'toggle' | 'select' | 'color' | 'range' | 'text';
  options?: [string, string][]; min?: number; max?: number; step?: number; unit?: string; maxLength?: number;
  default: SettingValue;
  kind: 'attr' | 'var' | 'logic';
  name?: string; // имя атрибута (без data-) или переменной (без --)
}

const tg = (key: string, label: string, group: Group, def: boolean, kind: SettingDef['kind'], name?: string, hint?: string): SettingDef =>
  ({ key, label, group, type: 'toggle', default: def, kind, name, hint });
const sel = (key: string, label: string, group: Group, options: [string, string][], def: string, kind: SettingDef['kind'], name?: string, hint?: string): SettingDef =>
  ({ key, label, group, type: 'select', options, default: def, kind, name, hint });
const rng = (key: string, label: string, group: Group, min: number, max: number, step: number, def: number, unit: string, kind: SettingDef['kind'], name?: string, hint?: string): SettingDef =>
  ({ key, label, group, type: 'range', min, max, step, default: def, unit, kind, name, hint });
const col = (key: string, label: string, group: Group, def: string, name: string, hint?: string): SettingDef =>
  ({ key, label, group, type: 'color', default: def, kind: 'var', name, hint });
const txt = (key: string, label: string, group: Group, def: string, maxLength: number, hint?: string): SettingDef =>
  ({ key, label, group, type: 'text', default: def, kind: 'logic', maxLength, hint });

const T: Group = 'Тема и цвета', F: Group = 'Шрифты и текст', S: Group = 'Форма и плотность', B: Group = 'Фон и узоры', U: Group = 'Пузыри сообщений',
  L: Group = 'Лента сообщений', C: Group = 'Поле ввода', Y: Group = 'Раскладка', R: Group = 'Комнаты и сообщества', A: Group = 'Аватары и люди',
  N: Group = 'Уведомления', Z: Group = 'Звуки', V: Group = 'Голос и видео', X: Group = 'Доступность', D: Group = 'Время и дата', P: Group = 'Поведение',
  Q: Group = 'Приватность на экране';

export const SETTINGS: SettingDef[] = [
  // ── Тема и цвета
  sel('theme', 'Тема', T, [['graphite', 'Графит'], ['meadow', 'Светлая'], ['moss', 'Тёмно-зелёная'], ['clay', 'Тёплая тёмная'], ['night', 'OLED'], ['ocean', 'Океан'],
    ['sakura', 'Сакура'], ['sunset', 'Песок'], ['lavender', 'Лаванда'], ['mint', 'Мята'], ['coffee', 'Кофе'], ['slate', 'Сланец'], ['paper', 'Контрастная']], 'graphite', 'attr', 'theme'),
  col('accent', 'Акцентный цвет', T, '#22c55e', 'accent'),
  col('dangerColor', 'Цвет предупреждений', T, '#ef4444', 'danger'),
  col('linkColor', 'Цвет ссылок', T, '#38bdf8', 'link'),
  col('mentionColor', 'Подсветка упоминаний', T, '#2a2410', 'mention'),
  col('selectionColor', 'Цвет выделения текста', T, '#1f6f43', 'selection'),
  sel('paperTone', 'Оттенок фона', T, [['theme', 'Как в теме'], ['warm', 'Тёплый'], ['cool', 'Холодный'], ['pink', 'Розоватый'], ['mint', 'Мятный'], ['gray', 'Серый']], 'theme', 'attr', 'paper-tone'),
  sel('bubbleMine', 'Цвет моих сообщений', T, [['accent', 'Акцент'], ['blue', 'Синий'], ['violet', 'Фиолетовый'], ['pink', 'Розовый'], ['orange', 'Оранжевый'], ['gray', 'Серый'], ['outline', 'Только контур']], 'accent', 'attr', 'bubble-mine'),
  sel('bubbleTheirs', 'Цвет чужих сообщений', T, [['surface', 'Светлая карточка'], ['tinted', 'С оттенком акцента'], ['gray', 'Серый'], ['transparent', 'Без фона']], 'surface', 'attr', 'bubble-theirs'),
  tg('headerTint', 'Цветная верхняя панель', T, false, 'attr', 'header-tint'),
  tg('communityColorTabs', 'Вкладки в цвете сообщества', T, true, 'attr', 'tab-colors', 'Иначе — в акцентном цвете'),
  tg('roleColors', 'Имена в цвете ролей', T, true, 'logic'),
  tg('colorBlindStatus', 'Статусы формой, а не только цветом', T, false, 'attr', 'cb'),

  // ── Шрифты и текст
  sel('fontFamily', 'Шрифт интерфейса', F, [['system', 'Системный'], ['humanist', 'Гуманистический'], ['serif', 'С засечками'], ['rounded', 'Округлый'], ['mono', 'Моноширинный'], ['readable', 'Удобочитаемый']], 'system', 'attr', 'font'),
  sel('headingFont', 'Шрифт заголовков', F, [['sans', 'Без засечек'], ['serif', 'С засечками'], ['mono', 'Моноширинный'], ['rounded', 'Округлый']], 'sans', 'attr', 'heading-font'),
  rng('fontSize', 'Размер шрифта', F, 12, 20, 1, 15, 'px', 'var', 'font-size'),
  rng('lineHeight', 'Межстрочный интервал', F, 1.2, 1.9, 0.05, 1.5, '', 'var', 'line-height'),
  rng('letterSpacing', 'Межбуквенный интервал', F, 0, 0.06, 0.01, 0, 'em', 'var', 'letter-spacing'),
  sel('fontWeight', 'Насыщенность текста', F, [['normal', 'Обычная'], ['medium', 'Средняя'], ['light', 'Тонкая']], 'normal', 'attr', 'weight'),
  rng('messageTextSize', 'Размер текста сообщений', F, 0.85, 1.4, 0.05, 1, 'em', 'var', 'msg-size'),
  tg('uppercaseLabels', 'Заголовки групп прописными', F, false, 'attr', 'upper'),
  tg('underlineLinks', 'Подчёркивать ссылки', F, false, 'attr', 'underline-links'),
  tg('hyphenate', 'Переносы слов в сообщениях', F, false, 'attr', 'hyphens'),
  tg('jumboEmoji', 'Крупные эмодзи без текста', F, true, 'logic'),
  rng('jumboSize', 'Размер крупных эмодзи', F, 1.5, 4, 0.25, 2.5, 'em', 'var', 'jumbo'),
  tg('richText', 'Форматирование **жирный**, _курсив_, `код`, ~~зачёркнутый~~', F, true, 'logic'),
  sel('codeStyle', 'Вид `кода`', F, [['soft', 'Мягкий фон'], ['dark', 'Тёмный блок'], ['outline', 'Контур']], 'soft', 'attr', 'code-style'),

  // ── Форма и плотность
  sel('density', 'Плотность', S, [['cozy', 'Обычная'], ['compact', 'Компактная'], ['spacious', 'Просторная']], 'cozy', 'attr', 'density'),
  rng('radiusScale', 'Скругление углов', S, 0.2, 1.6, 0.1, 0.6, '', 'var', 'radius-scale'),
  rng('borderWidth', 'Толщина рамок', S, 0, 3, 0.5, 1.5, 'px', 'var', 'bw'),
  sel('shadowStrength', 'Тени', S, [['soft', 'Мягкие'], ['none', 'Без теней'], ['normal', 'Обычные'], ['strong', 'Глубокие']], 'soft', 'attr', 'shadow'),
  sel('buttonShape', 'Форма кнопок', S, [['rounded', 'Скруглённые'], ['pill', 'Таблетка'], ['square', 'Прямые']], 'rounded', 'attr', 'buttons'),
  sel('cardStyle', 'Вид карточек', S, [['raised', 'Приподнятые'], ['flat', 'Плоские'], ['outlined', 'Только контур']], 'raised', 'attr', 'cards'),
  tg('compactTopbar', 'Компактная верхняя панель', S, false, 'attr', 'compact-topbar'),
  rng('messageGap', 'Расстояние между сообщениями', S, 0, 24, 1, 12, 'px', 'var', 'msg-gap'),

  // ── Фон и узоры
  sel('chatPattern', 'Узор в чате', B, [['none', 'Без узора'], ['dots', 'Точки'], ['grid', 'Сетка'], ['cross', 'Сетка плюсов'], ['waves', 'Волны'], ['diagonal', 'Диагонали'], ['confetti', 'Конфетти']], 'none', 'attr', 'pattern'),
  rng('patternOpacity', 'Заметность узора', B, 0.03, 0.3, 0.01, 0.1, '', 'var', 'pattern-opacity'),
  sel('appBackground', 'Фон приложения', B, [['plain', 'Однотонный'], ['tinted', 'С оттенком акцента'], ['lines', 'Линейки'], ['dots', 'Точки']], 'plain', 'attr', 'app-bg'),
  sel('chatBackground', 'Фон ленты', B, [['paper', 'Как бумага'], ['surface', 'Светлее'], ['tinted', 'С оттенком'], ['contrast', 'Контрастный']], 'paper', 'attr', 'chat-bg'),
  sel('roomsBackground', 'Фон колонки комнат', B, [['none', 'Прозрачный'], ['surface', 'Карточка'], ['tinted', 'С оттенком']], 'none', 'attr', 'rooms-bg'),

  // ── Пузыри сообщений
  sel('bubbleStyle', 'Стиль пузырей', U, [['rounded', 'Скруглённые'], ['leaf', 'Асимметричные'], ['sharp', 'Строгие'], ['minimal', 'Минимальные'], ['outline', 'Контурные'], ['glass', 'Полупрозрачные'], ['paper', 'Карточки со сдвигом'], ['cloud', 'Овальные']], 'rounded', 'attr', 'bubble'),
  rng('bubbleRadius', 'Скругление пузырей', U, 2, 28, 1, 12, 'px', 'var', 'bubble-radius'),
  tg('bubbleTail', 'Хвостик у пузыря', U, true, 'attr', 'tail'),
  tg('bubbleShadow', 'Тень у пузырей', U, true, 'attr', 'bubble-shadow'),
  tg('bubbleBorder', 'Рамка у пузырей', U, true, 'attr', 'bubble-border'),
  rng('bubbleWidth', 'Максимальная ширина пузыря', U, 50, 95, 5, 78, '%', 'var', 'bubble-max'),
  rng('bubblePadding', 'Внутренний отступ пузыря', U, 4, 18, 1, 9, 'px', 'var', 'bubble-pad'),
  sel('ownAlign', 'Мои сообщения', U, [['right', 'Справа'], ['left', 'Слева, как у всех']], 'right', 'attr', 'own-align'),
  sel('avatarAlign', 'Аватар у пузыря', U, [['bottom', 'Внизу'], ['top', 'Вверху']], 'bottom', 'attr', 'avatar-align'),
  sel('bubbleAnimation', 'Появление сообщений', U, [['none', 'Без анимации'], ['fade', 'Проявление'], ['pop', 'Всплытие'], ['slide', 'Сдвиг']], 'fade', 'attr', 'bubble-anim'),
  sel('botNotes', 'Ответы ботов', U, [['centered', 'Заметкой по центру'], ['inline', 'Как обычное сообщение']], 'centered', 'attr', 'bot-notes'),
  rng('groupWindow', 'Объединять сообщения подряд, мин', U, 0, 30, 1, 5, 'мин', 'logic'),
  tg('showAuthorNames', 'Имена над пузырями', U, true, 'logic'),
  tg('showChatAvatars', 'Аватары в чате', U, true, 'logic'),
  sel('chatAvatarSize', 'Размер аватаров в чате', U, [['28', 'Маленькие'], ['34', 'Средние'], ['42', 'Крупные']], '34', 'logic'),

  // ── Лента сообщений
  sel('timestamps', 'Время у сообщений', L, [['always', 'Всегда'], ['hover', 'При наведении'], ['never', 'Не показывать']], 'always', 'attr', 'timestamps'),
  tg('dayDividers', 'Разделители дней', L, true, 'logic'),
  sel('dividerStyle', 'Вид разделителя дней', L, [['pill', 'Плашка'], ['line', 'Линия'], ['text', 'Только текст']], 'pill', 'attr', 'divider'),
  tg('showEdited', 'Пометка «изм.»', L, true, 'logic'),
  tg('showReactions', 'Показывать реакции', L, true, 'logic'),
  rng('reactionScale', 'Размер реакций', L, 0.8, 1.6, 0.1, 1, '', 'var', 'reaction-scale'),
  txt('quickReactions', 'Быстрые реакции (через пробел)', L, '👍 ❤️ 😂 🎉 😮 😢 🔥 ✅', 64),
  sel('doubleClick', 'Двойной клик по сообщению', L, [['none', 'Ничего'], ['react', 'Реакция'], ['reply', 'Ответить']], 'none', 'logic'),
  txt('doubleClickEmoji', 'Реакция по двойному клику', L, '👍', 8),
  tg('highlightMentions', 'Подсвечивать упоминания меня', L, true, 'logic'),
  txt('highlightWords', 'Подсвечивать слова (через запятую)', L, '', 200, 'Например: релиз, турнир'),
  txt('mutedWords', 'Скрывать сообщения со словами', L, '', 200, 'Через запятую; сообщение свернётся'),
  tg('hideDeleted', 'Не показывать удалённые сообщения', L, false, 'logic'),
  tg('collapseLong', 'Сворачивать длинные сообщения', L, true, 'logic'),
  rng('collapseLines', 'Сворачивать после строк', L, 4, 30, 1, 12, 'строк', 'logic'),
  rng('imageMaxHeight', 'Высота картинок', L, 120, 600, 20, 300, 'px', 'var', 'img-max'),
  tg('blurMedia', 'Размывать картинки до наведения', L, false, 'attr', 'blur-media'),
  tg('inlineMedia', 'Показывать картинки в ленте', L, true, 'logic'),
  tg('showReplyQuotes', 'Цитата в ответах', L, true, 'logic'),
  tg('showTyping', 'Показывать, кто печатает', L, true, 'logic'),
  tg('smoothScroll', 'Плавная прокрутка', L, true, 'attr', 'smooth'),
  tg('autoScroll', 'Прокручивать к новым сообщениям', L, true, 'logic'),
  tg('autoLoadOlder', 'Подгружать историю при прокрутке вверх', L, false, 'logic'),
  rng('contentWidth', 'Ширина ленты', L, 600, 1600, 50, 1600, 'px', 'var', 'content-max'),

  // ── Поле ввода
  tg('enterToSend', 'Enter отправляет (иначе Ctrl+Enter)', C, true, 'logic'),
  tg('spellcheck', 'Проверка орфографии', C, true, 'logic'),
  txt('composerPlaceholder', 'Подсказка в поле ввода', C, '', 60, 'Пусто — «Сообщение в #канал»'),
  sel('charCounter', 'Счётчик символов', C, [['near', 'У предела'], ['always', 'Всегда'], ['never', 'Никогда']], 'near', 'logic'),
  rng('composerMaxHeight', 'Макс. высота поля ввода', C, 15, 60, 5, 40, 'vh', 'var', 'composer-max'),
  tg('showAttachButton', 'Кнопка вложений', C, true, 'logic'),
  tg('showSendButton', 'Кнопка «Отправить»', C, true, 'logic'),
  tg('commandHints', 'Подсказки /команд', C, true, 'logic'),
  tg('confirmDelete', 'Спрашивать перед удалением', C, true, 'logic'),
  tg('keepDrafts', 'Хранить черновики по каналам', C, true, 'logic'),
  sel('composerStyle', 'Вид поля ввода', C, [['box', 'Блок'], ['pill', 'Капсула'], ['underline', 'Подчёркивание']], 'box', 'attr', 'composer'),
  tg('autoFocusComposer', 'Курсор сразу в поле ввода', C, true, 'logic'),
  tg('sendTyping', 'Сообщать, что я печатаю', C, true, 'logic'),

  // ── Раскладка
  sel('roomsSide', 'Колонка комнат', Y, [['left', 'Слева'], ['right', 'Справа']], 'left', 'attr', 'rooms-side'),
  rng('roomsWidth', 'Ширина колонки комнат', Y, 220, 420, 10, 300, 'px', 'var', 'rooms-width'),
  sel('topbarPosition', 'Панель сообществ', Y, [['top', 'Сверху'], ['bottom', 'Снизу']], 'top', 'attr', 'topbar'),
  sel('mainFrame', 'Область разговора', Y, [['floating', 'Карточкой'], ['edge', 'Во всю ширину']], 'floating', 'attr', 'frame'),
  sel('dockPosition', 'Панель звонка', Y, [['center', 'По центру'], ['left', 'Слева'], ['right', 'Справа']], 'center', 'attr', 'dock'),
  tg('dockLabels', 'Подписи на панели звонка', Y, true, 'attr', 'dock-labels'),
  tg('showBrandText', 'Название приложения в панели', Y, true, 'attr', 'brand-text'),
  tg('showMyName', 'Моё имя в панели', Y, true, 'attr', 'my-name'),
  sel('peopleSide', 'Панель «Люди»', Y, [['right', 'Справа'], ['left', 'Слева']], 'right', 'attr', 'people-side'),

  // ── Комнаты и сообщества
  sel('communityCard', 'Карточка сообщества', R, [['full', 'Полная'], ['compact', 'Компактная'], ['hidden', 'Скрыта']], 'full', 'attr', 'community-card'),
  tg('roomSubtitles', 'Подписи у комнат', R, true, 'attr', 'room-sub'),
  sel('roomIcons', 'Значки комнат', R, [['square', 'Квадратные'], ['circle', 'Круглые'], ['none', 'Без значков']], 'square', 'attr', 'room-icons'),
  tg('unreadDots', 'Точки непрочитанного', R, true, 'attr', 'unread-dots'),
  tg('voicePeople', 'Участники под голосовыми', R, true, 'attr', 'voice-people'),
  sel('tabStyle', 'Вид вкладок сообществ', R, [['underline', 'Подчёркивание'], ['pill', 'Таблетки'], ['square', 'Плитки'], ['compact', 'Компактные']], 'underline', 'attr', 'tabs'),
  tg('tabIcons', 'Значки на вкладках', R, true, 'attr', 'tab-icons'),
  tg('collapseCategories', 'Категории свёрнуты по умолчанию', R, false, 'logic'),
  tg('favoritesSection', 'Раздел «Избранное»', R, true, 'logic'),
  tg('rememberLastRoom', 'Открывать последнюю комнату', R, true, 'logic'),
  sel('roomSort', 'Порядок комнат', R, [['manual', 'Как настроил админ'], ['alpha', 'По алфавиту'], ['unread', 'Сначала непрочитанные']], 'manual', 'logic'),
  tg('onlineCount', 'Счётчик «в сети»', R, true, 'attr', 'online-count'),
  tg('memberLevels', 'Уровни в списке людей', R, true, 'logic'),
  tg('memberTags', 'Метки в списке людей', R, true, 'logic'),
  tg('groupByRole', 'Группировать людей по ролям', R, true, 'logic'),
  tg('showOffline', 'Показывать тех, кто не в сети', R, true, 'logic'),

  // ── Аватары и люди
  sel('avatarShape', 'Форма аватаров', A, [['circle', 'Круг'], ['squircle', 'Скруглённый квадрат'], ['square', 'Квадрат'], ['hex', 'Шестиугольник']], 'circle', 'attr', 'avatar-shape'),
  tg('avatarFrames', 'Показывать рамки аватаров', A, true, 'attr', 'frames'),
  sel('initialsStyle', 'Аватары без фото', A, [['color', 'Цветные'], ['mono', 'Монохромные'], ['accent', 'В акцентном цвете']], 'color', 'attr', 'initials'),
  tg('profileEmoji', 'Эмодзи профилей рядом с именем', A, true, 'logic'),
  sel('friendsSort', 'Сортировка друзей', A, [['alpha', 'По имени'], ['recent', 'Сначала новые друзья']], 'alpha', 'logic'),

  // ── Уведомления
  tg('notifyDesktop', 'Уведомления на рабочем столе', N, false, 'logic'),
  tg('notifyMentionsOnly', 'Только упоминания', N, true, 'logic'),
  tg('notifyDms', 'О личных сообщениях', N, true, 'logic'),
  tg('notifyFriendRequests', 'О заявках в друзья', N, true, 'logic'),
  tg('notifyWhenFocused', 'Даже когда вкладка открыта', N, false, 'logic'),
  tg('notificationPreview', 'Текст сообщения в уведомлении', N, true, 'logic'),
  tg('quietHours', 'Тихие часы', N, false, 'logic', undefined, 'Без звуков и всплывающих уведомлений'),
  rng('quietFrom', 'Тихие часы с', N, 0, 23, 1, 23, 'ч', 'logic'),
  rng('quietTo', 'Тихие часы до', N, 0, 23, 1, 8, 'ч', 'logic'),
  tg('titleBadge', 'Счётчик непрочитанного во вкладке', N, true, 'logic'),
  tg('flashTitle', 'Мигать вкладкой при упоминании', N, false, 'logic'),
  sel('toastPosition', 'Где всплывают подсказки', N, [['top', 'Сверху'], ['bottom', 'Снизу']], 'top', 'attr', 'toasts'),
  rng('toastSeconds', 'Сколько держать подсказку', N, 2, 10, 1, 4, 'с', 'logic'),

  // ── Звуки
  tg('notifySound', 'Звук уведомлений', Z, true, 'logic'),
  sel('soundType', 'Звук', Z, [['soft', 'Мягкий'], ['bell', 'Колокольчик'], ['pop', 'Щелчок'], ['chirp', 'Чирик'], ['drop', 'Капля']], 'soft', 'logic'),
  rng('soundVolume', 'Громкость звуков', Z, 0, 1, 0.05, 0.5, '', 'logic'),
  tg('sendSound', 'Звук при отправке', Z, false, 'logic'),
  tg('voiceJoinSound', 'Звук входа и выхода в комнате', Z, true, 'logic'),

  // ── Голос и видео
  tg('noiseSuppression', 'Шумоподавление', V, true, 'logic'),
  tg('echoCancellation', 'Эхоподавление', V, true, 'logic'),
  tg('autoGain', 'Автоусиление микрофона', V, true, 'logic'),
  tg('pushToTalk', 'Режим рации (говорить с зажатой клавишей)', V, false, 'logic'),
  sel('pttKey', 'Клавиша рации', V, [['Space', 'Пробел'], ['KeyV', 'V'], ['KeyT', 'T'], ['Backquote', '`']], 'KeyV', 'logic'),
  rng('speakingThreshold', 'Чувствительность индикатора речи', V, 0.04, 0.4, 0.02, 0.12, '', 'logic'),
  tg('speakingRings', 'Подсветка говорящих', V, true, 'attr', 'speaking'),
  tg('mirrorCamera', 'Зеркалить свою камеру', V, true, 'logic'),
  sel('cameraQuality', 'Качество камеры', V, [['480', '480p (экономно)'], ['720', '720p'], ['1080', '1080p']], '720', 'logic'),
  sel('cameraFps', 'Кадров в секунду камеры', V, [['15', '15'], ['24', '24'], ['30', '30']], '24', 'logic'),
  sel('screenFps', 'Кадров в секунду экрана', V, [['5', '5 (текст)'], ['15', '15'], ['30', '30 (видео)']], '15', 'logic'),
  tg('screenAudio', 'Звук при показе экрана', V, true, 'logic'),
  rng('defaultVolume', 'Громкость участников по умолчанию', V, 0, 1, 0.05, 1, '', 'logic'),
  tg('confirmLeaveVoice', 'Спрашивать перед выходом из комнаты', V, false, 'logic'),
  tg('warnCloseInCall', 'Предупреждать при закрытии вкладки во время звонка', V, true, 'logic'),
  sel('stageSize', 'Размер плиток в комнате', V, [['normal', 'Обычные'], ['small', 'Мелкие'], ['large', 'Крупные']], 'normal', 'attr', 'stage'),

  // ── Доступность
  tg('reducedMotion', 'Уменьшить анимации', X, false, 'attr', 'motion'),
  tg('highContrast', 'Высокий контраст', X, false, 'attr', 'contrast'),
  sel('focusRing', 'Обводка фокуса', X, [['normal', 'Обычная'], ['strong', 'Заметная']], 'normal', 'attr', 'focus'),
  tg('largeTargets', 'Крупные кнопки', X, false, 'attr', 'large-targets'),
  tg('noTransparency', 'Без прозрачности', X, false, 'attr', 'opaque'),
  rng('animationSpeed', 'Скорость анимаций', X, 0.25, 2, 0.25, 1, '×', 'var', 'speed'),
  tg('altTextReminder', 'Подписывать вложения именем файла', X, true, 'logic'),

  // ── Время и дата
  sel('timeFormat', 'Формат времени', D, [['24', '24 часа'], ['12', '12 часов (AM/PM)']], '24', 'logic'),
  tg('showSeconds', 'Секунды во времени', D, false, 'logic'),
  tg('relativeTime', 'Относительное время («5 мин назад»)', D, false, 'logic'),
  sel('dateFormat', 'Формат даты', D, [['long', '1 ноября 2026'], ['short', '01.11.2026'], ['iso', '2026-11-01']], 'long', 'logic'),

  // ── Поведение
  sel('startPage', 'Что открывать при входе', P, [['last', 'Последнее сообщество'], ['home', 'Главную'], ['friends', 'Друзей']], 'last', 'logic'),
  tg('openLinksNewTab', 'Ссылки в новой вкладке', P, true, 'logic'),
  tg('confirmExternalLinks', 'Спрашивать перед переходом по ссылке', P, false, 'logic'),
  tg('keyboardShortcuts', 'Горячие клавиши (Alt+↑/↓ — комнаты)', P, true, 'logic'),
  tg('autoMarkRead', 'Отмечать прочитанным при просмотре', P, true, 'logic'),
  tg('escClosesPanels', 'Esc закрывает панели', P, true, 'logic'),

  // ── Приватность на экране
  tg('streamerMode', 'Режим стримера', Q, false, 'attr', 'streamer', 'Скрывает почту, ссылки-приглашения и превью ЛС'),
  tg('blurDmPreviews', 'Размывать превью личных сообщений', Q, false, 'attr', 'blur-dm'),
  tg('hideMyHandle', 'Скрывать мой @handle в панели', Q, false, 'attr', 'hide-handle'),
];

export const SETTINGS_BY_KEY = new Map(SETTINGS.map((s) => [s.key, s]));
export const GROUPS: Group[] = [...new Set(SETTINGS.map((s) => s.group))];
export const REGISTRY_DEFAULTS: Record<string, SettingValue> = Object.fromEntries(SETTINGS.map((s) => [s.key, s.default]));

export function cssValue(def: SettingDef, v: SettingValue): string {
  if (def.type === 'color') return /^#[0-9a-f]{6}$/i.test(String(v)) ? String(v) : String(def.default);
  if (def.type === 'range') {
    const n = Math.min(def.max ?? Infinity, Math.max(def.min ?? -Infinity, Number(v)));
    const unit = def.unit === 'px' || def.unit === 'em' || def.unit === 'vh' ? def.unit : def.unit === '%' ? '%' : '';
    return `${Number.isFinite(n) ? n : def.default}${unit}`;
  }
  return String(v);
}

export function applyRegistry(values: Record<string, SettingValue>, root: HTMLElement = document.documentElement) {
  for (const def of SETTINGS) {
    const v = values[def.key] ?? def.default;
    if (def.kind === 'attr' && def.name) root.setAttribute(`data-${def.name}`, String(v));
    else if (def.kind === 'var' && def.name) {
      // цвет по умолчанию не навязываем: тогда действует цвет выбранной темы
      if (def.type === 'color' && String(v).toLowerCase() === String(def.default).toLowerCase()) root.style.removeProperty(`--${def.name}`);
      else root.style.setProperty(`--${def.name}`, cssValue(def, v));
    }
  }
}

export function countByKind() {
  return { total: SETTINGS.length, attr: SETTINGS.filter((s) => s.kind === 'attr').length, var: SETTINGS.filter((s) => s.kind === 'var').length,
    logic: SETTINGS.filter((s) => s.kind === 'logic').length };
}
