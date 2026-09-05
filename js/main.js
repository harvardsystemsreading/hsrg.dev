// Entry point. Boots the background animation and the foreground (typewriter + scroll blur).
const params = new URLSearchParams(location.search);
const headless = params.get('headless') === '1';
const opts = {
  canvas: document.getElementById('bg'),
  // Deterministic-time controls used by tools/screenshot.sh for visual verification.
  headless,
  seekSeconds: params.has('t') ? parseFloat(params.get('t')) : null,
  paused: params.get('pause') === '1',
};
// ?scroll=<px>: restore immediately, then again once the webfonts have swapped in. JetBrains Mono
// and the fallback monospace stack do not share metrics, so the swap reflows the document *after*
// this line has run and the browser does not reliably re-anchor the scroll position — a real race
// (observed as an intermittent ~27 px offset between otherwise identical headless captures). Any
// genuine user input cancels the re-anchor, so this can never fight a real reader.
if (params.has('scroll')) {
  const scrollTo = parseFloat(params.get('scroll')) || 0;
  let anchored = true;
  const reanchor = () => { if (anchored) window.scrollTo(0, scrollTo); };
  const release = () => { anchored = false; };
  for (const ev of ['wheel', 'touchstart', 'keydown', 'pointerdown']) {
    window.addEventListener(ev, release, { once: true, passive: true });
  }
  reanchor();
  // Hold the anchor until BOTH the load event and the font loads have settled (either can be last),
  // then let go so nothing keeps grabbing the scroll position afterwards.
  const settle = () => { reanchor(); requestAnimationFrame(() => { reanchor(); release(); }); };
  const fontsReady = document.fonts && document.fonts.ready
    ? document.fonts.ready.then(() => {}, () => {}) : Promise.resolve();
  if (document.readyState === 'complete') fontsReady.then(settle);
  else window.addEventListener('load', () => fontsReady.then(settle), { once: true });
}

// Headless: a minimal on-page banner installed BEFORE the module graph loads, so a failing import
// (three.module.js, background.js: 404, syntax error) shows up in screenshots. background.js installs
// the full banner once it is running; these listeners are removed then so nothing is reported twice.
const preBanner = (message) => {
  console.error(message);
  if (!headless) return;
  let el = document.getElementById('bg-error');
  if (!el) {
    el = document.createElement('div');
    el.id = 'bg-error';
    el.style.cssText = 'position:fixed;top:0;left:0;z-index:9999;background:#000;color:#f33;'
      + 'font:14px/1.3 monospace;padding:8px;white-space:pre-wrap;max-width:100vw;box-sizing:border-box;';
    (document.body || document.documentElement).appendChild(el);
  }
  const line = document.createElement('div');
  line.textContent = String(message);
  el.appendChild(line);
};
const onError = (e) => preBanner(`[error] ${e.message} (${e.filename}:${e.lineno})`);
const onRejection = (e) => preBanner(`[unhandledrejection] ${e.reason && e.reason.stack ? e.reason.stack : e.reason}`);
window.addEventListener('error', onError);
window.addEventListener('unhandledrejection', onRejection);

// Foreground: typewriter reveal + scroll blur. Imported dynamically (after the banner above is
// installed, so a failure is visible in headless screenshots) and independently of the background,
// which must never gate the text on WebGL being available.
const fgOpts = {
  root: document.querySelector('#fg .content'),
  headless,
  fgDone: params.get('fgDone') === '1',
  fgFreeze: params.get('fgFreeze'),           // '<unitIndex>:<chars>'
  fgSpeed: params.has('fgSpeed') ? parseFloat(params.get('fgSpeed')) : 1,
};
import('./foreground.js')
  .then((mod) => mod.startForeground(fgOpts))
  .catch((err) => preBanner(`[import] ./foreground.js: ${err && err.stack ? err.stack : err}`));

// ?importFail=1 (headless only): self-test of the pre-import banner.
const entry = headless && params.get('importFail') === '1' ? './does-not-exist.js' : './background.js';
import(entry)
  .then((mod) => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
    mod.startBackground(opts);
  })
  .catch((err) => preBanner(`[import] ${entry}: ${err && err.stack ? err.stack : err}`));
