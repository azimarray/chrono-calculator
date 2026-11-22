/* End-to-end browser test of the built site, used the way a visitor would:
   opening, every machine, era locks, hands-on controls, slow-mo, sound toggle,
   installable/offline app, phone layout, and JavaScript errors.

   Run with:  npm run test:e2e        (builds the site, then tests dist/)
   Or against any running copy:  node tests/e2e.test.mjs https://chrono-calculator.netlify.app/
   First time only:  npx playwright install chromium */
import { chromium } from 'playwright';
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

/* Tiny static server for dist/ (localhost counts as secure, so the service worker runs). */
const DIST = fileURLToPath(new URL('../dist/', import.meta.url));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.mp4': 'video/mp4', '.webmanifest': 'application/manifest+json' };
async function serveDist() {
  const server = http.createServer(async (req, res) => {
    let path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
    if (!path || path.endsWith('/')) path += 'index.html';
    const file = join(DIST, path);
    try {
      if (!(await stat(file)).isFile()) throw new Error();
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(await readFile(file));
    } catch {
      res.writeHead(404); res.end('Not found');
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, url: `http://localhost:${server.address().port}/` };
}

let local = null;
if (!process.argv[2]) {
  try { await stat(join(DIST, 'index.html')); } catch { console.error('dist/ not found: run "npm run build" first (npm run test:e2e does this for you).'); process.exit(1); }
  local = await serveDist();
}
const SITE = process.argv[2] ?? local.url;
const rows = [];
const check = (area, name, ok, detail = '') => rows.push({ area, name, ok: !!ok, detail });
const errors = [];

const b = await chromium.launch({ args: ['--autoplay-policy=user-gesture-required'] });
const ctx = await b.newContext({ viewport: { width: 1280, height: 860 } });
const p = await ctx.newPage();
p.on('pageerror', (e) => errors.push(String(e)));
p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|fonts/.test(m.text())) errors.push(m.text()); });
await p.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());

/* ---------- opening ---------- */
const t0 = Date.now();
await p.goto(SITE);
await p.waitForSelector('h1');
const open = await p.evaluate(() => ({ intro: !!document.querySelector('video, [role="dialog"]'), title: document.querySelector('h1')?.textContent }));
check('Opening', 'opens straight into the app (no intro animation)', !open.intro && open.title === 'Chrono Calculator', `ready in ${((Date.now() - t0) / 1000).toFixed(1)} s`);

/* ---------- helpers ---------- */
const mode = async (name) => { await p.getByRole('button', { name: new RegExp('^' + name) }).click(); await p.waitForTimeout(250); };
const type = async (expr) => { for (const ch of expr) await p.keyboard.press({ '×': 'x', '÷': '/', '−': '-', '√': 'r' }[ch] ?? ch); };
const resultText = () => p.locator('.result-box').innerText();
const run = async (expr, timeout = 60000) => {
  await p.keyboard.press('Escape');
  await type(expr);
  await p.keyboard.press('Enter');
  await p.waitForTimeout(400);
  const during = await resultText();
  await p.waitForFunction(() => /^(Result|Instant result|Not possible)/i.test(document.querySelector('.result-box')?.innerText.trim() ?? ''), null, { timeout });
  const after = await resultText();
  const lines = after.split('\n').map((s) => s.trim()).filter(Boolean);
  return { during, value: lines[1] ?? '', explanation: lines[2] ?? '' };
};
const stageBox = async () => { const r = await p.locator('section.stage').boundingBox(); return `${Math.round(r.width)}×${Math.round(r.height)}`; };

/* ---------- each machine, end to end ---------- */
const plan = [
  ['Abacus', [['4+4', '8'], ['503−47', '456'], ['9−14', '−5']]],
  ['Slide Rule', [['4×4', '≈ 16'], ['√2', '≈ 1.41'], ['7÷3', '≈ 2.33']]],
  ['Arithmometer', [['4×4', '16'], ['23×47', '1,081'], ['100÷8', '12.5'], ['4−9', '−5']]],
  ['Comptometer', [['4×4', '16'], ['56+78', '134'], ['84÷7', '12'], ['9−4', '5']]],
];
const sizes = new Set();
for (const [m, eqs] of plan) {
  await mode(m);
  sizes.add(await stageBox());
  for (const [eq, want] of eqs) {
    const r = await run(eq);
    const hidden = /^Machine at work/i.test(r.during.trim()) && !/^Result/i.test(r.during.trim());
    check(m, `${eq} = ${want}`, r.value === want, `showed ${r.value || '(nothing)'}`);
    check(m, `${eq}: answer hidden while the machine moves`, hidden);
    if (eq === eqs[0][0]) check(m, 'explanation appears with the result', r.explanation.length > 40);
  }
}
await mode('Modern');
sizes.add(await stageBox());
for (const [eq, want] of [['2^10+√9', '1,027'], ['200+15%', '230'], ['(1+2)×3÷4', '2.25'], ['2+3×4', '14']]) {
  await p.keyboard.press('Escape'); await type(eq); await p.keyboard.press('Enter'); await p.waitForTimeout(150);
  const shown = (await p.locator('.ios-readout').innerText()).trim();
  check('Modern', `${eq} = ${want} instantly`, shown === want, `showed ${shown}`);
}
check('Layout', 'stage stays 16:9 and the same size in all 5 modes', sizes.size === 1, [...sizes].join(', '));

/* ---------- era locks ---------- */
for (const [m, key, label] of [['Abacus', 'Multiply', '×'], ['Slide Rule', 'Add', '+'], ['Arithmometer', 'Square root', '√']]) {
  await mode(m);
  await p.getByRole('button', { name: new RegExp(`^${key} \\(locked`) }).click({ force: true });
  await p.waitForTimeout(250);
  const tip = await p.locator('[role="tooltip"]').innerText().catch(() => '');
  check('Locks', `${m}: ${label} is locked and explains why`, tip.length > 30, tip.split('\n').pop()?.slice(0, 60) + '…');
}
await mode('Modern');
const locked = await p.locator('section[aria-label="Input"] button[aria-disabled="true"]').count();
check('Locks', 'Modern: every key unlocked', locked === 0, `${locked} locked`);

/* ---------- direct interaction with the machines ---------- */
const svgClick = async (x, y) => {
  const pt = await p.evaluate(([x, y]) => { const m = document.querySelector('section.stage svg').getScreenCTM(); return [m.a * x + m.e, m.d * y + m.f]; }, [x, y]);
  await p.mouse.click(pt[0], pt[1]); await p.waitForTimeout(350);
  return (await p.locator('.callout-bubble').innerText().catch(() => '')).replace(/\s+/g, ' ');
};
await mode('Abacus'); await p.keyboard.press('Escape'); await p.waitForTimeout(200);
let c = await svgClick(1108, 583);
check('Hands-on', 'Abacus: clicking a bead moves it and reads the board', /Board reads 1\b/.test(c), c);
c = await svgClick(1250, 304);
check('Hands-on', 'Abacus: fraction bead adds 1/24', /1 \+ 1\/24/.test(c), c);
await mode('Comptometer'); await p.keyboard.press('Escape'); await p.waitForTimeout(200);
c = await svgClick(1120 * 0.8923 + 86.15, (142 + 4 * 55) * 0.8923 + 48.25); // the "5" key, units column
check('Hands-on', 'Comptometer: pressing a key turns the wheels', /00000005/.test(c), c);
await mode('Arithmometer'); await p.keyboard.press('Escape'); await p.waitForTimeout(200);
c = await svgClick(1335 * 0.8406 + 127.54, (560 - 84) * 0.8406 + 79.83); // crank handle
check('Hands-on', 'Arithmometer: turning the crank runs a cycle', /Result reads/.test(c), c);

/* ---------- slow motion + sound toggle ---------- */
await p.getByRole('radio', { name: 'Slow-mo steps' }).click();
await mode('Comptometer'); await p.keyboard.press('Escape'); await type('4×2'); await p.keyboard.press('Enter');
await p.waitForTimeout(1500);
const step = await p.locator('.callout-step').innerText().catch(() => '');
check('Controls', 'Slow-mo shows numbered steps', /Step \d+\/\d+/.test(step), step);
await p.getByRole('radio', { name: 'Normal' }).click();
const mute = p.getByRole('button', { name: /Mute sound|Unmute sound/ });
const before = await mute.getAttribute('aria-pressed'); await mute.click(); const afterM = await mute.getAttribute('aria-pressed');
check('Controls', 'Sound on/off toggle works', before !== afterM, `${before} → ${afterM}`);

/* ---------- installable + offline ---------- */
const pwa = await p.evaluate(async () => {
  const man = await (await fetch('/manifest.json')).json();
  const reg = await navigator.serviceWorker.getRegistration();
  return { name: man.name, icons: man.icons.length, sw: !!reg };
});
check('PWA', 'manifest present (name + icons)', pwa.name === 'Chrono Calculator' && pwa.icons >= 3, `${pwa.name}, ${pwa.icons} icons`);
check('PWA', 'service worker registered', pwa.sw);
await p.reload(); await p.waitForTimeout(1500);
await ctx.setOffline(true);
await p.reload(); await p.waitForSelector('h1');
const off = await p.evaluate(() => ({ h1: document.querySelector('h1')?.textContent }));
check('PWA', 'opens offline', off.h1 === 'Chrono Calculator');
await ctx.setOffline(false);

/* ---------- phone ---------- */
const m = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
m.on('pageerror', (e) => errors.push('phone: ' + e));
await m.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
await m.goto(SITE); await m.waitForTimeout(700); await m.keyboard.press('Escape'); await m.waitForTimeout(900);
const overflow = [];
for (const name of ['Abacus', 'Slide Rule', 'Arithmometer', 'Comptometer', 'Modern']) {
  await m.getByRole('button', { name: new RegExp('^' + name) }).click(); await m.waitForTimeout(300);
  const w = await m.evaluate(() => document.documentElement.scrollWidth);
  if (w > 390) overflow.push(`${name} ${w}px`);
}
check('Phone', 'no sideways scrolling in any mode (390 px)', overflow.length === 0, overflow.join(', ') || 'all fit');
const align = await m.evaluate(() => {
  const L = (s) => Math.round(document.querySelector(s).getBoundingClientRect().left), R = (s) => Math.round(document.querySelector(s).getBoundingClientRect().right);
  return [L('h1'), L('nav'), L('section.stage'), R('nav'), R('section.stage')];
});
check('Phone', 'title, tab bar and stage line up', align[0] === align[1] && align[1] === align[2] && align[3] === align[4], `left ${align[0]}/${align[1]}/${align[2]}, right ${align[3]}/${align[4]}`);
await m.getByRole('button', { name: /^Abacus/ }).click();
await m.getByRole('button', { name: '4', exact: true }).tap(); await m.getByRole('button', { name: 'Add', exact: true }).tap(); await m.getByRole('button', { name: '4', exact: true }).tap(); await m.getByRole('button', { name: 'Equals' }).tap();
await m.waitForFunction(() => /^Result/i.test(document.querySelector('.result-box')?.innerText.trim() ?? ''), null, { timeout: 20000 });
check('Phone', 'tapping the keypad works (4 + 4 = 8)', (await m.locator('.result-box').innerText()).includes('\n8'));

check('Quality', 'no JavaScript errors anywhere', errors.length === 0, errors.slice(0, 3).join(' | '));
await b.close();

/* ---------- report ---------- */
let area = '';
for (const r of rows) {
  if (r.area !== area) { area = r.area; console.log(`\n${area}`); }
  console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  — ${r.detail}` : ''}`);
}
const pass = rows.filter((r) => r.ok).length;
console.log(`\nTOTAL ${pass}/${rows.length} browser checks passed`);
if (local) local.server.close();
if (pass !== rows.length) process.exitCode = 1;
