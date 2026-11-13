// Picture pipeline on top of the vendored <video>: CSS picture filters + fit, CAS sharpening (vendored WebGL2Player),
// FSR 1.0 EASU+RCAS (vendored Video.startFSR, three.js), repeated-frame filter (dedupe.ts), and Controller Bridge (nothing rendered).
import { WebGL2Player } from '../../../vendor/xstreaming-player/src/Fsr/WebGL2Player';
import type { VideoFit } from '../../shared/api';
import { FrameDedupe } from './dedupe';

export type PostMode = 'none' | 'cas' | 'fsr' | 'dedupe' | 'hidden';

export interface PostConfig {
  sharpness: number;   // 0..10 (effective)
  fsr: boolean;
  brightness: number; contrast: number; saturation: number;
  fit: VideoFit;
  dedupe: boolean;     // draw only frames that differ, for frame generation over the window
  bridge: boolean;
}

/** Xenith sharpness 1..10 -> RCAS stops (0 = strongest). 0 -> 10 stops (practically no sharpening, EASU only). */
export const rcasStops = (s: number) => (s <= 0 ? 10 : 2 * (1 - Math.min(10, s) / 10));
/** Xenith sharpness 1..10 -> vendored CAS sharpenFactor (mix = factor/2, so 10 -> full CAS). */
export const casFactor = (s: number) => Math.min(10, Math.max(0, s)) / 5;

export class PostProcessor {
  mode: PostMode = 'none';
  private cfg: PostConfig | null = null;
  private ready = false;
  private cas: WebGL2Player | null = null;
  private fsrCanvas: HTMLCanvasElement | null = null;
  private dedupe: FrameDedupe | null = null;
  private dedupeTimer: number | null = null;
  private ro: ResizeObserver;
  private debounce: number | null = null;
  private onVideoResize = () => this.schedule();
  /** A GPU process restart loses the canvas context while the hidden <video> keeps playing: without this the
   *  screen stays black. The canvas is dropped (video shows at once) and rebuilt on a fresh context. */
  private onContextLost = () => {
    this.log('post.context_lost', this.mode);
    this.teardownMode();
    this.schedule();
  };

  constructor(private holder: HTMLElement, private video: HTMLVideoElement, private player: any, private log: (t: string, d?: unknown) => void = () => {}) {
    this.ro = new ResizeObserver(() => this.schedule());
    this.ro.observe(holder);
    video.addEventListener('resize', this.onVideoResize);
  }

  /** Called on the first decoded frame (canvas paths need real video dimensions). */
  setReady() { this.ready = true; this.reconcile(); }

  apply(cfg: PostConfig) {
    if (this.mode === 'fsr' && this.cfg?.fit !== cfg.fit) this.teardownMode();
    this.cfg = cfg;
    this.reconcile();
  }

  dispose() {
    this.teardownMode();
    this.ro.disconnect();
    this.video.removeEventListener('resize', this.onVideoResize);
    if (this.debounce !== null) clearTimeout(this.debounce);
    this.cfg = null;
  }

  private schedule() {
    if (this.debounce !== null) clearTimeout(this.debounce);
    this.debounce = window.setTimeout(() => { this.debounce = null; this.reconcile(true); }, 150);
  }

  /** True when the stream is shown larger than its native size (FSR only makes sense then). */
  private upscaling(): boolean {
    const vw = this.video.videoWidth, vh = this.video.videoHeight;
    if (!vw || !vh) return false;
    const r = this.holder.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    return Math.min(r.width / vw, r.height / vh) * dpr > 1.01;
  }

  private want(): PostMode {
    const c = this.cfg;
    if (!c) return 'none';
    if (c.bridge) return 'hidden';
    if (!this.ready) return 'none';
    if (c.fsr && this.upscaling()) return 'fsr';
    if (c.sharpness > 0) return 'cas';
    if (c.dedupe) return 'dedupe';
    return 'none';
  }

  private reconcile(resized = false) {
    const c = this.cfg;
    if (!c) return;
    this.video.style.objectFit = c.fit;
    this.player._video_format = c.fit === 'fill' ? 'Stretch' : c.fit === 'cover' ? 'Zoom' : '';
    const f: string[] = [];
    if (c.brightness !== 1) f.push(`brightness(${c.brightness})`);
    if (c.contrast !== 1) f.push(`contrast(${c.contrast})`);
    if (c.saturation !== 1) f.push(`saturate(${c.saturation})`);
    this.holder.style.filter = f.join(' ');
    const m = this.want();
    if (m !== this.mode || (resized && m === 'fsr')) { this.teardownMode(); this.setupMode(m, c); }
    else if (m === 'cas') this.cas?.updateOptions({ sharpness: casFactor(c.sharpness) } as any, true);
    else if (m === 'fsr') this.player._videoComponent?.setRcasStops(rcasStops(c.sharpness));
    if (this.cas) this.cas.getCanvas().style.objectFit = c.fit;
    if (this.dedupe) this.dedupe.canvas.style.objectFit = c.fit;
  }

  private setupMode(m: PostMode, c: PostConfig) {
    this.mode = m;
    this.video.style.display = m === 'hidden' ? 'none' : '';
    this.video.style.opacity = m === 'cas' || m === 'fsr' || m === 'dedupe' ? '0' : '1';
    try {
      if (m === 'cas') {
        const p = new WebGL2Player(this.video);
        // brightness/contrast/saturation stay neutral in the shader (vendored scale is /100); CSS filter does them.
        p.updateOptions({ processing: 'cas', processingMode: 'quality', sharpness: casFactor(c.sharpness), brightness: 100, contrast: 100, saturation: 100 } as any);
        const cv = p.getCanvas();
        Object.assign(cv.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: c.fit, pointerEvents: 'none' });
        cv.addEventListener('webglcontextlost', this.onContextLost, { once: true });
        this.cas = p;
        p.init().catch((e) => this.log('post.cas.err', String(e)));
      } else if (m === 'fsr') {
        const cv = document.createElement('canvas');
        Object.assign(cv.style, { position: 'absolute', pointerEvents: 'none' });
        cv.addEventListener('webglcontextlost', this.onContextLost, { once: true });
        this.holder.appendChild(cv);
        this.fsrCanvas = cv;
        this.player._videoComponent.startFSR(cv, rcasStops(c.sharpness));
      } else if (m === 'dedupe') {
        const d = new FrameDedupe(this.video);
        Object.assign(d.canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: c.fit, pointerEvents: 'none' });
        d.canvas.addEventListener('webglcontextlost', this.onContextLost, { once: true });
        this.holder.appendChild(d.canvas);
        this.dedupe = d;
        this.dedupeTimer = window.setInterval(() => {
          if (d.stats.frames) this.log('post.dedupe', d.stats);
          d.stats = { frames: 0, drawn: 0, skipped: 0, maxSkippedMean: 0, minDrawnMean: null };
        }, 5000);
      }
      this.log('post.mode', m);
    } catch (e) {
      this.log('post.err', String((e as any)?.message || e));
      this.teardownMode();
      this.mode = 'none';
      this.video.style.opacity = '1';
    }
  }

  private teardownMode() {
    if (this.cas) {
      this.cas.getCanvas().removeEventListener('webglcontextlost', this.onContextLost); // destroy() loses it on purpose
      try { this.cas.destroy(); } catch { /* ignore */ }
      this.cas = null;
    }
    if (this.fsrCanvas) {
      this.fsrCanvas.removeEventListener('webglcontextlost', this.onContextLost);
      try { this.player._videoComponent?.stopFSR(); } catch { /* ignore */ }
      this.fsrCanvas.remove();
      this.fsrCanvas = null;
    }
    if (this.dedupe) {
      this.dedupe.canvas.removeEventListener('webglcontextlost', this.onContextLost);
      this.dedupe.stop();
      this.dedupe.canvas.remove();
      this.dedupe = null;
    }
    if (this.dedupeTimer !== null) { clearInterval(this.dedupeTimer); this.dedupeTimer = null; }
    this.video.style.opacity = '1';
    this.video.style.display = '';
    this.mode = 'none';
  }
}
