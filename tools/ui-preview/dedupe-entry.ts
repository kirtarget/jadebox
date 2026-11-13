import { PostProcessor, type PostConfig } from '../../src/renderer/stream/postprocess';

// Synthetic 60 fps stream: in "repeat" phases every content step is sent twice, the repeat with faint noise like an
// encoder refinement. The moving object is 8 x 8 px and moves 2 px per step, the hardest case for a tile mean.
interface Phase { name: string; dedupe: boolean; repeat: boolean; start: number; end: number; frames: number; drawn: number; skipped: number; maxSkippedMean: number; minDrawnMean: number | null }
declare global { interface Window { __dedupe?: { status: 'passed' | 'failed'; phases: Phase[]; error?: string } } }

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
const W = 1280, H = 720;

async function run() {
  const holder = document.querySelector<HTMLElement>('#holder')!;
  const src = document.createElement('canvas'); src.width = W; src.height = H;
  const g = src.getContext('2d')!;
  const stream = src.captureStream(0);
  const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
  let step = 0, tick = 0, repeat = false;
  const noise = document.createElement('canvas'); noise.width = W; noise.height = H;
  const ng = noise.getContext('2d')!; const id = ng.createImageData(W, H);
  for (let i = 0; i < id.data.length; i++) id.data[i] = Math.random() * 255;
  ng.putImageData(id, 0, 0);
  const scene = (refine: boolean) => {
    g.globalAlpha = 1;
    const grad = g.createLinearGradient(0, 0, W, H); grad.addColorStop(0, '#203040'); grad.addColorStop(1, '#806040');
    g.fillStyle = grad; g.fillRect(0, 0, W, H);
    g.fillStyle = '#fff'; g.fillRect(200 + (step % 400) * 2, 300, 8, 8);
    if (refine) { g.globalAlpha = 0.006; g.drawImage(noise, 0, 0); }
  };
  setInterval(() => {
    const isRepeat = repeat && tick % 2 === 1;
    if (!isRepeat) step++;
    scene(isRepeat);
    track.requestFrame();
    tick++;
  }, 1000 / 60);

  const video = document.createElement('video');
  video.muted = true; video.autoplay = true;
  Object.assign(video.style, { position: 'absolute', inset: '0', width: '100%', height: '100%' });
  holder.appendChild(video);
  video.srcObject = stream;
  await video.play();
  const post = new PostProcessor(holder, video, { _video_format: '' }, () => {});
  const cfg: PostConfig = { sharpness: 0, fsr: false, brightness: 1, contrast: 1, saturation: 1, fit: 'contain', dedupe: false, bridge: false };
  post.apply(cfg); post.setReady();
  await wait(500);

  const phases: Phase[] = [];
  for (const [name, dedupe, rep] of [['off, 30 in 60', false, true], ['on, 30 in 60', true, true], ['on, 60 unique', true, false], ['off, 60 unique', false, false]] as const) {
    repeat = rep;
    post.apply({ ...cfg, dedupe: false });
    post.apply({ ...cfg, dedupe });   // fresh mode: its 5 s stats log must not reset counters mid-phase
    await wait(700);
    const d = (post as any).dedupe;
    if (d) d.stats = { frames: 0, drawn: 0, skipped: 0, maxSkippedMean: 0, minDrawnMean: null };
    const start = Date.now(); const t0 = tick;
    await wait(3000);
    phases.push({ name, dedupe, repeat: rep, start, end: Date.now(), ticks: tick - t0, mode: post.mode, ...(d ? d.stats : { frames: 0, drawn: 0, skipped: 0, maxSkippedMean: 0, minDrawnMean: null }) } as Phase);
  }
  window.__dedupe = { status: 'passed', phases };
}
run().catch(e => { window.__dedupe = { status: 'failed', phases: [], error: String(e?.stack || e) }; });
