// Repeated-frame filter. The Xbox stream is 60 fps even when the game renders 30, so every game frame arrives twice.
// Drawing only frames that differ from the last drawn one makes the window update at the game's real rate, which is
// what frame generation over the window (Lossless Scaling) needs to interpolate real motion.

/** Frame differs when some tile's mean channel difference exceeds this (0..255 units). Encoder refinement of a
 *  repeated frame stays below it; a small moving object inside one tile goes above it. */
export const CHANGED_MEAN = 2;
/** Draw at least every N-th frame, so content below the threshold still reaches the screen. */
export const MAX_SKIPPED = 3;
/** Tile grid of the GPU difference pass. */
export const GRID_W = 64, GRID_H = 36;
/** The pass stores mean * this in an 8-bit channel to keep sub-1 precision. */
const MEAN_SCALE = 8;

export interface DedupeStats { frames: number; drawn: number; skipped: number; maxSkippedMean: number; minDrawnMean: number | null }

/** Pure decision, unit-tested: draw when the frame changed, or when too many frames were skipped in a row. */
export function shouldDraw(maxTileMean: number, skippedInRow: number): boolean {
  return maxTileMean > CHANGED_MEAN || skippedInRow >= MAX_SKIPPED;
}

const VS = `#version 300 es
void main() { vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;

const DIFF_FS = `#version 300 es
precision highp float;
uniform sampler2D cur, prev; uniform ivec2 tile, size;
out vec4 o;
void main() {
  ivec2 t = ivec2(gl_FragCoord.xy) * tile;
  float s = 0.0, n = 0.0;
  for (int y = 0; y < tile.y; y++) for (int x = 0; x < tile.x; x++) {
    ivec2 p = min(t + ivec2(x, y), size - 1);
    vec3 d = abs(texelFetch(cur, p, 0).rgb - texelFetch(prev, p, 0).rgb);
    s += max(d.r, max(d.g, d.b)); n += 1.0;
  }
  o = vec4(min(1.0, s / n * ${MEAN_SCALE}.0), 0.0, 0.0, 1.0);
}`;

const BLIT_FS = `#version 300 es
precision highp float;
uniform sampler2D cur; uniform ivec2 size;
out vec4 o;
void main() { ivec2 p = ivec2(gl_FragCoord.xy); o = vec4(texelFetch(cur, ivec2(p.x, size.y - 1 - p.y), 0).rgb, 1.0); }`;

export class FrameDedupe {
  readonly canvas = document.createElement('canvas');
  stats: DedupeStats = { frames: 0, drawn: 0, skipped: 0, maxSkippedMean: 0, minDrawnMean: null };
  private gl: WebGL2RenderingContext;
  private diffProg: WebGLProgram;
  private blitProg: WebGLProgram;
  private tex: [WebGLTexture, WebGLTexture];   // [current upload, last drawn]
  private fb: WebGLFramebuffer;
  private px = new Uint8Array(GRID_W * GRID_H * 4);
  private w = 0; private h = 0;
  private hasPrev = false;
  private skippedInRow = 0;
  private cb = 0;
  private stopped = false;

  constructor(private video: HTMLVideoElement) {
    const gl = this.canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, preserveDrawingBuffer: true, desynchronized: true });
    if (!gl) throw new Error('webgl2 unavailable');
    this.gl = gl;
    this.diffProg = this.program(DIFF_FS);
    this.blitProg = this.program(BLIT_FS);
    this.tex = [this.texture(), this.texture()];
    const fbTex = this.texture();
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, GRID_W, GRID_H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    this.fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fbTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.cb = video.requestVideoFrameCallback(this.onFrame);
  }

  stop() {
    this.stopped = true;
    this.video.cancelVideoFrameCallback(this.cb);
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }

  private onFrame = () => {
    if (this.stopped) return;
    this.cb = this.video.requestVideoFrameCallback(this.onFrame);
    try { this.frame(); } catch { /* context lost: the owner tears down on webglcontextlost */ }
  };

  private frame() {
    const gl = this.gl, v = this.video;
    const w = v.videoWidth, h = v.videoHeight;
    if (!w || !h) return;
    if (w !== this.w || h !== this.h) {
      this.w = this.canvas.width = w; this.h = this.canvas.height = h;
      for (const t of this.tex) { gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null); }
      this.hasPrev = false;
    }
    gl.bindTexture(gl.TEXTURE_2D, this.tex[0]);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, v);
    this.stats.frames++;

    const mean = this.hasPrev ? this.maxTileMean() : Infinity;
    if (!shouldDraw(mean, this.skippedInRow)) {
      this.skippedInRow++;
      this.stats.skipped++;
      this.stats.maxSkippedMean = Math.max(this.stats.maxSkippedMean, mean);
      return;
    }
    this.skippedInRow = 0;
    this.stats.drawn++;
    if (Number.isFinite(mean)) this.stats.minDrawnMean = Math.min(this.stats.minDrawnMean ?? mean, mean);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.useProgram(this.blitProg);
    this.bindTex(this.blitProg, 'cur', 0, this.tex[0]);
    gl.uniform2i(gl.getUniformLocation(this.blitProg, 'size'), w, h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.tex = [this.tex[1], this.tex[0]];
    this.hasPrev = true;
  }

  /** Largest per-tile mean difference between the uploaded frame and the last drawn one, 0..255. Drawing into the
   *  offscreen framebuffer does not mark the canvas changed, so a skipped frame presents nothing. */
  private maxTileMean(): number {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
    gl.viewport(0, 0, GRID_W, GRID_H);
    gl.useProgram(this.diffProg);
    this.bindTex(this.diffProg, 'cur', 0, this.tex[0]);
    this.bindTex(this.diffProg, 'prev', 1, this.tex[1]);
    gl.uniform2i(gl.getUniformLocation(this.diffProg, 'tile'), Math.ceil(this.w / GRID_W), Math.ceil(this.h / GRID_H));
    gl.uniform2i(gl.getUniformLocation(this.diffProg, 'size'), this.w, this.h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.readPixels(0, 0, GRID_W, GRID_H, gl.RGBA, gl.UNSIGNED_BYTE, this.px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    let m = 0;
    for (let i = 0; i < this.px.length; i += 4) if (this.px[i] > m) m = this.px[i];
    return m / MEAN_SCALE;
  }

  private bindTex(p: WebGLProgram, name: string, unit: number, t: WebGLTexture) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.uniform1i(gl.getUniformLocation(p, name), unit);
  }

  private texture(): WebGLTexture {
    const gl = this.gl, t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    for (const k of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, k, gl.NEAREST);
    for (const k of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, k, gl.CLAMP_TO_EDGE);
    return t;
  }

  private program(fs: string): WebGLProgram {
    const gl = this.gl, p = gl.createProgram()!;
    for (const [type, src] of [[gl.VERTEX_SHADER, VS], [gl.FRAGMENT_SHADER, fs]] as const) {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('dedupe shader: ' + gl.getShaderInfoLog(s));
      gl.attachShader(p, s);
    }
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('dedupe link: ' + gl.getProgramInfoLog(p));
    return p;
  }
}
