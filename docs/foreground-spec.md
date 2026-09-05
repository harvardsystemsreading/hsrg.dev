# HSRG foreground — implementation spec (pass 1)

The background (`js/background.js`) is finished and must not change. This pass restyles the
scrolling foreground (`<main id="fg">` in `index.html`) and adds two behaviours: a scroll-driven
uniform blur of the background, and a typewriter reveal of the text.

## Requirements (the user's words, paraphrased faithfully; every item mandatory)

F1. **Uniform scroll blur.** As the user scrolls down, the background canvas becomes blurred
    *uniformly across the whole screen*, not just under the centered content column. The
    current `.content` panel (`background: var(--panel)` + `backdrop-filter: blur(2px)`) must go.
    Scrolling back to the top un-blurs. The blur must not affect the top-of-page hero view
    (scrollY = 0 shows the crisp animation).
F2. **Monospace coding font** for all foreground text, keeping the same centering and column
    (max-width 860 px, centered, same paddings). Use the bundled JetBrains Mono
    (`assets/fonts/JetBrainsMono-Variable.ttf`, weight axis 100–800) via `@font-face` with a
    real fallback stack (`ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace`).
    The `<h1>` may keep Anton (it is the wordmark face) — decision: **h1 stays Anton**, everything
    else JetBrains Mono.
F3. **Table without table lines.** No cell borders, no header background, no outer border.
    Columns stay aligned (it is still a `<table>`); only the text shows.
F4. **Lime-green text, shade by original brightness.** Base body text is lime green; text that
    was muted/gray on the old site is a dimmer green; text that was highlighted (the `<mark>`
    around "Saturday 2-4 pm", the two 📢 callouts that sat on a gray box, the table header
    that sat on a gray band) loses its background/box entirely and instead uses its own green
    shade. No backgrounds, borders or highlight boxes remain anywhere in the text (the callouts
    become plain paragraphs with the 📢 icon; `<hr>` may stay as a thin green rule).
    Palette (CSS variables in `:root`; tune freely but keep the ordering of brightness):
      --g-heading  #d6ff7a   (h2, h3, table header)
      --g-base     #a8ff5c   (body, list items, table cells, links)
      --g-mark     #eaff9c   (formerly highlighted: the meeting time)
      --g-callout  #8ef05a   (formerly boxed callouts)
      --g-muted    #6fbf45   (formerly gray/italic "inspired by…" line and any gray text)
      --g-rule     rgba(168,255,92,0.35) (hr and any thin rules)
    Links: same shade as their surrounding text, underlined (`text-decoration-color` slightly
    dimmer), brighter on hover. The `<h1>` wordmark: `--g-heading`.
F5. **The 2x2 embeds stay as they are** (same grid, same iframes). Their border may become the
    green rule colour; otherwise leave them.
F6. **Typewriter reveal on scroll.** As the user scrolls down, text appears as if typed live,
    character by character, with a visible cursor that disappears when the end of that text
    unit is reached. Details:
    - A *unit* is one block of text: h1, each p, each h2/h3, each li, each callout paragraph.
      Units type strictly in document order, one at a time (one cursor on screen at most).
    - A unit starts typing when (a) every unit before it has finished and (b) its top edge is
      within the viewport (use IntersectionObserver with a small bottom margin, or a
      scroll-driven check). Units that are entirely *above* the viewport (the user scrolled
      past them, or the page loaded already scrolled) complete instantly, in order, so nothing
      above the fold is ever left blank or half-typed. Units below the viewport stay invisible
      until their turn.
    - No layout shift: the full text stays in the DOM for layout. Implement by wrapping every
      grapheme (use `Intl.Segmenter` when available, else code points) in a `<span>` that is
      `visibility:hidden` until revealed. Inline children (`<a>`, `<em>`, `<strong>`, `<mark>`,
      the 📢 icon span) keep working because the spans go inside them. Keep whitespace
      collapsing sane (only wrap text nodes; do not wrap leading/trailing pure-whitespace nodes).
    - Cursor: a block the width of one character and the height of the line, in the unit's
      text colour, placed inline after the last revealed character; solid while typing, and
      removed the moment the unit's last character is revealed. Reduced motion
      (`prefers-reduced-motion: reduce`): reveal everything instantly, no cursor.
    - Speed (all in a CONFIG block at the top of `js/foreground.js`): body/list/callout
      ~90 chars/s, h2/h3 ~35 chars/s, h1 ~20 chars/s, with a small deterministic per-character
      jitter (seeded PRNG, not `Math.random`) and a ~120 ms pause between units. Typing is
      driven by `requestAnimationFrame` and elapsed time (chars revealed = f(elapsed)), never by
      one `setTimeout` per character.
    - **Table: no typing.** The table (and the `<hr>` and the 2x2 embeds) are "instant" units:
      when their turn in the queue comes they simply become visible (a 150 ms opacity fade is
      fine). Before their turn they are `visibility:hidden` (space reserved).
F7. **Deterministic test hooks** (needed so screenshots can verify F6):
    - `?fgDone=1` — everything revealed instantly, no cursor.
    - `?fgFreeze=<unitIndex>:<chars>` — units before `unitIndex` complete, unit `unitIndex`
      shows exactly `chars` revealed characters followed by the cursor, later units hidden;
      no timers run. Unit indices are in document order starting at 0 (h1 = 0).
    - `?fgSpeed=<multiplier>` — scales all typing speeds (for live captures).
    - `window.__hsrgFg = { units: [...], completeAll(), freeze(i, n), state() }` for debugging.
    - `js/main.js` already parses `?scroll=<px>` and scrolls at load; combine with the above.
F8. **Scroll blur mechanics.** Apply the blur to the canvas itself with CSS
    `filter: blur(var(--bg-blur)) brightness(var(--bg-bright))` on `#bg`, driven by two CSS
    custom properties that `js/foreground.js` updates from `scrollY` inside a rAF-throttled
    scroll handler (and once at load, and on resize). Ramp: 0 at `scrollY <= 0.15·vh`, full at
    `scrollY >= 0.75·vh`, smoothstep between. Full values: `--bg-blur-max: 10px`,
    `--bg-bright-min: 0.7` (a mild dim for legibility of green text over the blurred white
    grid; both are CSS variables so they can be tuned to taste, including 1.0 = no dim).
    Because a blurred layer fades at its edges, scale the canvas slightly while blurred
    (`transform: scale(1 + 0.03·k)` where k is the 0–1 ramp) so no dark border appears.
    The background's own render loop and `?t=&pause=1` contract must keep working.
F9. **No regressions:** `index.html` content text stays byte-for-byte the same (you may add
    classes/attributes/wrappers; you may not change any visible characters). The background
    module and its files are untouched. No network fetches at runtime beyond repo files and
    the existing Google Drive iframes. No console errors. Works on a 390 px wide viewport
    (the table may scroll horizontally inside its own container rather than widening the page).
F10. **Headless error banner**: `js/main.js` already installs a pre-import banner; keep
    foreground failures visible the same way (import foreground.js the same dynamic way, or
    statically inside main.js after the banner is installed).

## Files

- `css/style.css` — rewrite for F1–F5 (keep the `#bg` and `#fg` layering rules and the
  `height: 100lvh` line; keep the Anton `@font-face`).
- `js/foreground.js` — new: `export function startForeground(opts)` with `{ root, headless,
  fgDone, fgFreeze, fgSpeed }`; implements F6–F8.
- `js/main.js` — parse the new params and start the foreground after the background import
  resolves (or independently; the foreground must not wait on WebGL).
- `index.html` — class/attribute additions only.
- `docs/foreground-spec.md` — this file; append a revision note describing any deviation.

## Verification checklist (tools/screenshot.sh; widths < 500 px and scrollY > 0 go through the
iframe harness automatically; budget 6000–8000 ms; always pass `t=<sec>&pause=1` so the
background is deterministic)

| Check | Command (S = tools/screenshot.sh, O = your shot dir) | Must show |
|---|---|---|
| F1 off at top | `S O/top.png "t=35&pause=1&fgDone=1" 7000 1280x800 0` | crisp funnel + crisp logo, no foreground text (hero) |
| F1 on when scrolled | `S O/s900.png "t=35&pause=1&fgDone=1" 7000 1280x800 900` | whole background uniformly blurred edge to edge; no sharp region anywhere; no dark border at the edges |
| F1 partial | `S O/s300.png "t=35&pause=1&fgDone=1" 7000 1280x800 300` | intermediate blur (visibly less than at 900) |
| F2/F4 | `s900.png` | monospace text, lime shades, h1 in Anton; no white text anywhere |
| F3 | `S O/s1500.png "t=35&pause=1&fgDone=1" 7000 1280x800 1500` | table text aligned in columns, no lines/backgrounds |
| F6 mid-typing | `S O/type.png "t=35&pause=1&fgFreeze=3:18" 7000 1280x800 900` | units 0–2 fully shown, unit 3 shows 18 characters then a block cursor, everything after hidden (space reserved, no layout shift vs `s900.png`) |
| F6 end of unit | `S O/typeend.png "t=35&pause=1&fgFreeze=4:0" 7000 1280x800 900` | units 0–3 fully shown with **no cursor**, unit 4 shows only the cursor |
| F6 live | `S O/live.png "t=35&pause=1&fgSpeed=0.2" 3000 1280x800 900` | some units typed, one cursor visible (timing not exact under software rendering; just confirm the mechanism runs) |
| F9 portrait | `S O/p.png "t=35&pause=1&fgDone=1" 7000 390x844 900` | text fits the width, table scrolls inside its container, no horizontal page scroll |
| F9 text intact | `diff <(sed 's/<[^>]*>//g' /tmp/claude-1000/-home-tbooy-HSRGWebsite/079e1f45-e3c4-421c-a877-b73611b6861c/scratchpad/index.html.orig) <(sed 's/<[^>]*>//g' index.html)` | no visible-text differences (keep a copy of the original first) |

---

## Revision (implementation, 2026-09-05)

`js/foreground.js`, `css/style.css`, `js/main.js` and `index.html` now implement F1–F10. Where the
code and this document disagree, the code is authoritative. Deviations and decisions:

1. **Blur edge compensation (F8).** `transform: scale(1 + 0.03·k)` is not enough: a CSS `blur(σ)`
   fades over roughly 3σ, so at `--bg-blur-max: 10px` the canvas needs ≥ 30 CSS px of overhang on
   every side. The implementation scales by `1 + 2·BLUR_EDGE_SIGMAS·blur / min(vw, vh)`
   (`BLUR_EDGE_SIGMAS = 3`; ≈ 1.075 at 1280×800 with full blur, ≈ 1.15 at 390 px wide). Measured
   A/B on the `scrollY = 900` frame: with `transform: none` the mean luminance of the
   background-only strip falls from 10.6 at row 779 to 5.7 at row 799 (a dark rim); with the scale
   it rises monotonically to 15.0 at row 799 (no rim).
2. **Blur tunables live in CSS.** `--bg-blur-max` and `--bg-bright-min` are read from `:root` with
   `getComputedStyle` at start-up and on resize; the constants in `CONFIG` are only fallbacks. The
   three live values `--bg-blur`, `--bg-bright`, `--bg-scale` are written on `<html>`.
3. **"Scrolled past" is `rect.top < 0`, not `rect.bottom <= 0`.** A unit whose top edge is above the
   viewport when its turn comes completes instantly. Typing a unit whose first line is off-screen is
   exactly the "blank or half-typed above the fold" case the rule exists to prevent, and the spec's
   literal test leaves a unit hanging one pixel below the top edge half-typed.
4. **Cursor implementation.** The cursor is an *empty* inline `<span class="fg-cursor">` inserted
   before the next still-hidden character; its absolutely positioned `::before` paints a `1ch`
   block of `currentColor` over that character. Being empty and zero-width it adds no advance width
   (so a frozen mid-typing frame has byte-identical layout to the finished frame — verified: the
   green text bands of `s900.png`, `type.png` and `typeend.png` start at the same rows 27/64/104)
   and, unlike an `inline-block`, it creates no line-break opportunity mid-word. It is removed the
   moment a unit's last character is revealed, and by `?fgDone=1` / reduced motion.
5. **`?fgSpeed=<m>` multiplies characters per second**, so `0.2` types 5× slower (that is what makes
   the `live.png` capture land mid-unit).
6. **`index.html`.** The only change is a wrapper: `<div class="table-wrap">` around `<table>`
   (kept on the same source lines so the visible-text diff stays empty). It is the F9 horizontal
   scroll container; the table carries `min-width: 620px` so narrow screens scroll it instead of
   squashing the columns.
7. **Long-word wrapping.** `overflow-wrap: break-word` on the text blocks, so the WhatsApp invite
   URL wraps at 390 px. Verified `documentElement.scrollWidth === clientWidth` at 390 and 1280.
8. **Whitespace-only text nodes are never wrapped** (not just leading/trailing ones): they carry no
   visible characters, and leaving them alone keeps whitespace collapsing between inline elements
   exactly as it was.
9. **Units.** `#fg .content`'s children in document order, with `<ul>` contributing its `<li>`
   items: h1 = 0 … `.table-wrap` = 8 (instant), `<hr>` = 15 (instant), `.embeds` = 20 (instant).
10. **JetBrains Mono uses `font-display: swap`** (Anton keeps `block`): a font hiccup must never
    leave the page textless in a screenshot. The `@font-face` lists the variable TTF twice, with the
    `truetype-variations` hint first and plain `truetype` as the fallback entry.
11. **Palette additions:** `--g-hover: #f2ffc4` for link hover, and `li::marker` uses `--g-rule` so
    the bullets read as rules rather than as text.

---

## Revision (fix pass 1, 2026-09-05)

Review findings applied to `js/main.js`, `js/foreground.js` and `css/style.css` (no change to
`index.html`, `js/background.js` or `js/logoSampler.js`; no visible text touched).

1. **`?scroll=` is re-anchored after the webfont swap (F6 "no layout shift", F9).** The restore used
   to run once, synchronously, at the top of `js/main.js` — before JetBrains Mono had loaded. With
   `font-display: swap` the swap-in reflows the document afterwards (the fallback stack has different
   metrics), and the browser did not reliably re-anchor: identical headless captures of
   `t=35&pause=1&fgDone=1` at `scrollY = 900` landed ~27 px apart in 2 of 6 runs. `main.js` now keeps
   the requested offset until *both* the `load` event and `document.fonts.ready` have settled (plus one
   rAF), then releases it; any genuine user input (`wheel`/`touchstart`/`keydown`/`pointerdown`)
   cancels the anchor first, so it can never fight a real reader. `font-display: swap` is deliberately
   kept (revision note 10 above: a font hiccup must never leave a screenshot textless). Verified: six
   consecutive captures of the same URL are now **byte-identical** (first green pixel row 27 in all
   six; previously 27 or 0 depending on the run).
2. **Typing epoch is cleared while a unit is blocked (F6).** In `advance()`, the early return taken
   when the next unit's top edge has not yet reached the reveal line left `startAt` holding the
   *previous* unit's finish time + `UNIT_PAUSE_MS`. When the reader later scrolled the unit into view,
   `elapsed = now − startAt` measured the scrolling time, not the typing time, so the unit snapped to
   fully revealed on its first unblocked frame — no per-character animation, no cursor — for every
   unit after the first. The blocked branch now sets `startAt = null` before returning, so the epoch is
   re-armed at the moment the unit actually starts. The common path (next unit already visible) never
   enters that branch, so the ~120 ms inter-unit pause is unchanged — confirmed still working in
   `live.png`. This bug is invisible to the checklist (its hooks never leave a real time gap between
   one unit finishing and the next unblocking), so it has no screenshot of its own.
3. **`--g-mark` separated from `--g-heading` (F4).** `#eaff9c` differed from the heading green by
   (20, 0, 34) — inside an `<h3>`, "Saturday 2-4 pm" and "Meetings:" read as the same colour, so the
   emphasis F4 asks to preserve was lost. `--g-mark` is now `#f2ffbe`: brighter *and* markedly less
   saturated, so it separates by chroma as well as luminance while staying a green tint rather than
   white. `--g-hover` is now `var(--g-mark)` (it duplicated the old value).
4. **Low nits.** `:scope > table` / `table` dropped from `UNIT_SELECTOR` / `INSTANT_SELECTOR` (the
   table is only ever reached through `.table-wrap`); `freeze()` defers to `completeAll()` under
   `prefers-reduced-motion: reduce`, so the test hook cannot produce a mid-typing frame with a cursor
   for a reduced-motion user; the `resize` listener now only marks the tunables dirty and calls
   `queueBlur()`, so the `getComputedStyle` re-read and the recompute both happen once per frame.
   **Not changed:** `CONFIG.SPEED.BODY` stays at 90 chars/s — F6 mandates "~90 chars/s" for
   body/list/callout, so lowering it for a more visible cursor would contradict the spec, not fix it.

Verification re-run into `shots/fg-fix1/` (all ten checklist rows, plus six repeats of the `s900`
capture): top hero crisp with no foreground text; `s900` uniformly blurred edge to edge with no rim;
`s300` visibly less blurred; table without lines at `s1500`; `type.png` = units 0–2 complete, unit 3 at
18 characters ("inspired by Harvar") followed by the block cursor, nothing after; `typeend.png` =
units 0–3 complete with no cursor and unit 4 showing the cursor alone; `live.png` mid-unit with one
cursor; 390 px portrait fits with the table scrolling inside its wrapper; visible-text diff empty; no
error banner in any frame. Text band start rows are identical (27 / 65) across `s900`, `type` and
`typeend`, i.e. still no layout shift between the frozen and finished frames.

---

## Revision (fix pass 2, 2026-09-05)

One confirmed review finding applied; `js/background.js` / `js/logoSampler.js` untouched, no visible
text changed (`diff` of the tag-stripped `index.html` against the pristine copy is still empty).

1. **The table's horizontal-scroll container is now keyboard-operable (F3/F9, WCAG 2.1.1).**
   `.table-wrap` has `overflow-x: auto` and the table a `min-width: 620px`, so at narrow widths
   (390 px) the Lead and Date columns sit outside the visible box. A plain `<div>` with
   `overflow-x:auto` and no `tabindex` is not in the focus order in any browser, and several rows
   (the Lead and Date cells, and every row whose Session Material is `N/A`) contain no focusable
   child at all — a keyboard-only or switch-access reader had no way to scroll those columns into
   view. `index.html` now carries `<div class="table-wrap" tabindex="0" role="region"
   aria-label="Session schedule table">`: the region is focusable, so the arrow keys scroll it, and
   the accessible name tells a screen-reader user what the region is (an unnamed `role="region"` is
   dropped from the landmark list). This is an attribute-only change on the same source line, so the
   visible-text diff stays empty. `css/style.css` adds
   `.table-wrap:focus-visible { outline: 2px solid var(--g-heading); outline-offset: 3px; }` so the
   new tab stop is visible for a sighted keyboard user; `:focus-visible` (not `:focus`) keeps the
   outline off a mouse click, and it never paints in the checklist captures. The wrapper is also an
   "instant" typing unit that is `visibility: hidden` until its turn, and hidden elements are not
   focusable, so the new tab stop cannot appear before the table does.

Verification re-run into `shots/fg-fix2/` (all ten checklist rows): hero crisp with no foreground
text at `scrollY = 0`; `s900` uniformly blurred edge to edge with no rim; `s300` intermediate;
`s1500` shows the table with no lines or backgrounds and the columns still aligned; `type.png` =
units 0–2 complete with unit 3 at 18 characters ("inspired by Harvar") plus the block cursor and
nothing after; `typeend.png` = units 0–3 complete, no cursor on unit 3, unit 4 showing the cursor
alone; `live.png` mid-unit with a single cursor; 390 px portrait fits the width with the table
scrolling inside its wrapper and no horizontal page scroll; no error banner in any frame; the text
bands start at the same rows across `s900` / `type` / `typeend` (no layout shift).

---

## Revision (fix pass 3, 2026-09-05)

Five confirmed review findings applied to `css/style.css` and `js/foreground.js`. `index.html`,
`js/background.js` and `js/logoSampler.js` are untouched; the tag-stripped diff against the pristine
`index.html` is still empty ("TEXT IDENTICAL").

1. **List bullets no longer leak the shape of the list (F6, "units below the viewport stay invisible
   until their turn").** The `::marker` is generated by the UA and belongs to no text node, so it was
   not one of the `.fg-ch` spans and painted from first paint: four green dots sat in empty space
   several units before the queue reached them, telling the reader exactly how many list items were
   coming. `css/style.css` adds `li.fg-unit:not(.fg-done):not(.fg-typing) { list-style: none; }`, and
   `js/foreground.js` adds the new `fg-typing` class to a unit the moment it starts revealing
   (`setRevealed` with `n > 0`, and `placeCursor`, so a unit showing only the cursor already owns its
   bullet); `resetUnit` and the blocked branch take it back. A bullet therefore arrives with its own
   first character. `list-style: none` only suppresses the marker box, which is laid out *outside* the
   `<li>`, so there is no layout shift — verified: in `shots/fg-fix3/freeze12_li.png` the two revealed
   items sit at exactly the rows and x-offsets they have in the finished `s1500.png`.
   Verified fixed: `freeze9_h2.png` (`fgFreeze=9:12`, scrollY 1500) shows the "Spring 2026 " h2
   mid-typing with **nothing** below it — the four dots the review found at y ≈ 490/519/549/578 are
   gone; `freeze12_li.png` shows bullets only on the two items that have started.
2. **The reduced-motion override actually wins now (F6, "reveal everything instantly").**
   `.fg-instant { transition: none; }` (specificity 0,1,0) could never override
   `.fg-instant.fg-shown { … transition: opacity 150ms linear; }` (0,2,0), so instant units still
   faded for `prefers-reduced-motion: reduce` users. The media block now declares
   `.fg-instant, .fg-instant.fg-shown { transition: none; }` — equal specificity, later in source
   order. Verified empirically (`shots/fg-fix3/rm.png`): with the media condition forced on in a copy
   of the stylesheet, a `.fg-instant.fg-shown` element computes `transition-duration: 0s`,
   `transition-property: none` (previously `0.15s` / `opacity`) while still being `opacity: 1`.
3. **`--g-callout` is `#5fe33a`, not `#8ef05a` (F4).** The old value was a ~16/255 luminance step from
   `--g-base` at practically the same hue: the former callouts read as ordinary paragraphs, so the
   emphasis F4 asks to preserve was lost once their gray box was removed. The new value is a deeper,
   markedly more saturated *pure* green against the yellow-green of the body, separating by hue and
   chroma as well as by ~42/255 of luminance (sampled from `s1500.png`: callout `(95,227,58)` = 168.3
   vs body `(168,255,92)` = 210.4). It keeps the palette's brightness ordering (below `--g-base`,
   above `--g-muted`). Visible as a distinct shade in `s1500.png` and `p.png`.
4. **The typing engine is event-driven instead of polling (PERFORMANCE).** `runLoop()` re-armed
   `requestAnimationFrame` for as long as any unit was unfinished, and `advance()` called
   `getBoundingClientRect()` unconditionally — including on the "blocked" branch taken whenever the
   reader stops scrolling before the next unit is in view. A reader who paused kept the page reading
   layout ~60 times a second, indefinitely, while nothing changed. The blocked branch now sets a
   `blocked` flag, which stops `runLoop()` from re-arming; `kickLoop()` clears it and restarts the
   loop from the existing `scroll` and `resize` listeners, from a `ResizeObserver` on the column (a
   reflow — the webfont swap, an iframe settling — can lift the next unit above the reveal line with
   no scroll event) and from `document.fonts.ready`. Behaviour is unchanged: `live.png` still types
   one unit at a time with a single cursor after the harness scrolls, `live1500.png` runs the whole
   queue down to the callout, and a 12-second live run at scrollY = 0 (`live_top_idle.png`) correctly
   types nothing and shows no error banner — the engine is idle, not stuck.
5. **Unrevealed characters stay in the accessibility tree (ACCESSIBILITY).** `.fg-ch` uses
   `opacity: 0` instead of `visibility: hidden` (and `setRevealed`/`resetUnit` write
   `style.opacity` instead of `style.visibility`). Both hide the glyph and keep its box, but
   `visibility: hidden` also removes the text from the accessibility tree, so a screen reader reaching
   a unit mid-animation heard an empty or truncated heading. With opacity the full text is exposed to
   assistive technology (and to find-in-page) immediately, whatever the reveal timer is doing. Purely
   visual behaviour is identical — the frozen captures are unchanged.
   **Not changed:** the *instant* units (`.table-wrap`, `hr`, `.embeds`) keep `visibility: hidden`
   before their turn. They contain focusable children (table links, iframes), and `visibility: hidden`
   is what keeps those out of the focus order until the table exists — the fix-pass-2 keyboard region
   depends on it. Swapping them to `opacity: 0` would put invisible tab stops on the page, a worse
   accessibility outcome than the one it would fix.

Verification re-run into `shots/fg-fix3/` (all ten checklist rows plus the four extra frames named
above): hero crisp with no foreground text at scrollY = 0; `s900` uniformly blurred edge to edge with
no rim; `s300` intermediate; `s1500` shows the table with no lines or backgrounds and columns still
aligned; `type.png` = units 0–2 complete, unit 3 at 18 characters ("inspired by Harvar") plus the block
cursor, nothing after; `typeend.png` = units 0–3 complete with no cursor and unit 4 showing the cursor
alone; `live.png` mid-unit with one cursor; 390 px portrait fits the width with the table scrolling
inside its wrapper; the visible-text diff is empty; no error banner in any frame; the text bands start
at the same rows across `s900` / `type` / `typeend`, i.e. still no layout shift.
