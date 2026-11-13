import type { ConsoleInfo } from '../../../shared/api';
import type { ShortcutSpec } from './shortcuts';
import { shortcutAppId } from './steam-ids';

export interface LaunchTarget { exe: string; startDir: string; argsPrefix: string }

export function consoleShortcutSpec(console: Pick<ConsoleInfo, 'serverId' | 'name'>, target: LaunchTarget): ShortcutSpec {
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(console.serverId) || console.serverId === '.' || console.serverId === '..') {
    throw new Error('Invalid console ID');
  }
  const exe = `"${target.exe}"`;
  return {
    appName: `Jadebox: My Xbox - ${console.name}`,
    exe, startDir: `"${target.startDir}"`, icon: target.exe,
    launchOptions: `${target.argsPrefix}--xhome=${console.serverId}`,
    tags: ['Jadebox', 'Xbox Remote Play'],
    // The id seed keeps the old name so shortcuts created before the rename keep their id and artwork.
    appid: shortcutAppId(exe, `Xenith: Xbox ${console.serverId}`),
  };
}
