// Sounds generated in code with the Web Audio API (no audio files).

export type SoundKind = 'move' | 'capture' | 'check' | 'end' | 'lowtime';

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null; // no audio support: stay silent
  }
}

/** One short note with a quick attack and exponential decay. */
function tone(ac: AudioContext, freq: number, start: number, dur: number, type: OscillatorType, peak: number) {
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(gain).connect(ac.destination);
  osc.start(start);
  osc.stop(start + dur + 0.02);
}

export function playSound(kind: SoundKind): void {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime;
  switch (kind) {
    case 'move':
      tone(ac, 520, t, 0.08, 'triangle', 0.25);
      break;
    case 'capture':
      tone(ac, 300, t, 0.12, 'square', 0.15);
      tone(ac, 200, t + 0.04, 0.12, 'triangle', 0.2);
      break;
    case 'check':
      tone(ac, 880, t, 0.1, 'sawtooth', 0.12);
      tone(ac, 1175, t + 0.1, 0.14, 'sawtooth', 0.12);
      break;
    case 'end':
      [523, 659, 784].forEach((f, i) => tone(ac, f, t + i * 0.12, 0.3, 'triangle', 0.2));
      break;
    case 'lowtime':
      tone(ac, 1000, t, 0.07, 'square', 0.1);
      tone(ac, 1000, t + 0.15, 0.07, 'square', 0.1);
      break;
  }
}
