// Foreground behaviour for the HSRG site.
//
//   F1/F8  uniform scroll blur: two CSS custom properties on <html> drive
//          `filter: blur() brightness()` + a compensating `transform: scale()` on #bg.
//   F6     typewriter reveal: every grapheme lives in a hidden <span> (so layout never shifts),
//          units type in document order, one block cursor on screen at most.
//   F7     deterministic hooks: ?fgDone=1, ?fgFreeze=<unit>:<chars>, ?fgSpeed=<mult>,
//          plus window.__hsrgFg for debugging.
//
// Layout:  §1 CONFIG   §2 helpers   §3 unit building   §4 reveal primitives
//          §5 typing loop   §6 scroll blur   §7 entry point

// ─────────────────────────────────────────────────────────────────────────── §1 CONFIG
export const CONFIG = {
  // Typing speed in characters per second, by unit kind (F6).
  SPEED: { H1: 20, H2: 35, H3: 35, BODY: 90 },
  JITTER: 0.35,           // per-character interval varies by ±this fraction (seeded PRNG, deterministic)
  UNIT_PAUSE_MS: 120,     // gap between the end of one unit and the start of the next
  INSTANT_FADE_MS: 150,   // table / hr / embeds: opacity fade instead of typing
  START_MARGIN: 0.08,     // a unit starts once its top edge is above (1 − this) × viewport height

  // Scroll blur (F8). BLUR_MAX_PX / BRIGHT_MIN are only fallbacks: the live values are read from
  // the CSS variables --bg-blur-max / --bg-bright-min so they stay tunable in the stylesheet.
  BLUR_START: 0.15,       // fraction of viewport height — no blur at or below this scrollY
  BLUR_END: 0.75,         // fraction of viewport height — full blur at or above this scrollY
  BLUR_MAX_PX: 10,
  BRIGHT_MIN: 0.7,
  // A CSS blur fades over roughly 3σ, so an unscaled canvas would show a dark rim. The canvas is
  // scaled up until it overhangs the viewport by this many σ on every side (F8's `1 + 0.03·k`
  // is not enough at blur 10 px; see the revision note in docs/foreground-spec.md).
  BLUR_EDGE_SIGMAS: 3,

  // Which children of .content are units, in document order. <ul> contributes its <li> items.
  UNIT_SELECTOR: ':scope > h1, :scope > h2, :scope > h3, :scope > p, :scope > .callout,'
    + ' :scope > ul > li, :scope > .table-wrap, :scope > hr, :scope > .embeds',
  // Units that are revealed whole instead of typed (F6, last bullet).
  INSTANT_SELECTOR: '.table-wrap, hr, .embeds',
};

// ─────────────────────────────────────────────────────────────────────────── §2 helpers
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a || 1), 0, 1); return t * t * (3 - 2 * t); };

/** Deterministic PRNG (mulberry32): the per-character jitter must be identical on every load. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Headless-only error banner, same element and look as the one js/main.js installs first. */
function installBanner(headless) {
  return (message) => {
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
}

// Grapheme clusters, so "🦾" and "📢" are one character each and never split mid-surrogate.
const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter
  ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
const graphemes = (s) => (segmenter ? Array.from(segmenter.segment(s), (g) => g.segment) : Array.from(s));

// ─────────────────────────────────────────────────────────────────── §3 unit building
/**
 * Wrap every grapheme of every text node inside `el` in a <span class="fg-ch">.
 * The spans are hidden by CSS, so the full text keeps reserving its space (no layout shift) and
 * inline children (<a>, <em>, <strong>, <mark>, the 📢 icon) keep their styling because the
 * spans go *inside* them. Whitespace-only text nodes (the newlines/indentation between inline
 * elements) are left untouched: wrapping them would change nothing visually but would add
 * characters that must be "typed", and skipping them keeps whitespace collapsing intact.
 */
function wrapGraphemes(el) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n);
  const chars = [];
  for (const node of nodes) {
    if (!/\S/.test(node.data)) continue;
    const frag = document.createDocumentFragment();
    for (const g of graphemes(node.data)) {
      const span = document.createElement('span');
      span.className = 'fg-ch';
      span.textContent = g;
      frag.appendChild(span);
      chars.push(span);
    }
    node.parentNode.replaceChild(frag, node);
  }
  return chars;
}

function charsPerSecond(el) {
  const tag = el.tagName;
  if (tag === 'H1') return CONFIG.SPEED.H1;
  if (tag === 'H2') return CONFIG.SPEED.H2;
  if (tag === 'H3') return CONFIG.SPEED.H3;
  return CONFIG.SPEED.BODY;
}

function buildUnits(root) {
  const els = Array.from(root.querySelectorAll(CONFIG.UNIT_SELECTOR));
  return els.map((el, index) => {
    const instant = el.matches(CONFIG.INSTANT_SELECTOR);
    if (instant) {
      el.classList.add('fg-instant');
      return { index, el, kind: 'instant', chars: [], revealed: 0, times: null, done: false };
    }
    el.classList.add('fg-unit');
    const chars = wrapGraphemes(el);
    return { index, el, kind: 'text', chars, revealed: 0, times: null, done: false };
  });
}

/** Cumulative reveal times (ms from the unit's start) for every character. */
function buildTimes(unit, speedMul) {
  const step = 1000 / (charsPerSecond(unit.el) * speedMul);
  const rnd = mulberry32(0x9e3779b9 ^ Math.imul(unit.index + 1, 2654435761));
  const times = new Float64Array(unit.chars.length);
  let acc = 0;
  for (let i = 0; i < times.length; i++) {
    acc += step * (1 + (rnd() * 2 - 1) * CONFIG.JITTER);
    times[i] = acc;
  }
  return times;
}

// ─────────────────────────────────────────────────────────── §4 reveal primitives
export function startForeground(opts = {}) {
  const show = installBanner(!!opts.headless);
  const root = opts.root || document.querySelector('#fg .content');
  if (!root) { show('[foreground] no .content root'); return null; }

  const reduced = typeof matchMedia === 'function'
    && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const speedMul = Number.isFinite(opts.fgSpeed) && opts.fgSpeed > 0 ? opts.fgSpeed : 1;

  const units = buildUnits(root);
  const cursor = document.createElement('span');
  cursor.className = 'fg-cursor';
  cursor.setAttribute('aria-hidden', 'true');

  const removeCursor = () => { if (cursor.parentNode) cursor.parentNode.removeChild(cursor); };

  /** The block cursor sits on the next hidden character, so it needs no width of its own. */
  function placeCursor(unit) {
    // A cursor means this unit has started, even at zero characters: `fg-typing` lets its <li>
    // marker paint now instead of leaking the list's shape from first paint (see css/style.css).
    unit.el.classList.add('fg-typing');
    const next = unit.chars[unit.revealed];
    if (!next) { removeCursor(); return; }
    if (next.previousSibling !== cursor) next.parentNode.insertBefore(cursor, next);
  }

  function setRevealed(unit, n) {
    n = clamp(n, 0, unit.chars.length);
    // `opacity`, not `visibility`: an unrevealed character must stay in the accessibility tree.
    for (let i = unit.revealed; i < n; i++) unit.chars[i].style.opacity = '1';
    for (let i = n; i < unit.revealed; i++) unit.chars[i].style.opacity = '';
    unit.revealed = n;
    if (n > 0) unit.el.classList.add('fg-typing');
  }

  function completeUnit(unit) {
    if (unit.kind === 'instant') unit.el.classList.add('fg-shown');
    else { unit.el.classList.add('fg-done'); unit.revealed = unit.chars.length; }
    unit.done = true;
  }

  function resetUnit(unit) {
    unit.done = false;
    if (unit.kind === 'instant') { unit.el.classList.remove('fg-shown'); return; }
    unit.el.classList.remove('fg-done', 'fg-typing');
    for (let i = 0; i < unit.revealed; i++) unit.chars[i].style.opacity = '';
    unit.revealed = 0;
  }

  // ───────────────────────────────────────────────────────────── §5 typing loop
  let mode = 'live';      // 'live' | 'done' | 'frozen'
  let index = 0;          // the unit currently typing or waiting to start
  let startAt = null;     // performance.now() timestamp at which units[index] starts typing
  let raf = 0;
  let blocked = false;    // the queue's next unit is below the reveal line: idle until something moves

  const stopLoop = () => { if (raf) { cancelAnimationFrame(raf); raf = 0; } };
  const runLoop = () => { if (!raf && mode === 'live' && !blocked) raf = requestAnimationFrame(step); };
  /** Re-arm the idle loop when the layout may have changed (scroll, resize, reflow). */
  const kickLoop = () => { if (blocked) { blocked = false; runLoop(); } };

  function step(now) {
    raf = 0;
    try { advance(now); } catch (err) { mode = 'done'; show(`[foreground] ${err && err.stack ? err.stack : err}`); return; }
    if (mode === 'live') runLoop();
  }

  /**
   * Queue policy (F6): strictly document order, one unit at a time. A unit the reader has already
   * scrolled past when its turn comes completes instantly, so nothing above the fold is ever left
   * blank or half-typed; a unit whose top edge has not reached the viewport blocks the queue until
   * the reader scrolls down to it. "Scrolled past" is `rect.top < 0` rather than the spec's
   * `rect.bottom <= 0`: a unit that starts above the viewport top would otherwise be typed
   * off-screen, which is the very thing the rule exists to prevent.
   */
  function advance(now) {
    const vh = window.innerHeight;
    for (let guard = 0; guard <= units.length; guard++) {
      if (index >= units.length) { removeCursor(); mode = 'done'; return; }
      const unit = units[index];
      const rect = unit.el.getBoundingClientRect();
      const past = rect.top < 0;
      if (!past && rect.top >= vh * (1 - CONFIG.START_MARGIN)) {
        // Blocked: this unit's turn has come but it is still below the reveal line. Nothing on
        // screen changes until the reader scrolls, so the loop goes idle here rather than reading
        // `getBoundingClientRect()` 60 times a second for as long as the reader pauses. Drop the
        // pending epoch — it is the *previous* unit's finish time plus the inter-unit pause, and
        // keeping it would make `elapsed` below measure the reader's scrolling time, snapping the
        // unit to fully typed on its first unblocked frame. The normal (already visible) path
        // never reaches here, so the ~120 ms inter-unit pause is unaffected.
        startAt = null;
        blocked = true;   // stop the rAF loop: `kickLoop` restarts it on the next scroll/reflow
        removeCursor();
        // If the reader scrolled back up in the one frame between this unit's cursor appearing and
        // its first character, take the "started" flag back so an <li> bullet cannot sit alone.
        if (unit.revealed === 0) unit.el.classList.remove('fg-typing');
        return;
      }

      if (unit.kind === 'instant' || past || reduced) {
        completeUnit(unit);
        index++;
        startAt = now + CONFIG.UNIT_PAUSE_MS;
        continue;
      }
      if (startAt === null) startAt = now;
      if (now < startAt) { removeCursor(); return; }        // inter-unit pause
      if (!unit.times) unit.times = buildTimes(unit, speedMul);

      const elapsed = now - startAt;
      let n = unit.revealed;
      while (n < unit.times.length && unit.times[n] <= elapsed) n++;
      setRevealed(unit, n);
      if (n >= unit.chars.length) {
        completeUnit(unit);
        index++;
        startAt = now + CONFIG.UNIT_PAUSE_MS;
        continue;
      }
      placeCursor(unit);   // solid block, on the next character; removed when the unit finishes
      return;
    }
  }

  // ───────────────────────────────────────────────────── §5b deterministic hooks (F7)
  function completeAll() {
    mode = 'done';
    stopLoop();
    removeCursor();
    for (const unit of units) { resetUnit(unit); completeUnit(unit); }
    index = units.length;
  }

  function freeze(i, n) {
    // Reduced motion outranks the test hook: no mid-typing frame, no cursor (F6, last bullet).
    if (reduced) { completeAll(); return; }
    mode = 'frozen';
    stopLoop();
    removeCursor();
    i = clamp(i | 0, 0, units.length);
    for (const unit of units) {
      resetUnit(unit);
      if (unit.index < i) completeUnit(unit);
      else if (unit.index === i) {
        if (unit.kind === 'instant') { if (n > 0) completeUnit(unit); }
        else { setRevealed(unit, n); placeCursor(unit); }
      }
    }
    index = i;
  }

  const state = () => ({
    mode,
    index,
    units: units.map((u) => ({ tag: u.el.tagName, kind: u.kind, chars: u.chars.length, revealed: u.revealed, done: u.done })),
  });

  // ────────────────────────────────────────────────────────── §6 scroll blur (F1/F8)
  const docEl = document.documentElement;
  let blurQueued = false;
  let tunablesDirty = false;
  let tunables = { maxPx: CONFIG.BLUR_MAX_PX, brightMin: CONFIG.BRIGHT_MIN };

  function readTunables() {
    const cs = getComputedStyle(docEl);
    const px = parseFloat(cs.getPropertyValue('--bg-blur-max'));
    const br = parseFloat(cs.getPropertyValue('--bg-bright-min'));
    tunables = {
      maxPx: Number.isFinite(px) ? px : CONFIG.BLUR_MAX_PX,
      brightMin: Number.isFinite(br) ? br : CONFIG.BRIGHT_MIN,
    };
  }

  function applyBlur() {
    const vh = window.innerHeight || 1;
    const k = smoothstep(CONFIG.BLUR_START * vh, CONFIG.BLUR_END * vh, window.scrollY || window.pageYOffset || 0);
    const blur = k * tunables.maxPx;
    // Overhang so the blur's own fade-out at the canvas edges never reaches the viewport border.
    const over = CONFIG.BLUR_EDGE_SIGMAS * blur;
    const scale = 1 + (2 * over) / Math.max(1, Math.min(window.innerWidth || 1, vh));
    docEl.style.setProperty('--bg-blur', `${blur.toFixed(3)}px`);
    docEl.style.setProperty('--bg-bright', (1 - k * (1 - tunables.brightMin)).toFixed(4));
    docEl.style.setProperty('--bg-scale', scale.toFixed(5));
  }

  function queueBlur() {
    if (blurQueued) return;
    blurQueued = true;
    requestAnimationFrame(() => {
      blurQueued = false;
      if (tunablesDirty) { tunablesDirty = false; readTunables(); }
      applyBlur();
    });
  }

  readTunables();
  applyBlur();
  // Scrolling drives both the blur and the typing queue: `kickLoop` is what wakes an idle engine.
  window.addEventListener('scroll', () => { queueBlur(); kickLoop(); }, { passive: true });
  // Resize can fire many times per frame; both the re-read and the recompute run once, in the rAF.
  window.addEventListener('resize', () => { tunablesDirty = true; queueBlur(); kickLoop(); }, { passive: true });
  // A reflow can lift the next unit above the reveal line without any scroll event (the webfont
  // swap, an iframe settling, a wrapped line changing height), so watch the column itself too.
  if (typeof ResizeObserver === 'function') {
    const ro = new ResizeObserver(() => kickLoop());
    ro.observe(root);
  }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(kickLoop, () => {});

  // ───────────────────────────────────────────────────────────── §7 entry point
  const api = { units, completeAll, freeze, state, config: CONFIG };
  window.__hsrgFg = api;

  const m = typeof opts.fgFreeze === 'string' ? /^(\d+)\s*:\s*(\d+)$/.exec(opts.fgFreeze) : null;
  if (m) freeze(parseInt(m[1], 10), parseInt(m[2], 10));
  else if (opts.fgDone || reduced) completeAll();
  else runLoop();

  return api;
}
