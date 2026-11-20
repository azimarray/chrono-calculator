import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Job, ModeId, Outcome } from './types';
import { sfx } from './lib/audio';
import { evaluate, fmt, parseHistorical } from './lib/math';
import type { KeyId } from './lib/keys';
import Keypad, { lockReason } from './components/Keypad';
import Abacus from './machines/Abacus';
import SlideRule from './machines/SlideRule';
import Arithmometer from './machines/Arithmometer';
import Comptometer from './machines/Comptometer';
import ModernCalc from './machines/ModernCalc';

interface ModeDef {
  id: ModeId;
  name: string;
  era: string;
  accent: string;
  /** Text colour that reads on top of the accent. */
  accentInk: string;
  noun: string;
  examples: string[];
}

const MODES: ModeDef[] = [
  { id: 'abacus', name: 'Abacus', era: 'c. 2700 BCE', accent: '#c0915f', accentInk: '#1a1109', noun: 'abacus', examples: ['4+4', '9−6', '1234+5678', '503−47'] },
  { id: 'slide', name: 'Slide Rule', era: '1622', accent: '#e2574a', accentInk: '#ffffff', noun: 'slide rule', examples: ['4×4', '7÷3', '√2', '2.5×36'] },
  { id: 'arith', name: 'Arithmometer', era: '1820', accent: '#d6ab4c', accentInk: '#1c1405', noun: 'arithmometer', examples: ['4×4', '23×47', '100÷8', '420−75'] },
  { id: 'compt', name: 'Comptometer', era: '1887', accent: '#46b07b', accentInk: '#06150d', noun: 'comptometer', examples: ['4×4', '56+78', '23×12', '84÷7'] },
  { id: 'modern', name: 'Modern Digital', era: '2000', accent: '#ff9f0a', accentInk: '#ffffff', noun: 'calculator', examples: ['2^10', '√(3^2+4^2)', '200+15%', '(1+2)×3÷4'] },
];

type Phase = 'idle' | 'working' | 'done' | 'error';
const OPS = ['+', '−', '×', '÷'];
const MAX_OPERAND: Record<ModeId, number> = { abacus: 7, slide: 9, arith: 9, compt: 9, modern: 40 };

const plain = (n: number) => {
  const s = String(Number(n.toPrecision(10)));
  return s.includes('e') ? '' : s.replace('-', '−');
};

/** Space out binary operators; leave a sign minus attached to its number. */
const pretty = (e: string) => {
  let out = '';
  for (let i = 0; i < e.length; i++) {
    const c = e[i];
    const binary = '+−×÷^'.includes(c) && i > 0 && /[\d).%]/.test(e[i - 1]);
    out += binary ? ` ${c} ` : c;
  }
  return out.trim();
};

/** Phone-calculator +/− : flip the sign of the number being typed (or of the next one). */
const endsWithSignMinus = (e: string) => e.endsWith('−') && (e.length === 1 || '+−×÷^(√'.includes(e[e.length - 2]));
function toggleSign(e: string): string {
  const m = e.match(/(\d+\.?\d*|\.\d+)$/);
  const num = m ? m[0] : '';
  const before = e.slice(0, e.length - num.length);
  if (before === '') return '−' + num;
  if (endsWithSignMinus(before)) return before.slice(0, -1) + num;
  if ('+−×÷^(√'.includes(before[before.length - 1])) return before + '−' + num;
  return e;
}

interface InstallEvent extends Event {
  prompt: () => Promise<void>;
}

export default function App() {
  const [mode, setMode] = useState<ModeId>('abacus');
  const [slow, setSlow] = useState(false);
  const [muted, setMuted] = useState(false);
  const [expr, setExpr] = useState('');
  const [fresh, setFresh] = useState(false); // expr shows a finished result
  const [lastValue, setLastValue] = useState<number | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState({ step: 0, total: 0 });
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [machineKey, setMachineKey] = useState(0);
  const [tip, setTip] = useState<{ id: KeyId; text: string; n: number } | null>(null);
  const [install, setInstall] = useState<InstallEvent | null>(null);
  const tipTimer = useRef<number | undefined>(undefined);

  const def = MODES.find((m) => m.id === mode)!;
  const speed = slow ? 2.8 : 1;

  useEffect(() => sfx.setMuted(muted), [muted]);
  useEffect(() => {
    const h = (e: Event) => {
      e.preventDefault();
      setInstall(e as InstallEvent);
    };
    window.addEventListener('beforeinstallprompt', h);
    return () => window.removeEventListener('beforeinstallprompt', h);
  }, []);

  const resetRun = useCallback(() => {
    setJob(null);
    setPhase('idle');
    setOutcome(null);
    setError(null);
    setProgress({ step: 0, total: 0 });
  }, []);

  const switchMode = (m: ModeId) => {
    if (m === mode) return;
    sfx.unlock();
    setMode(m);
    setExpr('');
    setFresh(false);
    setLastValue(null);
    setHint(null);
    setTip(null);
    resetRun();
    setMachineKey((k) => k + 1);
  };

  const showHint = (h: string) => setHint(h);

  const run = useCallback(
    (e: string) => {
      if (mode === 'modern') {
        if (!e) return;
        try {
          const v = evaluate(e);
          setOutcome({ display: fmt(v), explanation: '' });
          setError(null);
          setPhase('done');
          setLastValue(v);
          setFresh(true);
        } catch {
          setOutcome(null);
          setError('Error');
          setPhase('error');
        }
        return;
      }
      const p = parseHistorical(e);
      if (!p) {
        showHint(mode === 'slide' ? 'Enter one operation, like 4 × 4 or √2, then press =' : 'Enter one complete operation, like 4 + 4, then press =');
        return;
      }
      const exact = p.op === '+' ? p.a + p.b : p.op === '−' ? p.a - p.b : p.op === '×' ? p.a * p.b : p.op === '÷' ? p.a / p.b : Math.sqrt(p.a);
      setLastValue(Number.isFinite(exact) ? exact : null);
      setHint(null);
      setOutcome(null);
      setError(null);
      setProgress({ step: 0, total: 0 });
      setPhase('working');
      setFresh(true);
      setJob({ id: Date.now(), ...p });
    },
    [mode],
  );

  const handleKey = useCallback(
    (k: KeyId) => {
      sfx.unlock();
      setHint(null);
      const reason = lockReason(mode, k);
      if (reason) {
        sfx.deny();
        setTip({ id: k, text: reason, n: Date.now() });
        window.clearTimeout(tipTimer.current);
        tipTimer.current = window.setTimeout(() => setTip(null), 4200);
        return;
      }
      setTip(null);
      sfx.tap();
      if (k === '±') {
        if (mode !== 'modern') return;
        if (fresh && phase === 'done' && lastValue !== null) {
          // flip the shown result; the next digit still starts a new number
          const v = -lastValue;
          setLastValue(v);
          setOutcome({ display: fmt(v), explanation: '' });
          return;
        }
        if (phase === 'done' || phase === 'error') {
          setPhase('idle');
          setOutcome(null);
          setError(null);
        }
        setFresh(false);
        setExpr((e) => toggleSign(fresh ? '' : e));
        return;
      }
      if (mode === 'modern' && k !== '=' && (phase === 'done' || phase === 'error')) {
        setPhase('idle');
        setOutcome(null);
        setError(null);
      }

      if (k === 'C') {
        setExpr('');
        setFresh(false);
        setLastValue(null);
        resetRun();
        setMachineKey((n) => n + 1);
        return;
      }
      if (k === '=') {
        run(expr);
        return;
      }
      if (k === '⌫') {
        setFresh(false);
        setExpr((e) => (fresh ? '' : e.slice(0, -1)));
        return;
      }

      const historical = mode !== 'modern';
      let base = expr;
      if (fresh) {
        // after a result: digits start over, operators continue from the result
        const isContinuation = OPS.includes(k) || k === '%' || k === '^' || (k === '√' && !historical);
        if (isContinuation && lastValue !== null && plain(lastValue)) base = mode === 'modern' && k === '√' ? '' : plain(lastValue);
        else base = '';
        setFresh(false);
      }

      if (!historical) {
        if (k === '%' && !/[\d).]$/.test(base)) return;
        let next = base + k;
        if (OPS.includes(k) && k !== '−' && /[+−×÷^]$/.test(base)) next = base.slice(0, -1) + k;
        const lastNum = base.split(/[+−×÷^()√%]/).pop() ?? '';
        if (k === '.' && lastNum.includes('.')) return;
        setExpr(next);
        return;
      }

      // historical: one operation at a time
      const m = base.match(/^(√)?(\d*\.?\d*)([+−×÷])?(\d*\.?\d*)$/);
      if (!m) return;
      const [, root, a, op, b] = m;
      if (/\d|\./.test(k)) {
        const cur = op ? b : a;
        if (k === '.' && cur.includes('.')) return;
        if (cur.replace('.', '').length >= MAX_OPERAND[mode]) {
          showHint(`This machine takes at most ${MAX_OPERAND[mode]} digits per number.`);
          return;
        }
        setExpr(base + (k === '.' && !cur ? '0.' : k));
        return;
      }
      if (OPS.includes(k)) {
        if (root) return showHint('A root is a single operation — press = to see it.');
        if (!a) {
          if (k === '−') showHint('These machines work with positive numbers — enter the first number.');
          return;
        }
        if (op && b) return showHint('One operation at a time — press = first, then continue from the result.');
        setExpr(op ? base.slice(0, -1) + k : base + k);
        return;
      }
      if (k === '√') {
        if (root) return;
        if (op) return showHint('Press = first: the root is its own operation.');
        setExpr('√' + a);
        return;
      }
    },
    [expr, fresh, lastValue, mode, phase, resetRun, run],
  );

  // physical keyboard
  useEffect(() => {
    const map: Record<string, KeyId> = {
      '+': '+', '-': '−', '*': '×', x: '×', X: '×', '/': '÷', '.': '.', ',': '.', Enter: '=', '=': '=',
      Backspace: '⌫', Escape: 'C', c: 'C', C: 'C', '%': '%', '^': '^', '(': '(', ')': ')', r: '√', R: '√',
    };
    const h = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      const k: KeyId | undefined = /^[0-9]$/.test(e.key) ? (e.key as KeyId) : map[e.key];
      if (!k) return;
      e.preventDefault();
      handleKey(k);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [handleKey]);

  const machineProps = useMemo(
    () => ({
      job,
      speed,
      onProgress: (step: number, total: number) => setProgress({ step, total }),
      onDone: (o: Outcome) => {
        setOutcome(o);
        setPhase('done');
        sfx.chime();
      },
      onError: (msg: string) => {
        setError(msg);
        setPhase('error');
        sfx.deny();
      },
    }),
    [job, speed],
  );

  const tryExample = (ex: string) => {
    sfx.unlock();
    setExpr(ex);
    setFresh(false);
    setHint(null);
    run(ex);
  };

  return (
    <div className="min-h-dvh bg-paper text-ink" style={{ '--accent': def.accent, '--accent-ink': def.accentInk } as CSSProperties}>
      <div className="app-gutter mx-auto flex max-w-6xl flex-col gap-4 pb-10 pt-4 sm:gap-5">
        {/* Header */}
        <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 pt-2">
          <div>
            <h1 className="font-display text-[28px] leading-none tracking-tight sm:text-[34px]">Chrono Calculator</h1>
            <p className="mt-1.5 text-[13px] text-muted">Evolution of Calculation · watch each machine work, then see the answer</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="panel flex rounded-full border bg-card p-1 text-[12.5px] font-medium" role="radiogroup" aria-label="Animation speed">
              {[
                { v: false, l: 'Normal' },
                { v: true, l: 'Slow-mo steps' },
              ].map((o) => (
                <button
                  key={o.l}
                  role="radio"
                  aria-checked={slow === o.v}
                  onClick={() => setSlow(o.v)}
                  className={`rounded-full px-3 py-1.5 transition ${slow === o.v ? 'bg-ink text-paper' : 'text-muted hover:text-ink'}`}
                >
                  {o.l}
                </button>
              ))}
            </div>
            <button
              onClick={() => {
                const m = !muted;
                setMuted(m);
                sfx.setMuted(m);
                if (!m) sfx.tap();
              }}
              aria-pressed={!muted}
              aria-label={muted ? 'Unmute sound' : 'Mute sound'}
              className="panel grid h-9 w-9 place-items-center rounded-full border bg-card text-ink transition hover:bg-key-hover"
            >
              <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z" fill="currentColor" stroke="none" />
                {muted ? <path d="M16 9.5l5 5M21 9.5l-5 5" /> : <path d="M16 9a4.2 4.2 0 0 1 0 6M18.6 6.6a7.6 7.6 0 0 1 0 10.8" />}
              </svg>
            </button>
            {install && (
              <button
                onClick={async () => {
                  await install.prompt();
                  setInstall(null);
                }}
                className="h-9 rounded-full bg-ink px-3.5 text-[12.5px] font-medium text-paper transition hover:opacity-90"
              >
                Install app
              </button>
            )}
          </div>
        </header>

        {/* Mode bar */}
        {/* The frame stays exactly as wide as the title and stage; on phones the tabs scroll inside it. */}
        <nav className="panel overflow-hidden rounded-2xl border bg-card" aria-label="Calculator mode">
          <div className="mode-scroll overflow-x-auto">
          <div className="flex min-w-max gap-1.5 p-1.5 sm:min-w-0 sm:grid sm:grid-cols-5">
            {MODES.map((m) => {
              const active = m.id === mode;
              return (
                <button
                  key={m.id}
                  onClick={(e) => {
                    switchMode(m.id);
                    e.currentTarget.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
                  }}
                  aria-current={active ? 'page' : undefined}
                  className={`group rounded-xl px-3.5 py-2 text-left transition sm:px-4 ${active ? 'bg-ink text-paper shadow-sm' : 'text-ink hover:bg-key-hover'}`}
                >
                  <span className="flex items-center gap-2 text-[14px] font-semibold">
                    <span className="h-2 w-2 rounded-full" style={{ background: m.accent }} />
                    {m.name}
                  </span>
                  <span className={`mt-0.5 block font-mono text-[11px] ${active ? 'opacity-70' : 'text-muted'}`}>{m.era}</span>
                </button>
              );
            })}
          </div>
          </div>
        </nav>

        {/* Stage */}
        <section className="panel stage relative aspect-video w-full overflow-hidden rounded-[20px] border" aria-label={`${def.name} stage`}>
          {mode === 'abacus' && <Abacus key={machineKey} {...machineProps} />}
          {mode === 'slide' && <SlideRule key={machineKey} {...machineProps} />}
          {mode === 'arith' && <Arithmometer key={machineKey} {...machineProps} />}
          {mode === 'compt' && <Comptometer key={machineKey} {...machineProps} />}
          {mode === 'modern' && (
            <ModernCalc
              expr={pretty(expr)}
              history={pretty(expr)}
              result={phase === 'done' ? outcome?.display ?? null : null}
              error={phase === 'error' ? error : null}
              pendingOp={!fresh && /[\d).%][+−×÷]$/.test(expr) ? (expr.slice(-1) as KeyId) : null}
              onKey={handleKey}
            />
          )}
          {mode !== 'modern' && phase === 'idle' && (
            <div className="pointer-events-none absolute bottom-[3%] left-1/2 -translate-x-1/2 rounded-full bg-white/[0.06] px-3 py-1 text-[11px] text-muted max-sm:hidden">
              Try the machine directly — {mode === 'slide' ? 'drag the slide and the cursor' : mode === 'abacus' ? 'click the beads' : mode === 'arith' ? 'drag sliders, flip the lever, turn the crank' : 'press the keys, pull the clear crank'}
            </div>
          )}
        </section>

        {/* Result + Input */}
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_420px] lg:gap-5">
          <ResultBox mode={def} phase={phase} outcome={outcome} error={error} progress={progress} onExample={tryExample} />

          <section className="panel rounded-[20px] border bg-card p-3 sm:p-4" aria-label="Input">
            <div className="mb-3 rounded-xl border border-line bg-paper px-4 py-2.5">
              <div className="flex items-center justify-between text-[11px] text-muted">
                <span className="font-mono uppercase tracking-[0.14em]">Entry · {def.name}</span>
                {mode !== 'modern' && <span>one operation per run</span>}
              </div>
              <div className="mt-1 flex min-h-[38px] items-center justify-end overflow-x-auto font-mono text-[26px] font-medium tracking-tight">
                <span className={fresh ? 'text-muted' : ''}>{pretty(expr) || <span className="text-muted/60">0</span>}</span>
                <span className="caret ml-0.5 inline-block h-7 w-[2px] bg-accent" />
              </div>
              <p className={`min-h-[18px] text-[12px] ${hint ? 'text-danger' : 'text-muted'}`} aria-live="polite">
                {hint ?? (mode === 'modern' ? 'Everything unlocked: powers, roots, %, brackets, chains.' : 'Locked keys show why that era couldn’t do it.')}
              </p>
            </div>
            <Keypad mode={mode} onKey={handleKey} onLocked={handleKey} tip={tip} />
          </section>
        </div>

        <footer className="pt-2 text-center text-[11.5px] text-muted">
          Chrono Calculator works offline once loaded · keyboard: digits, + − * /, Enter, Backspace, Esc
        </footer>
      </div>
    </div>
  );
}

function ResultBox({ mode, phase, outcome, error, progress, onExample }: {
  mode: ModeDef;
  phase: Phase;
  outcome: Outcome | null;
  error: string | null;
  progress: { step: number; total: number };
  onExample: (e: string) => void;
}) {
  const isModern = mode.id === 'modern';
  return (
    <section
      className={`result-box relative overflow-hidden rounded-[20px] border bg-card p-5 transition-[border-color,box-shadow] duration-500 sm:p-6 ${
        phase === 'done' ? 'is-lit border-accent' : 'panel'
      }`}
      aria-live="polite"
      aria-label="Result and explanation"
    >
      <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
        {phase === 'working' ? 'Machine at work' : phase === 'done' ? (isModern ? 'Instant result' : 'Result') : phase === 'error' ? 'Not possible on this machine' : 'Result & explanation'}
      </div>

      {phase === 'idle' && (
        <div className="mt-3">
          <p className="max-w-xl text-[15px] leading-relaxed">
            {isModern
              ? 'Type any expression — it is computed the instant you press =, no gears required.'
              : `Enter an equation and press = to watch the ${mode.noun} work from zero. The answer appears here only after the mechanism stops.`}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {mode.examples.map((ex) => (
              <button key={ex} onClick={() => onExample(ex)} className="rounded-full border border-line bg-paper px-3 py-1.5 font-mono text-[13px] transition hover:border-accent hover:text-accent">
                {pretty(ex)}
              </button>
            ))}
          </div>
        </div>
      )}

      {phase === 'working' && (
        <div className="mt-3">
          <div className="flex items-baseline gap-3">
            <span className="working-dots font-display text-[30px] leading-none text-muted">Working</span>
            <span className="font-mono text-[13px] text-muted">
              step {progress.step} of {progress.total}
            </span>
          </div>
          <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-paper">
            <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${progress.total ? (progress.step / progress.total) * 100 : 0}%` }} />
          </div>
          <p className="mt-3 text-[13.5px] text-muted">The answer stays hidden until the last part comes to rest.</p>
        </div>
      )}

      {phase === 'done' && outcome && (
        <div className="reveal mt-2">
          <div className="font-mono text-[clamp(34px,6vw,56px)] font-semibold leading-tight tracking-tight text-ink">{outcome.display}</div>
          {!isModern && <p className="mt-2 max-w-2xl text-[15px] leading-relaxed">{outcome.explanation}</p>}
          {!isModern && outcome.note && <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-muted">{outcome.note}</p>}
        </div>
      )}

      {phase === 'error' && (
        <div className="mt-3">
          <p className="text-[15px] leading-relaxed text-danger">{error}</p>
          {!isModern && <p className="mt-2 text-[13px] text-muted">Try one of: {mode.examples.map(pretty).join(' · ')}</p>}
        </div>
      )}
    </section>
  );
}
