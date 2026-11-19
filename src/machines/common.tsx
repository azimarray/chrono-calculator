import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import type { Frame, Job, MachineProps, Plan } from '../types';
import { VB_H, VB_W } from '../types';
import type { ActiveCallout } from '../lib/useSequencer';

export type CalloutWithLabel = ActiveCallout;

/** Floating pointer: a pulsing dot on the active part, a leader line, and a label. */
export function Callout({ c, slow }: { c: CalloutWithLabel | null; slow: boolean }) {
  if (!c) return null;
  const ly = c.ly ?? (c.y > 220 ? c.y - 130 : c.y + 130);
  const lxRaw = c.lx ?? c.x;
  const lx = Math.max(150, Math.min(VB_W - 150, lxRaw));
  const align = lx < 330 ? 'left' : lx > VB_W - 330 ? 'right' : 'center';
  const tx = align === 'left' ? '-12%' : align === 'right' ? '-88%' : '-50%';
  return (
    <div className="pointer-events-none absolute inset-0" aria-live="polite">
      <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid meet">
        <line
          x1={c.x}
          y1={c.y}
          x2={lx}
          y2={ly}
          className="callout-leader"
          style={{ transition: 'all .3s ease' }}
        />
        <circle cx={c.x} cy={c.y} r={9} className="callout-dot" style={{ transition: 'all .3s ease' }} />
        <circle key={`p${c.step}`} cx={c.x} cy={c.y} r={9} className="callout-pulse" />
      </svg>
      <div
        className="callout-bubble"
        style={{
          left: `${(lx / VB_W) * 100}%`,
          top: `${(ly / VB_H) * 100}%`,
          transform: `translate(${tx}, -${((ly / VB_H) * 100).toFixed(1)}%)`,
        }}
      >
        {slow && c.total > 0 && (
          <span className="callout-step">
            Step {c.step}/{c.total}
          </span>
        )}
        <span>{c.text}</span>
      </div>
    </div>
  );
}

export function MachineShell({
  transitionMs,
  callout,
  slow,
  children,
  overlay,
  dragging,
  label,
}: {
  transitionMs: number;
  callout: CalloutWithLabel | null;
  slow: boolean;
  children: ReactNode;
  overlay?: ReactNode;
  dragging?: boolean;
  label: string;
}) {
  return (
    <div
      className={`absolute inset-0 ${dragging ? 'is-dragging' : ''}`}
      style={{ '--t': `${Math.round(transitionMs)}ms` } as CSSProperties}
    >
      <svg
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        className="absolute inset-0 h-full w-full touch-none select-none"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={label}
      >
        {children}
      </svg>
      {overlay}
      <Callout c={callout} slow={slow} />
    </div>
  );
}

/** Wires a job → plan → sequencer playback, using refs so callbacks never go stale. */
export function useJobRunner<S>(
  job: Job | null,
  plan: (job: Job) => Plan<S>,
  seq: {
    play: (frames: Frame<S>[], onStep: (i: number, t: number) => void, onDone: () => void) => void;
    stop: () => void;
    setManual: (s: S) => void;
  },
  props: MachineProps,
  rest: S,
) {
  const ref = useRef({ plan, seq, props, rest });
  ref.current = { plan, seq, props, rest };
  useEffect(() => {
    if (!job) return;
    const { plan, seq, props, rest } = ref.current;
    const p = plan(job);
    if (!p.ok) {
      seq.stop();
      seq.setManual(rest);
      props.onError(p.error);
      return;
    }
    seq.play(
      p.frames,
      (i, t) => ref.current.props.onProgress(i, t),
      () => ref.current.props.onDone(p.outcome),
    );
  }, [job]);
}

/** Convert a pointer event to viewBox coordinates of its nearest <svg>. */
export function svgPoint(e: { clientX: number; clientY: number }, el: Element): { x: number; y: number } {
  const svg = el instanceof SVGSVGElement ? el : (el as SVGElement).ownerSVGElement;
  if (!svg) return { x: 0, y: 0 };
  const pt = svg.createSVGPoint();
  pt.x = e.clientX;
  pt.y = e.clientY;
  const m = svg.getScreenCTM();
  if (!m) return { x: 0, y: 0 };
  const p = pt.matrixTransform(m.inverse());
  return { x: p.x, y: p.y };
}

/** Rolling digit wheel shown through a round or square window. */
export function DigitWheel({
  x,
  y,
  digit,
  r = 26,
  square = false,
  fontSize = 34,
  color = '#1b1612',
  face = '#f6efdc',
  id,
}: {
  x: number;
  y: number;
  digit: number;
  r?: number;
  square?: boolean;
  fontSize?: number;
  color?: string;
  face?: string;
  id: string;
}) {
  const step = fontSize * 1.25;
  return (
    <g transform={`translate(${x} ${y})`}>
      <defs>
        <clipPath id={id}>
          {square ? <rect x={-r * 0.78} y={-r} width={r * 1.56} height={r * 2} rx={4} /> : <circle r={r} />}
        </clipPath>
      </defs>
      {square ? (
        <rect x={-r * 0.78 - 4} y={-r - 4} width={r * 1.56 + 8} height={r * 2 + 8} rx={6} fill="#2a1d12" />
      ) : (
        <circle r={r + 4} fill="#3a2a14" />
      )}
      <g clipPath={`url(#${id})`}>
        {square ? <rect x={-r} y={-r} width={r * 2} height={r * 2} fill={face} /> : <circle r={r} fill={face} />}
        <g className="anim" style={{ transform: `translateY(${-digit * step}px)` }}>
          {Array.from({ length: 10 }, (_, k) => (
            <text
              key={k}
              x={0}
              y={k * step + fontSize * 0.36}
              textAnchor="middle"
              fontSize={fontSize}
              fontFamily="'IBM Plex Mono', ui-monospace, monospace"
              fontWeight={600}
              fill={color}
            >
              {k}
            </text>
          ))}
        </g>
        <rect x={-r} y={-r} width={r * 2} height={r * 0.7} fill="url(#wheelShadeTop)" />
        <rect x={-r} y={r * 0.3} width={r * 2} height={r * 0.7} fill="url(#wheelShadeBot)" />
      </g>
      {square ? (
        <rect x={-r * 0.78} y={-r} width={r * 1.56} height={r * 2} rx={4} fill="none" stroke="rgba(0,0,0,.45)" strokeWidth={2} />
      ) : (
        <circle r={r} fill="none" stroke="rgba(0,0,0,.45)" strokeWidth={2} />
      )}
    </g>
  );
}

/** Gradients shared by several machines. Render once inside each machine's <svg>. */
export function SharedDefs() {
  return (
    <defs>
      <linearGradient id="wheelShadeTop" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#000" stopOpacity="0.45" />
        <stop offset="1" stopColor="#000" stopOpacity="0" />
      </linearGradient>
      <linearGradient id="wheelShadeBot" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#000" stopOpacity="0" />
        <stop offset="1" stopColor="#000" stopOpacity="0.45" />
      </linearGradient>
      <radialGradient id="screwGrad" cx="0.35" cy="0.35" r="0.7">
        <stop offset="0" stopColor="#f2e3b0" />
        <stop offset="0.6" stopColor="#a88a45" />
        <stop offset="1" stopColor="#5e4a20" />
      </radialGradient>
      <filter id="softShadow" x="-10%" y="-10%" width="120%" height="130%">
        <feDropShadow dx="0" dy="10" stdDeviation="12" floodColor="#2a2018" floodOpacity="0.28" />
      </filter>
      <filter id="smallShadow" x="-30%" y="-30%" width="160%" height="160%">
        <feDropShadow dx="0" dy="3" stdDeviation="3" floodColor="#000" floodOpacity="0.35" />
      </filter>
    </defs>
  );
}

export function Screw({ x, y, r = 8, rot = 30 }: { x: number; y: number; r?: number; rot?: number }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot})`}>
      <circle r={r} fill="url(#screwGrad)" stroke="rgba(0,0,0,.4)" strokeWidth={1} />
      <line x1={-r * 0.7} x2={r * 0.7} y1={0} y2={0} stroke="rgba(0,0,0,.55)" strokeWidth={1.6} />
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* Shared plate size: every machine body matches the abacus plate.     */
/* ------------------------------------------------------------------ */

/** The abacus plate in stage (viewBox) units — the reference size for every machine. */
export const PLATE = { x: 220, y: 100, w: 1160, h: 700, rx: 14 } as const;

export interface Fit {
  s: number;
  tx: number;
  ty: number;
}

/** Uniform scale + offset that maps a machine body (drawn at x0,y0 with width w) onto the plate. */
export function fitToPlate(x0: number, y0: number, w: number): Fit {
  const s = PLATE.w / w;
  return { s, tx: PLATE.x - x0 * s, ty: PLATE.y - y0 * s };
}

export const fitTransform = (f: Fit) => `translate(${f.tx} ${f.ty}) scale(${f.s})`;

/** Callout targets are planned in a machine's own units; label anchors (lx/ly) are stage units. */
export function mapCallout<C extends { x: number; y: number; lx?: number }>(c: C | null, f: Fit): C | null {
  if (!c) return null;
  return { ...c, x: c.x * f.s + f.tx, y: c.y * f.s + f.ty, lx: c.lx === undefined ? undefined : c.lx * f.s + f.tx };
}

const PLACE_LABELS = ['1', '10', '100', '1K', '10K', '100K', '1M', '10M'];

/** Place-value guide above the plate (index 0 = units), identical on every machine. */
export function PlaceLabels({ xs }: { xs: number[] }) {
  return (
    <g>
      {xs.map((x, i) => (
        <text key={i} x={x} y={84} textAnchor="middle" fill="#8b8173" fontSize={20} fontFamily="'IBM Plex Mono', monospace">
          {PLACE_LABELS[i]}
        </text>
      ))}
    </g>
  );
}
