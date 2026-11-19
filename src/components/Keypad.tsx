import { useEffect, useRef, useState } from 'react';
import type { ModeId } from '../types';
import { ALLOWED, KEYPAD, LOCK_REASON, type KeyId } from '../lib/keys';

export function lockReason(mode: ModeId, k: KeyId): string | null {
  if (mode === 'modern' || ALLOWED[mode].includes(k)) return null;
  return LOCK_REASON[mode][k] ?? 'This machine could not perform that operation.';
}

export default function Keypad({ mode, onKey, onLocked, tip }: {
  mode: ModeId;
  onKey: (k: KeyId) => void;
  onLocked: (k: KeyId) => void;
  tip: { id: KeyId; text: string; n: number } | null;
}) {
  const [pressed, setPressed] = useState<KeyId | null>(null);
  const t = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(t.current), []);

  return (
    <div className="grid grid-cols-5 gap-2" role="group" aria-label="Calculator keypad">
      {KEYPAD.map((k) => {
        const reason = lockReason(mode, k.id);
        const locked = !!reason;
        const showTip = tip && tip.id === k.id;
        const tone =
          k.kind === 'eq'
            ? 'bg-accent text-[var(--accent-ink)] border-transparent hover:brightness-110'
            : k.kind === 'op'
              ? 'bg-key-op text-ink hover:bg-key-op-hover'
              : k.kind === 'clear'
                ? 'bg-key-fn text-danger hover:bg-key-op-hover'
                : k.kind === 'fn'
                  ? 'bg-key-fn text-ink hover:bg-key-op-hover'
                  : 'bg-key text-ink hover:bg-key-hover';
        return (
          <div key={k.id} className={`relative ${k.span === 2 ? 'col-span-2' : ''}`}>
            <button
              type="button"
              aria-label={(k.aria ?? k.label) + (locked ? ' (locked for this machine)' : '')}
              aria-disabled={locked}
              onClick={() => {
                if (locked) {
                  onLocked(k.id);
                  return;
                }
                setPressed(k.id);
                window.clearTimeout(t.current);
                t.current = window.setTimeout(() => setPressed(null), 120);
                onKey(k.id);
              }}
              className={`keypad-key relative h-12 w-full rounded-xl border border-line font-mono text-lg font-medium shadow-[0_1px_0_rgba(0,0,0,.06)] transition sm:h-13 ${tone} ${
                locked ? 'cursor-not-allowed opacity-35 saturate-0 hover:brightness-100' : 'active:translate-y-px'
              } ${pressed === k.id ? 'translate-y-px brightness-95' : ''}`}
            >
              {k.label}
              {locked && (
                <svg className="absolute right-1.5 top-1.5 h-3 w-3 opacity-70" viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M4 7V5a4 4 0 1 1 8 0v2h1v8H3V7h1Zm2 0h4V5a2 2 0 1 0-4 0v2Z" fill="currentColor" />
                </svg>
              )}
            </button>
            {showTip && (
              <div
                key={tip.n}
                role="tooltip"
                className={`lock-tip absolute bottom-[calc(100%+8px)] z-30 w-60 rounded-xl bg-ink px-3 py-2.5 text-[12.5px] leading-snug text-paper shadow-xl shadow-black/60 ${
                  KEYPAD.indexOf(k) % 5 >= 3 ? 'right-0' : KEYPAD.indexOf(k) % 5 <= 1 ? 'left-0' : 'left-1/2 -translate-x-1/2'
                }`}
              >
                <span className="mb-1 block font-mono text-[10.5px] uppercase tracking-[0.14em] opacity-60">Locked in this era</span>
                {tip.text}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
