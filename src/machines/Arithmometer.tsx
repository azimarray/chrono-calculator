import { useRef } from 'react';
import type { Frame, Job, MachineProps, Plan } from '../types';
import { useSequencer } from '../lib/useSequencer';
import { sfx } from '../lib/audio';
import { decimals, digitsOf, fixedPoint, fmt, pad } from '../lib/math';
import { DigitWheel, MachineShell, PLATE, Screw, SharedDefs, fitToPlate, fitTransform, mapCallout, svgPoint, useJobRunner } from './common';

/* Geometry ---------------------------------------------------------- */
const RES_DIGITS = 8;
const CNT_DIGITS = 6;
const SLIDERS = 6;
const MAX_SHIFT = 3; // 4 carriage positions: at the last one the carriage still sits on the brass
const PITCH = 72;
const RX0 = 1130; // units result window & units slider
const resX = (i: number) => RX0 - PITCH * i;
const cntX = (i: number) => 506 - 48 * i;
const sliderX = (j: number) => RX0 - PITCH * j;
const KNOB_Y0 = 682;
const KNOB_STEP = 28;
const knobY = (d: number) => KNOB_Y0 - d * KNOB_STEP;
/* Lever slot runs from y 474 down to 698, the same bottom edge as the slider slots; the knob rests at its centre. */
const LEVER = { x: 470, top: 474, bottom: 698, add: 502, neutral: 586, sub: 670 };
const CRANK = { x: 1335, y: 560 };
const MOD = 10 ** RES_DIGITS;
/* The case is drawn at x 110–1490, y 24–857 (the abacus plate's proportions) and scaled onto the plate. */
const CASE = { x: 110, y: 24, w: 1380, h: 833 };
const FIT = fitToPlate(CASE.x, CASE.y, CASE.w);
const CAR = { x: 300, label: 546, row: LEVER.neutral, step: 24 }; // carriage control: arrows level with the resting lever knob
const CLR = { label: 386, row: 418, name: 452, cnt: 232, res: 342 }; // names share the ADD · MULT baseline (y 452) // fixed clearing knobs

type Lever = 'neutral' | 'add' | 'sub';
export interface ArithState {
  res: number;
  cnt: number;
  sl: number[];
  lever: Lever;
  angle: number;
  shift: number;
}
const REST: ArithState = { res: 0, cnt: 0, sl: Array(SLIDERS).fill(0), lever: 'neutral', angle: 0, shift: 0 };

const PLACE = ['units', 'tens', 'hundreds', 'thousands', 'ten-thousands', 'hundred-thousands'];
const digitSum = (n: number) => String(n).split('').reduce((s, c) => s + Number(c), 0);

/* Planning ---------------------------------------------------------- */
export function planArithmometer(job: Job): Plan<ArithState> {
  const { op } = job;
  if (op === '√') return { ok: false, error: 'The arithmometer has no square-root mechanism.' };
  if (job.a < 0 || job.b < 0) return { ok: false, error: 'Enter positive numbers.' };

  const frames: Frame<ArithState>[] = [];
  let st: ArithState = { ...REST, sl: [...REST.sl], angle: 0 };
  const push = (patch: Partial<ArithState>, text: string | null, x: number, y: number, opts: { dur?: number; t?: number; sound?: Frame<ArithState>['sound']; ly?: number } = {}) => {
    st = { ...st, ...patch };
    frames.push({
      state: st,
      dur: opts.dur ?? 900,
      t: opts.t ?? 500,
      callout: text ? { x, y, text, ly: opts.ly ?? 850 } : null,
      sound: opts.sound,
    });
  };
  const lever = (l: Lever) => {
    if (st.lever === l) return;
    push({ lever: l }, l === 'add' ? 'Flip the lever to ADD / MULT' : 'Flip the lever to SUB / DIV', LEVER.x, LEVER[l], { sound: { kind: 'lever' }, t: 350, dur: 850 });
  };
  const setSliders = (n: number) => {
    const ds = digitsOf(n, SLIDERS);
    for (let j = SLIDERS - 1; j >= 0; j--) {
      if (st.sl[j] === ds[j]) continue;
      const sl = [...st.sl];
      sl[j] = ds[j];
      push({ sl }, `Set the ${PLACE[j]} slider to ${ds[j]}`, sliderX(j), knobY(ds[j]), { sound: { kind: 'lever' }, t: 450, dur: 800 });
    }
  };
  const shiftTo = (k: number) => {
    if (st.shift === k) return;
    push({ shift: k }, `Lift and shift the carriage ${k > st.shift ? 'right' : 'left'} to position ${k + 1} (×${fmt(10 ** k)})`, 760 + k * PITCH, 180, { sound: { kind: 'carriage' }, t: 520, dur: 950, ly: 66 });
  };
  const setting = () => Number(st.sl.slice().reverse().join(''));
  const crank = (text: string) => {
    const amount = setting() * 10 ** st.shift;
    const res = st.lever === 'sub' ? (st.res - amount + MOD) % MOD : (st.res + amount) % MOD;
    push({ res, cnt: (st.cnt + 10 ** st.shift) % 10 ** CNT_DIGITS, angle: st.angle + 360 }, text, CRANK.x + 70, CRANK.y - 30, {
      sound: { kind: 'ratchet', ms: 560 },
      t: 600,
      dur: 760,
    });
  };

  push({}, 'Cleared: result windows and turn counter at zero', resX(4), 250, { dur: 900, t: 300, ly: 66 });

  let display: string;
  let explanation: string;
  let note: string | undefined;

  if (op === '+' || op === '−') {
    const { A, B, d } = fixedPoint(job.aStr, job.bStr);
    if (A >= 10 ** SLIDERS || B >= 10 ** SLIDERS) return { ok: false, error: 'Each number must fit the 6 setting sliders.' };
    if (op === '+' && A + B >= MOD) return { ok: false, error: 'The sum overflows the 8 result windows.' };
    lever('add');
    setSliders(A);
    crank(`Turn the crank once: ${job.aStr} enters the result windows`);
    setSliders(B);
    if (op === '−') lever('sub');
    crank(`Turn once more: the drums ${op === '+' ? 'add' : 'subtract'} ${job.bStr}`);
    push({}, 'Read the result windows', resX(3), 250, { dur: 800, t: 200, ly: 66 });
    const exact = op === '+' ? A + B : A - B;
    display = fmt(exact / 10 ** d);
    explanation =
      op === '+'
        ? `Each crank turn rotates a stepped Leibniz drum under every slider; the drum's teeth turn the result wheels by the digit you set. Two turns added ${job.aStr} and then ${job.bStr}.`
        : `In SUB mode the crank turns the result wheels backwards, so the second turn took ${job.bStr} away from ${job.aStr}.`;
    if (exact < 0) note = `The windows show ${pad((exact + MOD) % MOD, 8)} — the ten's complement of a negative result, which the clerk read as −${fmt(-exact / 10 ** d)}.`;
    else if (d) note = `Brass decimal markers kept the point ${d} place${d > 1 ? 's' : ''} from the right.`;
  } else if (op === '×') {
    const da = decimals(job.aStr);
    const db = decimals(job.bStr);
    let A = Math.round(job.a * 10 ** da);
    let B = Math.round(job.b * 10 ** db);
    let swapped = false;
    // operators set the operand with more crank turns on the sliders
    if (digitSum(A) < digitSum(B) && B < 10 ** SLIDERS && String(A).length <= MAX_SHIFT + 1) {
      [A, B] = [B, A];
      swapped = true;
    }
    if (A >= 10 ** SLIDERS) return { ok: false, error: 'The multiplicand must fit the 6 setting sliders.' };
    if (String(B).length > MAX_SHIFT + 1) return { ok: false, error: 'The carriage has 4 positions: the multiplier can have at most 4 digits.' };
    if (A * B >= MOD) return { ok: false, error: 'The product overflows the 8 result windows.' };
    lever('add');
    setSliders(A);
    const bd = String(B).split('').reverse().map(Number);
    let turns = 0;
    bd.forEach((m, k) => {
      if (!m) return;
      shiftTo(k);
      for (let s = 1; s <= m; s++) {
        turns++;
        crank(`Turn ${s} of ${m}${k ? ` in the ${PLACE[k]} position` : ''}: the drums add ${fmt(A)}${k ? ` × ${fmt(10 ** k)}` : ''} again`);
      }
    });
    push({}, 'Read the result windows — the counter shows the multiplier', resX(3), 250, { dur: 900, t: 200, ly: 66 });
    const dd = da + db;
    display = fmt((A * B) / 10 ** dd);
    explanation =
      bd.length === 1
        ? `Multiplication is repeated addition: with ${fmt(A)} on the sliders, each of the ${turns} crank turns added it once more to the result wheels, while the counter logged the turns.`
        : `With ${fmt(A)} on the sliders, the crank was turned once per multiplier digit and the carriage shifted one place for tens, hundreds…, so ${turns} turns produced the product; the counter spelled out the multiplier ${fmt(B)}.`;
    if (swapped) note = 'The operator put the number needing more turns on the sliders and cranked the other — fewer turns.';
    if (dd) note = `${note ? note + ' ' : ''}Decimal markers placed the point ${dd} place${dd > 1 ? 's' : ''} from the right.`;
  } else {
    // division by repeated subtraction
    const { A, B, d } = fixedPoint(job.aStr, job.bStr);
    if (B === 0) return { ok: false, error: 'Division by zero: the crank would turn forever.' };
    if (A >= 10 ** SLIDERS || B >= 10 ** SLIDERS) return { ok: false, error: 'Dividend and divisor must fit the 6 setting sliders.' };
    let p = 0;
    while (p < MAX_SHIFT && (A * 10 ** p) % B !== 0 && A * 10 ** (p + 1) < MOD && Math.floor((A * 10 ** (p + 1)) / B) < 10 ** (MAX_SHIFT + 1)) p++;
    const dividend = A * 10 ** p;
    const q = Math.floor(dividend / B);
    if (q >= 10 ** (MAX_SHIFT + 1)) return { ok: false, error: 'The quotient needs more than the carriage’s 4 positions.' };
    lever('add');
    setSliders(A);
    shiftTo(p);
    crank(`Turn once to place the dividend ${job.aStr}${p ? ` (shifted ${p} place${p > 1 ? 's' : ''} for decimals)` : ''} in the result windows`);
    push({ cnt: 0 }, 'Press C to clear the turn counter', CLR.cnt, CLR.row, { sound: { kind: 'clear', ms: 400 }, dur: 800, t: 400, ly: 850 });
    setSliders(B);
    lever('sub');
    const qd = String(q).split('').map(Number);
    const top = qd.length - 1;
    let turns = 0;
    for (let k = top; k >= 0; k--) {
      const n = qd[top - k];
      shiftTo(k);
      for (let s = 1; s <= n; s++) {
        turns++;
        crank(`Subtract ${fmt(B)}${k ? ` × ${fmt(10 ** k)}` : ''} — turn ${s} while the remainder still allows it`);
      }
    }
    push({}, 'The counter holds the quotient; the result windows hold the remainder', cntX(2), 250, { dur: 1000, t: 200, ly: 66 });
    const rem = dividend - q * B;
    display = fmt(q / 10 ** p);
    explanation = `Division ran as repeated subtraction: in SUB mode each turn took the divisor away, the carriage stepped down one place at a time, and the counter tallied ${turns} turns into the quotient.`;
    if (rem) note = `A remainder of ${fmt(rem / 10 ** (p + d))} is left in the result windows; the quotient is cut off at ${p} decimal place${p === 1 ? '' : 's'}.`;
  }

  return { ok: true, frames, outcome: { display, explanation, note } };
}

/* Rendering --------------------------------------------------------- */
export default function Arithmometer(props: MachineProps) {
  const seq = useSequencer<ArithState>(REST, props.speed);
  useJobRunner(props.job, planArithmometer, seq, props, REST);
  const s = seq.state;
  const interactive = !seq.playing;
  const sliderDrag = useRef<number | null>(null);

  const resD = digitsOf(s.res, RES_DIGITS);
  const cntD = digitsOf(s.cnt, CNT_DIGITS);

  const manual = (next: ArithState, text: string, x: number, y: number, ly = 850, t = 220) => {
    seq.setManual(next, t);
    seq.setCallout({ x, y, text, ly, step: 0, total: 0 });
  };
  const setSliderFromY = (j: number, y: number) => {
    const d = Math.max(0, Math.min(9, Math.round((KNOB_Y0 - y) / KNOB_STEP)));
    if (d === s.sl[j]) return;
    sfx.lever();
    const sl = [...s.sl];
    sl[j] = d;
    manual({ ...s, sl }, `${PLACE[j]} slider: ${d}`, sliderX(j), knobY(d), 850, 120);
  };
  const turnCrank = () => {
    const amount = Number(s.sl.slice().reverse().join('')) * 10 ** s.shift;
    const res = s.lever === 'sub' ? (s.res - amount + MOD) % MOD : (s.res + amount) % MOD;
    sfx.ratchet(500);
    manual({ ...s, res, cnt: (s.cnt + 10 ** s.shift) % 10 ** CNT_DIGITS, angle: s.angle + 360, lever: s.lever === 'neutral' ? 'add' : s.lever }, `Result reads ${pad(res, 8)}`, CRANK.x + 70, CRANK.y - 30, 850, 500);
  };

  return (
    <MachineShell transitionMs={seq.transitionMs} callout={mapCallout(seq.callout, FIT)} slow={props.speed > 1} label="Thomas de Colmar arithmometer">
      <SharedDefs />
      <defs>
        <linearGradient id="arWood" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7a3b20" />
          <stop offset="0.5" stopColor="#5f2b16" />
          <stop offset="1" stopColor="#4a210f" />
        </linearGradient>
        <filter id="arGrain" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.0035 0.11" numOctaves="3" seed="11" />
          <feColorMatrix values="0 0 0 0 0.12  0 0 0 0 0.05  0 0 0 0 0.02  0 0 0 2.2 -0.9" />
          <feComposite in2="SourceGraphic" operator="in" />
        </filter>
        <linearGradient id="arBrass" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#d9bd78" />
          <stop offset="0.4" stopColor="#c4a35c" />
          <stop offset="0.75" stopColor="#b8964f" />
          <stop offset="1" stopColor="#a5843f" />
        </linearGradient>
        <linearGradient id="arBrassLight" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e6cd8c" />
          <stop offset="1" stopColor="#bf9e55" />
        </linearGradient>
        <filter id="arBrushed" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.002 0.6" numOctaves="2" seed="5" />
          <feColorMatrix values="0 0 0 0 1  0 0 0 0 0.95  0 0 0 0 0.8  0 0 0 0.7 -0.25" />
          <feComposite in2="SourceGraphic" operator="in" />
        </filter>
        <radialGradient id="arIvory" cx="0.35" cy="0.3" r="0.8">
          <stop offset="0" stopColor="#fffaf0" />
          <stop offset="1" stopColor="#d9ccb0" />
        </radialGradient>
      </defs>

      <g transform={fitTransform(FIT)}>
      {/* mahogany case */}
      <g filter="url(#softShadow)">
        <rect x={CASE.x} y={CASE.y} width={CASE.w} height={CASE.h} rx={PLATE.rx / FIT.s} fill="url(#arWood)" />
      </g>
      <rect x={CASE.x} y={CASE.y} width={CASE.w} height={CASE.h} rx={PLATE.rx / FIT.s} filter="url(#arGrain)" opacity={0.85} />
      <rect x={CASE.x + 6} y={CASE.y + 6} width={CASE.w - 12} height={CASE.h - 12} rx={10} fill="none" stroke="rgba(255,200,160,.12)" strokeWidth={2} />

      {/* brushed brass faceplate */}
      <rect x={150} y={64} width={1300} height={753} rx={6} fill="url(#arBrass)" />
      <rect x={150} y={64} width={1300} height={753} rx={6} filter="url(#arBrushed)" opacity={0.35} />
      <rect x={160} y={74} width={1280} height={733} rx={4} fill="none" stroke="rgba(90,60,20,.45)" strokeWidth={2} />
      {[
        [175, 89],
        [1425, 89],
        [175, 792],
        [1425, 792],
      ].map(([x, y], i) => (
        <Screw key={i} x={x} y={y} r={8} rot={i * 37} />
      ))}


      {/* operation lever */}
      <g>
        <text x={LEVER.x} y={452} textAnchor="middle" fontSize={15} fontWeight={600} fill="#4a3210" fontFamily="'IBM Plex Sans', sans-serif" letterSpacing={1.5}>
          ADD · MULT
        </text>
        <text x={LEVER.x} y={LEVER.bottom + 28} textAnchor="middle" fontSize={15} fontWeight={600} fill="#4a3210" fontFamily="'IBM Plex Sans', sans-serif" letterSpacing={1.5}>
          SUB · DIV
        </text>
        <rect x={LEVER.x - 10} y={LEVER.top} width={20} height={LEVER.bottom - LEVER.top} rx={10} fill="#2b1c08" stroke="rgba(0,0,0,.5)" />
        <g
          className={`anim ${interactive ? 'cursor-pointer' : ''}`}
          style={{ transform: `translate(${LEVER.x}px, ${LEVER[s.lever]}px)` }}
          onPointerDown={
            interactive
              ? () => {
                  sfx.lever();
                  const l: Lever = s.lever === 'add' ? 'sub' : 'add';
                  manual({ ...s, lever: l }, l === 'add' ? 'Lever: ADD / MULT' : 'Lever: SUB / DIV', LEVER.x, LEVER[l]);
                }
              : undefined
          }
        >
          <rect x={-34} y={-12} width={68} height={24} rx={8} fill="url(#arBrassLight)" stroke="rgba(60,40,10,.6)" filter="url(#smallShadow)" />
          <circle r={13} fill="url(#arIvory)" stroke="rgba(0,0,0,.3)" />
        </g>
      </g>

      {/* setting sliders */}
      {Array.from({ length: SLIDERS }, (_, j) => {
        const x = sliderX(j);
        const v = s.sl[j];
        return (
          <g key={`sl${j}`}>
            <DigitWheel id={`arSlw${j}`} x={x} y={392} digit={v} r={17} square fontSize={22} />
            {Array.from({ length: 10 }, (_, d) => (
              <text key={d} x={x - 27} y={knobY(d) + 5} textAnchor="middle" fontSize={13} fill="#5a3f14" fontFamily="'IBM Plex Mono', monospace">
                {d}
              </text>
            ))}
            <rect
              x={x - 9}
              y={416}
              width={18}
              height={282}
              rx={9}
              fill="#22160a"
              className={interactive ? 'cursor-ns-resize' : ''}
              onPointerDown={
                interactive
                  ? (e) => {
                      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
                      sliderDrag.current = j;
                      setSliderFromY(j, (svgPoint(e, e.currentTarget).y - FIT.ty) / FIT.s);
                    }
                  : undefined
              }
              onPointerMove={(e) => {
                if (sliderDrag.current === j) setSliderFromY(j, (svgPoint(e, e.currentTarget).y - FIT.ty) / FIT.s);
              }}
              onPointerUp={() => (sliderDrag.current = null)}
            />
            <g className="anim pointer-events-none" style={{ transform: `translate(${x}px, ${knobY(v)}px)` }}>
              <circle r={15} fill="#1a1008" opacity={0.4} cy={3} />
              <circle r={14} fill="url(#screwGrad)" stroke="rgba(0,0,0,.5)" />
              <circle r={5} fill="#3d2a0e" />
            </g>
          </g>
        );
      })}

      {/* carriage position control: arrows either side of five position dots */}
      <g fontFamily="'IBM Plex Sans', sans-serif" fill="#4a3210">
        <text x={CAR.x} y={CAR.label} textAnchor="middle" fontSize={15} fontWeight={600} letterSpacing={1.5}>
          CARRIAGE
        </text>
        {Array.from({ length: MAX_SHIFT + 1 }, (_, k) => (
          <circle
            key={k}
            cx={CAR.x + (k - MAX_SHIFT / 2) * CAR.step}
            cy={CAR.row}
            r={6}
            fill={k === s.shift ? '#4a3210' : 'none'}
            stroke="#4a3210"
            strokeWidth={2}
            style={{ transition: 'fill .2s' }}
          />
        ))}
        {[-1, 1].map((dir) => {
          const cx = CAR.x + dir * ((MAX_SHIFT / 2) * CAR.step + 36);
          const k = Math.max(0, Math.min(MAX_SHIFT, s.shift + dir));
          const can = interactive && k !== s.shift;
          return (
            <g
              key={dir}
              className={can ? 'cursor-pointer' : ''}
              opacity={can ? 1 : 0.45}
              onPointerDown={
                can
                  ? () => {
                      sfx.carriage();
                      manual({ ...s, shift: k }, `Carriage position ${k + 1}`, 760 + k * PITCH, 180, 66, 400);
                    }
                  : undefined
              }
            >
              <circle cx={cx} cy={CAR.row} r={16} fill="url(#arBrassLight)" stroke="rgba(60,40,10,.6)" />
              <path d={dir < 0 ? `M${cx + 4} ${CAR.row - 7} l-9 7 9 7z` : `M${cx - 4} ${CAR.row - 7} l9 7 -9 7z`} fill="#4a3210" />
            </g>
          );
        })}
      </g>

      {/* hand crank */}
      <g>
        <circle cx={CRANK.x} cy={CRANK.y} r={64} fill="url(#arBrassLight)" stroke="rgba(60,40,10,.55)" strokeWidth={2} filter="url(#smallShadow)" />
        <circle cx={CRANK.x} cy={CRANK.y} r={48} fill="none" stroke="rgba(90,60,20,.35)" strokeWidth={2} strokeDasharray="4 7" />
        <g
          className={`anim ${interactive ? 'cursor-pointer' : ''}`}
          style={{ transform: `translate(${CRANK.x}px, ${CRANK.y}px) rotate(${s.angle}deg)` }}
          onPointerDown={interactive ? turnCrank : undefined}
        >
          <rect x={-14} y={-96} width={28} height={110} rx={12} fill="url(#screwGrad)" stroke="rgba(0,0,0,.45)" />
          <circle r={18} fill="url(#screwGrad)" stroke="rgba(0,0,0,.45)" />
          <circle cy={-84} r={22} fill="url(#arIvory)" stroke="rgba(0,0,0,.35)" filter="url(#smallShadow)" />
        </g>
        <text x={CRANK.x} y={CRANK.y + 104} textAnchor="middle" fontSize={15} fontWeight={600} fill="#4a3210" fontFamily="'IBM Plex Sans', sans-serif" letterSpacing={1.5}>
          CRANK
        </text>
      </g>

      {/* fixed clearing knobs: they stay on the faceplate when the carriage moves */}
      <g fontFamily="'IBM Plex Sans', sans-serif" fill="#4a3210">
        <text x={(CLR.cnt + CLR.res) / 2} y={CLR.label} textAnchor="middle" fontSize={15} fontWeight={600} letterSpacing={1.5}>
          CLEAR
        </text>
        {[
          { x: CLR.cnt, key: 'C', name: 'COUNTER', act: () => manual({ ...s, cnt: 0 }, 'Turn counter cleared', CLR.cnt, CLR.row, 850, 500) },
          { x: CLR.res, key: 'R', name: 'RESULT', act: () => manual({ ...s, res: 0 }, 'Result windows cleared', CLR.res, CLR.row, 850, 500) },
        ].map((k) => (
          <g
            key={k.key}
            className={interactive ? 'cursor-pointer' : ''}
            opacity={interactive ? 1 : 0.6}
            onPointerDown={
              interactive
                ? () => {
                    sfx.clear(400);
                    k.act();
                  }
                : undefined
            }
          >
            <circle cx={k.x} cy={CLR.row} r={16} fill="url(#arIvory)" stroke="rgba(60,40,10,.55)" filter="url(#smallShadow)" />
            <text x={k.x} y={CLR.row + 5} textAnchor="middle" fontSize={14} fontWeight={700} fill="#5a3f14">
              {k.key}
            </text>
            <text x={k.x} y={CLR.name} textAnchor="middle" fontSize={15} fontWeight={600} letterSpacing={1.5}>
              {k.name}
            </text>
          </g>
        ))}
      </g>

      {/* moving carriage: turn counter and result windows, each in its own recessed strip */}
      <g className="anim" style={{ transform: `translateX(${s.shift * PITCH}px)` }}>
        <rect x={196} y={170} width={988} height={150} rx={10} fill="url(#arBrassLight)" stroke="rgba(70,45,10,.6)" strokeWidth={2} filter="url(#smallShadow)" />
        <rect x={196} y={170} width={988} height={150} rx={10} filter="url(#arBrushed)" opacity={0.3} />
        {[
          { x0: cntX(CNT_DIGITS - 1) - 30, x1: cntX(0) + 30, label: 'TURN COUNTER' },
          { x0: resX(RES_DIGITS - 1) - 36, x1: resX(0) + 36, label: 'RESULT' },
        ].map((g) => (
          <g key={g.label}>
            <text x={g.x0 + 4} y={202} fontSize={15} fontWeight={600} fill="#4a3210" letterSpacing={1.5} fontFamily="'IBM Plex Sans', sans-serif">
              {g.label}
            </text>
            <rect x={g.x0} y={212} width={g.x1 - g.x0} height={76} rx={10} fill="rgba(70,45,10,.16)" stroke="rgba(70,45,10,.5)" strokeWidth={1.5} />
            <rect x={g.x0 + 2} y={214} width={g.x1 - g.x0 - 4} height={6} rx={3} fill="rgba(40,25,5,.12)" />
          </g>
        ))}
        {cntD.map((d, i) => (
          <DigitWheel key={`c${i}`} id={`arCnt${i}`} x={cntX(i)} y={250} digit={d} r={19} fontSize={25} face="#efe6cf" />
        ))}
        {resD.map((d, i) => (
          <g key={`r${i}`}>
            <DigitWheel id={`arRes${i}`} x={resX(i)} y={250} digit={d} r={26} fontSize={34} />
            {i > 0 && i % 3 === 0 && <circle cx={resX(i) + PITCH / 2} cy={300} r={3.5} fill="#5a3f14" />}
          </g>
        ))}
      </g>
      </g>
    </MachineShell>
  );
}
