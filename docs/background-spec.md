# HSRG background — final implementation spec (`js/background.js`, three.js r160)

Synthesised from three independent designs (A: geometry, B: choreography, C: rendering). Every parameter below is concrete; everything tunable is in the CONFIG block (§1). Numbers marked "checked" were verified numerically (script: scratchpad `chk.py`). Requirements R1–R11 are mapped to screenshot checks in §14.

## 0. Decisions (what was taken from where, and why)

| Topic | Decision | Source / reason |
|---|---|---|
| Camera | Level camera at `(0,0,D)`, D = 3.2, vertical FOV = 2·atan(1/D) so the half-height of the viewport at z=0 is exactly 1.0 world unit at every aspect | C (A's D=2.2 is too strong and forbids extending the mesh; B's 4.5 gives weak ellipses). Ring at y=0.5 projects as an ellipse 0.28 tall × 1.69 wide — clearly 3-D. |
| Profile r(y) | Saturating Gaussian well, C∞, zero slope at the waist, mesh spans y ∈ [−1.6, 1.6] | C. **A's cosh trumpet cut at |y|=1 is rejected**: the back quarter of its top rim projects inside the screen corners (rim point at 15° → x_s=1.49, y_s=0.82, unoccluded), i.e. you would see the inside of the mouth. A saturating profile lets the mesh extend far enough that the whole rim is off-screen (`Y_EXT·D/(D+R_MAX) = 1.14 > 1`, checked). B's parabola also works but needs D=4.5. |
| Grid lines | Painted procedurally in the **fragment shader of the opaque body** (anti-aliased, constant device-pixel width, scroll = one uniform). No GL_LINES. | A. Removes z-fighting/polygon-offset/epsilon machinery of B and C entirely, gives DPR-scalable line width (B/C's 1-px lines are hairlines on DPR-2), hidden-line look and ring scroll for free. |
| Ring spacing | Uniform in y (not arc length), DY = 0.08, 40 rings over the 3.2 span, scroll 0.08 world/s | C. Simplest, exact integer wrap, uniform descent speed. |
| Ghost (far-side) lines | Off by default (`GHOST_ALPHA = 0`), implemented as an optional second pass | B's idea kept as a toggle; solid hidden-line look is the default. |
| Particles | One `THREE.Points`, **all motion in the vertex shader** from `uCycle`; cylindrical interpolation (ρ, θ, y) so the path never crosses the body; ends exactly on the target (no snap) | B + C. A's CPU update works but shader = zero per-frame JS and seek is a uniform. |
| Particle count | ≈ 6000 (adaptive stride from ink area) | C (A's 1900 is too sparse for crisp text; 6000 sprites cost nothing). |
| Spawn heights | Band around the target height, clamped to |y| ≤ 0.6 | A. C's |y| ∈ [0.45, 0.95] makes portrait entries invisible (funnel is wider than the phone above y≈0.68). |
| Release | "Sucked into the throat" (move in −z through the front wall → depth-occluded, alpha fades first) | B/C. A's outward spiral is a taste alternative; not used. |
| Crisp text underlay | Yes, default on, cross-faded in only after every particle has arrived and out before release; alphaMap (white-on-black raster) to avoid premultiplied fringes | A + B. Particles own every transition; the quad only sharpens the held logo. |
| Logo plane depth | Fixed-point iteration so the plane clears the body at the letters' top/bottom edge, not just at the waist | A (C's fixed Z_L=0.75 is far too deep in portrait). |
| Occlusion | Depth buffer only: opaque body writes depth; everything else depth-tests, no depth write | all three |
| Resize | Uniforms only, nothing rebuilt | B/C (body is parametric: vertex shader computes r(y) from uniforms) |
| Time | `renderAt(t)` pure function; JS doubles wrap `uCycle`, `uScroll`; seeded PRNG at build only | all three |
| Error banner | Installed first, DOM `<div>`, shown only in headless | all three |
| Canvas CSS | `#bg { width:100%; height:100% }` instead of `100vw/100vh` | A (scrollbar / URL-bar mismatch) |

Whole-animation period: `T_CYCLE = 18 s` and `RING_SPEED·T_CYCLE = 0.72 = 9·DY`, so **the entire frame is periodic with period 18 s** (t and t+18 render identically) — useful for verification.

> **Revision (fix pass 1).** After review the following changed in `js/background.js`; the code is authoritative where this document still shows old numbers: `T_CYCLE 18`, `T_STREAM 4.5`, `F 6.0`, `R0 15.8`, `R_DUR 2.2`, `RING_SPEED 0.04` (one ring pitch per 2 s), `FADE_IN 0.6`, `ENTRY_FACTOR 1.02`, `ENTRY_MARGIN 0.15`, `ENTRY_U 0.45` (radial approach window, was a literal 0.3), `ANG_S0 0.5` (cubic-Hermite angular progress replaces the `ANG_POW 1.7` ease-out: g'(0)=0.5, g'(1)=0, so a particle spends ≈ 1.3 s visible on the right, ≈ 1.2 s hidden and ≈ 3.3 s sweeping the front instead of 0.5 / 0.9 / 3.0 s), `CLEAR_ASPECT 1.6` (random orbit clearance scaled by `min(1, aspect/1.6)` so the left pass stays on a phone screen), hold choreography split into four strictly sequenced ramps `UNDERLAY_IN [10.5, 11.0] → DOTS_RECEDE [11.0, 11.4] → DOTS_RETURN [14.9, 15.3] → UNDERLAY_OUT [15.3, 15.8]` (the dots only recede while the underlay is fully opaque, so the letters never dim mid-crossfade), grazing-angle line fade now goes to zero (`1 − smoothstep(0.25, 0.5, cover)`), meridians running closer than 6 CSS px to the silhouette stroke are dropped (`MERIDIAN_GAP [6, 9]`, distance estimated from `dot(N, V)` and its screen derivative), an explicit anti-aliased silhouette stroke (`SIL_PX 1.25`) is drawn from `dot(N, V)`, the body is `FrontSide` with CCW winding (far wall no longer shaded), `powerPreference: 'default'`, and `layout()` returns early when size and DPR are unchanged. `tools/screenshot.sh` routes widths < 500 px and any `scrollY > 0` through `tools/viewport-test.html` automatically.

> **Revision (fix pass 2).** Near-limb meridians are now dropped analytically instead of by the `dot(N, V)`/`fwidth` distance heuristic, which left a half-faded meridian running parallel to the silhouette (a grey ghost line, worse at DPR 2). In the body fragment shader the nearest meridian's azimuth `phiK` and the perspective limb azimuth `acos((r − y·r′)/D)` are both projected to screen x; a meridian closer than `MERIDIAN_MIN_PX 6` CSS px inside the silhouette is removed, with a `MERIDIAN_TAPER_PX 3` taper only along the line's length (`MERIDIAN_GAP` is gone; the grazing fade `LINE_MAX_COVER` still applies to rings). `?lines=rings|meridians` draws one family only, for visual debugging. Cycle overlap (R11): spawn times are `s ∈ [−SPAWN_LEAD, T_STREAM − SPAWN_LEAD)` with `SPAWN_LEAD 1.1`, so the next stream enters at the right edge while the previous logo is still letting go; the release delay is `d = D_MAX · mix(q_d, spawn order, REL_ORDER 0.7)` (the logo lets go roughly left to right) and `REL_FADE [0.05, 0.55]` names the alpha ramp. New invariants: `0 ≤ SPAWN_LEAD < T_STREAM`, `T_STREAM − SPAWN_LEAD + F ≤ R0` (replaces `T_STREAM + F ≤ R0`) and `R0 + D_MAX·(1 − REL_ORDER) + REL_FADE[1]·(R_DUR − D_MAX) ≤ T_CYCLE − SPAWN_LEAD` (every particle is invisible before it respawns). Also: `HOLD_DOT_ALPHA 0.05`, `HOLD_DOT_SIZE 0.6` (no speckled fringe around the crisp held logo), `renderer.initTexture()` uploads the underlay at init, resize/DPR listeners are registered after the first frame and the DPR watcher is wrapped in try/catch, and `js/main.js` installs a minimal error banner before dynamically importing `background.js` so import failures are visible in headless screenshots (`?importFail=1` self-test).

> **Revision (fix pass 3).** (1) Meridian visibility is decided per WHOLE meridian in JS (`meridianCut()`, once per layout) instead of per fragment: for every meridian on the near side the smallest on-screen distance (CSS px, perpendicular) to the projected silhouette anywhere along its visible run is computed; because every surface curve meets the visual contour tangentially, a meridian that comes closer than `MERIDIAN_MIN_PX 6.5` would hug the silhouette stroke, so it is dropped over its full length. The distance shrinks monotonically toward the limb, so the dropped set is the band `|phi| > uPhiCut` (one uniform; the shader fades over `MERIDIAN_BAND 0.1` of the spacing so a resize slides a line in/out instead of popping it). `MERIDIAN_TAPER_PX` and the per-fragment `sPx` cut are gone: no meridian starts or ends mid-surface any more (the stubs/hooks at the four shoulders). At 1280x800 the 73.1° and 84.4° meridians are dropped (phiCut 65.2°), on a 390x844 phone also 61.9° (phiCut 60.9°). (2) Release: dots are no longer sunk in −z through the wall (they were depth-culled at 50–73 % alpha); they are pulled toward the throat's centre `(0, 0, zL)` within the logo plane (`REL_PULL 0.7`, x 0.7..1.3 per particle) and fade over `REL_FADE [0.1, 0.6]`. Every point of that path has cylindrical radius ≥ zL > r(y), so alpha reaches 0 while the dot is still in front of the wall (verified numerically at 1280x800, 390x844, 1920x1080). (3) Flight: the cubic-Hermite angular ease (`ANG_S0`) is replaced by a trapezoid speed profile (`ANG_IN 0.2`, `ANG_OUT 0.15`): angular speed no longer collapses after a particle clears the left limb; the y blend finishes by `Y_U 0.45` and the outward radial blend starts at `OUT_U 0.5` (was 0.6) so particles leave the limb as soon as they emerge; `F 5.5` with per-particle variation `F_VAR 0.12` disperses the stream along the path; `ENTRY_ALPHA 0.8` on the sparse right-hand approach and `FLIGHT_ALPHA 0.5` on the dense front sweep (was 0.85) so the emergence zone reads as a swarm, never a flat white mass. New invariants: `T_STREAM − SPAWN_LEAD + F·(1+F_VAR) ≤ R0` and `≤ UNDERLAY_IN[0]`, `ENTRY_U, Y_U ≤ OUT_U < 1`, `REL_PULL·1.3 < 1`. (4) `logoSampler.js` draws the period as a circle (`LOGO_ROUND_PERIOD`, the reference logo's dot is round): same centre column and bottom edge as Anton's square glyph, diameter = the glyph's ink width. (5) Body index buffer is `Uint16Array`; `#bg` is sized with `height: 100lvh` (fallback `100%`) so a phone's collapsing URL bar does not reallocate the drawing buffer mid-scroll.

> **Revision (retiming, 2026-09-04).** Per the user: `T_CYCLE 60`. The stream and formation take the first 13 s (`T_STREAM 6.2`, `F 6.1`, last arrival at 11.9 s, `UNDERLAY_IN [12.5, 13.0]`, `DOTS_RECEDE [13.0, 13.4]`), and the crisp logo then holds until the release at the end of the cycle (`DOTS_RETURN [56.9, 57.3]`, `UNDERLAY_OUT [57.3, 57.8]`, `R0 57.8`, `R_DUR 2.2`, so the release ends exactly at 60 s and the next stream enters at 58.9 s). Rings: `RING_SPEED·T_CYCLE/RING_DY = 30`, so the whole picture is still periodic with the cycle. Every timeline and t-value elsewhere in this document that assumes the 18 s cycle is superseded by these numbers.

## 1. CONFIG block (top of `background.js`)

```js
export const CONFIG = {
  // camera / world (world unit = half viewport height at z=0)
  D: 3.2,                 // camera distance; fov = 2*atan(1/D) = 34.71 deg
  NEAR: 0.5, FAR: 12,
  // funnel profile
  SIGMA: 0.55,            // Gaussian well width (0.45..0.65)
  Y_EXT: 1.6,             // mesh spans y in [-Y_EXT, Y_EXT]; keep Y_EXT*D/(D+R_MAX) > 1
  RMAX_K: 0.80, RMAX_LO: 0.55, RMAX_HI: 1.30,   // R_MAX = clamp(RMAX_K*aspect, LO, HI)
  RMIN_K: 0.22, RMIN_LO: 0.14, RMIN_HI: 0.30,   // R_MIN = clamp(RMIN_K*R_MAX, LO, HI)
  // body mesh
  NY: 160, NTH: 192,      // rows in y, columns around
  // grid
  RING_DY: 0.08,          // ring spacing in y (SPAN/RING_DY must be an integer: 3.2/0.08 = 40)
  RING_SPEED: 0.08,       // world units / s, downward
  MERIDIANS: 32,          // even; offset half a step so none sits on the exact silhouette
  LINE_PX: 1.25,          // line width in CSS px (device px = LINE_PX * dpr)
  LINE_MAX_COVER: 0.5,    // fade lines when they would cover > 50% of a cell (grazing angles)
  GHOST_ALPHA: 0.0,       // 0 = off; 0.12..0.2 draws the far-side grid faintly
  // logo
  LOGO_TEXT: 'HSRG.', FONT_PX: 400, SAMPLE_W: 1600, SAMPLE_H: 640,
  LOGO_FRAC_W: 0.86,      // max fraction of viewport width at the logo plane
  LOGO_W_MAX: 1.15,       // max world width
  LOGO_CLEAR: 0.10,       // gap between body and logo plane at the letters' top/bottom edge
  N_TARGET: 6000,         // target particle count (actual = sampled count, ~5500..6500)
  JITTER: 0.35,           // sample jitter in grid steps
  DOT_OVERLAP: 1.35,      // dot diameter / sample stride
  UNDERLAY_MAX: 0.9, UNDERLAY_IN: [9.9, 10.7], UNDERLAY_OUT: [13.2, 13.7],
  // particle cycle (seconds)
  T_CYCLE: 16, T_STREAM: 5.5, F: 4.5, R0: 13.6, D_MAX: 0.9, R_DUR: 2.4,   // release per particle lasts R_DUR-D_MAX = 1.5 s
  ANG_POW: 1.7,           // angular ease exponent
  CLEAR_MIN: 0.10, CLEAR_RAND: 0.25,   // orbit clearance m = CLEAR_MIN + CLEAR_RAND*q
  ENTRY_FACTOR: 1.15, ENTRY_MARGIN: 0.3,
  Y_SPREAD: 0.45, Y_SPAWN_MAX: 0.6,
  FLIGHT_ALPHA: 0.85, FADE_IN: 0.35,
  POINT_MIN_PX: 1.0, POINT_MAX_PX: 48.0,
  SEED: 0x48535247,       // "HSRG"
  DPR_MAX: 2,
  FONT_TIMEOUT_MS: 3000,
};
```

Invariant checks to assert at startup (throw → banner): `Number.isInteger(2*Y_EXT/RING_DY)`, `MERIDIANS % 2 === 0`, `T_STREAM + F <= R0`, `R0 + R_DUR <= T_CYCLE`, `D_MAX < R_DUR`, and after resize `Y_EXT*D/(D+R_MAX) > 1`.

## 2. Files and fit with the existing page

- Only new file: `/home/tbooy/HSRGWebsite/js/background.js`, `export function startBackground({canvas, headless, seekSeconds, paused})`. Optional helper `/home/tbooy/HSRGWebsite/js/logoSampler.js`. Import `import * as THREE from './three.module.js'` (relative, case-sensitive). No other network fetches (the Anton TTF is fetched by the existing `@font-face`).
- `index.html` and `main.js` unchanged. `main.js` already handles `?scroll=`; `background.js` never reads `scrollY` (R1).
- `css/style.css`: one tweak — in `#bg` replace `width: 100vw; height: 100vh;` with `width: 100%; height: 100%;` (with `inset:0` it fills the layout viewport without the scrollbar / mobile URL-bar mismatch). Nothing else.
- Canvas size always comes from CSS: `renderer.setSize(canvas.clientWidth, canvas.clientHeight, false)` (fallback `innerWidth/innerHeight` if 0).

## 3. Coordinates and camera

- World: funnel axis = +Y. Camera at `(0, 0, D)`, `lookAt(0,0,0)`, up +Y. Screen right = +X, "in front" = +Z, "behind" = −Z.
- `PerspectiveCamera(fovDeg, aspect, NEAR, FAR)` with `fovDeg = 2·atan(1/D)·180/π = 34.71°`. `tan(fov/2) = 1/D` ⇒ half-height of the viewport at z=0 is 1.0 world unit at every aspect; half-width `A = W_px/H_px`. Pixels per world unit at z=0 = `H_px/2`.
- Projection of `(x,y,z)` to screen units (half-height = 1): `x_s = x·D/(D−z)`, `y_s = y·D/(D−z)`. Magnification of a plane at depth z: `M(z) = D/(D−z)`.
- Azimuth convention used by everything (grid seam, particles): `pos(ρ, θ, y) = (ρ·cos θ, y, −ρ·sin θ)` ⇒ θ=0 right, 90° behind, 180° left, 270° front (R6).
- Camera is level and at the waist height: rings above the waist bow upward, rings below bow downward, the waist ring is edge-on. Never tilt.

## 4. Funnel profile (R3)

```
R_MAX = clamp(0.80·A, 0.55, 1.30)
R_MIN = clamp(0.22·R_MAX, 0.14, 0.30)
r(y)  = R_MIN + (R_MAX − R_MIN)·(1 − exp(−(y/SIGMA)²)),   y ∈ [−Y_EXT, Y_EXT], SIGMA = 0.55, Y_EXT = 1.6
```
Checked values:

| viewport | A | R_MAX | R_MIN | silhouette x_s at y=0 / 0.4 / 0.6 / 0.8 (% of half-width) | front wall reaches top edge at y | back rim y_s (must be > 1) |
|---|---|---|---|---|---|---|
| 1280×800 | 1.600 | 1.280 | 0.282 | 18 / 44 / 64 / 78 % | 0.67 | 1.14 |
| 390×844 | 0.462 | 0.550 | 0.140 | 30 / 67 / 93 / 110 % (wider than the phone above y≈0.66) | 0.84 | 1.37 |
| 1920×1080 | 1.778 | 1.300 | 0.286 | 16 / 41 / 59 / 71 % | 0.67 | 1.14 |
| 2560×1080 | 2.370 | 1.300 | 0.286 | 12 / 30 / 44 / 53 % (ultra-wide: accepted) | 0.67 | 1.14 |

Waist diameter on screen = `2·R_MIN·H_px/2` → 225 px at 1280×800, 118 px at 390×844. The rim ring at |y| = 1.6 projects at `y_s ≥ 1.14` for every point on it (sides at 1.6, front far above), so the mouth opening is never in view and no end cap is needed.

Single GLSL chunk concatenated into every vertex/fragment shader that needs it:
```glsl
uniform float uRmin, uRmax, uSigma;
float radius(float y) { float q = y / uSigma; return uRmin + (uRmax - uRmin) * (1.0 - exp(-q * q)); }
```

## 5. Body + grid: one opaque mesh, one draw call (R2, R4, R5, occluder for R6)

**Geometry** (built once, never rebuilt): indexed `BufferGeometry`, grid of `NY = 160` rows in y (uniform over [−Y_EXT, Y_EXT]) × `NTH = 192` columns in θ (closed: column 192 duplicates column 0). `position = (θ_j, y_i, 0)` — the position attribute carries the parameters (three needs `position` for the draw count and bounding sphere). `frustumCulled = false`. 160×192×2 ≈ 61 k triangles. Put θ_0 at the back (θ = π/2, i.e. seam at (0, y, −r)).

**Material**: `ShaderMaterial`, `side: DoubleSide` (safety: an interior would be black, never see-through), `transparent: false`, `depthTest: true`, `depthWrite: true`, `renderOrder: 0`. Uniforms: `uRmin, uRmax, uSigma, uYext, uRingDY, uScroll, uMeridians, uLinePx, uLineMaxCover`.

Vertex shader:
```glsl
varying vec3 vWorld; varying float vY;
void main() {
  float th = position.x, y = position.y;
  float r = radius(y);
  vec3 p = vec3(r * cos(th), y, -r * sin(th));
  vWorld = p; vY = y;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
```
Fragment shader (WebGL2/GLSL ES 3.00, `fwidth` built in):
```glsl
uniform float uYext, uRingDY, uScroll, uMeridians, uLinePx, uLineMaxCover;
varying vec3 vWorld; varying float vY;
float lineMask(float c, float px) {          // c: coordinate with a line at every integer
  float d = fwidth(c);                        // coordinate change per device pixel
  float w = d * px * 0.5;                     // half line width in coordinate units
  float l = abs(fract(c - 0.5) - 0.5);        // distance to nearest integer
  float a = 1.0 - smoothstep(w, w + d, l);    // px-wide line with a 1-px AA ramp
  return a * clamp(uLineMaxCover / max(d * px, 1e-6), 0.0, 1.0);  // fade at grazing angles: no white blow-out at the silhouette
}
void main() {
  float cr = (vY + uScroll) / uRingDY;                                      // rings: y = k*DY - uScroll, move DOWN as uScroll grows
  float cm = (atan(vWorld.x, vWorld.z) + 3.14159265 / uMeridians) * (uMeridians / 6.28318530718); // meridians, half-step offset
  float g = max(lineMask(cr, uLinePx), lineMask(cm, uLinePx));
  gl_FragColor = vec4(vec3(g), 1.0);                                        // black body, white lines, opaque
}
```
- Because the body is opaque and depth-written, far-side arcs are hidden automatically (hidden-line look) and particles behind it fail the depth test (R6).
- `atan(x, z)` seam (x=0, z<0) is at the back → hidden. Meridians are offset by half a step (B) so none sits on the exact silhouette (θ = ±90°); with 32 meridians the outermost visible ones are ~5.6° inside the silhouette.
- Line width in device px: `uLinePx = LINE_PX · dpr` (1.25 at dpr 1, 2.5 at dpr 2).
- **Ring scroll (R5)**: in JS doubles each frame `uScroll = ((RING_SPEED·c) % SPAN + SPAN) % SPAN` with `c = t mod T_CYCLE`, `SPAN = 2·Y_EXT = 3.2` (deriving it from `c` rather than raw `t` makes frames at t and t+16 bit-identical; valid because `RING_SPEED·T_CYCLE/RING_DY = 16` is an integer, asserted at startup). Lines sit where `(y + uScroll)/DY` is an integer, i.e. `y = k·DY − uScroll` → y decreases as t grows (downward; the earlier `(Y_EXT − y + uScroll)` form moved them upward), ~32 px/s at 800 px tall, one ring spacing per second. Seamless because the pattern is periodic in y with spacing DY, SPAN/DY = 40 exactly, and the wrap points (|y| = 1.6) are off-screen. Meridians do not depend on t (fixed).
- **Optional ghost pass** (`GHOST_ALPHA > 0`): draw the same geometry a second time with a clone material: `side: BackSide`, `transparent: true`, `depthTest: true`, `depthFunc: THREE.GreaterDepth`, `depthWrite: false`, `renderOrder: 0.5`, fragment `gl_FragColor = vec4(1.0, 1.0, 1.0, g * uGhostAlpha)`. Shows the far half of each ring faintly through the body. Default off.

## 6. Logo sampling (R7) — `sampleLogo()` runs once at startup

1. **Font**: `const faces = await Promise.race([document.fonts.load('400 400px "Anton"'), sleep(FONT_TIMEOUT_MS).then(() => null)])`. Loaded ⇔ `faces && faces.length > 0 && document.fonts.check('400 400px "Anton"')`. Additionally compare `measureText('HSRG.').width` with the Anton font string against `'400 400px sans-serif'`; if equal, the face did not apply. On failure: `console.warn('Anton not available, falling back')`, use `'400 400px Impact, "Arial Narrow", sans-serif'`, and in headless mode also print the warning in the banner (yellow, not red). Never block rendering on a missing font.
2. **Raster**: offscreen canvas `1600×640` (constant, DPR-independent), fill black, `ctx.fillStyle = '#fff'`, `ctx.font = '400 400px "Anton"'`, `textBaseline = 'alphabetic'`, `fillText('HSRG.', 80, 500)`. No letter-spacing (Anton's default tracking matches `logo-old.png`; the period is part of the string).
3. **Ink box from pixels** (not `measureText`): pixels with red channel > 128. Compute `x0,x1,y0,y1`, `w_ink = x1−x0+1`, `h_ink`, centre `cx, cy`, ink count `C`. Expect `h_ink/w_ink ≈ 0.45–0.48`; log it.
4. **Adaptive grid**: `g = sqrt(C / N_TARGET)` px (≈ 5–6 px). For every cell centre `(x0 + (i+0.5)g, y0 + (j+0.5)g)` inside the box, jitter by `±JITTER·g` in x and y using the seeded PRNG, keep the sample if the jittered pixel is ink. Result count `N` (≈ 5500–6500) becomes the particle count; no padding/duplication.
5. **Normalise**: `x_n = (px − cx)/w_ink`, `y_n = (cy − py)/w_ink` (same divisor → aspect preserved; x_n ∈ [−0.5, 0.5], y_n ≈ ±0.24).
6. **Order**: sort samples by `px` ascending (ties by `py`) so index order runs left→right (H first, period last). Then draw the per-particle random numbers **in index order** from the PRNG.
7. **Underlay texture**: copy the ink box plus 8 px padding into a crop canvas (white on black), `new THREE.CanvasTexture(crop)`, `generateMipmaps: true`, `minFilter: LinearMipmapLinearFilter`, `magFilter: LinearFilter`, `anisotropy: renderer.capabilities.getMaxAnisotropy()`. Used as `alphaMap` (green channel) — never a transparent canvas as `map`.
8. PRNG: `mulberry32(SEED)`; the sampling jitter consumes it first, then particle constants. No `Math.random`, no `Date.now()` anywhere after this.

**Logo placement (world)**: the logo is a flat plane at `z = Z_L`, centred on the origin (screen centre, in front of the waist). Fixed-point iteration (4 rounds, run on every resize):
```
Z_L = 0.5
repeat 4×:  A_L = A·(D − Z_L)/D
            LOGO_W = min(LOGO_FRAC_W·2·A_L, LOGO_W_MAX)
            H_half = 0.5·LOGO_W·(h_ink/w_ink)
            Z_L    = r(H_half) + LOGO_CLEAR          // clears the body at the letters' top/bottom edge
```
Checked (h/w = 0.48): 1280×800 → LOGO_W = 1.15, H = 0.55, Z_L = 0.604, M = 1.233, **567 px wide (44 %) × 272 px tall**; 390×844 → LOGO_W = 0.725, Z_L = 0.279, **335 px wide (86 %) × 161 px tall**; 1920×1080 → 768 px (40 %). Target world position of sample i: `T = (x_n·LOGO_W, y_n·LOGO_W, Z_L)`.

Dot size: `strideWorld = g·LOGO_W/w_ink`, `uDotWorld = DOT_OVERLAP·strideWorld` (≈ 4.8 px at 1280×800, ≈ 5.7 device px on a DPR-2 phone → solid strokes, counters of R and G preserved).

## 7. Particles (R6, R7, R11) — one `THREE.Points`, all motion in the vertex shader

**Attributes** (static, N points): `position = (x_n, y_n, s_i)`, `aRand = (q_m, q_y, q_sz, q_d)` ∈ [0,1)⁴ from the PRNG. Spawn time `s_i = T_STREAM·clamp(0.7·i/N + 0.3·q_s, 0, 0.999)` with `q_s` a fifth PRNG draw (left-to-right build with 30 % scatter). `frustumCulled = false`.

**Uniforms**: `uCycle` (= t mod 16, JS double), `uAspect`, `uLogoW`, `uZL`, `uHalfHeightPx` (= `renderer.getDrawingBufferSize().y / 2`, DPR included), `uDotWorld`, plus the radius chunk uniforms. CONFIG constants are injected as GLSL `const float`.

**Material**: `ShaderMaterial`, `transparent: true`, `depthTest: true`, `depthWrite: false`, `blending: NormalBlending`, `renderOrder: 2`.

Vertex shader (complete formulas; `radius()` from §4):
```glsl
const float PI = 3.14159265;
// injected consts: T_CYCLE, F, R0, D_MAX, R_DUR, ANG_POW, CLEAR_MIN, CLEAR_RAND, ENTRY_FACTOR, ENTRY_MARGIN,
//                  Y_SPREAD, Y_SPAWN_MAX, FLIGHT_ALPHA, FADE_IN, D, POINT_MIN_PX, POINT_MAX_PX
attribute vec4 aRand;
uniform float uCycle, uAspect, uLogoW, uZL, uHalfHeightPx, uDotWorld;
varying float vAlpha;
void main() {
  float tx = position.x * uLogoW, ty = position.y * uLogoW, s = position.z;
  float m      = CLEAR_MIN + CLEAR_RAND * aRand.x;                       // orbit clearance from the surface
  float ySpawn = clamp(ty + Y_SPREAD * (2.0 * aRand.y - 1.0), -Y_SPAWN_MAX, Y_SPAWN_MAX);
  float d      = D_MAX * aRand.w;                                        // release delay

  float tau = uCycle - s; if (tau < 0.0) tau += T_CYCLE;                 // particle-local time in [0, T_CYCLE)
  float u   = clamp(tau / F, 0.0, 1.0);                                  // flight progress
  float rho = clamp((tau - (R0 - s) - d) / (R_DUR - D_MAX), 0.0, 1.0);   // release progress (0 while flying/holding)

  // --- flight: cylindrical interpolation, ends exactly on the target
  float g        = 1.0 - pow(1.0 - u, ANG_POW);                          // angular ease-out
  float thetaEnd = 1.5 * PI + atan(tx, uZL);                             // 233..307 deg: "about 270"
  float th       = thetaEnd * g;
  float y        = mix(ySpawn, ty, smoothstep(0.05, 0.6, u));            // height settles by u = 0.6
  float rOrbit   = radius(y) + m;                                        // hugs the body, always outside it
  float rEntry   = max(ENTRY_FACTOR * uAspect, radius(ySpawn) + m + ENTRY_MARGIN); // off the right screen edge
  float rEnd     = sqrt(tx * tx + uZL * uZL);                            // >= uZL >= radius(ty) + LOGO_CLEAR
  float R = rOrbit + (rEntry - rOrbit) * (1.0 - smoothstep(0.0, 0.3, u))
                   + (rEnd   - rOrbit) * smoothstep(0.6, 1.0, u);
  R = max(R, radius(y) + 0.04);                                          // defensive; never binds at u = 1
  vec3 p = vec3(R * cos(th), y, -R * sin(th));
  if (u >= 1.0) p = vec3(tx, ty, uZL);                                   // hold: bit-exact target (crisp)

  float alpha = mix(FLIGHT_ALPHA, 1.0, smoothstep(0.85, 1.0, u)) * smoothstep(0.0, FADE_IN, tau);

  // --- release: sucked back through the front wall, occluded by the body, alpha gone first
  float rr = rho * rho;
  p += vec3(-0.25 * tx, -0.35, -1.6) * rr;
  alpha *= 1.0 - smoothstep(0.05, 0.55, rho);

  // --- size
  float sz = mix(uDotWorld * (0.7 + 0.5 * aRand.z), uDotWorld, smoothstep(0.8, 1.0, u)) * (1.0 - 0.5 * rho);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position  = projectionMatrix * mv;
  gl_PointSize = clamp(sz * uHalfHeightPx * D / (-mv.z), POINT_MIN_PX, POINT_MAX_PX); // world size -> device px (tan(fov/2)=1/D)
  vAlpha = alpha;
  if (rho >= 1.0 || alpha <= 0.001) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); gl_PointSize = 0.0; vAlpha = 0.0; } // dead: clipped
}
```
Fragment shader:
```glsl
varying float vAlpha;
void main() {
  float a = (1.0 - smoothstep(0.32, 0.5, length(gl_PointCoord - 0.5))) * vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(1.0, 1.0, 1.0, a);
}
```
Why the path is safe (checked for a centre particle, ySpawn = 0.4, m = 0.2, 1280×800 and 390×844): entry at x_s = 1.84 (portrait 0.81) off-screen right; visible drifting in for u ≤ 0.10; **occluded by the body for θ ≈ 60°–155° (u ≈ 0.13–0.42)**; emerges on the left at x_s ≈ −0.46 (portrait −0.32), sweeps across the front decelerating over u = 0.5→1 (≈ 2.3 s) and stops exactly at T with zero velocity. ρ is a convex combination of `rEntry ≥ rOrbit` and `rOrbit`, then of `rOrbit` and `rEnd ≥ radius(ty)+0.10` (y is already `ty` when that blend starts), so ρ > r(y) at all times; at u = 1 the target is exact (the defensive max never binds because `rEnd − radius(ty) ≥ 0.10 > 0.04`). Right-hand letters (`tx > 0`) travel up to 307°, left-hand ones down to 233°.

## 8. Crisp text underlay (R7 legibility, R10 phones)

`PlaneGeometry(1, 1)` scaled to `(LOGO_W·(w_ink+16)/w_ink, LOGO_W·(h_ink+16)/w_ink, 1)` at `(0, 0, Z_L − 0.002)`, `MeshBasicMaterial({ color: 0xffffff, alphaMap: tex, transparent: true, depthTest: true, depthWrite: false, opacity })`, `renderOrder: 1` (between body and points). Opacity per frame in JS: `UNDERLAY_MAX · smoothstep(9.9, 10.7, c) · (1 − smoothstep(13.2, 13.7, c))` with `c = uCycle`. It fades in only after the last arrival (10.0 s) and is gone before the first release (13.6 s) — the particles own every transition. Set `UNDERLAY_MAX = 0` for a pure-particle look.

## 9. Cycle timeline (T_CYCLE = 16 s, c = t mod 16)

| c (s) | event |
|---|---|
| 0.0 – 4.5 | spawns `s_i` (left letters first); each drifts in just inside the right edge, fades in over 0.6 s, ≈ 1.3 s visible on the right |
| ~1.3 – 7.5 | each particle is hidden behind the body for ≈ 1.2 s, reappears on the left and sweeps across the front (≈ 3.3 s, decelerating to rest) |
| 4.5 – 10.5 | arrivals (`s_i + 6.0`); logo accretes left → right across the front; reads from ≈ 9 s |
| 10.5 – 11.0 | underlay fades in (dots stay at full alpha: brightness only increases) |
| 11.0 – 11.4 | dots recede (underlay already opaque: no visible change except sharper edges) |
| 10.5 – 15.8 | **held, fully formed (5.3 s; crisp 11.4 – 14.9)**; rings keep scrolling behind |
| 14.9 – 15.3 | dots return to full alpha (still under the opaque underlay) |
| 15.3 – 15.8 | underlay fades out |
| 15.8 – 18.0 | release: start `15.8 + 0.9·q_d`, each lasts 1.3 s, dots sink into the throat and vanish (occluded + alpha 0) |
| 18.0 = 0.0 | next cycle; frame identical to t = 0 |

Rings: one ring pitch per 2.0 s; 9 pitches per cycle → the whole picture repeats every 18 s exactly.

## 10. Deterministic time, seek, pause, headless (R8)

```js
let base = Math.max(0, opts.seekSeconds ?? 0), stamp = performance.now(), playing = !opts.paused, ready = false;
const time = () => playing ? base + (performance.now() - stamp) / 1000 : base;
function renderAt(t) {                      // pure function of t; no accumulators anywhere
  const c = ((t % T_CYCLE) + T_CYCLE) % T_CYCLE;                 // JS double
  U.uCycle.value = c;
  U.uScroll.value = ((RING_SPEED * t) % SPAN + SPAN) % SPAN;     // JS double, never raw t to the GPU
  underlay.material.opacity = underlayOpacity(c);
  renderer.render(scene, camera);
}
function seek(t)  { base = t; stamp = performance.now(); if (ready) renderAt(t); }
function pause()  { base = time(); playing = false; renderer.setAnimationLoop(null); }
function play()   { base = time(); stamp = performance.now(); playing = true; renderer.setAnimationLoop(() => renderAt(time())); }
window.__hsrgBg = { seek, pause, play, time, render: () => renderAt(time()), info: () => renderer.info.render, ready: readyPromise };
```
Startup order: (1) install error banner; (2) create renderer/camera/scene synchronously (WebGL failure → banner); (3) `await sampleLogo()`; (4) build body, points, underlay; `renderer.compile(scene, camera)`; (5) **reset `stamp = performance.now()`** so the first frame is exactly at `t = seekSeconds`, not seek + load time; (6) `renderAt(time())` synchronously (do not rely on rAF under virtual time); (7) if `playing`, `renderer.setAnimationLoop(...)`. `headless` changes nothing in the pipeline except that the banner is visible; there is no interaction gate in either mode. Tab hidden: the loop stops, `time()` is wall-clock based, so on return state simply jumps forward.

**Error banner**: first statement of `startBackground`: `window.addEventListener('error', …)`, `window.addEventListener('unhandledrejection', …)`, `canvas.addEventListener('webglcontextcreationerror', …)`, and try/catch around the async init. Handler: `console.error` always; if `headless`, create/append `<div id="bg-error">` (`position:fixed; top:0; left:0; z-index:9999; background:#000; color:#f33; font:14px/1.3 monospace; padding:8px; white-space:pre-wrap; max-width:100vw`) with message + stack. Font fallback writes a yellow line the same way.

Context loss: `webglcontextlost` → `preventDefault()`, stop loop; `webglcontextrestored` → `renderAt(time())` (three re-uploads resources); if playing, restart the loop.

## 11. Renderer, resize, DPR (R9, R10)

- `new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' })`, `setClearColor(0x000000, 1)`, `toneMapping = NoToneMapping`, `setPixelRatio(Math.min(devicePixelRatio, DPR_MAX))` **before** `setSize(w, h, false)`.
- Listen to `window resize`, `orientationchange`, `visualViewport.resize` (if present) and a `matchMedia('(resolution: Xdppx)')` change for DPR; coalesce into one rAF. Handler: read `canvas.clientWidth/Height` → `setPixelRatio`, `setSize(w, h, false)` → `camera.aspect = w/h; updateProjectionMatrix()` → recompute `A, R_MAX, R_MIN` (assert the mouth inequality) → logo fixed point (`Z_L, LOGO_W`) → `uAspect, uRmin, uRmax, uLogoW, uZL, uDotWorld, uLinePx = LINE_PX·dpr, uHalfHeightPx` → underlay scale/position → `renderAt(time())` (even when paused). **No geometry or attribute is rebuilt.**
- Vertical FOV is fixed, so the funnel spans top-to-bottom at any aspect; width comes from `R_MAX(A)`; the logo cap (`0.86` of the viewport width at the logo plane, max 1.15 world) keeps it at ≤ 335 px on a 390 px phone and 567 px at 1280×800.

## 12. Render order and occlusion (R6)

Per frame: clear black → body (opaque, depth write, renderOrder 0) → [ghost pass, optional] → underlay (transparent, depth test, no write, renderOrder 1) → points (transparent, depth test, no write, renderOrder 2). Never mark the body `transparent`. Particle sprites are depth-tested per sprite centre: a particle behind the front wall is hidden entirely, one in front is drawn — binary but invisible at ≤ 6 px dots. Debug switch `?debugBody=1` (read in `background.js`, off by default) renders the body at 40 % grey to check body/particle agreement.

## 13. Performance (R9)

3 draw calls (4 with ghost), ≈ 31 k + 6 k vertices, one near-full-screen flat fill with `fwidth` grid math, ≈ 6 k sprites of ≈ 5 px. Per-frame JS: 3 uniform writes + `renderer.render`; no allocations. Expected < 1.5 ms GPU on integrated graphics at DPR 2. Static buffers (`StaticDrawUsage`). Requires WebGL2 (r160 default); if unavailable the banner reports it and the canvas stays black.

## 14. Verification checklist (`tools/screenshot.sh`, always `t=<s>&pause=1`, budget 6000 ms)

`S=/home/tbooy/HSRGWebsite/tools/screenshot.sh; O=/tmp/claude-1000/-home-tbooy-HSRGWebsite/079e1f45-e3c4-421c-a877-b73611b6861c/scratchpad/shots/impl` — then `Read` each PNG.

| R# | command | must show |
|---|---|---|
| R2, R3, R4 | `$S $O/l_t0.2.png "t=0.2&pause=1" 6000 1280x800 0` | pure black background, white lines only; funnel silhouette from the top edge (≈ 80 % of the width) narrowing smoothly to a 225 px waist at mid-height and widening again to the bottom; no kinks; rings above the waist bow upward, below bow downward, waist ring flat; meridians bunch toward the silhouette; no visible mouth interior in the corners; no white blow-out at the silhouette |
| R5 | `$S $O/l_t12.0.png "t=12.0&pause=1" …` and `$S $O/l_t12.5.png "t=12.5&pause=1" …` | identical meridians; every ring 0.02 world (≈ 13 px on the front wall above the waist) lower in the second frame; `t=17.9` vs `t=18.1` show no pop at the cycle wrap (ring phase continuous: RING_SPEED·T_CYCLE/RING_DY = 9) |
| R6 | `t=1.5`, `t=2.5`, `t=3.5` at 1280x800 | particles entering from the right edge, shrinking as they recede; none drawn over the black body in the region where they are behind it; new ones appearing at the left silhouette and sweeping across the front |
| R7 | `t=12` at 1280x800 | "HSRG." in Anton letterforms (compare `assets/logo-old.png`), white, ≈ 567 px wide, centred horizontally and vertically, crisp edges (underlay on), solid strokes, R/G counters open |
| R7 build-up | `t=6.5`, `t=8.5` | H (and S) formed first, right letters still streaming; nothing snaps |
| R8 | run `t=12` twice → `cmp a.png b.png` (byte-identical); `t=30` vs `t=12` (identical: period 18); `t=3600.5` vs `t=0.5` (identical); `t=100.7` renders (no NaN/black) | deterministic frames; no drift after large t |
| R9 | any frame | no red banner; `curl -s http://127.0.0.1:8765/js/background.js` serves; in a real browser `__hsrgBg.info().calls === 3` |
| R10 | `$S $O/p_t12.png "t=12&pause=1" 6000 390x844 0` and `p_t2.5.png` | funnel full-width above/below ≈ 66 % of the half-height, waist ≈ 118 px, logo ≈ 335 px wide (≤ 86 %), legible; particles enter visibly at the right edge near the waist band. Also `1920x1080` at `t=12` |
| R11 | `t=16.5`, `t=17.5`, `t=18.1` vs `t=0.1` | dots sinking into the throat and vanishing without popping; by 18.1 no stale dots; first new particles at the right edge; `t=18.1` identical to `t=0.1` |
| R1 | `$S $O/l_t12_scroll.png "t=12&pause=1" 6000 1280x800 900` | background frame identical to `t=12` (same ring phase, same logo) with the content panel over it. Note: a scrolled window cannot be captured directly by headless Chrome (the frame comes back black / displaced), so `screenshot.sh` routes any `scrollY > 0` (and any width < 500 px) through `tools/viewport-test.html`, an iframe of the exact size that scrolls internally |
| headless diag | temporarily throw in init → banner text visible in the PNG; remove | error banner works |

Anything all-black: read the banner; if none, raise the budget to 8000 ms and check the module path (`./three.module.js`, case-sensitive on the Python server).

## 15. Gotchas (each already handled above)

- Mouth interior visible in the corners → saturating profile + `Y_EXT = 1.6` + `R_MAX ≤ 1.30`; re-check `Y_EXT·D/(D+R_MAX) > 1` whenever D, SIGMA, Y_EXT or the R_MAX cap change (a cosh/trumpet profile fails this).
- Ring pop → integer `SPAN/RING_DY`, wrap at |y| = 1.6 off-screen, `uScroll` wrapped in JS doubles.
- Float drift at large t → only `uCycle` and `uScroll` (both small, wrapped in doubles) reach the GPU; JS `%` wrapped with `((x % m) + m) % m`.
- Lines vanish / flicker on the surface → impossible: lines are painted in the body's own fragment shader (no second surface). Do not add `LineSegments` on the surface.
- White blow-out at the silhouette → `LINE_MAX_COVER` fade in `lineMask`.
- Particles seen through the body → body opaque + depthWrite; points/underlay depthTest on, depthWrite off; explicit `renderOrder 0/1/2`.
- Particles cutting through the waist → cylindrical interpolation; y settles at u = 0.6 before the outward blend starts; `rEnd ≥ Z_L ≥ r(ty) + 0.10`.
- Distorted logo from a clamp at u = 1 → no smooth-max on ρ; the only clamp (`radius(y)+0.04`) is 0.06 below the guaranteed clearance; `if (u >= 1.0) p = T` makes the hold bit-exact.
- Entry not visible on phones → spawn band |y| ≤ 0.6 (funnel narrower than the phone there); `rEntry = max(1.15·A, r(ySpawn)+m+0.3)` is off-screen in every aspect.
- Nothing renders → `frustumCulled = false` on all objects; every geometry has a `position` attribute.
- Point size wrong on HiDPI → custom ShaderMaterial gets no automatic DPR; `uHalfHeightPx` is taken from the drawing buffer (DPR included); clamp [1, 48] px.
- Ghost pixels from dead particles → clipped `gl_Position` **and** `discard` for `a < 0.01`.
- Font race → `fonts.load` + `check` + width comparison + 3 s timeout + visible warning; sample only after the promise; family string `"Anton"` exactly as in `@font-face`.
- Period missing / off-centre logo → literal `'HSRG.'`; ink box from pixels includes the period; centre on the ink box like `logo-old.png`.
- Premultiplied fringe on the underlay → white-on-black raster as `alphaMap`, `color: 0xffffff`.
- `smoothstep(e0 > e1)` is undefined in GLSL → always ascending edges (all uses above comply).
- `atan(x, z)` seam → at the back, hidden; `atan(tx, uZL)` for `thetaEnd` has `uZL > 0` so no branch cut across `tx = 0`.
- Canvas sizing → `setSize(w, h, false)`, `clientWidth/Height`, CSS `100%`.
- Colour management → NoToneMapping; pure black/white unaffected by r160's sRGB output; ShaderMaterial output is written as-is.
- Screenshot flakiness → budget ≥ 6000 ms, `pause=1` always, banner installed before any `await`.
