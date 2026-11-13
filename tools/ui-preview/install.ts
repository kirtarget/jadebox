// ⚠ PREVIEW ONLY. Imported before the app: reads ?s=<scenario>&deck=1&lang=en&scale=m and installs fakes.
import { installFakeApi, type FakeConfig } from './fake-api';
import { fakeStreamConfig, type FakeMode } from './fake-stream';

export const params = new URLSearchParams(location.search);
export const scenario = params.get('s') ?? 'home';
const deck = params.get('deck') === '1';

const cfg: FakeConfig = {
  deck,
  signedIn: !scenario.startsWith('login'),
  consoles: scenario === 'home-loading' ? 'loading' : scenario === 'home-empty' ? 'empty' : scenario === 'home-two' ? 'two' : 'one',
  history: scenario === 'home-new' ? 'empty' : 'full',
  hasCloud: scenario === 'cloud-none' ? false : true,
  cloudLoading: scenario === 'cloud-loading',
  lang: params.get('lang') === 'en' ? 'en' : 'ru',
  scale: (params.get('scale') as FakeConfig['scale']) ?? 'm',
  bridge: scenario === 'stream-bridge',
  layout: deck ? 'auto' : ((params.get('layout') as FakeConfig['layout']) ?? 'auto'),
};
installFakeApi(cfg);
if (scenario === 'home-update') { const x = window.xenith, real = x.platform.bind(x); x.platform = async () => ({ ...(await real()), version: '0.2.0' }); }
if (scenario === 'home-update-ready') { const x = window.xenith, real = x.platform.bind(x); x.platform = async () => ({ ...(await real()), autoUpdate: true, updateReady: '9.9.0' }); }
// Release check: offline by default; ?s=home-update fakes a newer GitHub release.
const realFetch = window.fetch.bind(window);
window.fetch = (input, init) => String(input).startsWith('https://api.github.com/')
  ? Promise.resolve(new Response(JSON.stringify(scenario === 'home-update' ? { tag_name: 'v9.9.0' } : {}), { status: 200 }))
  : realFetch(input, init);

const modes: Record<string, FakeMode> = {
  connecting: 'connecting', 'connecting-cloud': 'connecting-cloud', 'conn-error': 'error-ice',
  stream: 'streaming', 'stream-hud': 'streaming', 'stream-lost': 'reconnecting', 'stream-bridge': 'streaming',
};
fakeStreamConfig.mode = modes[scenario] ?? 'streaming';
