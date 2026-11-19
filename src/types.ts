export type ModeId = 'abacus' | 'slide' | 'arith' | 'compt' | 'modern';

/** Operators as they appear in the entry line. */
export type Op = '+' | '−' | '×' | '÷' | '√';

export type SoundKind =
  | 'bead'
  | 'slide'
  | 'ratchet'
  | 'key'
  | 'keyUp'
  | 'lever'
  | 'carriage'
  | 'clear'
  | 'tap';

export interface SoundCue {
  kind: SoundKind;
  /** Duration in ms at normal speed (scaled by the speed factor when played). */
  ms?: number;
}

/** A calculation handed to a historical machine. */
export interface Job {
  id: number;
  op: Op;
  a: number;
  b: number;
  aStr: string;
  bStr: string;
}

export interface Outcome {
  display: string;
  explanation: string;
  note?: string;
}

/** Callout target in machine viewBox coordinates (all machines use 1600 × 900). */
export interface CalloutSpec {
  x: number;
  y: number;
  text: string;
  /** Optional label anchor (defaults to just above / below the target). */
  lx?: number;
  ly?: number;
}

export interface Frame<S> {
  state: S;
  /** How long this frame holds before the next one, in ms at normal speed. */
  dur: number;
  /** CSS transition length for the movement into this frame (defaults from dur). */
  t?: number;
  callout?: CalloutSpec | null;
  sound?: SoundCue | SoundCue[];
}

export type Plan<S> =
  | { ok: true; frames: Frame<S>[]; outcome: Outcome }
  | { ok: false; error: string };

export interface MachineProps {
  job: Job | null;
  speed: number;
  onProgress: (step: number, total: number) => void;
  onDone: (outcome: Outcome) => void;
  onError: (message: string) => void;
}

export const VB_W = 1600;
export const VB_H = 900;
