/*
 * The occlusion probe — the SINGLE source for what "measured" means in this
 * repo (issue #2580).
 *
 * This file is a pure BROWSER-side script — no imports, no build step. The
 * runner (`scripts/ui-gate/index.ts`) injects it with `addScriptTag` and calls
 * `window.__tolariaProbe()`; a human driving chrome-devtools-mcp pastes the
 * arrow function below (everything after the `=`) into `evaluate_script`.
 * `docs/guides/browser-verification.md` points at this file rather than
 * embedding a copy — the guide used to carry a shorter copy of its own and the
 * two had already diverged (the manual one had lost the touch-target,
 * tiny-text and chrome-height measurements).
 *
 * Provenance: the richer variant lives in the sibling design-canvas repo
 * (`tolaria-design-canvas/audit/probe.js`); this is that version, vendored.
 *
 * WHY it looks like this — the `reachable` / `occ` distinction is load
 * bearing. An earlier version clamped every element's centre into the viewport
 * before hit-testing, so anything below the fold hit whatever happened to sit
 * at the clamp point and counted as occluded: it reported 90 of 95 on a screen
 * whose real count was 25. Never hit-test a point the element does not occupy.
 * The same rule, one level down (issue #2582): never hit-test a point the
 * element's own SCROLL PORT does not show — see `scrollPort` / `seen` below.
 *
 * The whole file must stay evaluatable as a single expression: no imports, no
 * closures over module scope, no optional chaining on globals that older
 * Chrome headless shells lack.
 */
window.__tolariaProbe = () => {
    const V = innerWidth,
        H = innerHeight;
    const vis = (e) => {
        const cs = getComputedStyle(e);
        return (
            cs.display !== "none" &&
            cs.visibility !== "hidden" &&
            cs.opacity !== "0"
        );
    };
    const canScroll = (e) =>
        e.scrollHeight > e.clientHeight + 2 ||
        e.scrollWidth > e.clientWidth + 2;
    /**
     * The nearest ancestor that can actually scroll `e` into view, or `null`.
     *
     * Returns the ELEMENT rather than a boolean because its box is also the
     * window the element is visible through — see `probe` below. `auto|scroll`
     * only, never `hidden`/`clip`: a clipped-hidden element is not reachable
     * by any gesture, which is the `stranded` case.
     */
    const scrollPort = (e) => {
        for (let p = e.parentElement; p; p = p.parentElement) {
            const cs = getComputedStyle(p);
            if (/auto|scroll/.test(cs.overflowY + cs.overflowX) && canScroll(p))
                return p;
        }
        return null;
    };
    const probe = (list) => {
        const o = {
            n: list.length,
            zero: 0,
            occ: 0,
            reachable: 0,
            stranded: 0,
        };
        for (const e of list) {
            const r = e.getBoundingClientRect();
            if (r.width < 4 || r.height < 4) {
                o.zero++;
                continue;
            }
            const cx = r.left + r.width / 2,
                cy = r.top + r.height / 2;
            // The window the element is actually SEEN through: the viewport,
            // further clipped by its scroll port's box when it has one.
            //
            // Hit-testing against the bare viewport was correct only while
            // `<main>` ran to the bottom of the screen: an element clipped by
            // `<main>`'s own scroller was then clipped by the viewport too, so
            // its centre fell outside and it scored `reachable` — "below the
            // fold, one gesture away", which is what it is. Issue #2582's
            // bottom nav is the first band this app has ever had BELOW
            // `<main>`, and it moves `<main>`'s clip edge above the viewport
            // edge. Everything in the gap then hit-tested to the nav and
            // scored `occ` — the nav "occluding" content it cannot overlap,
            // because `<main>` never paints there. Browser-measured on the
            // lobby at 390x844x3: `<main>` 0-788, nav 788-844, the `Your
            // Events (all)` button at y 773-817 (centre 795) — `occ 1` on
            // `feat/issue-2582`, `occ 0` on `origin/main` where `<main>` ran
            // to 844, same button, same page, no difference a user could see.
            //
            // Clipping the test to the port keeps `occ` meaning what it has
            // to mean — PAINTED and covered by something on top. A band that
            // genuinely overlays `<main>` (`position: fixed`) does not shrink
            // its box, so the centre stays inside the window, the hit test
            // still runs, and the overlay is still caught.
            const port = scrollPort(e);
            const pr = port ? port.getBoundingClientRect() : null;
            const seen =
                cx >= 0 &&
                cx <= V - 1 &&
                cy >= 0 &&
                cy <= H - 1 &&
                (pr === null ||
                    (cx >= pr.left &&
                        cx <= pr.right - 1 &&
                        cy >= pr.top &&
                        cy <= pr.bottom - 1));
            if (seen) {
                const t = document.elementFromPoint(cx, cy);
                if (t && !e.contains(t) && !t.contains(e)) o.occ++;
            } else if (port) o.reachable++;
            else o.stranded++;
        }
        return o;
    };

    // Scroll containers shorter than the tallest thing inside them — the
    // deck-builder bug class (a 66px window around a 101px card tile).
    const starved = [];
    for (const el of document.querySelectorAll("*")) {
        const cs = getComputedStyle(el);
        if (!/auto|scroll/.test(cs.overflowY + cs.overflowX)) continue;
        const kids = [...el.children];
        if (!kids.length || el.clientHeight === 0) continue;
        const tallest = Math.max(
            ...kids.map((k) => k.getBoundingClientRect().height)
        );
        if (tallest > 40 && el.clientHeight < tallest * 0.9)
            starved.push({
                cls: (el.className || "").toString().slice(0, 40),
                h: el.clientHeight,
                tallest: Math.round(tallest),
            });
    }

    // Interactive targets under 44px (visible, in the viewport band).
    const small = [];
    const ctrls = [
        ...document.querySelectorAll(
            "button,a[href],input,select,[role=button],[role=tab],[role=option]"
        ),
    ];
    for (const e of ctrls) {
        if (!vis(e)) continue;
        const r = e.getBoundingClientRect();
        if (r.width < 4 || r.height < 4) continue;
        if (r.bottom < 0 || r.top > H) continue;
        if (Math.min(r.width, r.height) < 44)
            small.push({
                t: (e.getAttribute("aria-label") || e.textContent || e.tagName)
                    .trim()
                    .slice(0, 24),
                w: Math.round(r.width),
                h: Math.round(r.height),
            });
    }

    // Text below 12px.
    let tiny = 0;
    const tinyEx = new Set();
    for (const e of document.querySelectorAll("body *")) {
        if (!e.childNodes.length) continue;
        if (
            ![...e.childNodes].some(
                (n) => n.nodeType === 3 && n.textContent.trim()
            )
        )
            continue;
        if (!vis(e)) continue;
        const fs = parseFloat(getComputedStyle(e).fontSize);
        if (fs < 12) {
            tiny++;
            if (tinyEx.size < 5)
                tinyEx.add(fs + "px " + e.textContent.trim().slice(0, 20));
        }
    }

    const hOverflow = document.documentElement.scrollWidth - V;

    // A decorative image (AmbientPageGround's random full-bleed art,
    // FeaturedDeckArt's hero splash, the library-order deck mock, …) is not a
    // card — even though several of them draw from the exact same
    // `cards.scryfall.io` CDN as a real card image, which is what the raw
    // `img[src*="scryfall"]` selector below alone cannot tell apart. Every
    // decorative image in this codebase is marked `aria-hidden="true"` (own
    // convention, see `ambient-page-ground.tsx`, `featured-deck-art.tsx`,
    // `library-order/deck-mock.tsx`) — real card art (`card-image.tsx`,
    // `card-back.tsx`, `card-preview-face.tsx`, `stack-row.tsx`) never sets
    // it. `data-ambient-art` is named explicitly too, so the exclusion still
    // holds if a future edit ever drops the `aria-hidden` from that one spot.
    // Fail CLOSED: `closest` also walks ancestors, so an image nested inside
    // an `aria-hidden="true"` wrapper is excluded even without the attribute
    // on the `<img>` itself.
    const isDecorativeArt = (e) =>
        !!e.closest('[data-ambient-art],[aria-hidden="true"]');

    const imgs = [
        ...document.querySelectorAll(
            'img[src*="scryfall"],img[src*="card-back"],img[src*="/cards/"],img[data-card-id],[data-card-id] img'
        ),
    ].filter((e) => !isDecorativeArt(e));
    const sizes = imgs
        .map((i) => i.getBoundingClientRect().width)
        .filter((w) => w > 4);
    const cardW = sizes.length
        ? {
              min: Math.round(Math.min(...sizes)),
              max: Math.round(Math.max(...sizes)),
          }
        : null;

    // Fixed/sticky chrome eating the top and bottom of the viewport.
    let topChrome = 0,
        bottomChrome = 0;
    for (const e of document.querySelectorAll("*")) {
        const cs = getComputedStyle(e);
        if (!/fixed|sticky/.test(cs.position) || !vis(e)) continue;
        const r = e.getBoundingClientRect();
        if (r.width < V * 0.6) continue;
        if (r.top <= 1 && r.height < H * 0.5)
            topChrome = Math.max(topChrome, r.bottom);
        if (r.bottom >= H - 1 && r.height < H * 0.5)
            bottomChrome = Math.max(bottomChrome, H - r.top);
    }

    const main = document.querySelector("main") || document.body;
    const mr = main.getBoundingClientRect();

    return {
        vp: V + "x" + H,
        dpr: devicePixelRatio,
        docH: document.documentElement.scrollHeight,
        hOverflow,
        topChrome: Math.round(topChrome),
        bottomChrome: Math.round(bottomChrome),
        mainTop: Math.round(mr.top),
        cards: probe(imgs),
        cardW,
        ctrls: probe(ctrls),
        starvedN: starved.length,
        starved: starved.slice(0, 4),
        smallN: small.length,
        small: small.slice(0, 8),
        tinyText: tiny,
        tinyEx: [...tinyEx],
    };
};
