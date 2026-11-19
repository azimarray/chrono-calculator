import { useCallback } from 'react';
import type { Frame, Job, MachineProps, Plan } from '../types';
import { useSequencer } from '../lib/useSequencer';
import { sfx } from '../lib/audio';
import { fmt } from '../lib/math';
import { MachineShell, PlaceLabels, SharedDefs, useJobRunner } from './common';

/* Geometry (viewBox 1600 × 900) ------------------------------------ */
const COLS = 7;
const colX = (col: number) => 340 + (COLS - 1 - col) * 128; // col 0 = units (rightmost)
const HEAVEN_OFF = 177;
const HEAVEN_ON = 303;
const earthY = (i: number, active: boolean) => (active ? 461 + i * 52 : 583 + i * 52);
const BEAD_R = 25;

const ROMAN = ['I', 'X', 'C', '∞', '((I))', '(((I)))', '|X|'];
const COL_NAME = ['units (I)', 'tens (X)', 'hundreds (C)', 'thousands (∞)', 'ten-thousands', 'hundred-thousands', 'millions'];

export interface AbacusState {
  d: number[]; // 7 digits, index 0 = units
}
const REST: AbacusState = { d: Array(COLS).fill(0) };

/* Planning ---------------------------------------------------------- */
export function planAbacus(job: Job): Plan<AbacusState> {
  const { op, a, b } = job;
  if (op !== '+' && op !== '−') return { ok: false, error: 'The hand abacus demonstrates addition and subtraction only.' };
  if (!Number.isInteger(a) || !Number.isInteger(b)) return { ok: false, error: 'The abacus columns hold whole numbers only.' };
  if (a > 9_999_999 || b > 9_999_999) return { ok: false, error: 'This plate has 7 columns: numbers up to 9,999,999.' };
  if (op === '+' && a + b > 9_999_999) return { ok: false, error: 'The sum overflows the millions column — the board is full.' };

  let A = a;
  let B = b;
  let negative = false;
  if (op === '−' && b > a) {
    negative = true;
    A = b;
    B = a;
  }

  const d = Array(COLS).fill(0) as number[];
  const frames: Frame<AbacusState>[] = [];
  let fiveComp = 0;
  let tenComp = 0;
  const snap = () => ({ d: [...d] });
  const earth = (col: number, text: string, dur = 1050) =>
    frames.push({ state: snap(), dur, t: 560, callout: { x: colX(col), y: 520, text, ly: 846 }, sound: { kind: 'bead', ms: 560 } });
  const heaven = (col: number, text: string, dur = 1050) =>
    frames.push({ state: snap(), dur, t: 560, callout: { x: colX(col), y: 240, text, ly: 54 }, sound: { kind: 'bead', ms: 560 } });

  frames.push({ state: snap(), dur: 900, t: 400, callout: { x: 800, y: 385, text: 'Cleared: every bead rests away from the centre bar — the board reads 0', ly: 54 } });

  // 1) Set the first number column by column, left to right.
  const aDigits = String(A).split('').reverse().map(Number);
  for (let col = aDigits.length - 1; col >= 0; col--) {
    const v = aDigits[col];
    if (!v) continue;
    d[col] = v;
    const parts = v >= 5 ? `drop the 5-bead${v > 5 ? ` and push ${v - 5} earth bead${v - 5 > 1 ? 's' : ''} up` : ''}` : `push ${v} earth bead${v > 1 ? 's' : ''} up`;
    (v >= 5 ? heaven : earth)(col, `Set ${v} in the ${COL_NAME[col]} column: ${parts}`);
  }

  // 2) Execute the operation digit by digit with complements & carries.
  const opWord = op === '+' ? 'Add' : 'Subtract';
  const add = (col: number, n: number, why = '') => {
    const v = d[col];
    if (v + n <= 9) {
      if (n < 5 && (v % 5) + n <= 4) {
        d[col] = v + n;
        earth(col, `${why}${opWordFor('+', n)}: push ${n} earth bead${n > 1 ? 's' : ''} up`);
      } else if (n < 5) {
        fiveComp++;
        d[col] = v + 5;
        heaven(col, `${why}Not enough earth beads for +${n}: drop the 5-bead (+5)…`);
        d[col] = v + n;
        earth(col, `…and lower ${5 - n} earth bead${5 - n > 1 ? 's' : ''} (−${5 - n}) — now 5 + ${(v + n) % 5}`);
      } else {
        d[col] = v + 5;
        heaven(col, `${why}+${n}: drop the 5-bead (+5)${n > 5 ? '…' : ''}`);
        if (n > 5) {
          d[col] = v + n;
          earth(col, `…and push ${n - 5} earth bead${n - 5 > 1 ? 's' : ''} up`);
        }
      }
    } else {
      // carry: add 10 on the left, take away the complement here
      tenComp++;
      sub(col, 10 - n, `${why}+${n} overflows: take away its complement ${10 - n} here… `);
      add(col + 1, 1, `Carry: +1 into the ${COL_NAME[col + 1]} column. `);
    }
  };
  const sub = (col: number, n: number, why = '') => {
    const v = d[col];
    if (v >= n) {
      if (n < 5 && v % 5 >= n) {
        d[col] = v - n;
        earth(col, `${why}${opWordFor('−', n)}: lower ${n} earth bead${n > 1 ? 's' : ''}`);
      } else if (n < 5) {
        fiveComp++;
        d[col] = v + (5 - n);
        earth(col, `${why}Too few earth beads for −${n}: push ${5 - n} up (+${5 - n})…`);
        d[col] = v - n;
        heaven(col, '…then lift the 5-bead away (−5)');
      } else {
        d[col] = v - 5;
        heaven(col, `${why}−${n}: lift the 5-bead away (−5)${n > 5 ? '…' : ''}`);
        if (n > 5) {
          d[col] = v - n;
          earth(col, `…and lower ${n - 5} earth bead${n - 5 > 1 ? 's' : ''}`);
        }
      }
    } else {
      tenComp++;
      add(col, 10 - n, `${why}Can't take ${n} from ${v}: add its complement ${10 - n} here… `);
      sub(col + 1, 1, `Borrow: −1 from the ${COL_NAME[col + 1]} column. `);
    }
  };
  function opWordFor(sign: '+' | '−', n: number) {
    return `${sign}${n}`;
  }

  const bDigits = String(B).split('').reverse().map(Number);
  for (let col = bDigits.length - 1; col >= 0; col--) {
    const n = bDigits[col];
    if (!n) continue;
    const label = `${opWord} ${n} in the ${COL_NAME[col]} column. `;
    if (op === '+') add(col, n, label);
    else sub(col, n, label);
  }

  frames.push({ state: snap(), dur: 900, t: 300, callout: { x: 800, y: 385, text: 'Done: read the beads touching the bar, column by column', ly: 54 } });

  const result = op === '+' ? a + b : a - b;
  const moves: string[] = [];
  if (fiveComp) moves.push(`${fiveComp} five-complement move${fiveComp > 1 ? 's' : ''} (swapping the 5-bead for earth beads)`);
  if (tenComp) moves.push(`${tenComp} ten-complement carr${tenComp > 1 ? 'ies' : 'y'} into the next column`);
  const explanation =
    `${fmt(A)} was set bead by bead, then ${fmt(B)} was ${op === '+' ? 'added' : 'taken away'} column by column` +
    (moves.length ? ` using ${moves.join(' and ')}.` : ' with direct bead moves.') +
    ` Each column holds one 5-bead and four 1-beads, so the bar now reads ${fmt(Math.abs(result))}.` +
    (negative ? ` Because the board can't hold a negative, the reckoner subtracted the smaller from the larger and recorded a deficit.` : '');

  return { ok: true, frames, outcome: { display: fmt(result, 0), explanation } };
}

/* Rendering --------------------------------------------------------- */
function Bead({ x, y, onClick, interactive }: { x: number; y: number; onClick?: () => void; interactive: boolean }) {
  return (
    <g
      className={`anim ${interactive ? 'cursor-pointer' : ''}`}
      style={{ transform: `translate(${x}px, ${y}px)` }}
      onPointerDown={interactive ? onClick : undefined}
    >
      <ellipse cx={3} cy={8} rx={BEAD_R} ry={BEAD_R * 0.9} fill="rgba(0,0,0,.35)" />
      <circle r={BEAD_R} fill="url(#abBead)" />
      <ellipse cx={-8} cy={-10} rx={9} ry={6} fill="rgba(255,240,215,.28)" />
      <circle r={BEAD_R} fill="url(#abPatinaDots)" opacity={0.6} />
    </g>
  );
}

export default function Abacus(props: MachineProps) {
  const seq = useSequencer<AbacusState>(REST, props.speed);
  useJobRunner(props.job, planAbacus, seq, props, REST);
  const { d } = seq.state;
  const interactive = !seq.playing;

  const manualSet = useCallback(
    (col: number, v: number) => {
      sfx.bead();
      const next = [...d];
      next[col] = v;
      const reading = Number(next.slice().reverse().join(''));
      seq.setManual({ d: next }, 220);
      seq.setCallout({ x: colX(col), y: 385, text: `Board reads ${fmt(reading)}`, step: 0, total: 0, ly: 54 });
    },
    [seq, d],
  );

  return (
    <MachineShell transitionMs={seq.transitionMs} callout={seq.callout} slow={props.speed > 1} label="Roman bronze hand abacus">
      <SharedDefs />
      <defs>
        <linearGradient id="abPlate" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7d6650" />
          <stop offset="0.45" stopColor="#5f4c3a" />
          <stop offset="1" stopColor="#6e5a44" />
        </linearGradient>
        <radialGradient id="abBead" cx="0.36" cy="0.32" r="0.75">
          <stop offset="0" stopColor="#8d7964" />
          <stop offset="0.45" stopColor="#4d3d2f" />
          <stop offset="1" stopColor="#22190f" />
        </radialGradient>
        <filter id="abPatina" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="4" seed="7" />
          <feColorMatrix values="0 0 0 0 0.16  0 0 0 0 0.13  0 0 0 0 0.09  0 0 0 1.4 -0.55" />
          <feComposite in2="SourceGraphic" operator="in" />
        </filter>
        <filter id="abGrain" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="3" />
          <feColorMatrix values="0 0 0 0 0.9  0 0 0 0 0.8  0 0 0 0 0.65  0 0 0 0.9 -0.5" />
          <feComposite in2="SourceGraphic" operator="in" />
        </filter>
        <pattern id="abPatinaDots" width="14" height="14" patternUnits="userSpaceOnUse">
          <circle cx="4" cy="5" r="1.1" fill="rgba(0,0,0,.25)" />
          <circle cx="10" cy="11" r="0.8" fill="rgba(255,230,200,.12)" />
        </pattern>
      </defs>

      {/* place-value guide above the plate */}
      <PlaceLabels xs={Array.from({ length: COLS }, (_, col) => colX(col))} />

      {/* bronze plate */}
      <g filter="url(#softShadow)">
        <rect x={220} y={100} width={1160} height={700} rx={14} fill="url(#abPlate)" />
      </g>
      <rect x={220} y={100} width={1160} height={700} rx={14} filter="url(#abPatina)" opacity={0.9} />
      <rect x={220} y={100} width={1160} height={700} rx={14} filter="url(#abGrain)" opacity={0.18} />
      <rect x={240} y={120} width={1120} height={660} rx={8} fill="none" stroke="rgba(25,18,10,.55)" strokeWidth={3} />
      <rect x={243} y={123} width={1114} height={654} rx={7} fill="none" stroke="rgba(230,205,170,.18)" strokeWidth={1.5} />

      {/* slots pierced through the plate */}
      {Array.from({ length: COLS }, (_, col) => {
        const x = colX(col);
        return (
          <g key={`s${col}`}>
            <rect x={x - 20} y={150} width={40} height={180} rx={20} fill="#141416" stroke="rgba(15,10,6,.75)" strokeWidth={3} />
            <rect x={x - 20} y={435} width={40} height={330} rx={20} fill="#141416" stroke="rgba(15,10,6,.75)" strokeWidth={3} />
            {/* engraved Roman marks */}
            <text x={x + 1.5} y={399} textAnchor="middle" fontSize={ROMAN[col].length > 3 ? 26 : 38} fontFamily="Fraunces, Georgia, serif" fill="rgba(235,210,175,.25)">
              {ROMAN[col]}
            </text>
            <text x={x} y={397} textAnchor="middle" fontSize={ROMAN[col].length > 3 ? 26 : 38} fontFamily="Fraunces, Georgia, serif" fill="#2a1f15">
              {ROMAN[col]}
            </text>
          </g>
        );
      })}
      {/* ounce (uncia) fraction column — decorative, as on the original */}
      {[
        { y: 300, h: 70, m: 'Ө' },
        { y: 425, h: 70, m: 'Ɔ' },
        { y: 560, h: 110, m: '2' },
      ].map((s, i) => (
        <g key={`u${i}`}>
          <rect x={1250 - 18} y={s.y} width={36} height={s.h} rx={18} fill="#141416" stroke="rgba(15,10,6,.75)" strokeWidth={3} />
          <text x={1196} y={s.y + s.h / 2 + 12} textAnchor="middle" fontSize={32} fontFamily="Fraunces, Georgia, serif" fill="#2a1f15">
            {s.m}
          </text>
          <Bead x={1250} y={s.y + s.h - 22} interactive={false} />
        </g>
      ))}
      <text x={1305} y={397} textAnchor="middle" fontSize={34} fontFamily="Fraunces, Georgia, serif" fill="#2a1f15">S</text>

      {/* beads */}
      {Array.from({ length: COLS }, (_, col) => {
        const x = colX(col);
        const v = d[col];
        const heavenOn = v >= 5;
        const n = v % 5;
        return (
          <g key={`b${col}`}>
            <Bead x={x} y={heavenOn ? HEAVEN_ON : HEAVEN_OFF} interactive={interactive} onClick={() => manualSet(col, heavenOn ? v - 5 : v + 5)} />
            {[0, 1, 2, 3].map((i) => {
              const active = i < n;
              return (
                <Bead
                  key={i}
                  x={x}
                  y={earthY(i, active)}
                  interactive={interactive}
                  onClick={() => manualSet(col, (heavenOn ? 5 : 0) + (active ? i : i + 1))}
                />
              );
            })}
          </g>
        );
      })}
    </MachineShell>
  );
}
