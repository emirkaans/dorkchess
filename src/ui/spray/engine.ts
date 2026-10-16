// The spray can: lays a username out in single-stroke letters (glyphs.ts) in
// a style (styles.ts), then a pen walks the strokes, painting each layer into
// its own canvas with overspray dots, drips and splatters, composited on the
// visible canvas. A hiss follows the pen (louder while it is down).

import { seeded } from '../../achievements/tags.ts';
import { GLYPHS } from './glyphs.ts';
import { lookOf } from './styles.ts';
import type { Box, Flourish, Point, SprayLayer, SprayLook } from './styles.ts';

/** The pen lifts between strokes for this long. */
const LIFT_MS = 25;
/** The tag's slope: rising to the right (about 11 degrees). */
const TILT = -0.19;
/** A whole tag is sprayed in about this long, however long the name. */
export const SPRAY_MS = 1100;

type Stroke = Point[];

const gauss = (r: () => number) => (r() + r() + r() - 1.5) / 1.5;

let probe: SVGPathElement | null = null;
const sampleCache = new Map<string, Stroke[]>();

/** The points of each stroke of a path (the pen lifted at every M), about `step` apart. */
function sample(d: string, step = 1.4): Stroke[] {
  const key = `${d}|${step}`;
  const cached = sampleCache.get(key);
  if (cached) return cached;
  if (!probe) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.setAttribute('aria-hidden', 'true');
    svg.style.position = 'absolute';
    svg.style.visibility = 'hidden';
    probe = document.createElementNS(NS, 'path');
    svg.appendChild(probe);
    document.body.appendChild(svg);
  }
  const path = probe;
  // No geometry support (tests): nothing to draw.
  if (typeof path.getTotalLength !== 'function') return [];
  const strokes = d
    .split(/(?=M)/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((part) => {
      path.setAttribute('d', part);
      const len = path.getTotalLength();
      const pts: Stroke = [];
      for (let s = 0; s <= len; s += step) {
        const p = path.getPointAtLength(s);
        pts.push({ x: p.x, y: p.y });
      }
      const end = path.getPointAtLength(len);
      pts.push({ x: end.x, y: end.y });
      return pts;
    });
  sampleCache.set(key, strokes);
  return strokes;
}

function bounds(strokes: readonly Stroke[]): Box {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const s of strokes)
    for (const p of s) {
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    }
  return { x0, y0, x1, y1 };
}

/** Strokes added around the letters, sprayed after them. */
function flourish(kind: Flourish, b: Box): Stroke[] {
  const cx = (b.x0 + b.x1) / 2;
  const w = b.x1 - b.x0;
  const base = Math.min(b.y1, 104);
  switch (kind) {
    case 'underline':
      return sample(`M${b.x0 - 10} ${base + 22} Q${cx} ${base + 44} ${b.x1 + 16} ${base + 10}`, 2);
    case 'arrow':
      return sample(
        `M${cx - w * 0.1} ${base + 24} Q${b.x1 - w * 0.1} ${base + 42} ${b.x1 + 26} ${base - 6} M${b.x1 + 4} ${base - 10} L${b.x1 + 28} ${base - 8} L${b.x1 + 22} ${base + 16}`,
        2,
      );
    case 'arrowStart':
      return sample(
        `M${b.x0 + 8} ${b.y0 + 10} Q${b.x0 - 30} ${b.y0 - 10} ${b.x0 - 34} ${b.y0 + 34} M${b.x0 - 46} ${b.y0 + 20} L${b.x0 - 34} ${b.y0 + 38} L${b.x0 - 18} ${b.y0 + 24}`,
        2,
      );
    case 'crown': {
      const t = b.y0 - 14;
      return sample(
        `M${cx - 36} ${t} L${cx - 30} ${t - 44} L${cx - 12} ${t - 18} L${cx} ${t - 54} L${cx + 12} ${t - 18} L${cx + 30} ${t - 44} L${cx + 36} ${t} Z`,
        2,
      );
    }
    case 'stars': {
      const star = (x: number, y: number, s: number) =>
        `M${x - s} ${y} L${x + s} ${y} M${x} ${y - s} L${x} ${y + s} M${x - s * 0.5} ${y - s * 0.5} L${x + s * 0.5} ${y + s * 0.5}`;
      return sample(`${star(b.x0 - 22, b.y0 + 8, 13)} ${star(b.x1 + 22, b.y0 - 6, 10)}`, 2);
    }
    case 'halo': {
      const rx = w / 2 + 34;
      const ry = (b.y1 - b.y0) / 2 + 28;
      const cy = (b.y0 + b.y1) / 2;
      return sample(
        `M${cx - rx} ${cy} A${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A${rx} ${ry} 0 1 0 ${cx - rx + 6} ${cy - 8}`,
        2,
      );
    }
    case 'bolt':
      return sample(
        `M${b.x1 + 14} ${b.y0 - 6} L${b.x1 + 32} ${b.y0 + 42} L${b.x1 + 16} ${b.y0 + 42} L${b.x1 + 36} ${b.y0 + 96}`,
        2,
      );
    case 'xmarks': {
      const x = (px: number, py: number, s: number) =>
        `M${px - s} ${py - s} L${px + s} ${py + s} M${px + s} ${py - s} L${px - s} ${py + s}`;
      return sample(`${x(b.x0 - 24, b.y1 - 6, 11)} ${x(b.x1 + 26, b.y0 + 12, 9)}`, 2);
    }
  }
}

/** The name laid out in a style, as strokes in letter units, turned to rise to the right. */
function buildTag(name: string, styleId: string, look: SprayLook): { strokes: Stroke[]; box: Box; letters: Box } {
  const rnd = seeded(`${name}|${styleId}`);
  const strokes: Stroke[] = [];
  let x = 0;
  for (const ch of name) {
    const [w, d] = GLYPHS[ch] ?? GLYPHS['-'];
    const sc = 1 + (rnd() - 0.5) * look.bounce * 0.3;
    const dy = (rnd() - 0.5) * look.bounce * 30;
    const rot = (rnd() - 0.5) * look.bounce * 0.4;
    const cx = w / 2;
    const cy = 60;
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    for (const sub of sample(d)) {
      strokes.push(
        sub.map((p) => {
          const px0 = (p.x - cx) * sc;
          const py0 = (p.y - cy) * sc;
          let px = px0 * cos - py0 * sin + cx + x;
          let py = px0 * sin + py0 * cos + cy + dy;
          px += look.slant * (100 - py);
          if (look.jitter) {
            px += (rnd() - 0.5) * look.jitter;
            py += (rnd() - 0.5) * look.jitter;
          }
          return { x: px, y: py };
        }),
      );
    }
    x += w * sc + look.spacing * 30 + 6;
  }
  const letterBox = bounds(strokes);
  const letterCount = strokes.length;
  for (const f of look.flourish) strokes.push(...flourish(f, letterBox));
  const all = bounds(strokes);
  const cx = (all.x0 + all.x1) / 2;
  const cy = (all.y0 + all.y1) / 2;
  const cos = Math.cos(TILT);
  const sin = Math.sin(TILT);
  const turned = strokes.map((s) =>
    s.map((p) => ({ x: cx + (p.x - cx) * cos - (p.y - cy) * sin, y: cy + (p.x - cx) * sin + (p.y - cy) * cos })),
  );
  return { strokes: turned, box: bounds(turned), letters: bounds(turned.slice(0, letterCount)) };
}

interface Drip {
  x: number;
  y: number;
  len: number;
  to: number;
  w: number;
  li: number;
  color: string;
}

/** Where on the canvas the tag goes, as parts of its width and height. */
export interface Fit {
  readonly fitW: number;
  readonly fitH: number;
  readonly centerY: number;
}
export const BOARD_FIT: Fit = { fitW: 0.88, fitH: 0.6, centerY: 0.5 };
export const CARD_FIT: Fit = { fitW: 0.9, fitH: 0.8, centerY: 0.5 };

export class Spray {
  private ctx: CanvasRenderingContext2D | null;
  private layers: CanvasRenderingContext2D[] = [];
  private look: SprayLook = lookOf('signature');
  private rnd: () => number = Math.random;
  private k = 1;
  private box: Box = { x0: 0, y0: 0, x1: 1, y1: 1 };
  private W = 0;
  private H = 0;
  private si = 0;
  private pi = 0;
  private wait = 0;
  private drips: Drip[] = [];
  strokes: Stroke[] = [];
  done = false;
  penDown = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d');
  }

  setup(name: string, styleId: string, fit: Fit = BOARD_FIT) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.round(this.canvas.clientWidth * dpr) || 600;
    const H = Math.round(this.canvas.clientHeight * dpr) || 600;
    this.canvas.width = W;
    this.canvas.height = H;
    this.W = W;
    this.H = H;
    this.look = lookOf(styleId);
    this.rnd = seeded(`${name}#${styleId}`);
    const tag = buildTag(name, styleId, this.look);
    const pad = 40;
    const bw = tag.box.x1 - tag.box.x0 + pad * 2;
    const bh = tag.box.y1 - tag.box.y0 + pad * 2;
    const k = Math.min((W * fit.fitW) / bw, (H * fit.fitH) / bh) || 1;
    const ox = W / 2 - ((tag.box.x0 + tag.box.x1) / 2) * k;
    const oy = H * fit.centerY - ((tag.box.y0 + tag.box.y1) / 2) * k;
    this.k = k;
    this.box = {
      x0: tag.box.x0 * k + ox,
      x1: tag.box.x1 * k + ox,
      y0: tag.letters.y0 * k + oy,
      y1: tag.letters.y1 * k + oy,
    };
    this.strokes = tag.strokes.map((s) => s.map((p) => ({ x: p.x * k + ox, y: p.y * k + oy })));
    this.layers = this.look.layers
      .map(() => {
        const c = document.createElement('canvas');
        c.width = W;
        c.height = H;
        return c.getContext('2d');
      })
      .filter((c): c is CanvasRenderingContext2D => c !== null);
    this.si = 0;
    this.pi = 0;
    this.wait = 0;
    this.drips = [];
    this.done = this.layers.length < this.look.layers.length || this.strokes.length === 0;
    this.penDown = false;
    this.composite();
  }

  /** The pen speed (letter units per ms) that sprays the whole tag in `ms`. */
  speedFor(ms: number): number {
    let length = 0;
    for (const s of this.strokes)
      for (let i = 1; i < s.length; i++) length += Math.hypot(s[i].x - s[i - 1].x, s[i].y - s[i - 1].y);
    const lifts = this.strokes.length * LIFT_MS;
    return length / Math.max(300, ms - lifts) / this.k;
  }

  private colorOf(layer: SprayLayer, p: Point): string {
    return typeof layer.color === 'function' ? layer.color(p, this.box) : layer.color;
  }

  private segment(a: Point, b: Point) {
    const k = this.k;
    const r = this.rnd;
    this.look.layers.forEach((layer, i) => {
      const ctx = this.layers[i];
      let w = layer.width * k;
      if (layer.nib) w *= 0.28 + 0.72 * Math.abs(Math.sin(Math.atan2(b.y - a.y, b.x - a.x) - layer.nib));
      const color = this.colorOf(layer, b);
      const offs: [number, number][] =
        layer.kind === 'extrude'
          ? Array.from({ length: layer.steps ?? 1 }, (_, s) => {
              const f = (s + 1) / (layer.steps ?? 1);
              return [f * (layer.dx ?? 0) * k, f * (layer.dy ?? 0) * k];
            })
          : [[(layer.dx ?? 0) * k, (layer.dy ?? 0) * k]];
      ctx.save();
      ctx.globalAlpha = layer.alpha ?? 1;
      ctx.strokeStyle = color;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = w;
      if (layer.glow) {
        ctx.shadowBlur = layer.glow * k;
        ctx.shadowColor = color;
      }
      for (const [dx, dy] of offs) {
        ctx.beginPath();
        ctx.moveTo(a.x + dx, a.y + dy);
        ctx.lineTo(b.x + dx, b.y + dy);
        ctx.stroke();
      }
      ctx.restore();
      // Overspray: fine dots of paint around the line.
      if (layer.mist) {
        const n = Math.round(layer.mist * Math.hypot(b.x - a.x, b.y - a.y) * 0.9);
        ctx.save();
        ctx.fillStyle = color;
        for (let j = 0; j < n; j++) {
          const t = r();
          ctx.globalAlpha = (layer.alpha ?? 1) * (0.12 + r() * 0.3);
          ctx.beginPath();
          ctx.arc(
            a.x + (b.x - a.x) * t + gauss(r) * w * 1.35,
            a.y + (b.y - a.y) * t + gauss(r) * w * 1.35,
            (0.4 + r() * 1.1) * Math.max(1, k * 0.9),
            0,
            Math.PI * 2,
          );
          ctx.fill();
        }
        ctx.restore();
      }
    });
    const d = this.look.drips;
    if (d.along && r() < d.along * 0.012) this.drip(b);
    if (this.look.splatter && r() < this.look.splatter * 0.01) this.splat(b);
  }

  private drip(p: Point) {
    const d = this.look.drips;
    const li = d.layer ?? this.look.layers.length - 1;
    const layer = this.look.layers[li];
    this.drips.push({
      x: p.x + gauss(this.rnd) * 2,
      y: p.y + layer.width * this.k * 0.3,
      len: 0,
      to: (12 + this.rnd() * 46) * this.k,
      w: Math.max(1.5, layer.width * this.k * (0.28 + this.rnd() * 0.15)),
      li,
      color: d.color,
    });
  }

  private splat(p: Point) {
    const li = this.look.layers.length - 1;
    const ctx = this.layers[li];
    ctx.save();
    ctx.fillStyle = this.colorOf(this.look.layers[li], p);
    const n = 4 + Math.round(this.rnd() * 8);
    for (let i = 0; i < n; i++) {
      const a = this.rnd() * Math.PI * 2;
      const dist = (14 + this.rnd() * 60) * this.k;
      ctx.globalAlpha = 0.7 + this.rnd() * 0.3;
      ctx.beginPath();
      ctx.arc(p.x + Math.cos(a) * dist, p.y + Math.sin(a) * dist, (1 + this.rnd() * 5) * this.k * 0.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private growDrips(ms: number) {
    for (const d of this.drips) {
      if (d.len >= d.to) continue;
      const step = Math.min(d.to - d.len, ms * 0.14 * this.k * (1 - d.len / (d.to * 1.4)));
      const ctx = this.layers[d.li];
      ctx.save();
      ctx.strokeStyle = d.color;
      ctx.lineCap = 'round';
      ctx.lineWidth = d.w;
      ctx.beginPath();
      ctx.moveTo(d.x, d.y + d.len);
      ctx.lineTo(d.x, d.y + d.len + step);
      ctx.stroke();
      d.len += step;
      if (d.len >= d.to - 0.01) {
        ctx.fillStyle = d.color;
        ctx.beginPath();
        ctx.arc(d.x, d.y + d.len, d.w * 0.85, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  /** Moves the pen on by `ms` at `speed` (letter units per ms). True once everything, drips too, is done. */
  advance(ms: number, speed: number): boolean {
    let budget = ms * speed * this.k;
    while (budget > 0 && !this.done) {
      if (this.wait > 0) {
        this.wait -= Math.min(this.wait, ms);
        this.penDown = false;
        break;
      }
      const s = this.strokes[this.si];
      if (!s) {
        this.done = true;
        break;
      }
      if (this.pi >= s.length - 1) {
        // End of a stroke: maybe a drip, then the pen lifts to the next one.
        if (this.look.drips.end && this.rnd() < this.look.drips.end) this.drip(s[s.length - 1]);
        this.si++;
        this.pi = 0;
        this.wait = LIFT_MS;
        continue;
      }
      const a = s[this.pi];
      const b = s[this.pi + 1];
      this.segment(a, b);
      budget -= Math.hypot(b.x - a.x, b.y - a.y);
      this.pi++;
      this.penDown = true;
    }
    this.growDrips(ms);
    this.composite();
    return this.done && this.drips.every((d) => d.len >= d.to);
  }

  /** Sprays everything at once (previews, reduced motion). */
  finish() {
    let guard = 0;
    while (!this.done && guard++ < 200_000) this.advance(16, 1e6);
    for (let i = 0; i < 200; i++) this.growDrips(40);
    this.composite();
  }

  private composite() {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.clearRect(0, 0, this.W, this.H);
    for (const l of this.layers) ctx.drawImage(l.canvas, 0, 0);
  }
}

/** A spray can's hiss: louder while the pen is down. */
export class Hiss {
  private ac: AudioContext | null = null;
  private src: AudioBufferSourceNode | null = null;
  private gain: GainNode | null = null;

  start() {
    try {
      this.ac ??= new AudioContext();
      if (this.ac.state === 'suspended') void this.ac.resume();
    } catch {
      this.ac = null;
      return;
    }
    const ac = this.ac;
    this.stop();
    const buf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const high = ac.createBiquadFilter();
    high.type = 'highpass';
    high.frequency.value = 2600;
    const peak = ac.createBiquadFilter();
    peak.type = 'peaking';
    peak.frequency.value = 6500;
    peak.gain.value = 6;
    const gain = ac.createGain();
    gain.gain.value = 0.0001;
    src.connect(high).connect(peak).connect(gain).connect(ac.destination);
    src.start();
    this.src = src;
    this.gain = gain;
    // The ball in the can, shaken.
    [0, 0.08, 0.16].forEach((t) => {
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = 'square';
      o.frequency.value = 1900 + Math.random() * 500;
      g.gain.setValueAtTime(0.0001, ac.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.06, ac.currentTime + t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + t + 0.04);
      o.connect(g).connect(ac.destination);
      o.start(ac.currentTime + t);
      o.stop(ac.currentTime + t + 0.05);
    });
  }

  set(on: boolean) {
    if (!this.gain || !this.ac) return;
    const t = this.ac.currentTime;
    this.gain.gain.cancelScheduledValues(t);
    this.gain.gain.setTargetAtTime(on ? 0.18 : 0.0001, t, on ? 0.02 : 0.03);
  }

  stop() {
    const src = this.src;
    if (src) {
      this.set(false);
      setTimeout(() => {
        try {
          src.stop();
        } catch {
          // already stopped
        }
      }, 120);
    }
    this.src = null;
    this.gain = null;
  }
}
