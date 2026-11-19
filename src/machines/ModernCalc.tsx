import { KEYPAD, type KeyDef, type KeyId } from '../lib/keys';

/**
 * Modern digital calculator (2000). Same key layout as the input keypad below the stage,
 * coloured like a phone calculator: dark grey digits, light grey functions, orange operators.
 * It evaluates instantly — no mechanism, no animation sequence.
 */

const tone = (k: KeyDef) => (k.kind === 'digit' ? 'num' : k.kind === 'op' || k.kind === 'eq' ? 'op' : 'fn');

/** Shrink the readout as it gets longer so it always fits on one line. */
function readoutSize(text: string): string {
  const n = text.length;
  if (n <= 12) return '8.4cqh';
  return `${Math.max(4.2, (8.4 * 12) / n).toFixed(2)}cqh`;
}

export default function ModernCalc({ expr, history, result, error, pendingOp, onKey }: {
  /** Current entry, already formatted for display. */
  expr: string;
  /** The expression that produced the result (shown small, above). */
  history: string;
  result: string | null;
  error: string | null;
  /** Operator waiting for its second number — highlighted. */
  pendingOp: KeyId | null;
  onKey: (k: KeyId) => void;
}) {
  const main = error ?? result ?? (expr || '0');
  return (
    <div className="ios-wrap">
      <div className="ios-bezel">
        <div className="ios-device">
          <div className="ios-display" aria-live="polite">
            <div className="ios-history">{result || error ? history : '\u00a0'}</div>
            <div className="ios-readout" style={{ fontSize: readoutSize(main) }}>
              {main}
            </div>
          </div>
          <div className="ios-keys">
            {KEYPAD.map((k) => {
              const t = tone(k);
              const on = k.kind === 'op' && pendingOp === k.id;
              return (
                <button
                  key={k.id}
                  type="button"
                  aria-label={k.aria ?? k.label}
                  aria-pressed={k.kind === 'op' ? on : undefined}
                  onClick={() => onKey(k.id)}
                  className={`ios-key ios-key-${t} ${k.span === 2 ? 'ios-key-wide' : ''} ${on ? 'is-on' : ''}`}
                >
                  {k.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
