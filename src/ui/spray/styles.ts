// How each spray tag style looks (which styles exist and what earns them:
// src/achievements/tags.ts). Units are those of the letters: a capital is 100
// high. `layers` are painted bottom first, each into its own canvas so an
// outline stays under every colour: 'paint' is a sprayed line, 'extrude' a
// 3D side. slant: lean to the right; bounce: letters up and down, turned and
// sized; spacing: added between letters; jitter: a shaky hand; nib: a
// calligraphy pen's angle (the width follows the direction); drips: chance
// of paint running at a stroke's end (`end`) and along it (`along`);
// splatter: blobs of paint thrown around; flourish: strokes added after the
// letters.

/** Where a colour is wanted, and the box of the letters (canvas pixels). */
export interface Point {
  readonly x: number;
  readonly y: number;
}
export interface Box {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}
export type ColorFn = (p: Point, box: Box) => string;

export interface SprayLayer {
  readonly kind: 'paint' | 'extrude';
  readonly width: number;
  readonly color: string | ColorFn;
  readonly mist?: number;
  readonly alpha?: number;
  readonly glow?: number;
  readonly nib?: number;
  readonly dx?: number;
  readonly dy?: number;
  /** extrude: copies stacked toward (dx, dy). */
  readonly steps?: number;
}

export type Flourish = 'underline' | 'arrow' | 'arrowStart' | 'crown' | 'stars' | 'halo' | 'bolt' | 'xmarks';

export interface SprayLook {
  readonly slant: number;
  readonly bounce: number;
  readonly spacing: number;
  readonly jitter?: number;
  readonly layers: readonly SprayLayer[];
  readonly drips: { readonly end: number; readonly along?: number; readonly color: string; readonly layer?: number };
  readonly splatter?: number;
  readonly flourish: readonly Flourish[];
}

const hex = (c: string): [number, number, number] => {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const mix = (a: string, b: string, t: number): string => {
  const A = hex(a);
  const B = hex(b);
  return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(',')})`;
};
const gradX =
  (c1: string, c2: string): ColorFn =>
  (p, box) =>
    mix(c1, c2, Math.min(1, Math.max(0, (p.x - box.x0) / (box.x1 - box.x0))));
const splitY =
  (c1: string, c2: string): ColorFn =>
  (p, box) =>
    (p.y - box.y0) / (box.y1 - box.y0) < 0.52 ? c1 : c2;
const chrome: ColorFn = (p, box) => {
  const t = (p.y - box.y0) / (box.y1 - box.y0);
  if (t < 0.3) return mix('#ffffff', '#d7dcea', t / 0.3);
  if (t < 0.5) return mix('#d7dcea', '#6d768c', (t - 0.3) / 0.2);
  if (t < 0.56) return '#3c4255';
  return mix('#aeb7cd', '#f2f5ff', Math.min(1, (t - 0.56) / 0.44));
};

export const SPRAY_LOOKS: Readonly<Record<string, SprayLook>> = {
  signature: {
    slant: 0.22,
    bounce: 0.15,
    spacing: -0.05,
    layers: [{ kind: 'paint', width: 6.5, color: '#f4f1ea', mist: 0.8 }],
    drips: { end: 0.18, color: '#f4f1ea' },
    flourish: ['underline'],
  },
  drippy: {
    slant: 0.12,
    bounce: 0.2,
    spacing: 0.05,
    layers: [{ kind: 'paint', width: 10, color: '#ff2e93', mist: 1.2 }],
    drips: { end: 0.85, along: 0.5, color: '#ff2e93' },
    flourish: [],
  },
  throwup: {
    slant: 0.05,
    bounce: 0.35,
    spacing: -0.35,
    layers: [
      { kind: 'paint', width: 30, color: '#0b0b0c', mist: 0.5 },
      { kind: 'paint', width: 21, color: '#c6ff3d', mist: 0.2 },
      { kind: 'paint', width: 4, color: '#f7ffe0', mist: 0, dx: -4, dy: -5, alpha: 0.85 },
    ],
    drips: { end: 0.2, color: '#c6ff3d', layer: 1 },
    flourish: [],
  },
  mist: {
    slant: 0.1,
    bounce: 0.2,
    spacing: 0,
    layers: [
      { kind: 'paint', width: 18, color: '#3fd8ff', mist: 3.2, alpha: 0.25 },
      { kind: 'paint', width: 7, color: '#e9fbff', mist: 1.4 },
    ],
    drips: { end: 0.25, color: '#e9fbff', layer: 1 },
    flourish: ['stars'],
  },
  calli: {
    slant: 0.18,
    bounce: 0.1,
    spacing: 0.05,
    layers: [
      { kind: 'paint', width: 17, color: '#efe6d2', mist: 0.4, nib: 0.8 },
      { kind: 'paint', width: 12, color: '#0b0b0c', mist: 0.3, nib: 0.8 },
    ],
    drips: { end: 0.12, color: '#0b0b0c', layer: 1 },
    flourish: ['underline'],
  },
  crown: {
    slant: 0.12,
    bounce: 0.3,
    spacing: -0.1,
    layers: [
      { kind: 'paint', width: 18, color: '#2b1a00', mist: 0.3 },
      { kind: 'paint', width: 11, color: splitY('#ffe27a', '#e0a21b'), mist: 0.4 },
    ],
    drips: { end: 0.2, color: '#e0a21b', layer: 1 },
    flourish: ['crown', 'stars'],
  },
  toxic: {
    slant: 0.15,
    bounce: 0.45,
    spacing: -0.15,
    layers: [
      { kind: 'paint', width: 20, color: '#0b0b0c', mist: 0.4 },
      { kind: 'paint', width: 13, color: '#9dff00', mist: 1.1 },
    ],
    drips: { end: 0.9, along: 0.8, color: '#9dff00', layer: 1 },
    splatter: 0.6,
    flourish: [],
  },
  chaos: {
    slant: 0.25,
    bounce: 0.55,
    spacing: 0.1,
    jitter: 1.2,
    layers: [{ kind: 'paint', width: 7, color: '#ff2a2a', mist: 1 }],
    drips: { end: 0.6, along: 0.4, color: '#ff2a2a' },
    splatter: 1,
    flourish: ['xmarks'],
  },
  wild: {
    slant: 0.08,
    bounce: 0.75,
    spacing: -0.4,
    layers: [
      { kind: 'extrude', width: 20, color: '#4a1d6e', dx: 7, dy: 8, steps: 5 },
      { kind: 'paint', width: 23, color: '#0b0b0c', mist: 0.3 },
      { kind: 'paint', width: 15, color: gradX('#ff2e93', '#ff9a1f'), mist: 0.4 },
    ],
    drips: { end: 0.15, color: '#ff9a1f', layer: 2 },
    flourish: ['arrow', 'arrowStart'],
  },
  bubble: {
    slant: 0,
    bounce: 0.4,
    spacing: -0.3,
    layers: [
      { kind: 'paint', width: 34, color: '#0b0b0c', mist: 0.2 },
      { kind: 'paint', width: 28, color: '#ffffff', mist: 0 },
      { kind: 'paint', width: 21, color: '#ff7ad1', mist: 0.2 },
      { kind: 'paint', width: 3.5, color: '#ffffff', mist: 0, dx: -5, dy: -6 },
    ],
    drips: { end: 0.1, color: '#ff7ad1', layer: 2 },
    flourish: ['stars'],
  },
  neon: {
    slant: 0.1,
    bounce: 0.1,
    spacing: 0.1,
    layers: [
      { kind: 'paint', width: 14, color: '#00e5ff', mist: 0, glow: 22, alpha: 0.55 },
      { kind: 'paint', width: 5, color: '#e8feff', mist: 0, glow: 8 },
    ],
    drips: { end: 0, color: '#00e5ff' },
    flourish: ['halo'],
  },
  volt: {
    slant: 0.1,
    bounce: 0.3,
    spacing: 0,
    jitter: 3.2,
    layers: [
      { kind: 'paint', width: 15, color: '#0b0b0c', mist: 0.2 },
      { kind: 'paint', width: 8, color: '#ffe100', mist: 0.6, glow: 6 },
    ],
    drips: { end: 0, color: '#ffe100' },
    flourish: ['bolt'],
  },
  retro: {
    slant: 0.16,
    bounce: 0.2,
    spacing: 0.05,
    layers: [
      { kind: 'paint', width: 12, color: '#d81b3b', mist: 0, dx: 12, dy: 10 },
      { kind: 'paint', width: 12, color: '#ffd23f', mist: 0, dx: 6, dy: 5 },
      { kind: 'paint', width: 12, color: '#ff7a1a', mist: 0.3 },
    ],
    drips: { end: 0.15, color: '#ff7a1a', layer: 2 },
    flourish: ['underline'],
  },
  chrome: {
    slant: 0.06,
    bounce: 0.25,
    spacing: -0.2,
    layers: [
      { kind: 'extrude', width: 22, color: '#1f4fd1', dx: 6, dy: 6, steps: 4 },
      { kind: 'paint', width: 25, color: '#0b0b0c', mist: 0.2 },
      { kind: 'paint', width: 17, color: chrome, mist: 0.1 },
    ],
    drips: { end: 0, color: '#d7dcea' },
    flourish: ['stars'],
  },
  night: {
    slant: 0.1,
    bounce: 0.35,
    spacing: -0.15,
    layers: [
      { kind: 'extrude', width: 18, color: '#0b0b0c', dx: 6, dy: 7, steps: 4 },
      { kind: 'paint', width: 21, color: '#f4f1ea', mist: 0.2 },
      { kind: 'paint', width: 14, color: splitY('#2e7bff', '#8f3dff'), mist: 0.4 },
    ],
    drips: { end: 0.25, color: '#8f3dff', layer: 2 },
    flourish: ['underline'],
  },
};

export const lookOf = (id: string): SprayLook => SPRAY_LOOKS[id] ?? SPRAY_LOOKS.signature;
