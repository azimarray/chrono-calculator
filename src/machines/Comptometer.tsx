import type { Frame, Job, MachineProps, Plan } from '../types';
import { useSequencer } from '../lib/useSequencer';
import { sfx } from '../lib/audio';
import { decimals, digitsOf, fixedPoint, fmt, pad } from '../lib/math';
import { DigitWheel, MachineShell, PLATE, Screw, SharedDefs, fitToPlate, fitTransform, mapCallout, useJobRunner } from './common';

/* Geometry ---------------------------------------------------------- */
const COLS = 8;
const MOD = 10 ** COLS;
/* The case is drawn at x 150–1450, y 58–843 (the abacus plate's proportions) and scaled onto the plate. */
const CASE = { x: 150, y: 58, w: 1300, h: 785 };
const FIT = fitToPlate(CASE.x, CASE.y, CASE.w);
const colX = (i: number) => 1120 - 106 * i; // i = 0 → units (rightmost)
const keyY = (d: number) => 142 + (9 - d) * 55;
const KEY_W = 66;
const KEY_H = 44;
const WHEEL_Y = 776;
const CRANK = { x: 1452, y: 430 };
const GREEN = (i: number) => i % 2 === 1;
const PLACE = ['units', 'tens', 'hundreds', 'thousands', 'ten-thousands', 'hundred-thousands', 'millions', 'ten-millions'];

export interface ComptState {
  acc: number;
  pressed: number[]; // digit held down in each column (0 = none)
  crank: number;
}
const REST: ComptState = { acc: 0, pressed: Array(COLS).fill(0), crank: 0 };

/** Keys for a stroke that adds n (one key per non-zero digit). */
const keysFor = (n: number) => digitsOf(n, COLS);
const digitSum = (n: number) => String(n).split('').reduce((s, c) => s + Number(c), 0);

function describeKeys(keys: number[]): string {
  const parts = keys.map((d, i) => (d ? `${d} in the ${PLACE[i]}` : '')).filter(Boolean).reverse();
  if (parts.length <= 1) return `${parts[0] ?? 'no key'} column`;
  if (parts.length <= 3) return `${parts.join(', ')} together`;
  return `${parts.length} keys together`;
}

/* Planning ---------------------------------------------------------- */
export function planComptometer(job: Job): Plan<ComptState> {
  const { op } = job;
  if (op === '√') return { ok: false, error: 'The comptometer has no square-root mechanism.' };

  const frames: Frame<ComptState>[] = [];
  let st: ComptState = { ...REST, pressed: [...REST.pressed] };
  const push = (patch: Partial<ComptState>, text: string | null, x: number, y: number, o: { dur?: number; t?: number; sound?: Frame<ComptState>['sound']; ly?: number } = {}) => {
    st = { ...st, ...patch };
    frames.push({ state: st, dur: o.dur ?? 700, t: o.t ?? 220, callout: text ? { x, y, text, ly: o.ly ?? 40 } : null, sound: o.sound });
  };
  const stroke = (add: number, text: string) => {
    const keys = keysFor(add);
    const top = keys.reduce((m, d, i) => (d ? i : m), 0);
    push({ pressed: keys, acc: (st.acc + add) % MOD }, text, colX(top), keyY(keys[top] || 1) - 24, { sound: { kind: 'key' }, dur: 620, t: 200 });
    push({ pressed: Array(COLS).fill(0) }, null, 0, 0, { sound: { kind: 'keyUp' }, dur: 340, t: 160 });
  };

  push({ crank: 62 }, 'Pull the clearing crank: every wheel returns to 0', CRANK.x + 60, CRANK.y + 60, { dur: 700, t: 450, sound: { kind: 'clear', ms: 450 }, ly: 860 });
  push({ crank: 0, acc: 0 }, null, 0, 0, { dur: 500, t: 350 });

  let display: string;
  let explanation: string;
  let note: string | undefined;

  if (op === '+' || op === '−') {
    const { A, B, d } = fixedPoint(job.aStr, job.bStr);
    if (A >= MOD || B >= MOD) return { ok: false, error: 'Numbers must fit the 8 key columns.' };
    if (op === '+' && A + B >= MOD) return { ok: false, error: 'The sum overflows the 8 accumulator wheels.' };
    if (A) stroke(A, `Enter ${job.aStr}: press ${describeKeys(keysFor(A))}`);
    if (op === '+') {
      if (B) stroke(B, `Add ${job.bStr}: press ${describeKeys(keysFor(B))}`);
      explanation = `Every key stroke drives its column's lever, which turns the wheel below by the key's value; carries ripple left automatically. Pressing ${job.aStr} then ${job.bStr} left their sum on the wheels.`;
    } else {
      if (B) stroke((MOD - B) % MOD, `Subtract ${job.bStr}: press the small complement figures on every column — the overflow falls off the left`);
      explanation = `The comptometer only adds, so ${job.bStr} was subtracted by adding its ten's complement (the small figures printed on each key). The carry that overflows the last wheel is lost, leaving the difference.`;
    }
    const exact = op === '+' ? A + B : A - B;
    push({}, 'Read the accumulator wheels', colX(3), WHEEL_Y - 30, { dur: 900, t: 200, ly: 40 });
    display = fmt(exact / 10 ** d);
    if (exact < 0) note = `The wheels show ${pad((exact + MOD) % MOD, 8)}, the ten's complement of a negative result; the operator read it as −${fmt(-exact / 10 ** d)}.`;
    else if (d) note = `Decimal markers between the columns kept the point ${d} place${d > 1 ? 's' : ''} from the right.`;
  } else if (op === '×') {
    const da = decimals(job.aStr);
    const db = decimals(job.bStr);
    let A = Math.round(job.a * 10 ** da);
    let B = Math.round(job.b * 10 ** db);
    if (digitSum(A) < digitSum(B)) [A, B] = [B, A]; // fewer strokes
    if (A * B >= MOD) return { ok: false, error: 'The product overflows the 8 accumulator wheels.' };
    const bd = String(B).split('').reverse().map(Number);
    let strokes = 0;
    bd.forEach((m, k) => {
      for (let s = 1; s <= m; s++) {
        strokes++;
        const where = k ? `, shifted ${k} column${k > 1 ? 's' : ''} left` : '';
        stroke(A * 10 ** k, `×${m}${k ? ` (${PLACE[k]})` : ''} — stroke ${s} of ${m}: press ${fmt(A)}${where}`);
      }
    });
    push({}, 'Read the accumulator wheels', colX(3), WHEEL_Y - 30, { dur: 900, t: 200, ly: 40 });
    const dd = da + db;
    display = fmt((A * B) / 10 ** dd);
    explanation =
      bd.length === 1
        ? `Multiplication is repeated key strokes: pressing ${fmt(A)} ${strokes} times added it ${strokes} times, each lever push advancing the wheels.`
        : `The operator pressed ${fmt(A)} once per unit of each multiplier digit, moving one column left for tens, hundreds… — ${strokes} strokes in all.`;
    if (dd) note = `Decimal markers placed the point ${dd} place${dd > 1 ? 's' : ''} from the right.`;
  } else {
    const { A, B, d } = fixedPoint(job.aStr, job.bStr);
    if (B === 0) return { ok: false, error: 'Division by zero cannot be done by repeated subtraction.' };
    if (A >= MOD || B >= MOD) return { ok: false, error: 'Numbers must fit the 8 key columns.' };
    let p = 0;
    while (p < 4 && (A * 10 ** p) % B !== 0 && A * 10 ** (p + 1) < MOD) p++;
    const dividend = A * 10 ** p;
    const q = Math.floor(dividend / B);
    stroke(dividend, `Enter the dividend ${job.aStr}${p ? ` (shifted ${p} column${p > 1 ? 's' : ''} for decimals)` : ''}`);
    const qd = String(q).split('').map(Number);
    const top = qd.length - 1;
    let strokes = 0;
    for (let k = top; k >= 0; k--) {
      const n = qd[top - k];
      for (let s = 1; s <= n; s++) {
        strokes++;
        stroke((MOD - B * 10 ** k) % MOD, `Subtract ${fmt(B)}${k ? ` × ${fmt(10 ** k)}` : ''} with its complement — count stroke ${s} for this place`);
      }
    }
    push({}, 'Wheels hold the remainder; the counted strokes form the quotient', colX(3), WHEEL_Y - 30, { dur: 1000, t: 200, ly: 40 });
    const rem = dividend - q * B;
    display = fmt(q / 10 ** p);
    explanation = `Division was repeated complement-subtraction: the operator subtracted ${fmt(B)} at each column position as often as possible, and the ${strokes} counted strokes, place by place, spelled out the quotient.`;
    if (rem) note = `A remainder of ${fmt(rem / 10 ** (p + d))} stays on the wheels; the quotient is cut off at ${p} decimal place${p === 1 ? '' : 's'}.`;
  }

  return { ok: true, frames, outcome: { display, explanation, note } };
}

/* Rendering --------------------------------------------------------- */
function Key({ x, y, d, green, down, onPress }: { x: number; y: number; d: number; green: boolean; down: boolean; onPress?: () => void }) {
  const face = green ? '#245a3e' : '#f1e6c6';
  const faceHi = green ? '#3a7a57' : '#fffaf0';
  const ink = green ? '#f3ead2' : '#2a2219';
  return (
    <g transform={`translate(${x} ${y})`} className={onPress ? 'cursor-pointer' : ''} onPointerDown={onPress}>
      <rect x={-KEY_W / 2 - 3} y={-KEY_H / 2 - 2} width={KEY_W + 6} height={KEY_H + 9} rx={14} fill="#2b170c" opacity={0.75} />
      <g className="anim-fast" style={{ transform: `translateY(${down ? 5 : 0}px)` }}>
        <rect x={-KEY_W / 2} y={-KEY_H / 2 + 5} width={KEY_W} height={KEY_H} rx={12} fill={green ? '#123222' : '#b9a77d'} opacity={down ? 0 : 1} />
        <rect x={-KEY_W / 2} y={-KEY_H / 2} width={KEY_W} height={KEY_H} rx={12} fill={face} stroke="rgba(0,0,0,.35)" />
        <rect x={-KEY_W / 2 + 6} y={-KEY_H / 2 + 4} width={KEY_W - 12} height={12} rx={6} fill={faceHi} opacity={0.5} />
        <text x={-4} y={9} textAnchor="middle" fontSize={25} fontWeight={600} fill={ink} fontFamily="'IBM Plex Sans', sans-serif">
          {d}
        </text>
        <text x={22} y={15} textAnchor="middle" fontSize={11} fill={ink} opacity={0.7} fontFamily="'IBM Plex Sans', sans-serif">
          {9 - d}
        </text>
        {down && <rect x={-KEY_W / 2} y={-KEY_H / 2} width={KEY_W} height={KEY_H} rx={12} fill="rgba(0,0,0,.18)" />}
      </g>
    </g>
  );
}

export default function Comptometer(props: MachineProps) {
  const seq = useSequencer<ComptState>(REST, props.speed);
  useJobRunner(props.job, planComptometer, seq, props, REST);
  const s = seq.state;
  const interactive = !seq.playing;
  const wheels = digitsOf(s.acc, COLS);

  const pressKey = (col: number, d: number) => {
    sfx.key();
    const pressed = Array(COLS).fill(0);
    pressed[col] = d;
    const acc = (s.acc + d * 10 ** col) % MOD;
    seq.setManual({ ...s, pressed, acc }, 140);
    seq.setCallout({ x: colX(col), y: WHEEL_Y - 30, text: `Wheels read ${pad(acc, 8)}`, ly: 40, step: 0, total: 0 });
    window.setTimeout(() => {
      sfx.keyUp();
      seq.setManual((prev) => ({ ...prev, pressed: Array(COLS).fill(0) }), 120);
    }, 170);
  };
  const clear = () => {
    sfx.clear(450);
    seq.setManual({ ...s, crank: 62, acc: 0 }, 300);
    seq.setCallout({ x: CRANK.x + 60, y: CRANK.y + 60, text: 'Cleared to 00000000', ly: 860, step: 0, total: 0 });
    window.setTimeout(() => seq.setManual((prev) => ({ ...prev, crank: 0 }), 300), 360);
  };

  return (
    <MachineShell transitionMs={seq.transitionMs} callout={mapCallout(seq.callout, FIT)} slow={props.speed > 1} label="Felt and Tarrant style comptometer">
      <SharedDefs />
      <defs>
        <linearGradient id="cpCopper" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#d48d5f" />
          <stop offset="0.35" stopColor="#bb7146" />
          <stop offset="0.7" stopColor="#a9633b" />
          <stop offset="1" stopColor="#c47e52" />
        </linearGradient>
        <linearGradient id="cpBand" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#b8703f" />
          <stop offset="1" stopColor="#8a4e2a" />
        </linearGradient>
        <filter id="cpPatina" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.012 0.03" numOctaves="3" seed="21" />
          <feColorMatrix values="0 0 0 0 0.25  0 0 0 0 0.12  0 0 0 0 0.05  0 0 0 1.5 -0.6" />
          <feComposite in2="SourceGraphic" operator="in" />
        </filter>
        <linearGradient id="cpRubber" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#6a6a70" />
          <stop offset="0.35" stopColor="#3a3a3f" />
          <stop offset="1" stopColor="#1e1e22" />
        </linearGradient>
        <linearGradient id="cpDeck" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4b2a17" />
          <stop offset="1" stopColor="#5d3720" />
        </linearGradient>
      </defs>

      <g transform={fitTransform(FIT)}>
      {/* copper case */}
      <g filter="url(#softShadow)">
        <rect x={CASE.x} y={CASE.y} width={CASE.w} height={CASE.h} rx={PLATE.rx / FIT.s} fill="url(#cpCopper)" />
      </g>
      <rect x={CASE.x} y={CASE.y} width={CASE.w} height={CASE.h} rx={PLATE.rx / FIT.s} filter="url(#cpPatina)" opacity={0.5} />
      <rect x={CASE.x + 12} y={CASE.y + 12} width={CASE.w - 24} height={CASE.h - 24} rx={8} fill="none" stroke="rgba(255,220,190,.25)" strokeWidth={2} />

      {/* key deck */}
      <rect x={318} y={104} width={872} height={530} rx={16} fill="url(#cpDeck)" stroke="rgba(0,0,0,.35)" strokeWidth={2} />
      {Array.from({ length: COLS }, (_, i) => (
        <g key={`k${i}`}>
          {Array.from({ length: 9 }, (_, r) => {
            const d = 9 - r;
            return (
              <Key key={d} x={colX(i)} y={keyY(d)} d={d} green={GREEN(i)} down={s.pressed[i] === d} onPress={interactive ? () => pressKey(i, d) : undefined} />
            );
          })}
        </g>
      ))}
      {/* column dividers & decimal markers */}
      {[3, 6].map((i) => (
        <circle key={`dm${i}`} cx={colX(i) + 53} cy={650} r={4} fill="#4b2a17" />
      ))}

      {/* internal lever indicators */}
      {Array.from({ length: COLS }, (_, i) => {
        const travel = s.pressed[i];
        return (
          <g key={`lv${i}`}>
            <rect x={colX(i) - 7} y={646} width={14} height={66} rx={7} fill="#2a170b" />
            <g className="anim-fast" style={{ transform: `translate(${colX(i)}px, ${652 + travel * 5.2}px)` }}>
              <rect x={-5} y={0} width={10} height={14} rx={3} fill={travel ? '#f3d48a' : '#9b6a3f'} />
            </g>
            <line x1={colX(i)} x2={colX(i)} y1={712} y2={WHEEL_Y - 34} stroke="#5a3119" strokeWidth={2} />
          </g>
        );
      })}

      {/* front accumulator band */}
      <rect x={176} y={730} width={1248} height={86} rx={14} fill="url(#cpBand)" stroke="rgba(0,0,0,.3)" />
      <text x={262} y={782} textAnchor="middle" fontSize={13} fill="#3b1f0e" letterSpacing={2} fontFamily="'IBM Plex Sans', sans-serif">
        TOTAL
      </text>
      {wheels.map((d, i) => (
        <DigitWheel key={`w${i}`} id={`cpW${i}`} x={colX(i)} y={WHEEL_Y} digit={d} r={28} square fontSize={34} face="#fbf6e8" />
      ))}
      <Screw x={196} y={750} r={7} />
      <Screw x={1404} y={750} r={7} rot={70} />

      {/* clearing crank */}
      <g className={interactive ? 'cursor-pointer' : ''} onPointerDown={interactive ? clear : undefined}>
        <rect x={1430} y={CRANK.y - 30} width={34} height={60} rx={10} fill="url(#cpBand)" stroke="rgba(255,220,190,.35)" strokeWidth={1.5} />
        <g className="anim" style={{ transform: `translate(${CRANK.x}px, ${CRANK.y}px) rotate(${s.crank}deg)` }}>
          <rect x={-8} y={-8} width={96} height={16} rx={8} fill="url(#screwGrad)" stroke="rgba(0,0,0,.4)" />
          <rect x={76} y={-20} width={50} height={40} rx={16} fill="url(#cpRubber)" stroke="rgba(255,255,255,.4)" strokeWidth={1.5} />
          <rect x={84} y={-15} width={34} height={7} rx={3.5} fill="rgba(255,255,255,.22)" />
          <circle r={11} fill="url(#screwGrad)" stroke="rgba(0,0,0,.4)" />
        </g>
        <text x={CRANK.x + 50} y={CRANK.y - 46} textAnchor="middle" fontSize={15} fontWeight={600} fill="#e4ddd2" letterSpacing={2} fontFamily="'IBM Plex Sans', sans-serif">
          CLEAR
        </text>
      </g>
      {/* left latch (decorative) */}
      <rect x={128} y={400} width={30} height={60} rx={10} fill="url(#cpBand)" stroke="rgba(255,220,190,.35)" strokeWidth={1.5} />
      <rect x={90} y={414} width={46} height={32} rx={12} fill="url(#cpRubber)" stroke="rgba(255,255,255,.4)" strokeWidth={1.5} />
      <rect x={97} y={418} width={32} height={6} rx={3} fill="rgba(255,255,255,.22)" />

      </g>
    </MachineShell>
  );
}
