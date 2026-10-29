// Rasterisation-level sharpness of printed card faces (issue #6940).
//
// Injected by `scripts/ui-gate/raster.ts` after `probe.js` has run. `probe.js`'s
// `cardsSoft` measures the RESOURCE — the srcset candidate the browser resolved
// against the slot's device width — and by its own stated limit cannot see a
// correct resource that the compositor rasterises, decodes or resamples below
// its intrinsic resolution: nothing exposed to JS moves when that happens.
// What does move is the PIXELS. This module compares a screenshot of the face
// (what the compositor actually put on screen, in device pixels) against the
// same resource redrawn into a canvas at the same device size, and reports how
// much high-frequency detail the screen lost against the resource it holds.
//
// Two entry points, both on `window`:
//
//   __tolariaRasterCandidates(max)  → the printed faces worth measuring, marked
//                                     `data-ui-gate-raster="<k>"` so the Node
//                                     side can screenshot each by locator.
//   __tolariaRasterCompare(spec)    → one face's Blur Index from its PNG.
//   __tolariaRasterClear()          → removes the marks.
//
// Pure numeric helpers (`__tolariaRasterMath`) are exposed for the unit test,
// which runs this file in a happy-dom vm with synthetic pixel arrays — a canvas
// never exists there.
//
// THE MEASUREMENT. Luminance gradient energy — the mean of |∂L/∂x| + |∂L/∂y|
// over the face's interior — is a scale-free proxy for sharpness that survives
// a sub-pixel misalignment between the two renderings (a per-pixel diff would
// not). Three energies are taken on the same inset region:
//
//   shot  the screenshot, i.e. what the user sees;
//   ref   the resolved resource drawn at the face's device size with
//         high-quality resampling — the best this resource can look here;
//   half  the same resource drawn at HALF the device size and scaled back up —
//         what a compositor that rasterised the layer at half resolution, or
//         decoded the image one mip level too low, would show.
//
// Blur Index = (ref − shot) / (ref − half), clamped to [0, ∞): 0 is "as sharp
// as the resource allows", 1 is "as soft as a half-resolution raster". It is
// relative to the resource the browser holds, so a thumb rendition in a large
// slot (the `cardsSoft` class) scores ~0 here — that defect is the other
// check's, and the two are summed into the one `cardsSoft` Floor.
//
// WHY A CANVAS CAN READ THE ART. Card art is cross-origin, but Scryfall's CDN
// answers with `access-control-allow-origin: *`, so a SEPARATE `Image` loaded
// with `crossOrigin="anonymous"` is not tainted. The page's own `<img>` carries
// no `crossorigin` and stays unreadable — hence the re-request, which the HTTP
// cache serves.
(() => {
    const MARK = "data-ui-gate-raster";
    /** The fraction of the face's box ignored on every side: the printed
     *  corner (8% radius), the 2–4px state rings the tiles overlay inside the
     *  box, and the compositor's edge antialiasing all live there. */
    const INSET = 0.12;

    /** Mean |∂L/∂x| + |∂L/∂y| of the luminance of an RGBA buffer over the
     *  pixels strictly inside the `inset` fraction of each edge. */
    function gradientEnergy(data, w, h, inset) {
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
                const i = (y * w + x) * 4;
                const l = lum(i);
                sum += Math.abs(lum(i + 4) - l) + Math.abs(lum(i + w * 4) - l);
                n++;
            }
        }
        return n ? sum / n : 0;
    }

    /** The Blur Index (see the header). `null` when the reference cannot
     *  distinguish sharp from half-resolution at this size — a face so small
     *  that halving it loses nothing measurable. */
    function blurIndex(shot, ref, half) {
        const span = ref - half;
        if (!(ref > 0) || span <= ref * 0.05) return null;
        return Math.max(0, (ref - shot) / span);
    }

    window.__tolariaRasterMath = { gradientEnergy, blurIndex };

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

    window.__tolariaRasterClear = () => {
        for (const e of document.querySelectorAll(`[${MARK}]`))
            e.removeAttribute(MARK);
    };

    /** Up to `max` printed faces, largest first, one per distinct layout
     *  width (a surface's size classes, not `max` copies of its biggest
     *  tile). Each is fully inside the viewport, resolved (`currentSrc`),
     *  decoded, at least 40 CSS px wide and unoccluded. */
    window.__tolariaRasterCandidates = (max) => {
        window.__tolariaRasterClear();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const all = [];
        for (const e of document.querySelectorAll(
            '[data-card-face="printed"]'
        )) {
            if (isDecorativeArt(e)) continue;
            if (!(e.currentSrc || e.src) || !e.complete || !e.naturalWidth)
                continue;
            const r = e.getBoundingClientRect();
            const layoutW = e.offsetWidth || r.width;
            if (layoutW < 40 || r.height < 40) continue;
            if (r.left < 0 || r.top < 0 || r.right > vw || r.bottom > vh)
                continue;
            if (!unoccluded(e, r)) continue;
            all.push({ e, r, layoutW });
        }
        all.sort((a, b) => b.layoutW - a.layoutW);
        const picked = [];
        const seen = new Set();
        for (const c of all) {
            const key = Math.round(c.layoutW);
            if (seen.has(key)) continue;
            seen.add(key);
            picked.push(c);
            if (picked.length >= max) break;
        }
        // The same short selector `probe.js` names an offender by, so a
        // blurred face outlines on the failure shot like any other.
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
        return picked.map((c, k) => {
            c.e.setAttribute(MARK, String(k));
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
            };
        });
    };

    function loadImage(src, cors) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            if (cors) img.crossOrigin = "anonymous";
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error(`image failed: ${src}`));
            img.src = src;
        });
    }

    function canvas(w, h) {
        const c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(w));
        c.height = Math.max(1, Math.round(h));
        const ctx = c.getContext("2d", { willReadFrequently: true });
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        return [c, ctx];
    }

    /** `spec`: `{ k, png64, src }` — the marked face, its element screenshot
     *  (device pixels) and the resource to compare against. Returns the three
     *  energies and the Blur Index, or `{ error }`. */
    window.__tolariaRasterCompare = async (spec) => {
        const e = document.querySelector(`[${MARK}="${spec.k}"]`);
        if (!e) return { error: "the marked face is gone" };
        let shotImg;
        let ref;
        try {
            shotImg = await loadImage(
                "data:image/png;base64," + spec.png64,
                false
            );
        } catch {
            return { error: "screenshot undecodable" };
        }
        try {
            ref = await loadImage(spec.src, true);
        } catch {
            return { error: "reference fetch failed (CORS or network)" };
        }
        const W = shotImg.naturalWidth;
        const H = shotImg.naturalHeight;
        const [, shotCtx] = canvas(W, H);
        shotCtx.drawImage(shotImg, 0, 0);
        // `object-fit: cover` mapping of the resource onto the face's box: the
        // resource is scaled by the larger of the two ratios and centred, so
        // the box shows a centred crop of it.
        const nw = ref.naturalWidth;
        const nh = ref.naturalHeight;
        const s = Math.max(W / nw, H / nh);
        const dw = nw * s;
        const dh = nh * s;
        const ox = (W - dw) / 2;
        const oy = (H - dh) / 2;
        const [, refCtx] = canvas(W, H);
        refCtx.drawImage(ref, ox, oy, dw, dh);
        const [halfC, halfCtx] = canvas(W / 2, H / 2);
        halfCtx.drawImage(ref, ox / 2, oy / 2, dw / 2, dh / 2);
        const [, upCtx] = canvas(W, H);
        upCtx.drawImage(halfC, 0, 0, W, H);
        let shotData;
        try {
            shotData = shotCtx.getImageData(0, 0, W, H).data;
        } catch {
            return { error: "screenshot canvas unreadable" };
        }
        let refData;
        let halfData;
        try {
            refData = refCtx.getImageData(0, 0, W, H).data;
            halfData = upCtx.getImageData(0, 0, W, H).data;
        } catch {
            return { error: "reference canvas tainted (no CORS)" };
        }
        const shot = gradientEnergy(shotData, W, H, INSET);
        const refE = gradientEnergy(refData, W, H, INSET);
        const half = gradientEnergy(halfData, W, H, INSET);
        return {
            shot: +shot.toFixed(3),
            ref: +refE.toFixed(3),
            half: +half.toFixed(3),
            blur: blurIndex(shot, refE, half),
            pxW: W,
            pxH: H,
            natW: nw,
        };
    };
})();
