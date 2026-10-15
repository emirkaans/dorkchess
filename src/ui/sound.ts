// Sounds generated in code with the Web Audio API (no audio files). Moves are
// short wooden "tok"s like a piece put down on a board: a noise click for the
// contact plus a low body that drops in pitch.

export type SoundKind = 'move' | 'capture' | 'check' | 'captureCheck' | 'end' | 'mate' | 'lowtime' | 'start';

/** Sound of a played move: a capture always cracks (with a check ping on top when it also checks). */
export const moveSound = (captured: boolean, check: boolean): SoundKind =>
  captured ? (check ? 'captureCheck' : 'capture') : check ? 'check' : 'move';

let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;

function audio(): AudioContext | null {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null; // no audio support: stay silent
  }
}

/** Half a second of white noise, made once. */
function noiseBuffer(ac: AudioContext): AudioBuffer {
  if (noise && noise.sampleRate === ac.sampleRate) return noise;
  const buf = ac.createBuffer(1, Math.floor(ac.sampleRate * 0.5), ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  noise = buf;
  return buf;
}

/** A gain node with a fast attack and an exponential decay to silence. */
function envelope(ac: AudioContext, start: number, peak: number, decay: number): GainNode {
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(peak, start + 0.003);
  g.gain.exponentialRampToValueAtTime(0.0001, start + decay);
  g.connect(ac.destination);
  return g;
}

/** One oscillator note, optionally gliding to `toFreq`. */
function tone(
  ac: AudioContext,
  freq: number,
  start: number,
  dur: number,
  type: OscillatorType,
  peak: number,
  toFreq = freq,
) {
  const osc = ac.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (toFreq !== freq) osc.frequency.exponentialRampToValueAtTime(toFreq, start + dur * 0.6);
  osc.connect(envelope(ac, start, peak, dur));
  osc.start(start);
  osc.stop(start + dur + 0.02);
}

/** Filtered noise burst (the contact click of wood on wood). */
function click(ac: AudioContext, start: number, centre: number, peak: number, dur: number) {
  const src = ac.createBufferSource();
  src.buffer = noiseBuffer(ac);
  const band = ac.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = centre;
  band.Q.value = 1.1;
  src.connect(band).connect(envelope(ac, start, peak, dur));
  src.start(start);
  src.stop(start + dur + 0.02);
}

/** Filtered noise snap with a sharper filter (one crack of a breaking shell). */
function snap(ac: AudioContext, start: number, centre: number, peak: number, dur: number) {
  const src = ac.createBufferSource();
  src.buffer = noiseBuffer(ac);
  const band = ac.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = centre;
  band.Q.value = 2.5;
  src.connect(band).connect(envelope(ac, start, peak, dur));
  src.start(start, Math.random() * 0.3);
  src.stop(start + dur + 0.01);
}

/**
 * A nutshell cracking: one hard snap, then a quick, uneven run of smaller
 * crackles that die away (timings and pitches vary a little every time).
 */
function crack(ac: AudioContext, start: number) {
  snap(ac, start, 3200, 0.9, 0.018);
  let t = start + 0.012;
  for (let i = 0; i < 7; i++) {
    t += 0.006 + Math.random() * 0.014;
    snap(ac, t, 2600 + Math.random() * 3400, 0.55 * (1 - i / 9), 0.006 + Math.random() * 0.008);
  }
}

/** A piece set down: click, knock and a low body. `weight` makes it louder and deeper. */
function tok(ac: AudioContext, start: number, weight = 1) {
  click(ac, start, 2400 - 500 * weight, 0.55 * weight, 0.035);
  tone(ac, 420 - 60 * weight, start, 0.07, 'triangle', 0.22 * weight, 300);
  tone(ac, 190 - 30 * weight, start, 0.14, 'sine', 0.55 * weight, 105);
}

export function playSound(kind: SoundKind): void {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime + 0.005;
  switch (kind) {
    case 'move':
      tok(ac, t);
      break;
    case 'capture':
      // Only the crack, like a nutshell breaking (no "tok" of a plain move).
      crack(ac, t);
      break;
    case 'check':
      tok(ac, t, 1.1);
      tone(ac, 1320, t + 0.02, 0.18, 'sine', 0.09);
      break;
    case 'captureCheck':
      crack(ac, t);
      tone(ac, 1320, t + 0.03, 0.18, 'sine', 0.09);
      break;
    case 'end':
      tok(ac, t, 0.9);
      [330, 247].forEach((f, i) => tone(ac, f, t + 0.08 + i * 0.16, 0.6, 'triangle', 0.16));
      break;
    case 'mate':
      // The final blow, then a low gong and a falling chord.
      tok(ac, t, 1.4);
      tone(ac, 98, t + 0.05, 2.2, 'sine', 0.5, 92);
      tone(ac, 147, t + 0.05, 1.8, 'sine', 0.22);
      [392, 311, 262, 196].forEach((f, i) => tone(ac, f, t + 0.12 + i * 0.13, 0.9 + i * 0.2, 'triangle', 0.14));
      break;
    case 'start':
      // A game begins: two rising notes, loud enough to hear from another tab.
      [523, 784].forEach((f, i) => tone(ac, f, t + i * 0.14, 0.32, 'triangle', 0.2));
      break;
    case 'lowtime':
      tone(ac, 1000, t, 0.07, 'square', 0.08);
      tone(ac, 1000, t + 0.15, 0.07, 'square', 0.08);
      break;
  }
}
