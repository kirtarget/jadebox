// Picture diagnostics for the log. The <video> is sampled, not the screen: a dark sample means the console sends a
// black picture; a normal sample while the user sees black means the frame is lost between Chromium and Windows.
export interface PictureSample { mode: string; w: number; h: number; videoOpacity: string; luma: number | null }
export type PictureEvent = { event: 'picture' | 'black_video'; data: PictureSample };

export const BLACK_LUMA = 2;      // 0..255 average; real dark scenes stay above this
export const BLACK_SAMPLES = 3;   // consecutive dark samples before "black_video"

/** Average brightness 0..255 of the current video frame, or null when it cannot be read. */
export function videoLuma(v: HTMLVideoElement, ctx: CanvasRenderingContext2D): number | null {
  if (!v.videoWidth || v.readyState < 2) return null;
  try {
    ctx.drawImage(v, 0, 0, ctx.canvas.width, ctx.canvas.height);
    const px = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height).data;
    let s = 0;
    for (let i = 0; i < px.length; i += 4) s += px[i] + px[i + 1] + px[i + 2];
    return Math.round((s / (px.length / 4) / 3) * 10) / 10;
  } catch { return null; }
}

/** Turns periodic samples into log events: the first sample, every mode/size change, a black streak and its end. */
export class PictureWatch {
  private last: PictureSample | null = null;
  private dark = 0;
  private black = false;

  push(s: PictureSample): PictureEvent | null {
    const prev = this.last;
    this.last = s;
    this.dark = s.luma !== null && s.luma < BLACK_LUMA ? this.dark + 1 : 0;
    if (!this.black && this.dark >= BLACK_SAMPLES) { this.black = true; return { event: 'black_video', data: s }; }
    const recovered = this.black && this.dark === 0;
    if (recovered) this.black = false;
    if (!prev || recovered || prev.mode !== s.mode || prev.w !== s.w || prev.h !== s.h || prev.videoOpacity !== s.videoOpacity) return { event: 'picture', data: s };
    return null;
  }
}
