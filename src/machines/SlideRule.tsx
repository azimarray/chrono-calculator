import { memo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import type { Frame, Job, MachineProps, Plan } from '../types';
import { useSequencer } from '../lib/useSequencer';
import { sfx } from '../lib/audio';
import { fmt } from '../lib/math';
import { MachineShell, Screw, SharedDefs, svgPoint, useJobRunner } from './common';

/* Geometry ---------------------------------------------------------- */
const X0 = 250; // position of index "1" on C/D
const L = 1100; // length of one C/D decade
const BODY_L = 150;
const BODY_R = 1450;
const TOP = { y0: 270, y1: 430 };
const SLIDE = { y0: 430, y1: 550 };
const BOT = { y0: 550, y1: 710 };
const LENS_Y = 140;
const LENS_R = 105;
const ZOOM = 3;

export interface SlideState {
  slide: number; // offset of the slide in decades
  cursor: number; // hairline position in decades from D index
  lensY: number; // which scale boundary the magnifier is reading
  readout: string | null;
}
const REST: SlideState = { slide: 0, cursor: 0, lensY: SLIDE.y1, readout: null };

/* Tick generation ---------------------------------------------------- */
interface Tick {
  pos: number;
  level: 0 | 1 | 2 | 3;
  label?: string;
  small?: boolean;
}

function levelFor(subs: number, k: number): Tick['level'] {
  if (subs === 50) return k % 10 === 0 ? 1 : k % 5 === 0 ? 2 : 3;
  if (subs === 20) return k % 10 === 0 ? 1 : k % 2 === 0 ? 2 : 3;
  if (subs === 10) return k % 5 === 0 ? 1 : 2;
  if (subs === 2) return 1;
  return 2;
}

function logTicks(dec: number): Tick[] {
  const out: Tick[] = [];
  for (let e = 0; e < dec; e++) {
    for (let i = 1; i < 10; i++) {
      const lo = i * 10 ** e;
      const hi = (i + 1) * 10 ** e;
      const span = (L / dec) * Math.log10((i + 1) / i);
      const subs = [50, 20, 10, 5, 2, 1].find((s) => span / s >= 5.2) ?? 1;
      for (let k = 0; k < subs; k++) {
        const v = lo + ((hi - lo) * k) / subs;
        const pos = Math.log10(v) / dec;
        if (k === 0) out.push({ pos, level: 0, label: String(i) });
        else {
          const tenth = subs >= 10 && k % (subs / 10) === 0;
          out.push({
            pos,
            level: levelFor(subs, k),
            label: dec === 1 && i === 1 && tenth ? String(k / (subs / 10)) : undefined,
            small: true,
          });
        }
      }
    }
  }
  out.push({ pos: 1, level: 0, label: '1' });
  return out;
}

function linearTicks(): Tick[] {
  const out: Tick[] = [];
  for (let k = 0; k <= 100; k++) {
    out.push({ pos: k / 100, level: k % 10 === 0 ? 0 : k % 5 === 0 ? 1 : 2, label: k % 10 === 0 ? String(k / 10 === 10 ? 1 : k / 10) : undefined });
  }
  return out;
}

function llTicks(sign: 1 | -1): Tick[] {
  const out: Tick[] = [];
  let lastX = -99;
  // m in ten-thousandths: LL1 1.0100 → 1.1050, LL01 0.9900 → 0.9050
  const start = sign > 0 ? 10100 : 9900;
  const end = sign > 0 ? 11050 : 9050;
  for (let m = start; sign > 0 ? m <= end : m >= end; m += sign * 5) {
    const v = m / 10000;
    const pos = Math.log10(sign * 100 * Math.log(v));
    if (pos < -0.001 || pos > 1.001) continue;
    const off = Math.abs(m - 10000);
    const level: Tick['level'] = off % 100 === 0 ? 0 : off % 50 === 0 ? 1 : off % 10 === 0 ? 2 : 3;
    const x = pos * L;
    if (level >= 2 && x - lastX < 4.5) continue;
    lastX = x;
    out.push({
      pos,
      level,
      label: level === 0 ? (sign > 0 ? v.toFixed(2) : v.toFixed(2).slice(1)) : undefined,
    });
  }
  return out;
}

const TICK_LEN = [20, 14, 10, 6];

interface ScaleDef {
  id: string;
  name: string;
  base: number;
  dir: 1 | -1;
  ticks: Tick[];
  red?: boolean;
  invert?: boolean;
}

const C_TICKS = logTicks(1);
const SCALES_TOP: ScaleDef[] = [
  { id: 'LL01', name: 'LL01', base: TOP.y0 + 2, dir: 1, ticks: llTicks(-1), red: true },
  { id: 'L', name: 'L', base: TOP.y0 + 38, dir: 1, ticks: linearTicks() },
  { id: 'K', name: 'K', base: TOP.y0 + 74, dir: 1, ticks: logTicks(3) },
  { id: 'A', name: 'A', base: TOP.y1, dir: -1, ticks: logTicks(2) },
];
const SCALES_SLIDE: ScaleDef[] = [
  { id: 'B', name: 'B', base: SLIDE.y0, dir: 1, ticks: logTicks(2) },
  { id: 'CI', name: 'CI', base: SLIDE.y0 + 40, dir: 1, ticks: C_TICKS, red: true, invert: true },
  { id: 'C', name: 'C', base: SLIDE.y1, dir: -1, ticks: C_TICKS },
];
const SCALES_BOT: ScaleDef[] = [
  { id: 'D', name: 'D', base: BOT.y0, dir: 1, ticks: C_TICKS },
  { id: 'DI', name: 'DI', base: BOT.y0 + 44, dir: 1, ticks: C_TICKS, red: true, invert: true },
  { id: 'LL1', name: 'LL1', base: BOT.y0 + 90, dir: 1, ticks: llTicks(1) },
];

function Scale({ s }: { s: ScaleDef }) {
  const color = s.red ? '#b3261e' : '#1d1a16';
  let d = '';
  const labels: { x: number; t: string; small?: boolean }[] = [];
  for (const t of s.ticks) {
    const p = s.invert ? 1 - t.pos : t.pos;
    const x = X0 + p * L;
    d += `M${x.toFixed(2)} ${s.base}v${s.dir * TICK_LEN[t.level]}`;
    if (t.label) labels.push({ x, t: t.label, small: t.small });
  }
  const ly = s.base + s.dir * (TICK_LEN[0] + 11) + (s.dir > 0 ? 3 : 8);
  return (
    <g>
      <path d={d} stroke={color} strokeWidth={1.15} fill="none" />
      {labels.map((l, i) => (
        <text
          key={i}
          x={l.x}
          y={ly}
          textAnchor="middle"
          fontSize={l.small ? 11 : 15}
          fill={color}
          fontFamily="'IBM Plex Sans', Helvetica, sans-serif"
          fontStyle={s.invert ? 'italic' : undefined}
        >
          {l.t}
        </text>
      ))}
      <text x={X0 - 12} y={s.base + s.dir * 14 + (s.dir > 0 ? 6 : 4)} textAnchor="end" fontSize={15} fontWeight={600} fill={color} fontFamily="'IBM Plex Sans', Helvetica, sans-serif">
        {s.name}
      </text>
    </g>
  );
}

const StatorTop = memo(function StatorTop() {
  return (
    <g>
      <rect x={BODY_L} y={TOP.y0} width={BODY_R - BODY_L} height={TOP.y1 - TOP.y0} fill="url(#srIvory)" />
      {SCALES_TOP.map((s) => (
        <Scale key={s.id} s={s} />
      ))}
    </g>
  );
});
const StatorBottom = memo(function StatorBottom() {
  return (
    <g>
      <rect x={BODY_L} y={BOT.y0} width={BODY_R - BODY_L} height={BOT.y1 - BOT.y0} fill="url(#srIvory)" />
      {SCALES_BOT.map((s) => (
        <Scale key={s.id} s={s} />
      ))}
      <text x={X0 + L} y={BOT.y1 - 10} textAnchor="end" fontSize={10} fill="#5b544a" fontFamily="'IBM Plex Sans', sans-serif" letterSpacing={1.5}>
        LOG LOG DUPLEX · MADE IN U.S.A.
      </text>
    </g>
  );
});
const SlideStrip = memo(function SlideStrip() {
  return (
    <g>
      <rect x={BODY_L} y={SLIDE.y0} width={BODY_R - BODY_L} height={SLIDE.y1 - SLIDE.y0} fill="url(#srSlide)" />
      <line x1={BODY_L} x2={BODY_R} y1={SLIDE.y0 + 0.5} y2={SLIDE.y0 + 0.5} stroke="rgba(0,0,0,.35)" />
      <line x1={BODY_L} x2={BODY_R} y1={SLIDE.y1 - 0.5} y2={SLIDE.y1 - 0.5} stroke="rgba(0,0,0,.35)" />
      {SCALES_SLIDE.map((s) => (
        <Scale key={s.id} s={s} />
      ))}
    </g>
  );
});

function Bracket({ x }: { x: number }) {
  return (
    <g>
      {[
        [TOP.y0 - 8, TOP.y1 + 6],
        [BOT.y0 - 6, BOT.y1 + 8],
      ].map(([y0, y1], i) => (
        <g key={i}>
          <rect x={x} y={y0} width={78} height={y1 - y0} rx={8} fill="url(#srChrome)" stroke="rgba(0,0,0,.35)" />
          <Screw x={x + 39} y={y0 + 22} r={7} rot={20 + i * 40} />
          <Screw x={x + 39} y={y1 - 22} r={7} rot={70 + i * 30} />
        </g>
      ))}
    </g>
  );
}

function Cursor({ x }: { x: number }) {
  return (
    <g className="anim" style={{ transform: `translateX(${x}px)` }}>
      <rect x={-66} y={250} width={132} height={480} rx={10} fill="rgba(198,222,230,.22)" stroke="rgba(80,100,112,.55)" strokeWidth={2} />
      <rect x={-60} y={256} width={10} height={468} rx={4} fill="rgba(255,255,255,.28)" />
      <line x1={0} x2={0} y1={252} y2={728} stroke="#9c1f17" strokeWidth={1.6} />
      {[236, 720].map((y) => (
        <g key={y}>
          <rect x={-76} y={y} width={152} height={26} rx={6} fill="url(#srChrome)" stroke="rgba(0,0,0,.4)" />
          <Screw x={-56} y={y + 13} r={6} />
          <Screw x={56} y={y + 13} r={6} rot={80} />
        </g>
      ))}
    </g>
  );
}

/** Everything on the rule body; rendered twice (stage + magnifier). */
function RuleBody({ slide, cursor, interactive, onSlideDown, onCursorDown }: {
  slide: number;
  cursor: number;
  interactive?: boolean;
  onSlideDown?: (e: RPointerEvent) => void;
  onCursorDown?: (e: RPointerEvent) => void;
}) {
  return (
    <g>
      <rect x={BODY_L + 6} y={SLIDE.y0} width={BODY_R - BODY_L - 12} height={SLIDE.y1 - SLIDE.y0} fill="#ddd6c6" />
      <StatorTop />
      <StatorBottom />
      <g
        className={`anim ${interactive ? 'cursor-ew-resize' : ''}`}
        style={{ transform: `translateX(${slide * L}px)` }}
        onPointerDown={interactive ? onSlideDown : undefined}
      >
        <SlideStrip />
      </g>
      <Bracket x={BODY_L - 36} />
      <Bracket x={BODY_R - 42} />
      <g onPointerDown={interactive ? onCursorDown : undefined} className={interactive ? 'cursor-ew-resize' : ''}>
        <Cursor x={X0 + cursor * L} />
      </g>
    </g>
  );
}

/* Planning ---------------------------------------------------------- */
const lg = Math.log10;
function norm(v: number) {
  const e = Math.floor(lg(v));
  return { m: v / 10 ** e, e };
}
const r3 = (v: number) => Number(v.toPrecision(3));
const show3 = (m: number) => {
  const r = r3(m);
  return r >= 10 ? '10.0' : r.toFixed(2);
};

export function planSlideRule(job: Job): Plan<SlideState> {
  const { op, a, b } = job;
  if (op === '+' || op === '−') return { ok: false, error: 'A slide rule adds logarithms, not numbers — it cannot add or subtract.' };
  if (a <= 0 || (op !== '√' && b <= 0)) return { ok: false, error: 'Zero and negative numbers have no place on logarithmic scales.' };

  const frames: Frame<SlideState>[] = [];
  let st: SlideState = { ...REST };
  const push = (patch: Partial<SlideState>, text: string, x: number, y: number, kind: 'slide' | 'none', t = 1150, dur = 1650) => {
    st = { ...st, ...patch };
    frames.push({ state: st, dur, t, callout: { x, y, text, ly: 812 }, sound: kind === 'slide' ? { kind: 'slide', ms: t } : undefined });
  };
  const hx = (c: number) => X0 + c * L;

  push({}, 'Neutral: the 1 on C sits exactly over the 1 on D', X0, SLIDE.y1, 'none', 700, 1100);

  let exact: number;
  let explanation: string;
  if (op === '√') {
    // A scale spans 1–100: odd digit counts use the left half, even the right.
    const e = Math.floor(lg(a));
    const k = Math.floor(e / 2);
    const ap = a / 100 ** k; // in [1, 100)
    const half = ap < 10 ? 'left half' : 'right half';
    const pos = lg(ap) / 2;
    push({ lensY: TOP.y1, cursor: pos }, `Hairline to ${fmt(r3(ap))} on A (${half})`, hx(pos), TOP.y1 - 8, 'slide', 1300, 1900);
    push({ lensY: SLIDE.y1 }, 'Look down the same hairline to D: A is D squared', hx(pos), BOT.y0 + 8, 'none', 900, 1400);
    exact = Math.sqrt(a);
    st = { ...st, readout: `D ≈ ${show3(Math.sqrt(ap))}` };
    frames.push({ state: st, dur: 700, t: 200, callout: null });
    explanation = `The A scale is drawn at half the length of D, so every A value sits directly above its square root on D. Setting ${fmt(a)} on A and reading D gives the root's digits; the operator places the decimal point.`;
  } else {
    const A = norm(a);
    const B = norm(b);
    const la = lg(A.m);
    const lb = lg(B.m);
    push({ cursor: la }, `Move the hairline to ${fmt(r3(A.m))} on D`, hx(la), BOT.y0 + 8, 'slide');
    let readPos: number;
    if (op === '×') {
      const right = la + lb >= 1;
      const slide = right ? la - 1 : la;
      push(
        { slide },
        right ? 'Off the end: bring C’s right index (10) under the hairline' : 'Slide C’s index 1 under the hairline',
        hx(right ? slide + 1 : slide),
        SLIDE.y1 - 8,
        'slide',
        1250,
        1750,
      );
      readPos = slide + lb;
      push({ cursor: readPos }, `Move the hairline to ${fmt(r3(B.m))} on C`, hx(readPos), SLIDE.y1 - 8, 'slide');
      exact = a * b;
      explanation = `Logarithms turn multiplication into addition: sliding C by log ${fmt(A.m)} and moving a further log ${fmt(B.m)} along it lands on log ${fmt(r3(A.m * B.m))} on D. The operator tracks the decimal point mentally.`;
    } else {
      const slide = la - lb;
      push({ slide }, `Slide ${fmt(r3(B.m))} on C under the hairline`, hx(la), SLIDE.y1 - 8, 'slide', 1250, 1750);
      readPos = slide < 0 ? slide + 1 : slide;
      push({ cursor: readPos }, slide < 0 ? 'Move the hairline to C’s right index (10)' : 'Move the hairline to C’s index 1', hx(readPos), SLIDE.y1 - 8, 'slide');
      exact = a / b;
      explanation = `Division subtracts logarithms: with ${fmt(B.m)} on C set over ${fmt(A.m)} on D, the C index now sits at log ${fmt(A.m)} − log ${fmt(B.m)}, which is read straight off D. The operator places the decimal point.`;
    }
    st = { ...st, readout: `D ≈ ${show3(10 ** readPos)}` };
    frames.push({ state: st, dur: 700, t: 200, callout: null });
  }

  const reading = r3(exact);
  return {
    ok: true,
    frames,
    outcome: {
      display: `≈ ${fmt(reading)}`,
      explanation,
      note: reading === exact ? undefined : `3-significant-figure slide rule reading · exact value ${fmt(exact)}`,
    },
  };
}

/* Component --------------------------------------------------------- */
export default function SlideRule(props: MachineProps) {
  const seq = useSequencer<SlideState>(REST, props.speed);
  useJobRunner(props.job, planSlideRule, seq, props, REST);
  const { slide, cursor, lensY, readout } = seq.state;
  const interactive = !seq.playing;
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ what: 'slide' | 'cursor'; x0: number; v0: number; last: number; el: Element } | null>(null);

  const cursorX = X0 + cursor * L;
  const lensCX = Math.max(BODY_L + 20, Math.min(BODY_R - 20, cursorX));

  const begin = (what: 'slide' | 'cursor') => (e: RPointerEvent) => {
    e.stopPropagation();
    const el = e.currentTarget as Element;
    (el as Element & { setPointerCapture?: (id: number) => void }).setPointerCapture?.(e.pointerId);
    const p = svgPoint(e, el);
    drag.current = { what, x0: p.x, v0: what === 'slide' ? slide : cursor, last: p.x, el };
    setDragging(true);
    sfx.frictionStart();
  };
  const move = (e: RPointerEvent) => {
    const g = drag.current;
    if (!g) return;
    const p = svgPoint(e, g.el);
    sfx.frictionUpdate(p.x - g.last);
    g.last = p.x;
    const v = g.v0 + (p.x - g.x0) / L;
    const next: SlideState =
      g.what === 'slide'
        ? { ...seq.state, slide: Math.max(-1, Math.min(1, v)), readout: null }
        : { ...seq.state, cursor: Math.max(-0.05, Math.min(1.05, v)), readout: null };
    seq.setManual(next, 0);
    const cD = Math.min(1, Math.max(0, next.cursor));
    const onC = next.cursor - next.slide;
    const cTxt = onC >= -0.0001 && onC <= 1.0001 ? ` · C ${show3(10 ** onC)}` : '';
    seq.setCallout({
      x: X0 + next.cursor * L,
      y: BOT.y0 + 8,
      text: `D ${show3(10 ** cD)}${cTxt} · A ${fmt(r3(100 ** cD))}`,
      step: 0,
      total: 0,
      ly: 812,
    });
  };
  const end = () => {
    if (!drag.current) return;
    drag.current = null;
    setDragging(false);
    sfx.frictionStop();
  };

  return (
    <MachineShell
      transitionMs={seq.transitionMs}
      callout={seq.callout}
      slow={props.speed > 1}
      dragging={dragging}
      label="Log-log duplex slide rule with glass cursor"
    >
      <SharedDefs />
      <defs>
        <linearGradient id="srIvory" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f8f4e7" />
          <stop offset="1" stopColor="#ede5cf" />
        </linearGradient>
        <linearGradient id="srSlide" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f3eedd" />
          <stop offset="1" stopColor="#e9e0c6" />
        </linearGradient>
        <linearGradient id="srChrome" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#8d9298" />
          <stop offset="0.35" stopColor="#e6e9ec" />
          <stop offset="0.65" stopColor="#b9bec4" />
          <stop offset="1" stopColor="#767b81" />
        </linearGradient>
        <clipPath id="srLensClip">
          <circle r={LENS_R} />
        </clipPath>
      </defs>

      <g onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
        <rect x={0} y={0} width={1600} height={900} fill="transparent" />
        <g filter="url(#softShadow)">
          <rect x={BODY_L} y={TOP.y0} width={BODY_R - BODY_L} height={BOT.y1 - TOP.y0} fill="#e8e0c8" />
        </g>
        <RuleBody slide={slide} cursor={cursor} interactive={interactive} onSlideDown={begin('slide')} onCursorDown={begin('cursor')} />

        {/* magnifier lens */}
        <g className="anim" style={{ transform: `translate(${lensCX}px, ${LENS_Y}px)` }}>
          <line x1={0} y1={LENS_R} x2={0} y2={236 - LENS_Y} stroke="#8d9298" strokeWidth={6} />
          <circle r={LENS_R + 9} fill="url(#srChrome)" filter="url(#smallShadow)" />
          <g clipPath="url(#srLensClip)">
            <circle r={LENS_R} fill="#f4efe2" />
            <g className="anim" style={{ transform: `scale(${ZOOM}) translate(${-cursorX}px, ${-lensY}px)` }}>
              <RuleBody slide={slide} cursor={cursor} />
            </g>
            <circle r={LENS_R} fill="url(#srGlass)" />
          </g>
          <circle r={LENS_R} fill="none" stroke="rgba(0,0,0,.35)" strokeWidth={2} />
          {readout && (
            <g className="fade-in">
              <rect x={-74} y={LENS_R - 30} width={148} height={34} rx={17} fill="#1d1a16" />
              <text y={LENS_R - 7} textAnchor="middle" fontSize={20} fill="#f8f4e7" fontFamily="'IBM Plex Mono', monospace" fontWeight={600}>
                {readout}
              </text>
            </g>
          )}
        </g>
        <defs>
          <radialGradient id="srGlass" cx="0.3" cy="0.25" r="0.9">
            <stop offset="0" stopColor="#fff" stopOpacity="0.35" />
            <stop offset="0.4" stopColor="#fff" stopOpacity="0" />
            <stop offset="1" stopColor="#5d7680" stopOpacity="0.18" />
          </radialGradient>
        </defs>
      </g>
    </MachineShell>
  );
}
