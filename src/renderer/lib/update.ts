// Release check against the public GitHub repo. No auto-install: the user downloads the new build themselves.
export const RELEASES_URL = 'https://github.com/kirtarget/jadebox/releases/latest';
const LATEST_API = 'https://api.github.com/repos/kirtarget/jadebox/releases/latest';

const parts = (v: string) => /^v?(\d+)\.(\d+)\.(\d+)$/.exec(v.trim())?.slice(1).map(Number) ?? null;

/** The release version when `tag` is newer than `current`, else null (also for unparsable versions). */
export function newerVersion(current: string, tag: string): string | null {
  const a = parts(current), b = parts(tag);
  if (!a || !b) return null;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return b[i] > a[i] ? b.join('.') : null;
  return null;
}

/** Network or API failure is silent: an update check must never block or nag. */
export async function checkForUpdate(current: string): Promise<string | null> {
  try {
    const r = await fetch(LATEST_API, { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(10_000) });
    if (!r.ok) return null;
    const tag = (await r.json())?.tag_name;
    return typeof tag === 'string' ? newerVersion(current, tag) : null;
  } catch { return null; }
}
