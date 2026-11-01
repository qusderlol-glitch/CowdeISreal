import { PERM } from './permissions';

// Реестр команд для справки и автодополнения. Исполняются ТОЛЬКО на сервере (public._run_command).
export interface CommandDef {
  name: string;
  module: string; // bot_key из public.bot_modules
  usage: string;
  description: string;
  permission: number;
  example: boolean; // true = демонстрационная команда, не из DiggersBtwModes
}

export const COMMANDS: CommandDef[] = [
  { name: 'help', module: 'examples', usage: '/help', description: 'Список команд', permission: PERM.USE_COMMANDS, example: true },
  { name: 'rank', module: 'examples', usage: '/rank', description: 'Ваш уровень и опыт', permission: PERM.USE_COMMANDS, example: true },
  { name: 'top', module: 'examples', usage: '/top', description: 'Пятёрка лидеров', permission: PERM.USE_COMMANDS, example: true },
  { name: 'roll', module: 'examples', usage: '/roll [NdM]', description: 'Бросок кубиков', permission: PERM.USE_COMMANDS, example: true },
  { name: 'coin', module: 'examples', usage: '/coin', description: 'Орёл или решка', permission: PERM.USE_COMMANDS, example: true },
];

export function parseCommand(text: string): { name: string; args: string } | null {
  const m = /^\/([a-zA-Z][\w-]{0,31})(?:\s+([\s\S]*))?$/.exec(text.trim());
  return m ? { name: m[1].toLowerCase(), args: (m[2] ?? '').trim() } : null;
}

export function suggestCommands(text: string, enabledModules: Set<string>): CommandDef[] {
  if (!text.startsWith('/') || /\s/.test(text)) return [];
  const q = text.slice(1).toLowerCase();
  return COMMANDS.filter((c) => enabledModules.has(c.module) && c.name.startsWith(q)).slice(0, 8);
}
