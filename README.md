# Chrono Calculator

An installable Progressive Web App that shows five calculators from five eras. Type an equation, press `=`, and each historical machine animates from its zero state: it sets the first number, performs the operation, and comes to rest on the answer. Only then does the result box light up with the number and a short explanation of the mechanism.

| Mode | Era | Operations | How it computes |
|---|---|---|---|
| Abacus | c. 2700 BCE | `+` `−` (7-digit integers) | Real bead moves with 5-complements and 10-complement carries/borrows |
| Slide Rule | 1622 | `×` `÷` `√` | Moves the hairline and C slide in log space; magnifier lens; 3-sig-fig reading + exact note |
| Arithmometer | 1820 | `+` `−` `×` `÷` | Sliders → lever → crank turns, carriage shifts for multi-digit multipliers, division by repeated subtraction |
| Comptometer | 1887 | `+` `−` `×` `÷` | Key strokes drive levers into accumulator wheels; subtraction via ten's-complement keys |
| Modern Digital | 2000 | everything | Same layout as the input keypad (C, ⌫, brackets, √, %, xʸ, ÷ × − +) in grey/orange; answers instantly |

Locked keys are dimmed per mode; tapping one explains why that era could not do it.

## Features

- **Fixed 16:9 stage** (`aspect-video`) for every mode, so switching never shifts the layout
- **Normal / Slow-mo steps** toggle (2.8× slower with numbered step callouts)
- **Floating callouts** point at the part that is moving
- **Procedural Web Audio** sounds: bead clicks, slide friction, crank ratchets, key snaps, soft taps, a reveal chime (mute toggle in the header)
- **Direct manipulation**: click beads; drag the slide and cursor; drag arithmometer sliders, flip the lever, turn the crank, shift the carriage, clear registers; press comptometer keys and pull the clearing crank
- **Keyboard**: digits, `+ - * /`, `.`, `Enter`, `Backspace`, `Esc`, `r` (√), `^`, `%`, `( )`
- **PWA**: `manifest.json`, maskable icons, and an offline service worker (`public/sw.js`)
- **Matte black** theme throughout; responsive down to phone width

Animations are smooth SVG + CSS transitions driven by a small frame sequencer (`src/lib/useSequencer.ts`), so no animation library is needed.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production build in dist/
npm run preview    # serve dist/ to test install + offline
```

## Publish on Netlify

There are two ways. Pick one.

### Option A: drag and drop (no build needed)

1. Go to https://app.netlify.com/drop (sign in first).
2. Drag the **`dist`** folder from this project onto the page. Drag the `dist` folder itself, **not** the whole project folder and **not** the zip. The whole project folder would publish an unbuilt `index.html` and show a blank page.
3. Netlify gives you a `https://…netlify.app` link. Open it on your phone or desktop and use **Install app** / **Add to Home Screen**.

To update later, open your site in Netlify → **Deploys** → drag a new `dist` folder onto the deploy area.

### Option B: from GitHub (rebuilds on every push)

1. Push this project to a GitHub repository (`node_modules/` and `dist/` are git-ignored).
2. In Netlify: **Add new project → Import an existing project → GitHub**, authorise Netlify, then choose the repo.
3. Netlify reads `netlify.toml` automatically (build command `npm run build`, publish directory `dist`, Node 22). Leave the settings as they are and click **Deploy**.
4. Every later `git push` redeploys the site automatically.

`prebuilt/` holds the last build that was tested end to end. If the Vite build on Netlify ever fails, `netlify.toml` publishes `prebuilt/` instead so the live site keeps working; the deploy log then says "Using prebuilt/".

`public/_headers` sets the caching rules Netlify needs for an installable app: the service worker and `index.html` are never stale, and hashed assets are cached for a year.

## Project layout

```
src/
  App.tsx                 layout, mode bar, input logic, result box
  components/Keypad.tsx   modern keypad with era locks + tooltips
  lib/audio.ts            Web Audio synthesis
  lib/math.ts             parsing, evaluator, formatting
  lib/keys.ts             keypad layout, allowed keys, lock reasons
  lib/useSequencer.ts     frame player shared by all machines
  machines/               Abacus, SlideRule, Arithmometer, Comptometer, ModernCalc
public/
  manifest.json  sw.js  _headers  icons/
netlify.toml              Netlify build settings
```

Each historical machine exports a `plan…(job)` function that turns an equation into a list of machine states (frames) plus the final outcome, and a component that renders the current state as SVG. To change timing, edit the `dur` / `t` values in a plan.
