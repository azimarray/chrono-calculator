import type { SoundCue } from '../types';

/**
 * Procedural sound effects built on the Web Audio API.
 * Nothing is sampled: every click, ratchet and slide is synthesised from
 * filtered noise and short sine "bodies" so the app stays tiny and offline.
 */
class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private friction: { src: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
  muted = false;

  private ensure(): AudioContext | null {
    if (this.muted) return null;
    if (!this.ctx) {
      const AC: typeof AudioContext | undefined =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      const ctx = new AC();
      const master = ctx.createGain();
      master.gain.value = 0.55;
      master.connect(ctx.destination);
      const len = ctx.sampleRate;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.ctx = ctx;
      this.master = master;
      this.noise = buf;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  /** Call from any user gesture so iOS/Safari unlock audio early. */
  unlock() {
    this.ensure();
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (m) this.frictionStop();
  }

  /** Band-passed noise burst + optional sine "body" — the building block of all clicks. */
  private click(opts: {
    at?: number;
    freq: number;
    q?: number;
    dur?: number;
    gain?: number;
    body?: number;
    bodyGain?: number;
    bodyDur?: number;
    ping?: number;
    pingGain?: number;
  }) {
    const ctx = this.ensure();
    if (!ctx || !this.master || !this.noise) return;
    const t0 = ctx.currentTime + (opts.at ?? 0);
    const dur = opts.dur ?? 0.04;

    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = opts.freq;
    bp.Q.value = opts.q ?? 5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(opts.gain ?? 0.5, t0 + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t0, Math.random() * 0.5);
    src.stop(t0 + dur + 0.02);

    if (opts.body) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(opts.body, t0);
      o.frequency.exponentialRampToValueAtTime(opts.body * 0.6, t0 + (opts.bodyDur ?? 0.08));
      const og = ctx.createGain();
      og.gain.setValueAtTime(opts.bodyGain ?? 0.3, t0);
      og.gain.exponentialRampToValueAtTime(0.0008, t0 + (opts.bodyDur ?? 0.08));
      o.connect(og).connect(this.master);
      o.start(t0);
      o.stop(t0 + (opts.bodyDur ?? 0.08) + 0.02);
    }
    if (opts.ping) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = opts.ping;
      const og = ctx.createGain();
      og.gain.setValueAtTime(opts.pingGain ?? 0.05, t0);
      og.gain.exponentialRampToValueAtTime(0.0005, t0 + 0.12);
      o.connect(og).connect(this.master);
      o.start(t0);
      o.stop(t0 + 0.14);
    }
  }

  /** Bronze/wood bead knocking against the slot end. */
  bead(at = 0) {
    const j = Math.random();
    this.click({ at, freq: 1700 + j * 700, q: 4, dur: 0.05, gain: 0.55, body: 480 + j * 120, bodyGain: 0.28, bodyDur: 0.07, ping: 2900 + j * 400, pingGain: 0.03 });
    this.click({ at: at + 0.016, freq: 2600, q: 6, dur: 0.025, gain: 0.18 });
  }

  /** Planned slide movement: a swell of filtered friction noise. */
  slide(ms: number) {
    const ctx = this.ensure();
    if (!ctx || !this.master || !this.noise) return;
    const t0 = ctx.currentTime;
    const d = Math.max(0.12, ms / 1000);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 0.9;
    bp.frequency.setValueAtTime(700, t0);
    bp.frequency.linearRampToValueAtTime(1100, t0 + d * 0.5);
    bp.frequency.linearRampToValueAtTime(650, t0 + d);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.16, t0 + Math.min(0.08, d * 0.3));
    g.gain.setValueAtTime(0.14, t0 + d * 0.75);
    g.gain.linearRampToValueAtTime(0, t0 + d);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t0);
    src.stop(t0 + d + 0.05);
    this.click({ at: d, freq: 1400, q: 3, dur: 0.03, gain: 0.12 });
  }

  /** Continuous friction for manual dragging; update with drag speed (px/frame-ish). */
  frictionStart() {
    const ctx = this.ensure();
    if (!ctx || !this.master || !this.noise || this.friction) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 800;
    filter.Q.value = 0.8;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(this.master);
    src.start();
    this.friction = { src, gain, filter };
  }
  frictionUpdate(speed: number) {
    if (!this.friction || !this.ctx) return;
    const s = Math.min(1, Math.abs(speed) / 18);
    const t = this.ctx.currentTime;
    this.friction.gain.gain.setTargetAtTime(s * 0.2, t, 0.03);
    this.friction.filter.frequency.setTargetAtTime(600 + s * 700, t, 0.05);
  }
  frictionStop() {
    if (!this.friction || !this.ctx) return;
    const f = this.friction;
    this.friction = null;
    const t = this.ctx.currentTime;
    f.gain.gain.setTargetAtTime(0, t, 0.03);
    f.src.stop(t + 0.2);
  }

  /** One crank turn: brass pawl clicking over a ratchet, ending in a solid clunk. */
  ratchet(ms: number) {
    const d = Math.max(0.15, ms / 1000);
    const n = 9;
    for (let i = 0; i < n; i++) {
      this.click({ at: (i / n) * d * 0.9, freq: 3300 + Math.random() * 500, q: 10, dur: 0.022, gain: 0.32, ping: 4300, pingGain: 0.025 });
    }
    this.click({ at: d * 0.92, freq: 1200, q: 2, dur: 0.06, gain: 0.4, body: 190, bodyGain: 0.35, bodyDur: 0.1 });
  }

  /** Comptometer key bottoming out. */
  key() {
    this.click({ freq: 2600, q: 3, dur: 0.028, gain: 0.7, body: 170, bodyGain: 0.42, bodyDur: 0.09 });
    this.click({ at: 0.03, freq: 3800, q: 8, dur: 0.02, gain: 0.15, ping: 5200, pingGain: 0.02 });
  }
  keyUp() {
    this.click({ freq: 1900, q: 4, dur: 0.022, gain: 0.22, body: 260, bodyGain: 0.1, bodyDur: 0.04 });
  }

  lever() {
    this.click({ freq: 1500, q: 3, dur: 0.05, gain: 0.45, body: 240, bodyGain: 0.3, bodyDur: 0.09 });
  }

  carriage() {
    this.slide(260);
    this.click({ at: 0.27, freq: 1100, q: 2, dur: 0.06, gain: 0.45, body: 150, bodyGain: 0.4, bodyDur: 0.12 });
  }

  clear(ms = 500) {
    const d = ms / 1000;
    for (let i = 0; i < 14; i++) this.click({ at: (i / 14) * d, freq: 2800 + Math.random() * 600, q: 8, dur: 0.018, gain: 0.25 });
    this.click({ at: d, freq: 900, q: 2, dur: 0.05, gain: 0.3, body: 160, bodyGain: 0.3 });
  }

  /** Soft modern UI tap. */
  tap() {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(720, t0);
    o.frequency.exponentialRampToValueAtTime(520, t0 + 0.06);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.16, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0005, t0 + 0.08);
    o.connect(g).connect(this.master);
    o.start(t0);
    o.stop(t0 + 0.1);
  }

  /** Gentle bell when a historical result is revealed. */
  chime() {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime;
    [880, 1320.5, 1760].forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0 + i * 0.05);
      g.gain.exponentialRampToValueAtTime(0.09 / (i + 1), t0 + i * 0.05 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0003, t0 + 1.4);
      o.connect(g).connect(this.master!);
      o.start(t0 + i * 0.05);
      o.stop(t0 + 1.5);
    });
  }

  /** Muted thud for a locked key. */
  deny() {
    this.click({ freq: 500, q: 1.5, dur: 0.06, gain: 0.25, body: 120, bodyGain: 0.3, bodyDur: 0.12 });
  }

  play(cue: SoundCue | SoundCue[] | undefined, speed: number) {
    if (!cue || this.muted) return;
    const cues = Array.isArray(cue) ? cue : [cue];
    for (const c of cues) {
      const ms = (c.ms ?? 300) * speed;
      switch (c.kind) {
        case 'bead': this.bead(Math.min(0.25, ms / 1000 * 0.85)); break;
        case 'slide': this.slide(ms); break;
        case 'ratchet': this.ratchet(ms); break;
        case 'key': this.key(); break;
        case 'keyUp': this.keyUp(); break;
        case 'lever': this.lever(); break;
        case 'carriage': this.carriage(); break;
        case 'clear': this.clear(Math.min(ms, 900)); break;
        case 'tap': this.tap(); break;
      }
    }
  }
}

export const sfx = new Sfx();
