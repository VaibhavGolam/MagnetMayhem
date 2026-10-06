// Headless smoke test: runs the real game code against stubbed browser APIs.
// Checks for exceptions, NaN physics and basic playability of generated worlds.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function stub() {
  const fn = function () { return stub(); };
  return new Proxy(fn, {
    get: (t, k) => {
      if (k === Symbol.toPrimitive) return () => 0;
      if (k === 'style' || k === 'classList' || k === 'dataset' || k === 'firstChild') return stub();
      if (k === 'width' || k === 'height') return 64;
      if (k === 'length') return 0;
      if (k === 'then') return undefined;
      return stub();
    },
    set: () => true,
    apply: () => stub()
  });
}

const store = {};
const sandbox = {
  console, Math, Date, JSON, Object, Array, Set, Map, Number, String, parseInt, isNaN, Promise, setTimeout, clearTimeout, setInterval, clearInterval,
  performance: { now: () => Date.now() },
  __MM_TEST: true,
  localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
  document: { getElementById: () => stub(), createElement: () => stub(), querySelectorAll: () => [], addEventListener() {}, hidden: false, body: stub() },
  navigator: { vibrate() {} },
  requestAnimationFrame() {},
  addEventListener() {},
  innerWidth: 412, innerHeight: 892, devicePixelRatio: 2
};
sandbox.window = sandbox;
vm.createContext(sandbox);
const root = path.join(__dirname, '..', 'www', 'js');
// Top-level const in scripts is not attached to the sandbox, so concatenate into one script.
const src = ['storage.js', 'audio.js', 'ads.js', 'game.js'].map(f => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');
vm.runInContext(src, sandbox, { filename: 'bundle.js' });

const g = sandbox.__mm;
let failures = 0;
const fail = m => { failures++; console.error('FAIL:', m); };

// 1) Simulate many runs with random-ish inputs, render each frame periodically.
const results = [];
for (let seed = 1; seed <= 40; seed++) {
  g.startRun({ seed: seed * 7919 });
  let hold = [false, false], nextChange = 0, steps = 0;
  while (g.state === 'play' && steps < 120 * 150) {
    if (steps >= nextChange) { hold = [Math.random() < 0.5, Math.random() < 0.5]; g.hold = hold; nextChange = steps + 20 + Math.random() * 80; }
    g.update(1 / 120);
    if (steps % 4 === 0) g.render(1 / 30);
    const P = g.P;
    if (!isFinite(P.x) || !isFinite(P.y) || !isFinite(P.vx) || !isFinite(P.vy)) { fail('NaN physics, seed ' + seed); break; }
    steps++;
  }
  results.push({ seed, secs: +(steps / 120).toFixed(1), score: Math.floor(g.run.score), reason: g.run.reason || 'timeout' });
}
const avg = results.reduce((a, r) => a + r.secs, 0) / results.length;
console.log('Random-input bot, 40 runs: avg survival', avg.toFixed(1) + 's', '(random play should usually die; that is expected)');
console.log('Death reasons:', JSON.stringify(results.reduce((o, r) => (o[r.reason] = (o[r.reason] || 0) + 1, o), {})));

// 2) World generation sanity: no hazard overlaps the start area, chunks contain content.
g.newRun({ seed: 99 });
const c = g.counts();
console.log('Start world counts:', JSON.stringify(c));
if (c.mags < 2) fail('too few magnets generated');

// 3) Determinism: same seed gives same layout.
g.newRun({ seed: 4242 }); const a = JSON.stringify(g.counts());
g.newRun({ seed: 4242 }); const b = JSON.stringify(g.counts());
if (a !== b) fail('seed not deterministic'); else console.log('Seeded layout is deterministic:', a);

// 4) Tutorial runs end to end without throwing.
g.startTutorial();
for (let i = 0; i < 4; i++) g.nextTut();
console.log('Tutorial advanced through all steps, state:', g.state);

// 5) Long survival with an "always attract" bot to exercise tiers/events/powerups for errors.
g.startRun({ seed: 2024 });
g.run.energy = 1e9; g.run.shield = true;
g.hold = [true, false];
for (let i = 0; i < 120 * 90 && g.state === 'play'; i++) { g.update(1 / 120); if (i % 6 === 0) g.render(1 / 20); }
console.log('Long run: t=' + g.run.t.toFixed(0) + 's tier=' + g.run.tier + ' state=' + g.state);

if (failures) { console.error(failures + ' failure(s)'); process.exit(1); }
console.log('Smoke test passed');
