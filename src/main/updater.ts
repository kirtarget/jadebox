// Auto-update from GitHub Releases (electron-updater). Builds it cannot update in place (portable zip,
// tar.gz, unsigned macOS, dev) fall back to the renderer's "new version" card with a download link.
import { app } from 'electron';
import { autoUpdater } from 'electron-updater';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { emit } from './events';
import { log, logWarn } from './log';

/** NSIS install (has its uninstaller next to the exe) or a running AppImage. */
export function updaterSupported(): boolean {
  if (!app.isPackaged || process.env.XENITH_NO_AUTOUPDATE === '1') return false;
  if (process.platform === 'win32') return existsSync(join(dirname(process.execPath), `Uninstall ${app.getName()}.exe`));
  if (process.platform === 'linux') return !!process.env.APPIMAGE;
  return false; // macOS: Squirrel.Mac needs a signed app
}

let readyVersion: string | null = null;

export function startUpdater(): void {
  if (!updaterSupported()) return;
  autoUpdater.logger = null;
  autoUpdater.autoDownload = true;
  // AppImage: the new file gets a new versioned name and the old one is deleted, so install only on an
  // explicit restart; the relaunched build rewrites the Steam launcher path (platform/impl/steam.ts).
  autoUpdater.autoInstallOnAppQuit = process.platform === 'win32';
  autoUpdater.on('update-available', (i) => log('update.available', { version: i.version }));
  autoUpdater.on('update-downloaded', (i) => {
    readyVersion = i.version;
    log('update.downloaded', { version: i.version });
    emit({ type: 'updateReady', version: i.version });
  });
  autoUpdater.on('error', (e) => logWarn('update.error', String(e?.message || e)));
  autoUpdater.checkForUpdates().catch((e) => logWarn('update.check_failed', String(e?.message || e)));
}

/** Read through platformInfo(), so a renderer that loads after 'updateReady' still sees it. */
export function updateReadyVersion(): string | null { return readyVersion; }

export function installUpdate(): void {
  if (!readyVersion) return;
  log('update.install', { version: readyVersion });
  autoUpdater.quitAndInstall(true, true);
}
