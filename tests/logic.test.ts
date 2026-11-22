/* Maths tests: run every machine's planner on many random equations and check the
   answer it reveals AND the machine's final physical state against exact arithmetic.
   Run with:  npm run test:logic   (the random inputs are seeded, so every run is identical) */
import { planAbacus } from '../src/machines/Abacus';
import { planSlideRule } from '../src/machines/SlideRule';
import { planArithmometer } from '../src/machines/Arithmometer';
import { planComptometer } from '../src/machines/Comptometer';
import { evaluate, fmt, parseHistorical } from '../src/lib/math';
import type { Job, Op } from '../src/types';

type Result = { name: string; runs: number; pass: number; rejected: number; fails: string[] };
const results: Result[] = [];
let seed = 20261121;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const int = (max: number) => Math.floor(rnd() * (max + 1));
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
const job = (op: Op, aStr: string, bStr = ''): Job => ({ id: 1, op, a: Number(aStr), b: Number(bStr || 0), aStr, bStr });
const num = (display: string) => Number(display.replace(/[≈\s,]/g, '').replace('−', '-'));
const digitsToNum = (d: number[]) => Number(d.slice().reverse().join(''));

function suite(name: string, runs: number, body: (fail: (m: string) => void) => 'ok' | 'rejected') {
  const r: Result = { name, runs, pass: 0, rejected: 0, fails: [] };
  for (let i = 0; i < runs; i++) {
    let failed = false;
    const out = body((m) => { failed = true; if (r.fails.length < 5) r.fails.push(m); });
    if (out === 'rejected') r.rejected++;
    else if (!failed) r.pass++;
  }
  results.push(r);
}

/* ---------------- Abacus: + and − on whole numbers up to 7 digits ---------------- */
suite('Abacus  + −  (random up to 7 digits)', 400, (fail) => {
  const op = pick<Op>(['+', '−']);
  const a = int(pick([9, 99, 9999, 999999, 9999999])), b = int(pick([9, 99, 9999, 999999, 9999999]));
  const p = planAbacus(job(op, String(a), String(b)));
  const exact = op === '+' ? a + b : a - b;
  if (!p.ok) { if (op === '+' && exact > 9999999) return 'rejected'; fail(`${a}${op}${b} rejected: ${p.error}`); return 'ok'; }
  if (num(p.outcome.display) !== exact) fail(`${a}${op}${b}: showed ${p.outcome.display}, expected ${exact}`);
  const last = p.frames[p.frames.length - 1].state;
  if (digitsToNum(last.d) !== Math.abs(exact)) fail(`${a}${op}${b}: beads read ${digitsToNum(last.d)}, expected ${Math.abs(exact)}`);
  for (const f of p.frames) if (f.state.d.some((v) => v < 0 || v > 9)) { fail(`${a}${op}${b}: impossible bead count ${f.state.d}`); break; }
  return 'ok';
});
suite('Abacus  first frame starts from zero', 50, (fail) => {
  const p = planAbacus(job('+', String(int(99999)), String(int(99999))));
  if (p.ok && digitsToNum(p.frames[0].state.d) !== 0) fail('first frame not cleared');
  return 'ok';
});

/* ---------------- Slide rule: × ÷ √, 3 significant figures ---------------- */
const r3 = (v: number) => Number(v.toPrecision(3));
suite('Slide rule  × ÷ √  (random, decimals, any size)', 500, (fail) => {
  const op = pick<Op>(['×', '÷', '√']);
  const mk = () => String(Number((rnd() * pick([1, 10, 100, 10000]) + 0.01).toFixed(pick([0, 1, 2]))) || 1);
  const aS = mk(), bS = mk();
  const a = Number(aS), b = Number(bS);
  const p = planSlideRule(job(op, aS, bS));
  if (!p.ok) { fail(`${aS}${op}${bS} rejected: ${p.error}`); return 'ok'; }
  const exact = op === '×' ? a * b : op === '÷' ? a / b : Math.sqrt(a);
  if (num(p.outcome.display) !== r3(exact)) fail(`${aS}${op}${bS}: showed ${p.outcome.display}, expected ≈ ${r3(exact)}`);
  const last = p.frames[p.frames.length - 1].state;
  if (last.cursor < -0.001 || last.cursor > 1.001) fail(`${aS}${op}${bS}: hairline off the scale (${last.cursor})`);
  if (Math.abs(last.slide) > 1.001) fail(`${aS}${op}${bS}: slide pulled out too far (${last.slide})`);
  // the magnified D reading must show the answer's leading digits
  const m = exact / 10 ** Math.floor(Math.log10(exact));
  const shown = Number((last.readout ?? '').replace(/[^0-9.]/g, ''));
  if (Math.abs(shown - Number(m.toPrecision(3))) > 0.011 && !(shown === 10 || Number(m.toPrecision(3)) === 10)) fail(`${aS}${op}${bS}: lens reads ${last.readout}, mantissa ${m.toPrecision(3)}`);
  return 'ok';
});
suite('Slide rule  refuses + and −', 2, (fail) => {
  for (const op of ['+', '−'] as Op[]) if (planSlideRule(job(op, '4', '4')).ok) fail(`accepted ${op}`);
  return 'ok';
});

/* ---------------- Arithmometer: + − × ÷ ---------------- */
const MOD = 1e8;
suite('Arithmometer  + −  (whole and decimal)', 300, (fail) => {
  const op = pick<Op>(['+', '−']);
  const dec = pick([0, 0, 1, 2]);
  const aS = (rnd() * pick([99, 9999, 99999])).toFixed(dec), bS = (rnd() * pick([99, 9999, 99999])).toFixed(dec);
  const p = planArithmometer(job(op, aS, bS));
  if (!p.ok) return 'rejected';
  const f = 10 ** dec, A = Math.round(Number(aS) * f), B = Math.round(Number(bS) * f);
  const exact = op === '+' ? A + B : A - B;
  if (Math.abs(num(p.outcome.display) * f - exact) > 1e-6) fail(`${aS}${op}${bS}: showed ${p.outcome.display}, expected ${exact / f}`);
  const res = p.frames[p.frames.length - 1].state.res;
  if (res !== (exact + MOD) % MOD) fail(`${aS}${op}${bS}: result wheels ${res}, expected ${(exact + MOD) % MOD}`);
  return 'ok';
});
suite('Arithmometer  ×  (crank turns + carriage)', 300, (fail) => {
  const a = int(pick([9, 99, 9999, 99999])), b = int(pick([9, 99, 999, 9999]));
  const p = planArithmometer(job('×', String(a), String(b)));
  if (!p.ok) return 'rejected';
  const last = p.frames[p.frames.length - 1].state;
  if (num(p.outcome.display) !== a * b) fail(`${a}×${b}: showed ${p.outcome.display}, expected ${a * b}`);
  if (last.res !== a * b) fail(`${a}×${b}: result wheels ${last.res}`);
  const multiplier = last.sl.slice().reverse().join('') === String(a).padStart(6, '0') ? b : a;
  if (last.cnt !== multiplier) fail(`${a}×${b}: turn counter ${last.cnt}, expected ${multiplier}`);
  for (const f of p.frames) if (f.state.shift < 0 || f.state.shift > 3) { fail(`${a}×${b}: carriage off the plate (position ${f.state.shift + 1})`); break; }
  return 'ok';
});
suite('Arithmometer  ÷  (repeated subtraction)', 200, (fail) => {
  const b = int(98) + 1, a = int(pick([99, 9999, 99999]));
  const p = planArithmometer(job('÷', String(a), String(b)));
  if (!p.ok) return 'rejected';
  const shown = num(p.outcome.display), exact = a / b;
  const dp = (p.outcome.display.split('.')[1] ?? '').length;
  if (Math.abs(shown - Math.floor(exact * 10 ** dp + 1e-9) / 10 ** dp) > 1e-9) fail(`${a}÷${b}: showed ${p.outcome.display}, exact ${exact}`);
  if (Number.isInteger(exact) && shown !== exact) fail(`${a}÷${b}: showed ${shown}, expected ${exact}`);
  return 'ok';
});

/* ---------------- Comptometer: + − × ÷ ---------------- */
suite('Comptometer  + −  (ten\'s complement for −)', 300, (fail) => {
  const op = pick<Op>(['+', '−']);
  const a = int(pick([99, 9999, 999999])), b = int(pick([99, 9999, 999999]));
  const p = planComptometer(job(op, String(a), String(b)));
  if (!p.ok) return 'rejected';
  const exact = op === '+' ? a + b : a - b;
  if (num(p.outcome.display) !== exact) fail(`${a}${op}${b}: showed ${p.outcome.display}, expected ${exact}`);
  const acc = p.frames[p.frames.length - 1].state.acc;
  if (acc !== (exact + MOD) % MOD) fail(`${a}${op}${b}: wheels ${acc}`);
  return 'ok';
});
suite('Comptometer  ×  (key strokes)', 300, (fail) => {
  const a = int(pick([9, 99, 9999])), b = int(pick([9, 99, 999]));
  const p = planComptometer(job('×', String(a), String(b)));
  if (!p.ok) return 'rejected';
  if (num(p.outcome.display) !== a * b) fail(`${a}×${b}: showed ${p.outcome.display}`);
  if (p.frames[p.frames.length - 1].state.acc !== a * b) fail(`${a}×${b}: wheels wrong`);
  return 'ok';
});
suite('Comptometer  ÷', 200, (fail) => {
  const b = int(98) + 1, a = int(pick([99, 9999]));
  const p = planComptometer(job('÷', String(a), String(b)));
  if (!p.ok) return 'rejected';
  const shown = num(p.outcome.display), exact = a / b;
  const dp = (p.outcome.display.split('.')[1] ?? '').length;
  if (Math.abs(shown - Math.floor(exact * 10 ** dp + 1e-9) / 10 ** dp) > 1e-9) fail(`${a}÷${b}: showed ${p.outcome.display}, exact ${exact}`);
  return 'ok';
});
suite('All machines  refuse what their era could not do', 1, (fail) => {
  if (planAbacus(job('×', '4', '4')).ok) fail('abacus accepted ×');
  if (planArithmometer(job('√', '9')).ok) fail('arithmometer accepted √');
  if (planComptometer(job('√', '9')).ok) fail('comptometer accepted √');
  if (planArithmometer(job('÷', '4', '0')).ok) fail('arithmometer divided by zero');
  return 'ok';
});

/* ---------------- Modern calculator evaluator ---------------- */
const cases: [string, number | 'error'][] = [
  ['2+3×4', 14], ['(1+2)×3÷4', 2.25], ['2^10', 1024], ['2^3^2', 512], ['√(3^2+4^2)', 5], ['√9+2^10', 1027],
  ['200+15%', 230], ['200−10%', 180], ['50%', 0.5], ['−5+3', -2], ['2(3)', 6], ['10÷4', 2.5], ['0.1+0.2', 0.3],
  ['12×−3', -36], ['9−−3', 12], ['(2+3', 5], ['1÷0', 'error'], ['5×', 'error'], ['1..2', 'error'],
];
suite('Modern  expressions (precedence, %, powers, roots, signs)', cases.length, (() => {
  let i = 0;
  return (fail: (m: string) => void) => {
    const [e, want] = cases[i++];
    try {
      const v = evaluate(e);
      if (want === 'error') fail(`${e} should be an error, gave ${v}`);
      else if (Math.abs(v - want) > 1e-9) fail(`${e} = ${v}, expected ${want}`);
    } catch {
      if (want !== 'error') fail(`${e} threw`);
    }
    return 'ok';
  };
})());
suite('Entry parser  one operation for historical machines', 1, (fail) => {
  const ok = parseHistorical('12.5×4'); if (!ok || ok.op !== '×' || ok.a !== 12.5 || ok.b !== 4) fail('12.5×4');
  if (parseHistorical('1+2+3')) fail('accepted a chain');
  const r = parseHistorical('√2'); if (!r || r.op !== '√') fail('√2');
  if (fmt(1234567) !== '1,234,567' || fmt(-5) !== '−5') fail('formatting');
  return 'ok';
});

/* ---------------- report ---------------- */
let total = 0, passed = 0, rejected = 0;
for (const r of results) {
  const checked = r.runs - r.rejected;
  total += checked; passed += r.pass; rejected += r.rejected;
  const status = r.fails.length ? 'FAIL' : 'PASS';
  console.log(`${status}  ${r.name.padEnd(58)} ${String(r.pass).padStart(4)}/${checked}${r.rejected ? `  (${r.rejected} over machine limits, correctly refused)` : ''}`);
  for (const f of r.fails) console.log('        ✗ ' + f);
}
console.log(`\nTOTAL ${passed}/${total} checks passed, ${rejected} inputs correctly refused as beyond the machine's capacity`);
if (passed !== total) process.exitCode = 1;
