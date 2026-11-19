import type { Op } from '../types';

/** Human-friendly number formatting with thousands separators. */
export function fmt(n: number, maxFrac = 8): string {
  if (!Number.isFinite(n)) return n > 0 ? '∞' : n < 0 ? '−∞' : 'Error';
  const abs = Math.abs(n);
  let s: string;
  if (abs !== 0 && (abs >= 1e15 || abs < 1e-7)) {
    s = n.toExponential(8).replace(/\.?0+e/, 'e').replace('e+', 'e');
  } else {
    const rounded = Number(n.toPrecision(12));
    s = rounded.toLocaleString('en-US', { maximumFractionDigits: maxFrac });
  }
  return s.replace(/^-/, '−');
}

/** Plain digits for an integer register value, zero-padded. */
export function pad(n: number, width: number): string {
  return Math.round(n).toString().padStart(width, '0').slice(-width);
}

export function digitsOf(n: number, width: number): number[] {
  // index 0 = units
  const s = pad(n, width);
  return s.split('').reverse().map(Number);
}

export function decimals(s: string): number {
  const i = s.indexOf('.');
  return i < 0 ? 0 : s.length - i - 1;
}

export interface Parsed {
  op: Op;
  a: number;
  b: number;
  aStr: string;
  bStr: string;
}

const NUM = '(\\d+(?:\\.\\d+)?|\\.\\d+)';
const BIN = new RegExp(`^${NUM}([+−×÷])${NUM}$`);
const ROOT = new RegExp(`^√${NUM}$`);

/** Parse a single-operation historical entry like "4×4" or "√9". */
export function parseHistorical(expr: string): Parsed | null {
  const e = expr.replace(/\s+/g, '');
  let m = e.match(ROOT);
  if (m) return { op: '√', a: Number(m[1]), b: 0, aStr: m[1], bStr: '' };
  m = e.match(BIN);
  if (m) return { op: m[2] as Op, a: Number(m[1]), b: Number(m[3]), aStr: m[1], bStr: m[3] };
  return null;
}

/* ------------------------------------------------------------------ */
/* Modern expression evaluator: + − × ÷ ^ √ % ( ) with precedence.     */
/* ------------------------------------------------------------------ */

type Tok = { t: 'num'; v: number } | { t: 'op'; v: string };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ') { i++; continue; }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      const raw = src.slice(i, j);
      if ((raw.match(/\./g) ?? []).length > 1 || raw === '.') throw new Error('Bad number');
      out.push({ t: 'num', v: Number(raw) });
      i = j;
      continue;
    }
    const map: Record<string, string> = { '-': '−', '*': '×', '/': '÷', 'x': '×' };
    const op = map[c] ?? c;
    if ('+−×÷^√%()'.includes(op)) { out.push({ t: 'op', v: op }); i++; continue; }
    throw new Error(`Unexpected ${c}`);
  }
  return out;
}

export function evaluate(src: string): number {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v: string) => { const k = peek(); return !!k && k.t === 'op' && k.v === v; };

  type Val = { v: number; pct: boolean };

  function expr(): Val {
    let left = term();
    while (isOp('+') || isOp('−')) {
      const op = (toks[p++] as { v: string }).v;
      const right = term();
      // "200 + 10%" → 200 + 20 (calculator convention)
      const r = right.pct ? (left.v * right.v) : right.v;
      left = { v: op === '+' ? left.v + r : left.v - r, pct: false };
    }
    return left;
  }
  function term(): Val {
    let left = power();
    for (;;) {
      if (isOp('×') || isOp('÷')) {
        const op = (toks[p++] as { v: string }).v;
        const right = power();
        left = { v: op === '×' ? left.v * right.v : left.v / right.v, pct: false };
      } else if (peek() && (peek().t === 'num' || isOp('(') || isOp('√'))) {
        // implicit multiplication: 2(3), 2√9, (2)(3)
        const right = power();
        left = { v: left.v * right.v, pct: false };
      } else break;
    }
    return left;
  }
  function power(): Val {
    const base = unary();
    if (isOp('^')) {
      p++;
      const exp = power();
      return { v: Math.pow(base.v, exp.v), pct: false };
    }
    return base;
  }
  function unary(): Val {
    if (isOp('−')) { p++; const u = unary(); return { v: -u.v, pct: u.pct }; }
    if (isOp('+')) { p++; return unary(); }
    return postfix();
  }
  function postfix(): Val {
    let v = primary();
    while (isOp('%')) { p++; v = { v: v.v / 100, pct: true }; }
    return v;
  }
  function primary(): Val {
    const k = peek();
    if (!k) throw new Error('Incomplete');
    if (k.t === 'num') { p++; return { v: k.v, pct: false }; }
    if (k.v === '(') {
      p++;
      const v = expr();
      if (isOp(')')) p++; // auto-close missing parens
      return { v: v.v, pct: false };
    }
    if (k.v === '√') {
      p++;
      const u = unary();
      return { v: Math.sqrt(u.v), pct: false };
    }
    throw new Error('Unexpected operator');
  }

  const result = expr();
  if (p < toks.length) throw new Error('Unexpected input');
  if (!Number.isFinite(result.v) || Number.isNaN(result.v)) throw new Error('Math error');
  return result.v;
}

/** Scale two decimal operands to integers sharing a fixed point. */
export function fixedPoint(aStr: string, bStr: string) {
  const d = Math.max(decimals(aStr), decimals(bStr));
  const f = 10 ** d;
  return { A: Math.round(Number(aStr) * f), B: Math.round(Number(bStr) * f), d };
}

export function intDigits(n: number): number {
  return Math.max(1, Math.floor(Math.abs(n)).toString().length);
}
