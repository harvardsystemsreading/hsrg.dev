// Logo sampler: rasterises the "HSRG." wordmark once at startup and turns its ink
// into (a) a list of particle target points and (b) a crisp white-on-black texture
// used as the held-logo underlay. Runs entirely on an offscreen 2D canvas.
//
// Everything random in here is drawn from the seeded PRNG passed in (`rand`) so the
// result is identical on every load (deterministic animation, R8).

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** mulberry32: tiny seeded PRNG, returns floats in [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Waits for the Anton face (declared by @font-face in css/style.css) to be usable on a
 * canvas. Never rejects; resolves { ok, reason }. Three checks: FontFaceSet.load(),
 * FontFaceSet.check(), and a measureText() comparison against the generic fallback.
 */
async function ensureFontReady(family, fontPx, text, timeoutMs) {
  const spec = `400 ${fontPx}px "${family}"`;
  if (!document.fonts || typeof document.fonts.load !== 'function') {
    return { ok: false, reason: 'FontFaceSet API unavailable' };
  }
  let faces = null;
  try {
    faces = await Promise.race([document.fonts.load(spec, text), sleep(timeoutMs).then(() => null)]);
  } catch (err) {
    return { ok: false, reason: `fonts.load failed: ${err && err.message ? err.message : err}` };
  }
  if (faces === null) return { ok: false, reason: `fonts.load timed out after ${timeoutMs} ms` };
  if (!faces.length || !document.fonts.check(spec)) return { ok: false, reason: 'no matching @font-face' };
  // Belt and braces: if the face did not actually apply, the advance width equals the generic one.
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.font = spec;
  const wFace = ctx.measureText(text).width;
  ctx.font = `400 ${fontPx}px sans-serif`;
  const wGeneric = ctx.measureText(text).width;
  if (Math.abs(wFace - wGeneric) < 0.5) return { ok: false, reason: 'face did not apply to canvas text' };
  return { ok: true, reason: '' };
}

/**
 * Rasterises the logo text and samples its ink.
 * @returns {Promise<{
 *   n: number, samples: Float32Array,        // n points, (x_n, y_n) pairs, sorted left->right
 *   wInk: number, hInk: number, ratio: number, // ink box in raster px, ratio = hInk / wInk
 *   stride: number,                          // sample grid step in raster px
 *   crop: HTMLCanvasElement, cropPad: number,// white-on-black ink box + padding (underlay alphaMap)
 *   fontOk: boolean, fontReason: string, fontUsed: string }>}
 */
export async function sampleLogo({
  text, family, fontPx, sampleW, sampleH, nTarget, jitter, timeoutMs, rand, cropPad = 8, roundPeriod = false,
}) {
  const font = await ensureFontReady(family, fontPx, text, timeoutMs);
  const fontUsed = font.ok
    ? `400 ${fontPx}px "${family}"`
    : `400 ${fontPx}px Impact, "Arial Narrow", sans-serif`;

  // 1. Raster: white text on black, DPR independent.
  const penX = Math.round(sampleW * 0.05), penY = Math.round(sampleH * 0.78);
  const newRaster = () => {
    const c = document.createElement('canvas');
    c.width = sampleW; c.height = sampleH;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.fillStyle = '#000'; x.fillRect(0, 0, sampleW, sampleH);
    x.fillStyle = '#fff'; x.font = fontUsed;
    x.textBaseline = 'alphabetic'; x.textAlign = 'left';
    return [c, x];
  };
  const [cv, ctx] = newRaster();
  const dot = roundPeriod && text.length > 1 && text.endsWith('.');
  ctx.fillText(dot ? text.slice(0, -1) : text, penX, penY);
  let img = ctx.getImageData(0, 0, sampleW, sampleH).data;
  const ink = (px, py) => img[(py * sampleW + px) * 4] > 128;
  const inkBox = (xMin = 0) => {   // ink bounding box (inclusive) and pixel count, columns >= xMin
    let x0 = sampleW, x1 = -1, y0 = sampleH, y1 = -1, count = 0;
    for (let py = 0; py < sampleH; py++) {
      for (let px = xMin; px < sampleW; px++) {
        if (!ink(px, py)) continue;
        count++;
        if (px < x0) x0 = px; if (px > x1) x1 = px;
        if (py < y0) y0 = py; if (py > y1) y1 = py;
      }
    }
    return { x0, x1, y0, y1, count };
  };
  if (dot) {
    // The reference logo's period is a round dot; the font's glyph is square. Draw the rest of the text,
    // then paint a circle where the glyph would be: same centre column, sitting on the glyph's bottom
    // edge, diameter = the glyph's ink width. Kerning is honoured by rastering the full text once and
    // taking the ink right of the preceding letters.
    const head = inkBox();
    if (head.count === 0) throw new Error('logo raster is empty (font size / canvas size mismatch)');
    const [, fullCtx] = newRaster();
    fullCtx.fillText(text, penX, penY);
    const saved = img;
    img = fullCtx.getImageData(0, 0, sampleW, sampleH).data;
    const g = inkBox(head.x1 + 1);
    img = saved;
    if (g.count > 0) {
      const dia = g.x1 - g.x0 + 1;
      ctx.beginPath();
      ctx.arc((g.x0 + g.x1 + 1) / 2, g.y1 + 1 - dia / 2, dia / 2, 0, 2 * Math.PI);
      ctx.fill();
      img = ctx.getImageData(0, 0, sampleW, sampleH).data;
    } else {
      ctx.fillText(text, penX, penY);   // no separate period ink found: fall back to the glyph
      img = ctx.getImageData(0, 0, sampleW, sampleH).data;
    }
  }

  // 2. Ink box from pixels (measureText ignores overhangs and the period's true extent).
  const { x0, x1, y0, y1, count } = inkBox();
  if (count === 0) throw new Error('logo raster is empty (font size / canvas size mismatch)');
  const wInk = x1 - x0 + 1, hInk = y1 - y0 + 1;
  const cx = (x0 + x1 + 1) / 2, cy = (y0 + y1 + 1) / 2;

  // 3. Adaptive jittered grid: stride chosen so ~nTarget samples land on ink.
  const stride = Math.sqrt(count / nTarget);
  const nx = Math.ceil(wInk / stride), ny = Math.ceil(hInk / stride);
  const pts = [];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const x = x0 + (i + 0.5) * stride + (rand() * 2 - 1) * jitter * stride;
      const y = y0 + (j + 0.5) * stride + (rand() * 2 - 1) * jitter * stride;
      const px = Math.round(x), py = Math.round(y);
      if (px < 0 || px >= sampleW || py < 0 || py >= sampleH) continue;
      if (ink(px, py)) pts.push(x, y);
    }
  }
  const n = pts.length / 2;
  if (n < 100) throw new Error(`logo sampling produced only ${n} points`);

  // 4. Order left -> right (ties top -> bottom) so the logo accretes H first, period last.
  const order = new Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  order.sort((a, b) => (pts[a * 2] - pts[b * 2]) || (pts[a * 2 + 1] - pts[b * 2 + 1]));

  // 5. Normalise to the ink box width (aspect preserved): x in [-0.5, 0.5], y up.
  const samples = new Float32Array(n * 2);
  for (let k = 0; k < n; k++) {
    const i = order[k];
    samples[k * 2] = (pts[i * 2] - cx) / wInk;
    samples[k * 2 + 1] = (cy - pts[i * 2 + 1]) / wInk;
  }

  // 6. Underlay: the ink box plus padding, white on black (used as alphaMap, no fringes).
  const crop = document.createElement('canvas');
  crop.width = wInk + 2 * cropPad; crop.height = hInk + 2 * cropPad;
  const cctx = crop.getContext('2d');
  cctx.fillStyle = '#000'; cctx.fillRect(0, 0, crop.width, crop.height);
  cctx.drawImage(cv, x0 - cropPad, y0 - cropPad, crop.width, crop.height, 0, 0, crop.width, crop.height);

  return {
    n, samples, wInk, hInk, ratio: hInk / wInk, stride, crop, cropPad,
    fontOk: font.ok, fontReason: font.reason, fontUsed,
  };
}
