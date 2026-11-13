import test from 'node:test';
import assert from 'node:assert/strict';
import { BLACK_SAMPLES, PictureWatch, type PictureSample } from '../../../src/renderer/stream/picture';

const s = (luma: number | null, extra: Partial<PictureSample> = {}): PictureSample => ({ mode: 'none', w: 2560, h: 1440, videoOpacity: '1', luma, ...extra });

test('picture watch logs first sample and changes only', () => {
  const w = new PictureWatch();
  assert.equal(w.push(s(40))?.event, 'picture');
  assert.equal(w.push(s(38)), null);
  assert.equal(w.push(s(38, { mode: 'cas', videoOpacity: '0' }))?.event, 'picture');
  assert.equal(w.push(s(38, { mode: 'cas', videoOpacity: '0', w: 1280, h: 720 }))?.event, 'picture');
});

test('picture watch reports a black streak once and its recovery', () => {
  const w = new PictureWatch();
  w.push(s(40));
  const events = [];
  for (let i = 0; i < BLACK_SAMPLES + 2; i++) events.push(w.push(s(0.5))?.event ?? null);
  assert.deepEqual(events.filter(Boolean), ['black_video']);
  assert.equal(w.push(s(30))?.event, 'picture');
  assert.equal(w.push(s(null)), null); // unreadable frame is not "dark"
});
