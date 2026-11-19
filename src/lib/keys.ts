import type { ModeId } from '../types';

export type KeyId =
  | '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9'
  | '.' | '+' | '−' | '×' | '÷' | '√' | '%' | '^' | '(' | ')'
  | 'C' | '⌫' | '=' | '±';

export interface KeyDef {
  id: KeyId;
  label: string;
  kind: 'digit' | 'op' | 'fn' | 'eq' | 'clear';
  span?: number;
  aria?: string;
}

/** 5-column keypad layout, row by row. */
export const KEYPAD: KeyDef[] = [
  { id: 'C', label: 'C', kind: 'clear', aria: 'Clear' },
  { id: '⌫', label: '⌫', kind: 'fn', aria: 'Backspace' },
  { id: '(', label: '(', kind: 'fn' },
  { id: ')', label: ')', kind: 'fn' },
  { id: '÷', label: '÷', kind: 'op', aria: 'Divide' },
  { id: '7', label: '7', kind: 'digit' },
  { id: '8', label: '8', kind: 'digit' },
  { id: '9', label: '9', kind: 'digit' },
  { id: '√', label: '√', kind: 'fn', aria: 'Square root' },
  { id: '×', label: '×', kind: 'op', aria: 'Multiply' },
  { id: '4', label: '4', kind: 'digit' },
  { id: '5', label: '5', kind: 'digit' },
  { id: '6', label: '6', kind: 'digit' },
  { id: '%', label: '%', kind: 'fn', aria: 'Percent' },
  { id: '−', label: '−', kind: 'op', aria: 'Subtract' },
  { id: '1', label: '1', kind: 'digit' },
  { id: '2', label: '2', kind: 'digit' },
  { id: '3', label: '3', kind: 'digit' },
  { id: '^', label: 'xʸ', kind: 'fn', aria: 'Power' },
  { id: '+', label: '+', kind: 'op', aria: 'Add' },
  { id: '0', label: '0', kind: 'digit', span: 2 },
  { id: '.', label: '.', kind: 'digit', aria: 'Decimal point' },
  { id: '=', label: '=', kind: 'eq', span: 2, aria: 'Equals' },
];

const ALWAYS: KeyId[] = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '⌫', '='];

export const ALLOWED: Record<ModeId, KeyId[]> = {
  abacus: [...ALWAYS, '+', '−'],
  slide: [...ALWAYS, '.', '×', '÷', '√'],
  arith: [...ALWAYS, '.', '+', '−', '×', '÷'],
  compt: [...ALWAYS, '.', '+', '−', '×', '÷'],
  modern: [...ALWAYS, '.', '+', '−', '×', '÷', '√', '%', '^', '(', ')', '±'],
};

/** Why an era's machine could not do a locked operation. */
export const LOCK_REASON: Record<Exclude<ModeId, 'modern'>, Partial<Record<KeyId, string>>> = {
  abacus: {
    '×': 'Reckoners multiplied by long chains of additions and memorised tables — the bead board itself only moves values up and down a column.',
    '÷': 'Division was done by repeated subtraction worked out in the head; the board has no mechanism for it.',
    '.': 'Columns hold whole numbers. Roman fractions were twelfths (unciae) — decimal points reached Europe only in 1585.',
    '√': 'No bead technique computes roots directly; the Romans had no algorithm for it on the board.',
    '%': 'The percent sign did not exist yet — it appears in Italian merchant manuscripts around the 1400s.',
    '^': 'Exponent notation arrived with symbolic algebra in the 1600s.',
    '(': 'Bracketed expressions belong to symbolic algebra, centuries later.',
    ')': 'Bracketed expressions belong to symbolic algebra, centuries later.',
  },
  slide: {
    '+': 'A slide rule adds lengths that represent logarithms, so it multiplies — there is no scale for plain addition.',
    '−': 'Subtracting logarithm lengths divides; plain subtraction has no scale on a slide rule.',
    '%': 'No percent scale: engineers divided by 100 by moving the decimal point in their heads.',
    '^': 'General powers need the LL scales and several settings — beyond a single-move operation.',
    '(': 'One setting at a time: a slide rule cannot hold stacked expressions.',
    ')': 'One setting at a time: a slide rule cannot hold stacked expressions.',
  },
  arith: {
    '√': 'Square roots took long iterative routines by the operator; the arithmometer had no root mechanism.',
    '%': 'No percentage function — clerks multiplied, then moved the decimal two places.',
    '^': 'Powers meant cranking out repeated multiplications by hand.',
    '(': 'The result register holds one running total, so there is no place for bracketed sub-results.',
    ')': 'The result register holds one running total, so there is no place for bracketed sub-results.',
  },
  compt: {
    '√': 'Root extraction was a specialist key-stroke routine, not a key on the machine.',
    '%': 'No percentage key — operators multiplied and placed the decimal themselves.',
    '^': 'Powers meant repeated multiplication by key strokes.',
    '(': 'The accumulator wheels hold one running total — no bracketed sub-results.',
    ')': 'The accumulator wheels hold one running total — no bracketed sub-results.',
  },
};
