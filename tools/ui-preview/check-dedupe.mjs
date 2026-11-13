// Proves the repeated-frame filter: with a 30-in-60 source the window must repaint about 30 times a second, with
// 60 unique frames it must still repaint about 60. Repaints are counted from Electron offscreen 'paint' events.
import { build } from 'esbuild';
import { cpSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '../../dist-test/dedupe');

if (!process.versions.electron) {
  await build({ entryPoints: [join(here, 'dedupe-entry.ts')], outfile: join(out, 'dedupe-entry.js'), bundle: true, platform: 'browser', format: 'iife', target: 'es2022', logLevel: 'warning' });
  cpSync(join(here, 'dedupe.html'), join(out, 'index.html'));
  const electron = (await import('electron')).default;
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const r = spawnSync(electron, [fileURLToPath(import.meta.url)], { env, stdio: 'inherit', windowsHide: true });
  if (r.error) throw r.error;
  process.exit(r.status ?? 1);
} else {
  const { app, BrowserWindow } = await import('electron');
  app.commandLine.appendSwitch('force-device-scale-factor', '1');
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  app.commandLine.appendSwitch('disable-background-timer-throttling');
  void app.whenReady().then(async () => {
    const win = new BrowserWindow({ width: 1280, height: 720, show: false, webPreferences: { offscreen: true, backgroundThrottling: false } });
    win.webContents.setFrameRate(240);
    const paints = [];
    win.webContents.on('paint', () => paints.push(Date.now()));
    win.webContents.on('console-message', e => { if (/error/i.test(String(e.level))) console.error('[page]', e.message); });
    try {
      await win.loadFile(join(out, 'index.html'));
      const deadline = Date.now() + 30000;
      let res;
      while (Date.now() < deadline && !(res = await win.webContents.executeJavaScript('window.__dedupe'))) await new Promise(r => setTimeout(r, 100));
      if (!res || res.status !== 'passed') throw new Error(res?.error ?? 'timed out');
      let ok = true;
      for (const p of res.phases) {
        const sec = (p.end - p.start) / 1000;
        const rate = paints.filter(t => t >= p.start && t < p.end).length / sec;
        const want = p.dedupe && p.repeat ? [25, 35] : [52, 68];
        const pass = rate >= want[0] && rate <= want[1] && (!p.dedupe || p.mode === 'dedupe');
        ok &&= pass;
        console.log(`${pass ? 'PASS' : 'FAIL'} ${p.name}: mode ${p.mode}, window repaints ${rate.toFixed(1)}/s (want ${want[0]}-${want[1]}); source ticks ${p.ticks}, filter frames ${p.frames}, drawn ${p.drawn}, skipped ${p.skipped}, max skipped mean ${p.maxSkippedMean.toFixed(2)}, min drawn mean ${p.minDrawnMean?.toFixed(2) ?? '-'}`);
      }
      app.exit(ok ? 0 : 1);
    } catch (e) { console.error(e); app.exit(1); }
  });
}
