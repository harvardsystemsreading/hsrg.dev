// HSRG background: a wormhole-like funnel drawn as a 3-D coordinate grid (white lines on
// black), with particles that stream in from the right, orbit behind the funnel and settle
// in front of its waist as the "HSRG." wordmark. Everything is a pure function of elapsed
// time t (seconds): renderAt(t) produces the same pixels for the same t, and the whole
// picture repeats every CONFIG.T_CYCLE seconds.
//
// Layout:  §0 types   §1 CONFIG   §2 banner/helpers   §3 shaders   §4 scene build   §5 time + resize
// Spec:    docs/background-spec.md (requirements R1-R11).

import * as THREE from 'three';
import { sampleLogo, mulberry32, type LogoSample } from './logoSampler';

// ───────────────────────────────────────────────────────────────────────────── §0 types
export interface BackgroundOptions {
  canvas: HTMLCanvasElement | null;
  headless?: boolean;       // show the error banner; render as soon as assets are ready
  seekSeconds?: number | null;   // clock value of the first rendered frame
  paused?: boolean;         // render that frame only, do not advance
}

/** Layout numbers, exposed for the headless ?stats=1 overlay and `canvas.dataset.stats`. */
export interface BackgroundStats {
  n?: number; wInk?: number; hInk?: number; ratio?: number; stride?: number; fontOk?: boolean; webgl2?: boolean;
  w?: number; h?: number; dpr?: number; A?: number; rMax?: number; rMin?: number; zL?: number; logoW?: number; logoPx?: number;
  phiCutDeg?: number; merDropped?: number;
}

export interface BackgroundApi {
  seek: (t: number) => void;
  pause: () => void;
  play: () => void;
  time: () => number;
  render: () => void;
  info: () => THREE.WebGLInfo['render'] | undefined;
  ready: Promise<BackgroundApi>;
  config: typeof CONFIG;
  stats: BackgroundStats | null;
}

type Ramp = readonly [number, number];   // [start, end] in cycle seconds
type Uniforms = Record<string, THREE.IUniform>;
type Banner = (message: string, color?: string) => void;

declare global {
  interface Window { __hsrgBg?: BackgroundApi }
}

// ───────────────────────────────────────────────────────────────────────────── §1 CONFIG
export const CONFIG = {
  // camera / world (world unit = half viewport height at z = 0)
  D: 3.2,                 // camera distance; vertical fov = 2*atan(1/D) = 34.71 deg
  NEAR: 0.5, FAR: 12,
  // funnel profile  r(y) = R_MIN + (R_MAX - R_MIN) * (1 - exp(-(y/SIGMA)^2))
  SIGMA: 0.55,
  Y_EXT: 1.6,             // mesh spans y in [-Y_EXT, Y_EXT]; keep Y_EXT*D/(D+R_MAX) > 1
  RMAX_K: 0.80, RMAX_LO: 0.55, RMAX_HI: 1.30,   // R_MAX = clamp(RMAX_K*aspect, LO, HI)
  RMIN_K: 0.22, RMIN_LO: 0.14, RMIN_HI: 0.30,   // R_MIN = clamp(RMIN_K*R_MAX, LO, HI)
  // body mesh
  NY: 160, NTH: 192,      // rows in y, columns around the axis
  // grid lines (painted in the body's fragment shader)
  RING_DY: 0.08,          // ring spacing in y; 2*Y_EXT/RING_DY must be an integer
  RING_SPEED: 0.04,       // world units per second, downward (one ring pitch per 2 s); RING_SPEED*T_CYCLE/RING_DY must be an integer (0.04*60/0.08 = 30)
  MERIDIANS: 32,          // even; half-step offset (those hugging the perspective limb are dropped by MERIDIAN_MIN_PX)
  LINE_PX: 1.25,          // line width in CSS px (device px = LINE_PX * dpr)
  LINE_MAX_COVER: 0.5,    // rings vanish once they would cover > 50 % of a cell (fade from 25 %): no grey smear where they pile up at the limb
  SIL_PX: 1.25,           // explicit anti-aliased silhouette stroke, CSS px (0 = off)
  MERIDIAN_MIN_PX: 6.5,   // a meridian whose visible run comes closer than this (CSS px, perpendicular) to the silhouette ANYWHERE is dropped over its whole length (decided per meridian in JS, see meridianCut)
  MERIDIAN_BAND: 0.1,     // fade band around the cut azimuth, fraction of the meridian spacing: a resize slides a meridian in/out instead of popping it
  GHOST_ALPHA: 0.0,       // 0 = off; 0.12..0.2 draws the far-side grid faintly through the body
  // logo
  LOGO_TEXT: 'HSRG.', FONT_FAMILY: 'Anton', FONT_PX: 400, SAMPLE_W: 1600, SAMPLE_H: 640,
  LOGO_ROUND_PERIOD: true, // draw the period as a circle (the reference logo's dot is round; Anton's glyph is square)
  LOGO_FRAC_W: 0.86,      // max fraction of the viewport width at the logo plane
  LOGO_W_MAX: 1.15,       // max logo width in world units
  LOGO_CLEAR: 0.10,       // gap between the body and the logo plane at the letters' top/bottom
  N_TARGET: 6000,         // target particle count (actual = sampled count)
  JITTER: 0.35,           // sample jitter in grid steps
  DOT_OVERLAP: 1.35,      // dot diameter / sample stride
  UNDERLAY_MAX: 1.0,      // keep at 1.0: the dots only recede while the underlay is fully in (see DOTS_RECEDE)
  // hold choreography (cycle seconds). Sequenced, never overlapped: the underlay is fully in BEFORE
  // the dots recede, and the dots are fully back BEFORE the underlay fades, so the letters' coverage
  // never dips below the dots-only level mid-crossfade (asserted in assertConfig).
  UNDERLAY_IN: [12.5, 13.0] as Ramp, DOTS_RECEDE: [13.0, 13.4] as Ramp, DOTS_RETURN: [56.9, 57.3] as Ramp, UNDERLAY_OUT: [57.3, 57.8] as Ramp,
  HOLD_DOT_ALPHA: 0.05,   // dot alpha while receded (crisp underlay owns the edges; low enough that edge dots leave no speckled fringe)
  HOLD_DOT_SIZE: 0.6,     // dot size factor while receded
  // particle cycle (seconds)
  T_CYCLE: 60,            // whole-animation period: ~13 s of streaming + formation, then the logo holds until the release at R0
  T_STREAM: 6.2,          // spawn window length: spawn times s in [-SPAWN_LEAD, T_STREAM - SPAWN_LEAD)
  SPAWN_LEAD: 1.1,        // the next stream enters this long before the cycle wraps, while the previous logo is still letting go (R11)
  F: 6.1,                 // flight duration per particle (mean); last arrival = T_STREAM - SPAWN_LEAD + F*(1+F_VAR) = 11.9 s
  F_VAR: 0.12,            // per-particle flight duration F * (1 +- F_VAR): the stream disperses along the path instead of travelling as one wall
  R0: 57.8, D_MAX: 0.9, R_DUR: 2.2,   // release window; each particle's release lasts R_DUR - D_MAX
  REL_ORDER: 0.7,         // release delay d = D_MAX * mix(q_d, spawn order, REL_ORDER): the logo lets go roughly in the order it formed
  REL_FADE: [0.1, 0.6] as Ramp,   // release progress over which a particle's alpha goes to 0 (its motion continues, unseen)
  REL_PULL: 0.7,          // release: fraction of the way toward the throat's centre (0, 0, zL) a particle has travelled at rho = 1 (x 0.7..1.3 per particle)
  ANG_IN: 0.2, ANG_OUT: 0.15,  // angular progress g(u): trapezoid speed profile, ramps up over the first ANG_IN and down over the last ANG_OUT of the flight, cruises between
  CLEAR_MIN: 0.10, CLEAR_RAND: 0.25,  // orbit clearance from the surface: CLEAR_MIN + CLEAR_RAND * q * min(1, aspect / CLEAR_ASPECT)
  CLEAR_ASPECT: 1.6,      // on narrower viewports the random clearance shrinks so the left pass stays on screen
  ENTRY_FACTOR: 1.02, ENTRY_MARGIN: 0.15, ENTRY_U: 0.45,  // spawn just outside the right edge; radial approach done by u = ENTRY_U
  Y_U: 0.45,              // y blend from ySpawn to the target done by u = Y_U (while hidden behind the body)
  OUT_U: 0.5,             // outward radial blend from the orbit to the logo plane starts at u = OUT_U (>= ENTRY_U, Y_U): particles leave the limb as soon as they emerge
  Y_SPREAD: 0.45, Y_SPAWN_MAX: 0.6,
  ENTRY_ALPHA: 0.8,       // dot alpha while approaching on the right (sparse: single dots must read)
  FLIGHT_ALPHA: 0.5,      // dot alpha on the front sweep (dense: overlapping dots read as a swarm, never a flat white mass)
  FADE_IN: 0.6,
  POINT_MIN_PX: 1.0, POINT_MAX_PX: 48.0,
  SEED: 0x48535247,       // "HSRG"
  DPR_MAX: 2,
  FONT_TIMEOUT_MS: 3000,
};

const SPAN = 2 * CONFIG.Y_EXT;          // ring pattern wraps after this much scroll (= 40 rings)
const UNDERLAY_PAD = 8;                 // raster px of black around the underlay crop

// ─────────────────────────────────────────────────────────────────── §2 helpers / banner
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const mod = (x: number, m: number) => ((x % m) + m) % m;
const smoothstep = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const glslFloat = (x: number) => { const s = String(x); return /[.eE]/.test(s) ? s : `${s}.0`; };

/** Funnel radius at height y (JS twin of the GLSL radius()). */
function radiusAt(y: number, rMin: number, rMax: number): number {
  const q = y / CONFIG.SIGMA;
  return rMin + (rMax - rMin) * (1 - Math.exp(-q * q));
}
/** dr/dy (JS twin of the GLSL dradius()). */
function dradiusAt(y: number, rMin: number, rMax: number): number {
  const q = y / CONFIG.SIGMA;
  return (rMax - rMin) * Math.exp(-q * q) * 2 * q / CONFIG.SIGMA;
}

/**
 * Meridian cut azimuth (radians). Every surface curve meets the visual contour tangentially, so a
 * meridian running near the perspective limb hugs the silhouette stroke as a second, ghost line;
 * and any per-fragment cut of such a meridian ends it with a stub somewhere on the surface. So
 * visibility is decided per WHOLE meridian here, once per layout: for each meridian on the near
 * side the smallest on-screen distance (CSS px, perpendicular) to the silhouette anywhere along its
 * visible run is computed; the distance shrinks monotonically toward the limb, so the meridians to
 * drop are the contiguous band |phi| > phiCut. phiCut is interpolated between the last kept and the
 * first dropped meridian (by their distances) and the shader fades over MERIDIAN_BAND around it,
 * so a resize slides a meridian in or out over ~1 px of distance instead of popping it.
 */
function meridianCut(rMin: number, rMax: number, aspect: number, halfHeightPx: number) {
  const { D, MERIDIANS: M, Y_EXT, MERIDIAN_MIN_PX: MIN } = CONFIG;
  const spacing = 2 * Math.PI / M;
  // silhouette on screen, tabulated over world y: limb azimuth cos(phiL) = (r - y r') / D
  const N = 400, silX = new Float64Array(N + 1), silY = new Float64Array(N + 1);
  for (let i = 0; i <= N; i++) {
    const y = -Y_EXT + 2 * Y_EXT * i / N;
    const r = radiusAt(y, rMin, rMax), dr = dradiusAt(y, rMin, rMax);
    const cosL = clamp((r - y * dr) / D, -1, 1), sinL = Math.sqrt(1 - cosL * cosL);
    const f = D / (D - r * cosL);
    silX[i] = r * sinL * f; silY[i] = y * f;               // silY is monotone in y for this profile
  }
  const silAt = (ys: number) => {                                   // silhouette x and dx/dy at screen height ys
    let lo = 0, hi = N;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (silY[mid]! <= ys) lo = mid; else hi = mid; }
    const dy = silY[hi]! - silY[lo]!, dx = silX[hi]! - silX[lo]!;
    return { x: silX[lo]! + dx * (ys - silY[lo]!) / dy, slope: dx / dy };
  };
  const NS = 320, minDist = new Float64Array(M / 2).fill(Infinity);
  for (let k = 1; k <= M / 2; k++) {                       // phi_k = (k - 0.5) * spacing, right side
    const phi = (k - 0.5) * spacing, s = Math.sin(phi), c = Math.cos(phi);
    for (let i = 0; i <= NS; i++) {
      const y = -Y_EXT + 2 * Y_EXT * i / NS;
      const r = radiusAt(y, rMin, rMax), dr = dradiusAt(y, rMin, rMax);
      if (-r + y * dr + D * c <= 0) continue;               // back-facing: hidden by the near wall
      const f = D / (D - r * c), xs = r * s * f, ys = y * f;
      if (Math.abs(ys) > 1 || xs > aspect) continue;        // off-screen
      const sil = silAt(ys);
      const d = (sil.x - xs) / Math.sqrt(1 + sil.slope * sil.slope) * halfHeightPx;
      if (d < minDist[k - 1]!) minDist[k - 1] = d;
    }
  }
  let phiCut = Math.PI, dropped = 0;                        // default: nothing dropped
  for (let j = 0; j < M / 2; j++) {
    if (minDist[j]! >= MIN) continue;
    dropped = minDist.filter((d) => Number.isFinite(d) && d < MIN).length;   // visible meridians removed, per side
    if (j === 0) { phiCut = 0; break; }
    const prev = minDist[j - 1]!;
    const t = clamp((prev - MIN) / (prev - minDist[j]!), 0, 1);
    phiCut = j * spacing + t * spacing;                     // between phi_{j-1} = (j - 0.5) sp and phi_j
    phiCut -= 0.5 * spacing;
    break;
  }
  return { phiCut, dropped, minDist };
}

/**
 * Error banner: console.error always; a fixed DOM panel when headless so failures show
 * up in screenshots. Installed before anything else can throw.
 */
function installBanner(headless: boolean): Banner {
  const show: Banner = (message, color) => {
    if (color === undefined) console.error(message); else console.warn(message);
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
    line.style.color = color || '#f33';
    line.textContent = String(message);
    el.appendChild(line);
  };
  window.addEventListener('error', (e: ErrorEvent) => {
    const stack = e.error instanceof Error && e.error.stack ? `\n${e.error.stack}` : '';
    show(`[error] ${e.message} (${e.filename}:${e.lineno})${stack}`);
  });
  window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
    const r: unknown = e.reason;
    show(`[unhandledrejection] ${r instanceof Error && r.stack ? r.stack : r}`);
  });
  return show;
}

function assertConfig() {
  const C = CONFIG;
  const must = (ok: boolean, what: string) => { if (!ok) throw new Error(`CONFIG invariant failed: ${what}`); };
  must(Number.isInteger(Math.round((2 * C.Y_EXT / C.RING_DY) * 1e6) / 1e6), '2*Y_EXT/RING_DY integer');
  must(C.MERIDIANS % 2 === 0, 'MERIDIANS even');
  must(C.SPAWN_LEAD >= 0 && C.SPAWN_LEAD < C.T_STREAM, '0 <= SPAWN_LEAD < T_STREAM');
  must(C.F_VAR >= 0 && C.F_VAR < 0.5, '0 <= F_VAR < 0.5');
  must(C.T_STREAM - C.SPAWN_LEAD + C.F * (1 + C.F_VAR) <= C.R0, 'T_STREAM - SPAWN_LEAD + F*(1+F_VAR) <= R0');
  must(C.REL_ORDER >= 0 && C.REL_ORDER <= 1 && C.D_MAX <= C.T_STREAM, '0 <= REL_ORDER <= 1, D_MAX <= T_STREAM');
  // A particle must be invisible (release alpha gone) before it respawns for the next cycle; the earliest
  // spawner with the largest random share of its release delay is the binding case.
  must(C.R0 + C.D_MAX * (1 - C.REL_ORDER) + C.REL_FADE[1] * (C.R_DUR - C.D_MAX) <= C.T_CYCLE - C.SPAWN_LEAD,
    'R0 + D_MAX*(1-REL_ORDER) + REL_FADE[1]*(R_DUR-D_MAX) <= T_CYCLE - SPAWN_LEAD (released before respawn)');
  must(C.R0 + C.R_DUR <= C.T_CYCLE, 'R0 + R_DUR <= T_CYCLE');
  must(C.D_MAX < C.R_DUR, 'D_MAX < R_DUR');
  must(Number.isInteger(Math.round((C.RING_SPEED * C.T_CYCLE / C.RING_DY) * 1e6) / 1e6), 'RING_SPEED*T_CYCLE/RING_DY integer (ring phase continuous across the cycle wrap)');
  must(C.Y_EXT * C.D / (C.D + C.RMAX_HI) > 1, 'mouth rim off-screen: Y_EXT*D/(D+RMAX_HI) > 1');
  must(C.ENTRY_U <= C.OUT_U && C.Y_U <= C.OUT_U && C.OUT_U < 1, 'ENTRY_U, Y_U <= OUT_U < 1 (approach and y blend finish before the outward blend starts)');
  must(C.ANG_IN > 0 && C.ANG_OUT > 0 && C.ANG_IN + C.ANG_OUT < 1, '0 < ANG_IN, ANG_OUT, ANG_IN + ANG_OUT < 1');
  must(C.REL_PULL * 1.3 < 1, 'REL_PULL * 1.3 < 1 (released dots never cross the axis)');
  must(C.MERIDIAN_BAND > 0 && C.MERIDIAN_BAND <= 0.5, '0 < MERIDIAN_BAND <= 0.5');
  // hold choreography is strictly sequenced (see CONFIG): every particle has arrived, underlay in,
  // dots recede, dots return, underlay out, release.
  const seq: [string, number][] = [['T_STREAM - SPAWN_LEAD + F*(1+F_VAR)', C.T_STREAM - C.SPAWN_LEAD + C.F * (1 + C.F_VAR)], ['UNDERLAY_IN[0]', C.UNDERLAY_IN[0]], ['UNDERLAY_IN[1]', C.UNDERLAY_IN[1]],
    ['DOTS_RECEDE[0]', C.DOTS_RECEDE[0]], ['DOTS_RECEDE[1]', C.DOTS_RECEDE[1]], ['DOTS_RETURN[0]', C.DOTS_RETURN[0]],
    ['DOTS_RETURN[1]', C.DOTS_RETURN[1]], ['UNDERLAY_OUT[0]', C.UNDERLAY_OUT[0]], ['UNDERLAY_OUT[1]', C.UNDERLAY_OUT[1]], ['R0', C.R0]];
  for (let i = 1; i < seq.length; i++) must(seq[i - 1]![1] <= seq[i]![1], `${seq[i - 1]![0]} <= ${seq[i]![0]}`);
}

// ─────────────────────────────────────────────────────────────────────────── §3 shaders
const RADIUS_GLSL = /* glsl */`
uniform float uRmin, uRmax, uSigma;
float radius(float y) { float q = y / uSigma; return uRmin + (uRmax - uRmin) * (1.0 - exp(-q * q)); }
float dradius(float y) { float q = y / uSigma; return (uRmax - uRmin) * exp(-q * q) * 2.0 * q / uSigma; }
`;

// Body: the position attribute carries (theta, y, 0); the surface is evaluated here so a
// resize only touches uniforms.
const BODY_VERT = /* glsl */`
${RADIUS_GLSL}
varying vec3 vWorld;
varying float vY;
varying float vFacing;                        // dot(outward normal, view dir): 0 on the silhouette
void main() {
  float th = position.x, y = position.y;
  float r = radius(y);
  vec3 p = vec3(r * cos(th), y, -r * sin(th));
  vec3 n = normalize(vec3(cos(th), -dradius(y), -sin(th)));   // outward normal of the surface of revolution
  vFacing = dot(n, normalize(cameraPosition - p));
  vWorld = p; vY = y;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

// Grid lines are painted procedurally: rings at every RING_DY in y (scrolling with uScroll),
// meridians at every 2*PI/MERIDIANS in azimuth (fixed). Anti-aliased, constant pixel width.
const BODY_FRAG = /* glsl */`
${RADIUS_GLSL}
uniform float uYext, uRingDY, uScroll, uMeridians, uLinePx, uLineMaxCover, uSilPx, uPhiCut, uPhiBand, uBodyGrey, uGhostAlpha;
uniform vec2 uLineOn;                            // debug (?lines=rings|meridians): (rings, meridians) 0/1
varying vec3 vWorld;
varying float vY;
varying float vFacing;
const float PI = 3.14159265358979;
const float CAM_D = ${glslFloat(CONFIG.D)};
float lineMask(float c, float px) {              // c has a line at every integer
  float d = fwidth(c);                            // coordinate change per device pixel
  float w = d * px * 0.5;                         // half line width in coordinate units
  float l = abs(fract(c - 0.5) - 0.5);            // distance to the nearest integer
  float a = 1.0 - smoothstep(w, w + d, l);        // px-wide line with a 1-px AA ramp
  // grazing angles: lines that would cover more than uLineMaxCover of a cell vanish (fade from half
  // that) instead of merging into a grey band along the silhouette
  return a * (1.0 - smoothstep(0.5 * uLineMaxCover, uLineMaxCover, d * px));
}
void main() {
  float cr = (vY + uScroll) / uRingDY;                                   // rings: y = k*DY - uScroll (down)
  float phi = atan(vWorld.x, vWorld.z);                                  // azimuth from the front, right side > 0
  float cm = (phi + PI / uMeridians) * (uMeridians / (2.0 * PI));
  // Meridian visibility is decided per WHOLE meridian (meridianCut() in JS, once per layout): the band of
  // meridians hugging the perspective limb, |phi| > uPhiCut, is absent over its full length; every other
  // meridian is drawn over its full length. Nothing starts or ends mid-surface, and the silhouette stroke
  // is the only line at the limb.
  float k = floor(cm + 0.5);
  float phiK = abs((k - 0.5) * (2.0 * PI / uMeridians));               // azimuth of the nearest meridian
  float merVis = 1.0 - smoothstep(uPhiCut - uPhiBand, uPhiCut + uPhiBand, phiK);
  float g = max(lineMask(cr, uLinePx) * uLineOn.x, lineMask(cm, uLinePx) * merVis * uLineOn.y);
  // silhouette: one explicit anti-aliased stroke at the limb. The view-facing factor f grows like
  // sqrt(distance) near the limb, so 0.5 * f / fwidth(f) is that distance in device px to first order.
  float f = abs(vFacing);
  float dpx = 0.5 * f / max(fwidth(vFacing), 1e-6);
  g = max(g, (1.0 - smoothstep(uSilPx, uSilPx + 1.0, dpx)) * step(0.01, uSilPx));
  #ifdef GHOST
    gl_FragColor = vec4(1.0, 1.0, 1.0, g * uGhostAlpha);
  #else
    gl_FragColor = vec4(vec3(max(g, uBodyGrey)), 1.0);                  // opaque black body, white lines
  #endif
}
`;

// Particles: all motion in the vertex shader from uCycle (t mod T_CYCLE). Cylindrical
// interpolation (rho, theta, y) keeps every path outside the body; the hold pose is exact.
function particleVert(): string {
  const C = CONFIG;
  const consts = ([
    ['T_CYCLE', C.T_CYCLE], ['T_STREAM', C.T_STREAM], ['SPAWN_LEAD', C.SPAWN_LEAD], ['F', C.F], ['R0', C.R0], ['D_MAX', C.D_MAX], ['R_DUR', C.R_DUR],
    ['REL_ORDER', C.REL_ORDER], ['REL_FADE0', C.REL_FADE[0]], ['REL_FADE1', C.REL_FADE[1]], ['REL_PULL', C.REL_PULL], ['F_VAR', C.F_VAR],
    ['ANG_IN', C.ANG_IN], ['ANG_OUT', C.ANG_OUT], ['CLEAR_MIN', C.CLEAR_MIN], ['CLEAR_RAND', C.CLEAR_RAND], ['CLEAR_ASPECT', C.CLEAR_ASPECT],
    ['ENTRY_FACTOR', C.ENTRY_FACTOR], ['ENTRY_MARGIN', C.ENTRY_MARGIN], ['ENTRY_U', C.ENTRY_U], ['Y_U', C.Y_U], ['OUT_U', C.OUT_U],
    ['Y_SPREAD', C.Y_SPREAD], ['Y_SPAWN_MAX', C.Y_SPAWN_MAX],
    ['ENTRY_ALPHA', C.ENTRY_ALPHA], ['FLIGHT_ALPHA', C.FLIGHT_ALPHA], ['FADE_IN', C.FADE_IN], ['CAM_D', C.D],
    ['POINT_MIN_PX', C.POINT_MIN_PX], ['POINT_MAX_PX', C.POINT_MAX_PX],
    ['HOLD_DOT_ALPHA', C.HOLD_DOT_ALPHA], ['HOLD_DOT_SIZE', C.HOLD_DOT_SIZE],
  ] as [string, number][]).map(([k, v]) => `const float ${k} = ${glslFloat(v)};`).join('\n');
  return /* glsl */`
${RADIUS_GLSL}
${consts}
const float PI = 3.14159265358979;
attribute vec4 aRand;                       // (q_m, q_y, q_sz, q_d) in [0,1)
attribute vec2 aRand2;                      // (q_f, q_r): flight-duration and release-pull variation
uniform float uCycle, uAspect, uLogoW, uZL, uHalfHeightPx, uDotWorld, uRecede;
varying float vAlpha;
// Angular progress: trapezoid speed profile (ramp up over a, cruise, ramp down over b), normalised so
// g(1) = 1. The sweep across the front keeps its pace until the last b of the flight, so the stream
// never stalls beside the left limb.
float trapezoid(float u, float a, float b) {
  float s = (u < a) ? 0.5 * u * u / a
          : (u < 1.0 - b) ? u - 0.5 * a
          : 1.0 - 0.5 * a - 0.5 * b - 0.5 * (1.0 - u) * (1.0 - u) / b;
  return s / (1.0 - 0.5 * a - 0.5 * b);
}
void main() {
  float tx = position.x * uLogoW, ty = position.y * uLogoW, s = position.z;   // target + spawn time
  float m      = CLEAR_MIN + CLEAR_RAND * aRand.x * min(1.0, uAspect / CLEAR_ASPECT);  // orbit clearance (tighter on narrow screens)
  float ySpawn = clamp(ty + Y_SPREAD * (2.0 * aRand.y - 1.0), -Y_SPAWN_MAX, Y_SPAWN_MAX);
  float sNorm  = (s + SPAWN_LEAD) / T_STREAM;                                  // spawn order in [0,1)
  float d      = D_MAX * mix(aRand.w, sNorm, REL_ORDER);                       // release delay
  float Fi     = F * (1.0 + F_VAR * (2.0 * aRand2.x - 1.0));                   // this particle's flight duration

  float tau = uCycle - s; tau -= T_CYCLE * floor(tau / T_CYCLE);               // particle-local time in [0, T_CYCLE)
  float u   = clamp(tau / Fi, 0.0, 1.0);                                       // flight progress
  float rho = clamp((tau - (R0 - s) - d) / (R_DUR - D_MAX), 0.0, 1.0);         // release progress

  // flight: right (0) -> behind (90) -> left (180) -> front (~270), ends exactly on the target.
  float g        = trapezoid(u, ANG_IN, ANG_OUT);
  float thetaEnd = 1.5 * PI + atan(tx, uZL);
  float th       = thetaEnd * g;
  float y        = mix(ySpawn, ty, smoothstep(0.05, Y_U, u));                  // y settles while hidden behind the body
  float rOrbit   = radius(y) + m;
  float rEntry   = max(ENTRY_FACTOR * uAspect, radius(ySpawn) + m + ENTRY_MARGIN);   // just outside the right edge
  float rEnd     = sqrt(tx * tx + uZL * uZL);
  // radial: approach from the right edge to the orbit by ENTRY_U, then out from the orbit to the logo plane
  // from OUT_U (as soon as the particle emerges on the left) so it leaves the limb instead of hovering there
  float R = rOrbit + (rEntry - rOrbit) * (1.0 - smoothstep(0.0, ENTRY_U, u))
                   + (rEnd   - rOrbit) * smoothstep(OUT_U, 1.0, u);
  R = max(R, radius(y) + 0.04);
  vec3 p = vec3(R * cos(th), y, -R * sin(th));
  if (u >= 1.0) p = vec3(tx, ty, uZL);                                         // hold: bit-exact target

  // alpha: ENTRY_ALPHA on the sparse right-hand approach, FLIGHT_ALPHA on the dense front sweep (the switch
  // happens while the particle is hidden), 1.0 as it settles on the target
  float alpha = mix(mix(ENTRY_ALPHA, FLIGHT_ALPHA, smoothstep(0.35, 0.5, u)), 1.0, smoothstep(0.85, 1.0, u)) * smoothstep(0.0, FADE_IN, tau);
  // hold: once the crisp underlay is fully in (uRecede ramps only then), dots recede so the letter edges stay sharp
  float held = uRecede * step(1.0, u);
  alpha *= mix(1.0, HOLD_DOT_ALPHA, held);

  // release: drawn toward the throat's centre (0, 0, zL) within the logo plane and dissolved on the way.
  // Every point of that path has cylindrical radius >= zL > r(y) (|y| only shrinks), i.e. it stays in front
  // of the wall, so alpha reaches 0 long before a dot could be depth-culled: no per-dot pop.
  float rr = rho * rho;
  p.xy *= 1.0 - REL_PULL * (0.7 + 0.6 * aRand2.y) * rr;
  alpha *= 1.0 - smoothstep(REL_FADE0, REL_FADE1, rho);

  float sz = mix(uDotWorld * (0.7 + 0.5 * aRand.z), uDotWorld, smoothstep(0.8, 1.0, u)) * (1.0 - 0.5 * rho) * mix(1.0, HOLD_DOT_SIZE, held);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position  = projectionMatrix * mv;
  gl_PointSize = clamp(sz * uHalfHeightPx * CAM_D / max(-mv.z, 1e-3), POINT_MIN_PX, POINT_MAX_PX);
  vAlpha = alpha;
  if (rho >= 1.0 || alpha <= 0.001) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); gl_PointSize = 0.0; vAlpha = 0.0; }
}
`;
}

const PARTICLE_FRAG = /* glsl */`
varying float vAlpha;
void main() {
  float a = (1.0 - smoothstep(0.32, 0.5, length(gl_PointCoord - 0.5))) * vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(1.0, 1.0, 1.0, a);
}
`;

// ──────────────────────────────────────────────────────────────────────── §4 scene build
/** Parametric grid over (theta, y); the position attribute stores the parameters. */
function buildBodyGeometry(): THREE.BufferGeometry {
  const { NY, NTH, Y_EXT } = CONFIG;
  const cols = NTH + 1, rows = NY + 1;                  // closed in theta: last column = first
  const pos = new Float32Array(rows * cols * 3);
  let k = 0;
  for (let i = 0; i < rows; i++) {
    const y = -Y_EXT + (2 * Y_EXT * i) / NY;
    for (let j = 0; j < cols; j++) {
      pos[k++] = Math.PI / 2 + (2 * Math.PI * j) / NTH; // seam at the back (theta = 90 deg)
      pos[k++] = y;
      pos[k++] = 0;
    }
  }
  if (rows * cols > 65535) throw new Error('body vertex count exceeds Uint16 indices');
  const idx = new Uint16Array(NY * NTH * 6);
  k = 0;
  for (let i = 0; i < NY; i++) {
    for (let j = 0; j < NTH; j++) {
      const a = i * cols + j, b = a + 1, c = a + cols, d = c + 1;   // CCW seen from outside (front faces)
      idx[k++] = a; idx[k++] = b; idx[k++] = c;
      idx[k++] = b; idx[k++] = d; idx[k++] = c;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 4);
  return geo;
}

/** One point per logo sample: position = (x_n, y_n, spawnTime), aRand + aRand2 = 6 seeded randoms. */
function buildParticleGeometry(logo: LogoSample, rand: () => number): THREE.BufferGeometry {
  const { n, samples } = logo;
  const pos = new Float32Array(n * 3);
  const rnd = new Float32Array(n * 4);
  const rnd2 = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const qm = rand(), qy = rand(), qsz = rand(), qd = rand(), qs = rand(), qf = rand(), qr = rand();
    pos[i * 3] = samples[i * 2]!;
    pos[i * 3 + 1] = samples[i * 2 + 1]!;
    pos[i * 3 + 2] = -CONFIG.SPAWN_LEAD + CONFIG.T_STREAM * clamp(0.7 * i / n + 0.3 * qs, 0, 0.999);  // left -> right, 30 % scatter
    rnd[i * 4] = qm; rnd[i * 4 + 1] = qy; rnd[i * 4 + 2] = qsz; rnd[i * 4 + 3] = qd;
    rnd2[i * 2] = qf; rnd2[i * 2 + 1] = qr;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aRand', new THREE.BufferAttribute(rnd, 4));
  geo.setAttribute('aRand2', new THREE.BufferAttribute(rnd2, 2));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 4);
  return geo;
}

// ────────────────────────────────────────────────────────────────── §5 startBackground
/** Boots the background on `canvas`. Options (from src/main.ts): see BackgroundOptions. */
export function startBackground(opts: BackgroundOptions): BackgroundApi {
  const { canvas, headless = false } = opts;
  const show = installBanner(headless);
  const params = new URLSearchParams(location.search);
  const debugBody = params.get('debugBody') === '1';
  const debugLines = params.get('lines');   // 'rings' | 'meridians' | null (both)
  const showStats = headless && params.get('stats') === '1';   // overlay layout numbers in screenshots
  const C = CONFIG;

  // ── clock (a pure function of wall time; nothing accumulates)
  let base = typeof opts.seekSeconds === 'number' && Number.isFinite(opts.seekSeconds) ? Math.max(0, opts.seekSeconds) : 0;
  let stamp = performance.now();
  let playing = !opts.paused;
  let ready = false;
  const time = () => (playing ? base + (performance.now() - stamp) / 1000 : base);

  let renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera, scene: THREE.Scene;
  let body: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>, ghost: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  let points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>, underlay: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  let logo: LogoSample;
  const U: Uniforms = {};           // shared uniforms (same {value} objects in every material)
  let readyResolve!: (api: BackgroundApi) => void, readyReject!: (err: unknown) => void;
  const readyPromise = new Promise<BackgroundApi>((res, rej) => { readyResolve = res; readyReject = rej; });
  readyPromise.catch(() => {});   // init failures are reported by the banner; no unhandled-rejection duplicate
  const api: BackgroundApi = { seek, pause, play, time, render: () => renderAt(time()), info: () => renderer && renderer.info.render, ready: readyPromise, config: C, stats: null };
  window.__hsrgBg = api;

  function renderAt(t: number) {
    if (!ready) return;
    const c = mod(t, C.T_CYCLE);                       // everything below depends on c only,
    U.uCycle!.value = c;                               //   so frames at t and t + T_CYCLE are bit-identical
    U.uScroll!.value = mod(C.RING_SPEED * c, SPAN);    // ring phase is continuous at the wrap (see assertConfig)
    const ramp = (r: Ramp) => smoothstep(r[0], r[1], c);
    const o = C.UNDERLAY_MAX * ramp(C.UNDERLAY_IN) * (1 - ramp(C.UNDERLAY_OUT));   // crisp underlay opacity
    U.uRecede!.value = ramp(C.DOTS_RECEDE) * (1 - ramp(C.DOTS_RETURN));           // dots recede only while it is fully in
    underlay.material.opacity = o;
    underlay.visible = o > 0.001;
    renderer.render(scene, camera);
    if (showStats) updateStatsOverlay();
  }
  function seek(t: number) { base = Math.max(0, +t || 0); stamp = performance.now(); renderAt(base); }
  function pause() { base = time(); playing = false; if (renderer) renderer.setAnimationLoop(null); }
  function play() {
    base = time(); stamp = performance.now(); playing = true;
    if (renderer && ready) renderer.setAnimationLoop(() => renderAt(time()));
  }

  // ── layout: everything that depends on the viewport, uniforms only (no geometry rebuilt)
  let lastLayout: { w: number; h: number; dpr: number } | null = null;   // {w, h, dpr} last applied; visualViewport fires resize events that change nothing
  function layout(): boolean {
    const canvas = opts.canvas!;
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, C.DPR_MAX);
    if (lastLayout && lastLayout.w === w && lastLayout.h === h && lastLayout.dpr === dpr) return false;
    lastLayout = { w, h, dpr };
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();

    const A = w / h;
    const rMax = clamp(C.RMAX_K * A, C.RMAX_LO, C.RMAX_HI);
    const rMin = clamp(C.RMIN_K * rMax, C.RMIN_LO, C.RMIN_HI);
    if (!(C.Y_EXT * C.D / (C.D + rMax) > 1)) throw new Error('funnel mouth would be visible: Y_EXT*D/(D+R_MAX) <= 1');

    // logo plane: wide as allowed, deep enough to clear the body at the letters' top/bottom edge
    let zL = 0.5, logoW = 0;
    for (let k = 0; k < 4; k++) {
      const aL = A * (C.D - zL) / C.D;
      logoW = Math.min(C.LOGO_FRAC_W * 2 * aL, C.LOGO_W_MAX);
      zL = radiusAt(0.5 * logoW * logo.ratio, rMin, rMax) + C.LOGO_CLEAR;
    }
    const db = renderer.getDrawingBufferSize(new THREE.Vector2());
    U.uAspect!.value = A;
    U.uRmin!.value = rMin; U.uRmax!.value = rMax;
    U.uLogoW!.value = logoW; U.uZL!.value = zL;
    U.uDotWorld!.value = C.DOT_OVERLAP * logo.stride * logoW / logo.wInk;
    U.uLinePx!.value = C.LINE_PX * dpr;
    U.uSilPx!.value = C.SIL_PX * dpr;
    const mer = meridianCut(rMin, rMax, A, h / 2);         // whole-meridian visibility (CSS px criterion)
    U.uPhiCut!.value = mer.phiCut;
    U.uPhiBand!.value = C.MERIDIAN_BAND * 2 * Math.PI / C.MERIDIANS;
    U.uHalfHeightPx!.value = db.y / 2;
    underlay.scale.set(logoW * logo.crop.width / logo.wInk, logoW * logo.crop.height / logo.wInk, 1);
    underlay.position.set(0, 0, zL - 0.002);
    api.stats = Object.assign(api.stats || {}, { w, h, dpr, A, rMax, rMin, zL, logoW, logoPx: logoW * (h / 2) * C.D / (C.D - zL),
      phiCutDeg: mer.phiCut * 180 / Math.PI, merDropped: mer.dropped });
    if (headless) canvas.dataset.stats = JSON.stringify(api.stats);   // readable via --dump-dom
    return true;
  }

  /** Headless-only overlay (?stats=1): layout numbers and per-frame draw stats, visible in screenshots. */
  function updateStatsOverlay() {
    const st = api.stats; if (!st) return;
    let el = document.getElementById('bg-stats');
    if (!el) {
      el = document.createElement('div');
      el.id = 'bg-stats';
      el.style.cssText = 'position:fixed;left:0;bottom:0;z-index:9999;background:rgba(0,0,0,.7);color:#0f0;'
        + 'font:11px/1.3 monospace;padding:4px;white-space:pre-wrap;max-width:100vw;box-sizing:border-box;';
      document.body.appendChild(el);
    }
    const r = renderer.info.render;
    el.textContent = `innerW/H ${window.innerWidth}x${window.innerHeight} client ${st.w}x${st.h} dpr ${st.dpr}\n`
      + `A ${st.A!.toFixed(3)} rMax ${st.rMax!.toFixed(3)} rMin ${st.rMin!.toFixed(3)} zL ${st.zL!.toFixed(3)} logoW ${st.logoW!.toFixed(3)} logoPx ${st.logoPx!.toFixed(0)} phiCut ${st.phiCutDeg!.toFixed(1)} (${st.merDropped}/side dropped)\n`
      + `n ${st.n} ink ${st.wInk}x${st.hInk} ratio ${st.ratio!.toFixed(3)} stride ${st.stride!.toFixed(2)} fontOk ${st.fontOk} webgl2 ${st.webgl2}\n`
      + `t ${time().toFixed(3)} cycle ${(U.uCycle!.value as number).toFixed(3)} scroll ${(U.uScroll!.value as number).toFixed(3)} draw calls ${r.calls} tris ${r.triangles} points ${r.points}`;
  }

  let resizeQueued = false;
  function queueLayout() {
    if (resizeQueued || !ready) return;
    resizeQueued = true;
    requestAnimationFrame(() => { resizeQueued = false; if (layout()) renderAt(time()); });
  }

  async function init() {
    if (!canvas) throw new Error('startBackground: no canvas');
    if (headless && params.get('throw') === '1') throw new Error('banner self-test (?throw=1)');
    assertConfig();
    canvas.addEventListener('webglcontextcreationerror', (e) => show(`[webgl] context creation failed: ${(e as WebGLContextEvent).statusMessage || ''}`));

    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'default' });
    renderer.setClearColor(0x000000, 1);
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.autoClear = true;
    const fovDeg = (2 * Math.atan(1 / C.D) * 180) / Math.PI;
    camera = new THREE.PerspectiveCamera(fovDeg, 1, C.NEAR, C.FAR);
    camera.position.set(0, 0, C.D);
    camera.lookAt(0, 0, 0);
    scene = new THREE.Scene();

    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); renderer.setAnimationLoop(null); });
    canvas.addEventListener('webglcontextrestored', () => { renderAt(time()); if (playing) play(); });

    // Logo raster + samples (the only async step; seeded PRNG so the result never varies).
    const rand = mulberry32(C.SEED);
    logo = await sampleLogo({
      text: C.LOGO_TEXT, family: C.FONT_FAMILY, fontPx: C.FONT_PX, sampleW: C.SAMPLE_W, sampleH: C.SAMPLE_H,
      nTarget: C.N_TARGET, jitter: C.JITTER, timeoutMs: C.FONT_TIMEOUT_MS, rand, cropPad: UNDERLAY_PAD, roundPeriod: C.LOGO_ROUND_PERIOD,
    });
    if (!logo.fontOk) show(`[font] ${C.FONT_FAMILY} not available (${logo.fontReason}); falling back to ${logo.fontUsed}`, '#fd3');
    console.info(`[hsrg-bg] logo ink ${logo.wInk}x${logo.hInk} px (h/w=${logo.ratio.toFixed(3)}), ${logo.n} particles, stride ${logo.stride.toFixed(2)} px, font ok=${logo.fontOk}`);
    api.stats = { n: logo.n, wInk: logo.wInk, hInk: logo.hInk, ratio: logo.ratio, stride: logo.stride, fontOk: logo.fontOk, webgl2: renderer.capabilities.isWebGL2 };

    // Shared uniforms.
    const uf = <T,>(v: T): THREE.IUniform<T> => ({ value: v });
    Object.assign(U, {
      uRmin: uf(0.28), uRmax: uf(1.28), uSigma: uf(C.SIGMA), uYext: uf(C.Y_EXT),
      uRingDY: uf(C.RING_DY), uScroll: uf(0), uMeridians: uf(C.MERIDIANS), uLinePx: uf(C.LINE_PX),
      uLineMaxCover: uf(C.LINE_MAX_COVER), uSilPx: uf(C.SIL_PX), uPhiCut: uf(Math.PI), uPhiBand: uf(0.02), uBodyGrey: uf(debugBody ? 0.4 : 0), uGhostAlpha: uf(C.GHOST_ALPHA),
      uLineOn: uf(new THREE.Vector2(debugLines === 'meridians' ? 0 : 1, debugLines === 'rings' ? 0 : 1)),
      uCycle: uf(0), uAspect: uf(1.6), uLogoW: uf(1), uZL: uf(0.6), uHalfHeightPx: uf(400), uDotWorld: uf(0.01), uRecede: uf(0),
    });
    const pick = (...names: string[]): Uniforms => Object.fromEntries(names.map((k) => [k, U[k]!]));
    const bodyUniforms = pick('uRmin', 'uRmax', 'uSigma', 'uYext', 'uRingDY', 'uScroll', 'uMeridians', 'uLinePx', 'uLineMaxCover', 'uSilPx', 'uPhiCut', 'uPhiBand', 'uHalfHeightPx', 'uBodyGrey', 'uGhostAlpha', 'uLineOn');

    // Body + grid: one opaque, depth-writing draw call (also the occluder for the particles).
    // FrontSide: only the near wall is shaded (the far wall is always hidden behind it, and the
    // mouth rim is off-screen by assertConfig), so the funnel area is not fragment-shaded twice.
    const bodyGeo = buildBodyGeometry();
    body = new THREE.Mesh(bodyGeo, new THREE.ShaderMaterial({
      uniforms: bodyUniforms, vertexShader: BODY_VERT, fragmentShader: BODY_FRAG,
      side: THREE.FrontSide, transparent: false, depthTest: true, depthWrite: true,
    }));
    (body.material.extensions as { derivatives?: boolean }).derivatives = true;
    body.frustumCulled = false;
    body.renderOrder = 0;
    scene.add(body);

    // Optional ghost pass: far-side grid faintly visible through the body (DoubleSide + GreaterDepth: needs the far wall).
    if (C.GHOST_ALPHA > 0) {
      ghost = new THREE.Mesh(bodyGeo, new THREE.ShaderMaterial({
        uniforms: bodyUniforms, vertexShader: BODY_VERT, fragmentShader: BODY_FRAG, defines: { GHOST: 1 },
        side: THREE.DoubleSide, transparent: true, depthTest: true, depthWrite: false, depthFunc: THREE.GreaterDepth,
      }));
      (ghost.material.extensions as { derivatives?: boolean }).derivatives = true;
      ghost.frustumCulled = false;
      ghost.renderOrder = 0.5;
      scene.add(ghost);
    }

    // Crisp text underlay: only sharpens the fully formed logo; particles own every transition.
    const tex = new THREE.CanvasTexture(logo.crop);
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    underlay = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
      color: 0xffffff, alphaMap: tex, transparent: true, depthTest: true, depthWrite: false, opacity: 0,
    }));
    underlay.frustumCulled = false;
    underlay.renderOrder = 1;
    underlay.visible = false;
    scene.add(underlay);

    // Particles: one THREE.Points, motion entirely in the vertex shader.
    points = new THREE.Points(buildParticleGeometry(logo, rand), new THREE.ShaderMaterial({
      uniforms: pick('uRmin', 'uRmax', 'uSigma', 'uCycle', 'uAspect', 'uLogoW', 'uZL', 'uHalfHeightPx', 'uDotWorld', 'uRecede'),
      vertexShader: particleVert(), fragmentShader: PARTICLE_FRAG,
      transparent: true, depthTest: true, depthWrite: false, blending: THREE.NormalBlending,
    }));
    points.frustumCulled = false;
    points.renderOrder = 2;
    scene.add(points);

    layout();
    renderer.initTexture(tex);          // upload + mipmaps now, not as a hitch on the underlay's first frame mid-hold
    renderer.compile(scene, camera);
    ready = true;

    // First frame exactly at t = seekSeconds (loading time must not count), then the loop.
    stamp = performance.now();
    renderAt(time());
    if (playing) renderer.setAnimationLoop(() => renderAt(time()));
    readyResolve(api);

    // Resize sources, coalesced into one rAF. Registered after the first frame so a listener failure
    // can never leave the canvas black; the DPR watcher is best-effort (matchMedia quirks vary).
    window.addEventListener('resize', queueLayout);
    window.addEventListener('orientationchange', queueLayout);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', queueLayout);
    const watchDpr = () => {
      try {
        const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
        const onChange = () => { queueLayout(); watchDpr(); };
        if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onChange, { once: true });
        else if (typeof mq.addListener === 'function') mq.addListener(function once(this: MediaQueryList) { mq.removeListener(once); onChange(); });
      } catch (err) {
        show(`[dpr] watcher unavailable: ${err instanceof Error ? err.message : err}`, '#fd3');
      }
    };
    if (typeof window.matchMedia === 'function') watchDpr();
  }

  init().catch((err: unknown) => {
    show(`[init] ${err instanceof Error && err.stack ? err.stack : err}`);
    readyReject(err);
  });
  return api;
}
