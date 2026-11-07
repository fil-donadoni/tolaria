// Rasterisation-level sharpness of printed card faces (issue #6940, two-sided
// and DPR-1-aware since issue #8321).
//
// Injected by `scripts/ui-gate/raster-measure.ts` after `probe.js` has run.
// `probe.js`'s `cardsSoft` measures the RESOURCE — the srcset candidate the
// browser resolved against the slot's device width — and by its own stated
// limit cannot see a correct resource that the compositor rasterises, decodes
// or resamples away from its intrinsic resolution: nothing exposed to JS moves
// when that happens. What does move is the PIXELS. This module compares a
// screenshot of the face (what the compositor actually put on screen, in
// device pixels) against a CLEAN REFERENCE of the same art at the same device
// size, and reports how far the screen is from it — in BOTH directions.
//
// Three entry points, all on `window`:
//
//   __tolariaRasterCandidates(max)  → the printed faces worth measuring, marked
//                                     `data-ui-gate-raster="<k>"` so the Node
//                                     side can screenshot each by locator, plus
//                                     a count of the faces rejected, by reason.
//   __tolariaRasterCompare(spec)    → one face's Blur and Alias indexes from
//                                     its PNG (and, on request, a 3× crop).
//   __tolariaRasterClear()          → removes the marks.
//
// Pure helpers (`__tolariaRasterMath`) are exposed for the unit test, which
// runs this file in a happy-dom vm with synthetic pixel arrays and inline
// styles — a canvas never exists there.
//
// THE MEASUREMENT. Luminance gradient energy — the mean of |∂L/∂x| + |∂L/∂y|
// over the face's interior — divided by the region's luminance contrast (its
// standard deviation) is a scale-free, CONTRAST-FREE proxy for sharpness: it
// survives a sub-pixel misalignment between the two renderings (a per-pixel
// diff would not) and a scrim, a fade-in caught mid-way or a gradient overlay
// (which scale gradient and contrast alike; measured on this lane before the
// normalisation: one tablet cell read 0.00, 0.39 and 1.06 on three runs of the
// same face, a fade). Three normalised energies are taken on the same inset
// region:
//
//   shot  the screenshot, i.e. what the user sees;
//   ref   the reference: the art AREA-AVERAGED (box-filtered) down to the
//         face's device size — the alias-free downscale, and the look the
//         owner asked for ("a clean, high-quality downscale", issue #8321);
//   half  the same reference at HALF the device size and scaled back up —
//         what a compositor that rasterised the layer at half resolution, or
//         decoded the image one mip level too low, would show.
//
// Blur Index = (ref − shot) / (ref − half), clamped at 0: 0 is "as sharp as
// the reference", 1 is "as soft as a half-resolution raster". Alias Index =
// shot / ref − 1, clamped at 0: 0 is "no more detail than the clean downscale
// has", 0.5 is "half again as much gradient energy" — aliasing ADDS local
// contrast, so a face that over-reads the reference is a defect too, and the
// first implementation (issue #6940) could not see it: its index was one-sided
// and relative to the resource the browser held, so a `thumb` drawn at 112px
// (over-sharpened at source: +21% over the clean reference on this lane) and a
// `grid` bilinear-stepped from its 122px mip to an 84px slot (+35%) both read
// 0, a pass.
//
// WHY THE REFERENCE IS BOX-FILTERED `grid`, NOT THE RESOURCE HELD. Measured on
// this lane (issue #8321, 2026-11-07, three cards, eight widths): the canvas's
// own high-quality downscale (`imageSmoothingQuality: high`) is mip-based and
// wobbles ±10% around the box filter from one width to the next, identically
// at every quality setting; `grid` box-filtered reads within 3% of `display`
// box-filtered at every width up to 256px, so the mid rendition IS the clean
// art for any board slot; and `thumb` box-filtered reads +8% at 46px, −6% at
// 64px, +20% at 73px and +21–45% from 84px up: the small rendition is
// sharpened at source and cannot be anyone's reference. So the reference is
// the `grid` rendition (or `display` once the face is wider than grid's 488
// device px), area-averaged in JS — deterministic, renderer-independent — and
// a face's own resource only decides the "upscaled" skip below. The face's
// rendition still names itself on the cell line.
//
// WHAT IS MASKED. An inert overlay painted INSIDE the face — the battlefield's
// P/T badge, a counter chip — is not the card's pixels: on a 46px board card
// the 2/1 badge covers a fifth of the art, and its flat black box inflates the
// region's contrast while the reference (the bare art) has none of it —
// measured Blur Index 0.60–0.73 on a face as sharp as its resource (issue
// #7590). Such overlays are `pointer-events: none`, so the occlusion lattice
// below never sees them; `overlayRects` finds them with hit-testing forced on,
// and their boxes are excluded from all three energies alike.
//
// WHAT IS MEASURED THAT USED TO BE SKIPPED (issue #8321). A FADED face — the
// `opacity-40` ineligible tile of a pile dialog, the `opacity-30` drag — is
// measured: the composite L' = αL + (1−α)B is an affine map of the luminance
// wherever the background B is flat, which the normalisation cancels; measured
// on the synthetic page at opacity 0.4 against 1.0, every (rendition, width)
// pair read the same shot/ref to three decimals. A face under a uniform SCALE
// (the drag ghost's 1.05, a compact zone's `scale(.9)`) is measured at its
// on-screen box: that box IS the card, scaled. A face ROTATED by a quarter
// turn (a tapped permanent) is measured with the reference rotated into the
// screenshot's box; the gradient energy is orientation-free. What is still
// skipped, and why each is a skip and never a red: a face under an overlay
// (the pixels would be the overlay's), a filtered or blended face (not an
// affine map), a face mid-tilt (its box is neither the card nor a quarter
// turn of it), a face whose own resource is narrower than its device box
// (upscaling is the resource check's class), one too small for half-resolution
// to differ from full, and one invisible (opacity under 2%).
//
// WHY A CANVAS CAN READ THE ART. Card art is cross-origin, but Scryfall's CDN
// answers with `access-control-allow-origin: *`, so a SEPARATE `Image` loaded
// with `crossOrigin="anonymous"` is not tainted. The page's own `<img>` carries
// no `crossorigin` and stays unreadable — hence the re-request, which the HTTP
// cache serves. A face the app resampled itself (a `blob:` source, issue
// #8321) names the art it was made from in `data-art-src`.
(() => {
    const MARK = "data-ui-gate-raster";
    /** The fraction of the face's box ignored on every side: the printed
     *  corner (8% radius), the 2–4px state rings the tiles overlay inside the
     *  box, and the compositor's edge antialiasing all live there. */
    const INSET = 0.12;
    /** Longest wait for the screenshot decode or the reference re-fetch. A
     *  stalled fetch must end in a skip, never a hung cell. */
    const LOAD_TIMEOUT_MS = 8000;

    /** Most of the inset region overlays may cover before the face is
     *  rejected as occluded: past it, too little card is left to judge. */
    const MAX_MASKED = 0.5;
    /** Overlay hit-test lattice, per axis, over the inset region. */
    const OVERLAY_LATTICE = 12;

    /** Scryfall's published rendition widths — the same three numbers
     *  `src/lib/imageUrls.ts` builds the srcset from, plus the legacy names
     *  `probe.js` knows. */
    const RENDITION_W = {
        thumb: 146,
        small: 146,
        border_crop: 480,
        grid: 488,
        normal: 488,
        display: 672,
        large: 672,
        png: 745,
    };

    /** Mean |∂L/∂x| + |∂L/∂y| of the luminance of an RGBA buffer over the
     *  pixels strictly inside the `inset` fraction of each edge. `mask`
     *  (optional, one byte per pixel, 1 = excluded) drops every pixel whose
     *  own value or either forward neighbour is masked, so an overlay's edge
     *  never counts as the card's detail. */
    function gradientEnergy(data, w, h, inset, mask) {
        const x0 = Math.floor(w * inset);
        const x1 = Math.ceil(w * (1 - inset)) - 1;
        const y0 = Math.floor(h * inset);
        const y1 = Math.ceil(h * (1 - inset)) - 1;
        if (x1 - x0 < 2 || y1 - y0 < 2) return 0;
        const lum = (i) =>
            0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        let sum = 0;
        let n = 0;
        for (let y = y0; y < y1; y++) {
            for (let x = x0; x < x1; x++) {
                const p = y * w + x;
                if (mask && (mask[p] || mask[p + 1] || mask[p + w])) continue;
                const i = p * 4;
                const l = lum(i);
                sum += Math.abs(lum(i + 4) - l) + Math.abs(lum(i + w * 4) - l);
                n++;
            }
        }
        return n ? sum / n : 0;
    }

    /** Standard deviation of the luminance over the same inset region: the
     *  region's CONTRAST. `mask` as in {@link gradientEnergy}. */
    function luminanceSigma(data, w, h, inset, mask) {
        const x0 = Math.floor(w * inset);
        const x1 = Math.ceil(w * (1 - inset));
        const y0 = Math.floor(h * inset);
        const y1 = Math.ceil(h * (1 - inset));
        let sum = 0;
        let sq = 0;
        let n = 0;
        for (let y = y0; y < y1; y++) {
            for (let x = x0; x < x1; x++) {
                if (mask && mask[y * w + x]) continue;
                const i = (y * w + x) * 4;
                const l =
                    0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
                sum += l;
                sq += l * l;
                n++;
            }
        }
        if (!n) return 0;
        const mean = sum / n;
        return Math.sqrt(Math.max(0, sq / n - mean * mean));
    }

    /** Gradient energy NORMALISED by contrast — the quantity both indexes are
     *  built on. A scrim, a fade-in caught mid-way, a `pointer-events: none`
     *  gradient over the card all apply an affine map to luminance
     *  (L' = αL + c): that scales the gradient and the contrast by the same
     *  α, so their ratio does not move, while a lower-resolution raster loses
     *  gradient far faster than contrast. `null` when the region is UNIFORM
     *  (σ under 1 level): there is no picture to measure. */
    function normalizedEnergy(data, w, h, inset, mask) {
        const sigma = luminanceSigma(data, w, h, inset, mask);
        if (sigma < 1) return null;
        return gradientEnergy(data, w, h, inset, mask) / sigma;
    }

    /** A `w`×`h` pixel mask (1 = excluded) from overlay boxes given as
     *  fractions `[x0, y0, x1, y1]` of the face's box, each grown by `pad`
     *  pixels (the overlay's antialiased edge, a shadow). `null` when there
     *  is nothing to mask. */
    function maskOf(rects, w, h, pad) {
        if (!rects || !rects.length) return null;
        const mask = new Uint8Array(w * h);
        for (const [fx0, fy0, fx1, fy1] of rects) {
            const x0 = Math.max(0, Math.floor(fx0 * w) - pad);
            const y0 = Math.max(0, Math.floor(fy0 * h) - pad);
            const x1 = Math.min(w, Math.ceil(fx1 * w) + pad);
            const y1 = Math.min(h, Math.ceil(fy1 * h) + pad);
            for (let y = y0; y < y1; y++) mask.fill(1, y * w + x0, y * w + x1);
        }
        return mask;
    }

    /** The fraction of the inset region a mask excludes. */
    function maskedShare(mask, w, h, inset) {
        if (!mask) return 0;
        const x0 = Math.floor(w * inset);
        const x1 = Math.ceil(w * (1 - inset));
        const y0 = Math.floor(h * inset);
        const y1 = Math.ceil(h * (1 - inset));
        let masked = 0;
        for (let y = y0; y < y1; y++)
            for (let x = x0; x < x1; x++) masked += mask[y * w + x];
        return masked / Math.max(1, (x1 - x0) * (y1 - y0));
    }

    /** The Blur Index (see the header), on normalised energies. `null` when
     *  the reference cannot distinguish sharp from half-resolution at this
     *  size — a face so small that halving it loses nothing measurable. */
    function blurIndex(shot, ref, half) {
        const span = ref - half;
        if (!(ref > 0) || span <= ref * 0.05) return null;
        return Math.max(0, (ref - shot) / span);
    }

    /** The Alias Index (see the header): how far the screen OVER-reads the
     *  clean reference, as a fraction of it. 0 at or below the reference. */
    function aliasIndex(shot, ref) {
        if (!(ref > 0)) return null;
        return Math.max(0, shot / ref - 1);
    }

    /** Area-average (box-filter) resample of an RGBA buffer: the `[sx, sy,
     *  sw, sh]` source window (fractional, in source pixels) averaged into a
     *  `dw`×`dh` buffer. Every destination pixel is the exact mean of the
     *  source area it covers — no mip chain, no kernel, nothing to alias. */
    function boxDownscale(src, sw0, sh0, win, dw, dh) {
        const [sx, sy, sw, sh] = win;
        const out = new Uint8ClampedArray(dw * dh * 4);
        const kx = sw / dw;
        const ky = sh / dh;
        for (let y = 0; y < dh; y++) {
            const y0 = sy + y * ky;
            const y1 = y0 + ky;
            const yy0 = Math.max(0, Math.floor(y0));
            const yy1 = Math.min(sh0, Math.ceil(y1));
            for (let x = 0; x < dw; x++) {
                const x0 = sx + x * kx;
                const x1 = x0 + kx;
                const xx0 = Math.max(0, Math.floor(x0));
                const xx1 = Math.min(sw0, Math.ceil(x1));
                let r = 0;
                let g = 0;
                let b = 0;
                let n = 0;
                for (let yy = yy0; yy < yy1; yy++) {
                    const wy = Math.min(yy + 1, y1) - Math.max(yy, y0);
                    if (wy <= 0) continue;
                    for (let xx = xx0; xx < xx1; xx++) {
                        const wx = Math.min(xx + 1, x1) - Math.max(xx, x0);
                        if (wx <= 0) continue;
                        const wgt = wx * wy;
                        const i = (yy * sw0 + xx) * 4;
                        r += src[i] * wgt;
                        g += src[i + 1] * wgt;
                        b += src[i + 2] * wgt;
                        n += wgt;
                    }
                }
                const o = (y * dw + x) * 4;
                out[o] = n ? r / n : 0;
                out[o + 1] = n ? g / n : 0;
                out[o + 2] = n ? b / n : 0;
                out[o + 3] = 255;
            }
        }
        return out;
    }

    /** Bilinear 2× upscale of an RGBA buffer — the `half` reference's way
     *  back to the face's size, in JS so no renderer's resampler is in it. */
    function upscale2x(src, w, h) {
        const W = w * 2;
        const H = h * 2;
        const out = new Uint8ClampedArray(W * H * 4);
        for (let y = 0; y < H; y++) {
            const fy = Math.max(0, (y + 0.5) / 2 - 0.5);
            const y0 = Math.min(h - 1, Math.floor(fy));
            const y1 = Math.min(h - 1, y0 + 1);
            const ty = fy - y0;
            for (let x = 0; x < W; x++) {
                const fx = Math.max(0, (x + 0.5) / 2 - 0.5);
                const x0 = Math.min(w - 1, Math.floor(fx));
                const x1 = Math.min(w - 1, x0 + 1);
                const tx = fx - x0;
                const o = (y * W + x) * 4;
                for (let c = 0; c < 3; c++) {
                    const a = src[(y0 * w + x0) * 4 + c];
                    const b = src[(y0 * w + x1) * 4 + c];
                    const cc = src[(y1 * w + x0) * 4 + c];
                    const d = src[(y1 * w + x1) * 4 + c];
                    out[o + c] =
                        (a * (1 - tx) + b * tx) * (1 - ty) +
                        (cc * (1 - tx) + d * tx) * ty;
                }
                out[o + 3] = 255;
            }
        }
        return out;
    }

    /** A `w`×`h` RGBA buffer turned a quarter turn clockwise: `h`×`w`. */
    function rotate90(src, w, h) {
        const out = new Uint8ClampedArray(w * h * 4);
        for (let y = 0; y < h; y++)
            for (let x = 0; x < w; x++) {
                const i = (y * w + x) * 4;
                const nx = h - 1 - y;
                const ny = x;
                const o = (ny * h + nx) * 4;
                out[o] = src[i];
                out[o + 1] = src[i + 1];
                out[o + 2] = src[i + 2];
                out[o + 3] = 255;
            }
        return out;
    }

    /** `object-fit: cover` of an `nw`×`nh` picture onto a `W`×`H` box: the
     *  source window `[sx, sy, sw, sh]` the box shows — a centred crop. */
    function coverWindow(nw, nh, W, H) {
        const s = Math.max(W / nw, H / nh);
        const sw = W / s;
        const sh = H / s;
        return [(nw - sw) / 2, (nh - sh) / 2, sw, sh];
    }

    /** A face whose pixels are not an affine map of the art's: it, or an
     *  ancestor, is filtered or blended. Walks to the root. */
    function filteredOrBlended(e) {
        for (let n = e; n && n.nodeType === 1; n = n.parentElement) {
            const cs = getComputedStyle(n);
            if (cs.filter && cs.filter !== "none") return true;
            if (cs.mixBlendMode && cs.mixBlendMode !== "normal") return true;
        }
        return false;
    }

    /** The composited opacity of a face: the product down to the root —
     *  opacity does not inherit, it composites, so every level counts. A
     *  faded face is MEASURED (the normalisation cancels the fade) and
     *  reported as such; one under 2% is invisible and skipped. */
    function compositedOpacity(e) {
        let opacity = 1;
        for (let n = e; n && n.nodeType === 1; n = n.parentElement) {
            const o = parseFloat(getComputedStyle(n).opacity);
            if (!Number.isNaN(o)) opacity *= o;
        }
        return opacity;
    }

    /** How a face's on-screen box relates to its layout box: `none` (equal,
     *  or a translate), `scaled` (same aspect, another size: a uniform
     *  scale), `rotated` (the two sides swapped: a quarter turn, with or
     *  without a scale), or `other` (a tilt mid-hover, a skew — the box is
     *  not the card, nor a quarter turn of it). */
    function transformKind(e, r) {
        const lw = e.offsetWidth;
        const lh = e.offsetHeight;
        if (!(lw > 0) || !(lh > 0) || !(r.width > 0) || !(r.height > 0))
            return "other";
        if (Math.abs(r.width - lw) <= 1 && Math.abs(r.height - lh) <= 1)
            return "none";
        const aspect = lw / lh;
        if (Math.abs(r.width / r.height - aspect) <= aspect * 0.02)
            return "scaled";
        if (Math.abs(r.height / r.width - aspect) <= aspect * 0.02)
            return "rotated";
        return "other";
    }

    /** Whether an ancestor holds the face on its own compositor layer at
     *  rest: a standing `will-change: transform`, or a 3D transform. Reported
     *  on the sample (the census column issue #8321 asked for); never a
     *  reason to skip. */
    function promotedAncestor(e) {
        for (
            let n = e.parentElement;
            n && n.nodeType === 1;
            n = n.parentElement
        ) {
            const cs = getComputedStyle(n);
            if (/transform|opacity/.test(cs.willChange || "")) return true;
            if (
                cs.transform &&
                /matrix3d|translate3d|translateZ/.test(cs.transform)
            )
                return true;
        }
        return false;
    }

    /** The Scryfall rendition a URL names, or `bitmap` for an app-resampled
     *  `blob:` face, or `null`. */
    function renditionOf(url) {
        if (!url) return null;
        if (url.startsWith("blob:")) return "bitmap";
        const m = url.match(/cards\.scryfall\.io\/([^/]+)\//);
        return m ? m[1] : null;
    }

    /** The pixel width of the resource a face holds: a published rendition
     *  width, or the intrinsic width of an app-made bitmap (no srcset, so
     *  `naturalWidth` is the real one). `null` when unknown. */
    function heldWidth(e) {
        const url = e.currentSrc || e.src || "";
        const rendition = renditionOf(url);
        if (rendition === "bitmap") return e.naturalWidth || null;
        return (rendition && RENDITION_W[rendition]) || null;
    }

    /** The art the reference is built from: the face's `data-art-src` (an
     *  app-resampled face names the art it was made from), else the face's
     *  own Scryfall URL re-pointed at the clean rendition for this device
     *  width — `grid` up to grid's own 488px, `display` above it. */
    function referenceSourceOf(e, deviceW) {
        const declared = e.getAttribute("data-art-src");
        const own = e.currentSrc || e.src || "";
        const base = declared || own;
        const m = base.match(
            /^(https:\/\/cards\.scryfall\.io\/)([^/]+)(\/.+\.)([a-z]+)$/
        );
        if (!m) return declared ? declared : null;
        const variant = deviceW > RENDITION_W.grid ? "display" : "grid";
        return `${m[1]}${variant}${m[3]}webp`;
    }

    window.__tolariaRasterMath = {
        gradientEnergy,
        luminanceSigma,
        normalizedEnergy,
        maskOf,
        maskedShare,
        blurIndex,
        aliasIndex,
        boxDownscale,
        upscale2x,
        rotate90,
        coverWindow,
        filteredOrBlended,
        compositedOpacity,
        transformKind,
        promotedAncestor,
        renditionOf,
        referenceSourceOf,
    };

    const isDecorativeArt = (e) =>
        !!e.closest('[data-ambient-art],[aria-hidden="true"]');

    /** Every point of a 3×3 lattice inside the inset box must hit the image
     *  itself: a face under a sheet, a scrim or a sibling card would compare
     *  the overlay's pixels against the card's. `pointer-events: none`
     *  overlays (the state rings) are skipped by `elementFromPoint`, which is
     *  what makes a ringed card measurable. */
    function unoccluded(e, r) {
        for (const fy of [0.2, 0.5, 0.8]) {
            for (const fx of [0.2, 0.5, 0.8]) {
                const hit = document.elementFromPoint(
                    r.left + r.width * fx,
                    r.top + r.height * fy
                );
                if (hit !== e) return false;
            }
        }
        return true;
    }

    /** An element that puts pixels of its own on screen: visible, not fully
     *  transparent, and with a background, a raster or text of its own. A
     *  state ring (a border or shadow around a transparent box) and an idle
     *  glare (opacity 0) paint nothing over the art. */
    function paintsOver(n) {
        const cs = getComputedStyle(n);
        if (cs.visibility === "hidden" || parseFloat(cs.opacity) < 0.02)
            return false;
        // An `<svg>` is a container — a full-board arrow layer is one, and
        // transparent wherever no arrow is drawn — so only raster content
        // counts by tag.
        if (/^(IMG|CANVAS|VIDEO)$/i.test(n.tagName)) return true;
        if (cs.backgroundImage && cs.backgroundImage !== "none") return true;
        const bg = cs.backgroundColor.match(/[\d.]+/g);
        if (bg && bg.length === 4 && parseFloat(bg[3]) > 0.02) return true;
        if (bg && bg.length === 3) return true;
        for (const c of n.childNodes)
            if (c.nodeType === 3 && c.textContent.trim()) return true;
        return false;
    }

    /** The overlays painted over the face's inset region, as fractions of its
     *  box (see WHAT IS MASKED). Hit-testing is forced on for the duration —
     *  the overlays worth finding are exactly the `pointer-events: none`
     *  ones — and a lattice of points collects every element above the image
     *  that is not one of its ancestors and paints. */
    function overlayRects(e, r) {
        const force = document.createElement("style");
        force.textContent = "* { pointer-events: auto !important; }";
        document.head.appendChild(force);
        const found = new Set();
        try {
            for (let j = 0; j < OVERLAY_LATTICE; j++) {
                for (let i = 0; i < OVERLAY_LATTICE; i++) {
                    const fx =
                        INSET + ((1 - 2 * INSET) * (i + 0.5)) / OVERLAY_LATTICE;
                    const fy =
                        INSET + ((1 - 2 * INSET) * (j + 0.5)) / OVERLAY_LATTICE;
                    const stack = document.elementsFromPoint(
                        r.left + r.width * fx,
                        r.top + r.height * fy
                    );
                    for (const n of stack) {
                        if (n === e) break;
                        if (!n.contains(e) && paintsOver(n)) found.add(n);
                    }
                }
            }
        } finally {
            force.remove();
        }
        return [...found].map((n) => {
            const o = n.getBoundingClientRect();
            return [
                Math.max(0, (o.left - r.left) / r.width),
                Math.max(0, (o.top - r.top) / r.height),
                Math.min(1, (o.right - r.left) / r.width),
                Math.min(1, (o.bottom - r.top) / r.height),
            ];
        });
    }

    /** Why a printed face is not a candidate, or `null` when it is. The order
     *  is cheapest first; the reason is what the cell line reports, so a
     *  surface that yields no sample says what its faces were. */
    function rejectReason(e, r, vw, vh) {
        // A face whose 1x bitmap is still being made (issue #8321) shows a
        // placeholder pixel: no picture yet.
        if (e.hasAttribute("data-face-pending")) return "unresolved";
        if (!(e.currentSrc || e.src) || !e.complete || !e.naturalWidth)
            return "unresolved";
        const layoutW = e.offsetWidth || r.width;
        if (layoutW < 40 || r.height < 40) return "small";
        if (r.left < 0 || r.top < 0 || r.right > vw || r.bottom > vh)
            return "offscreen";
        if (transformKind(e, r) === "other") return "transformed";
        if (compositedOpacity(e) < 0.02) return "hidden";
        if (filteredOrBlended(e)) return "filtered";
        if (!unoccluded(e, r)) return "occluded";
        return null;
    }

    /** Per marked face: its overlay boxes and its transform kind, read back
     *  by the compare. */
    let pickedByMark = {};

    window.__tolariaRasterClear = () => {
        for (const e of document.querySelectorAll(`[${MARK}]`))
            e.removeAttribute(MARK);
        pickedByMark = {};
    };

    // The same short selector `probe.js` names an offender by, so a blurred
    // face outlines on the failure shot like any other.
    const selectorOf = (e) => {
        let s = e.tagName.toLowerCase();
        if (e.id) return (s + "#" + e.id).slice(0, 80);
        const slot = e.getAttribute("data-slot");
        if (slot) s += '[data-slot="' + slot + '"]';
        const cls = (e.getAttribute("class") || "")
            .trim()
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2);
        if (cls.length) s += "." + cls.join(".");
        return s.slice(0, 80);
    };

    /** `{ picked, rejected, printed }`: up to `max` printed faces, largest
     *  first, one per distinct layout width (a surface's size classes, not
     *  `max` copies of its biggest tile), each marked; the count of faces
     *  rejected by reason; and how many printed faces the page holds. A
     *  faded face and an unfaded one of the same width are two classes: the
     *  fade is what issue #8321 asked to see measured. */
    window.__tolariaRasterCandidates = (max) => {
        window.__tolariaRasterClear();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const all = [];
        const rejected = {};
        let printed = 0;
        for (const e of document.querySelectorAll(
            '[data-card-face="printed"]'
        )) {
            if (isDecorativeArt(e)) continue;
            printed++;
            const r = e.getBoundingClientRect();
            const why = rejectReason(e, r, vw, vh);
            if (why) {
                rejected[why] = (rejected[why] || 0) + 1;
                continue;
            }
            const overlays = overlayRects(e, r);
            const probeMask = maskOf(overlays, 100, 140, 0);
            if (maskedShare(probeMask, 100, 140, INSET) > MAX_MASKED) {
                rejected.occluded = (rejected.occluded || 0) + 1;
                continue;
            }
            all.push({
                e,
                r,
                overlays,
                layoutW: e.offsetWidth || r.width,
                kind: transformKind(e, r),
                faded: compositedOpacity(e) < 0.98,
                promoted: promotedAncestor(e),
            });
        }
        all.sort((a, b) => b.layoutW - a.layoutW);
        const picked = [];
        const seen = new Set();
        for (const c of all) {
            const key = `${Math.round(c.layoutW)}|${c.faded ? "f" : ""}|${c.kind}`;
            if (seen.has(key)) continue;
            seen.add(key);
            picked.push(c);
            if (picked.length >= max) break;
        }
        return {
            printed,
            rejected,
            picked: picked.map((c, k) => {
                c.e.setAttribute(MARK, String(k));
                pickedByMark[k] = { overlays: c.overlays, kind: c.kind };
                return {
                    k,
                    sel: selectorOf(c.e),
                    t: (c.e.getAttribute("alt") || "img").trim().slice(0, 24),
                    w: Math.round(c.layoutW),
                    x: Math.round(c.r.left),
                    y: Math.round(c.r.top),
                    h: Math.round(c.r.height),
                    src: c.e.currentSrc || c.e.src,
                    dec: c.e.getAttribute("sizes") || "",
                    dpr: window.devicePixelRatio,
                    kind: c.kind,
                    faded: c.faded,
                    promoted: c.promoted,
                };
            }),
        };
    };

    function loadImage(src, cors) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            const timer = setTimeout(
                () => reject(new Error("timeout")),
                LOAD_TIMEOUT_MS
            );
            if (cors) img.crossOrigin = "anonymous";
            img.onload = () => {
                clearTimeout(timer);
                resolve(img);
            };
            img.onerror = () => {
                clearTimeout(timer);
                reject(new Error(`image failed: ${src}`));
            };
            img.src = src;
        });
    }

    function canvas(w, h) {
        const c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(w));
        c.height = Math.max(1, Math.round(h));
        const ctx = c.getContext("2d", { willReadFrequently: true });
        ctx.imageSmoothingEnabled = false;
        return [c, ctx];
    }

    /** The pixels of an image at its natural size. */
    function pixelsOf(img) {
        const [, ctx] = canvas(img.naturalWidth, img.naturalHeight);
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, img.naturalWidth, img.naturalHeight).data;
    }

    /** Two RGBA buffers side by side at 3× nearest-neighbour — the crop a
     *  reader judges by eye (issue #8321): the screen on the left, the
     *  reference on the right. A PNG data URL. */
    function cropsPng(shot, ref, W, H) {
        const S = 3;
        const gap = 6;
        const [c, ctx] = canvas((W * 2 + gap) * S, H * S);
        ctx.fillStyle = "#ff00ff";
        ctx.fillRect(0, 0, c.width, c.height);
        const blit = (data, ox) => {
            const out = ctx.createImageData(W * S, H * S);
            for (let y = 0; y < H * S; y++)
                for (let x = 0; x < W * S; x++) {
                    const i = (Math.floor(y / S) * W + Math.floor(x / S)) * 4;
                    const o = (y * W * S + x) * 4;
                    out.data[o] = data[i];
                    out.data[o + 1] = data[i + 1];
                    out.data[o + 2] = data[i + 2];
                    out.data[o + 3] = 255;
                }
            ctx.putImageData(out, ox, 0);
        };
        blit(shot, 0);
        blit(ref, (W + gap) * S);
        return c.toDataURL("image/png").split(",")[1];
    }

    /** `spec`: `{ k, png64, src, crops? }` — the marked face, its element
     *  screenshot (device pixels) and the resource it held when picked.
     *  Returns the three energies with the Blur and Alias indexes, `{ skip }`
     *  for a face this check declines to judge, or `{ error }`. With `crops`
     *  set, also the 3× side-by-side crop as `crop64`. */
    window.__tolariaRasterCompare = async (spec) => {
        const e = document.querySelector(`[${MARK}="${spec.k}"]`);
        if (!e) return { error: "the marked face is gone" };
        const picked = pickedByMark[spec.k] || { overlays: [], kind: "none" };
        // The floor hook, the dpr watcher or a lazy srcset re-selection can
        // swap the resource between the pick and the shot; the shot would
        // then be compared against the wrong picture.
        if ((e.currentSrc || e.src) !== spec.src)
            return { skip: "source changed since it was picked" };
        let shotImg;
        try {
            shotImg = await loadImage(
                "data:image/png;base64," + spec.png64,
                false
            );
        } catch {
            return { error: "screenshot undecodable" };
        }
        const W = shotImg.naturalWidth;
        const H = shotImg.naturalHeight;
        // The card's own axes: a quarter turn swaps the screenshot's.
        const rotated = picked.kind === "rotated";
        const cardW = rotated ? H : W;
        const cardH = rotated ? W : H;
        // 1px of slack: the screenshot box is the bounding rect rounded
        // outward, the bitmap the layout box rounded to nearest (measured on
        // this lane: 112 against 113, 93 against 94, never a real shortfall).
        const held = heldWidth(e);
        if (held !== null && held + 1 < cardW)
            return {
                skip: `resource ${held}px below the face's ${cardW}px device box (the resource check's class)`,
            };
        const refSrc = referenceSourceOf(e, cardW);
        if (!refSrc) return { skip: "no art to build a reference from" };
        let ref;
        try {
            ref = await loadImage(refSrc, true);
        } catch (err) {
            return {
                error:
                    err && err.message === "timeout"
                        ? "reference fetch timed out"
                        : "reference fetch failed (CORS or network)",
            };
        }
        const nw = ref.naturalWidth;
        const nh = ref.naturalHeight;
        if (nw < cardW || nh < cardH)
            return {
                skip: "no rendition as wide as the face (the resource check's class)",
            };
        let shotData;
        try {
            const [, shotCtx] = canvas(W, H);
            shotCtx.drawImage(shotImg, 0, 0);
            shotData = shotCtx.getImageData(0, 0, W, H).data;
        } catch {
            return { error: "screenshot canvas unreadable" };
        }
        let art;
        try {
            art = pixelsOf(ref);
        } catch {
            return { error: "reference canvas tainted (no CORS)" };
        }
        // The reference in the card's axes, then turned into the screen's.
        const win = coverWindow(nw, nh, cardW, cardH);
        let refData = boxDownscale(art, nw, nh, win, cardW, cardH);
        const halfW = Math.max(1, Math.floor(cardW / 2));
        const halfH = Math.max(1, Math.floor(cardH / 2));
        let halfData = upscale2x(
            boxDownscale(art, nw, nh, win, halfW, halfH),
            halfW,
            halfH
        );
        // The 2× of a floored half can fall one pixel short of the box: pad
        // by resampling nothing — the inset never reaches the last row.
        if (halfW * 2 !== cardW || halfH * 2 !== cardH) {
            const padded = new Uint8ClampedArray(cardW * cardH * 4);
            for (let y = 0; y < Math.min(cardH, halfH * 2); y++)
                padded.set(
                    halfData.subarray(
                        y * halfW * 2 * 4,
                        (y + 1) * halfW * 2 * 4
                    ),
                    y * cardW * 4
                );
            halfData = padded;
        }
        if (rotated) {
            refData = rotate90(refData, cardW, cardH);
            halfData = rotate90(halfData, cardW, cardH);
        }
        // One mask for all three: the overlay's box is excluded from the
        // screenshot and from both renderings of the bare art alike.
        const mask = maskOf(
            picked.overlays,
            W,
            H,
            Math.ceil(window.devicePixelRatio)
        );
        const refE = normalizedEnergy(refData, W, H, INSET, mask);
        const half = normalizedEnergy(halfData, W, H, INSET, mask);
        const shot = normalizedEnergy(shotData, W, H, INSET, mask);
        if (refE === null) return { skip: "reference region is uniform" };
        // A uniform screenshot is no picture at all where the face should be:
        // the layer evicted, the slot blank. The caller re-shoots before it
        // believes it (a frame not yet painted looks the same).
        if (shot === null)
            return {
                blank: true,
                shot: 0,
                ref: +refE.toFixed(3),
                half: +(half ?? 0).toFixed(3),
            };
        return {
            shot: +shot.toFixed(3),
            ref: +refE.toFixed(3),
            half: +(half ?? 0).toFixed(3),
            blur: blurIndex(shot, refE, half ?? 0),
            alias: aliasIndex(shot, refE),
            pxW: W,
            pxH: H,
            natW: nw,
            refSrc,
            ...(spec.crops
                ? { crop64: cropsPng(shotData, refData, W, H) }
                : {}),
        };
    };
})();
