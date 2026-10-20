/*
 * The failure-shot overlay (issue #6145): outlines every box that broke a
 * Floor, with its Floor's name, so the screenshot of a failing cell shows WHAT
 * failed instead of a whole screen to search.
 *
 * Like `probe.js`, a pure BROWSER-side script — no imports, no build step. The
 * runner (`scripts/ui-gate/index.ts`) injects it with `addScriptTag`, calls
 * `window.__tolariaOutline(spec)`, takes the screenshot, then
 * `window.__tolariaOutlineClear()` — before the Named Assertions, which must
 * see the screen as the walk left it.
 *
 * `spec` is `{ boxes: [{ x, y, w, h, label }], banner: [string] }`, boxes in
 * viewport CSS pixels as the probe measured them. A box the viewport cannot
 * show is still drawn: a zero-size box is grown to `MIN` around its own
 * centre, and a stranded one (off-screen, nothing scrolls it back) is pinned,
 * dashed, to the nearest edge with `off-screen` in its label. The banner names
 * what has no box at all — a failed Named Assertion.
 *
 * Inert by construction: `pointer-events: none`, `aria-hidden`, and removed
 * before anything else reads the page.
 */
window.__tolariaOutline = (spec) => {
    window.__tolariaOutlineClear();
    const V = innerWidth,
        H = innerHeight;
    const MIN = 12;
    const RED = "#ff1744";
    const root = document.createElement("div");
    root.setAttribute("data-ui-gate-overlay", "");
    root.setAttribute("aria-hidden", "true");
    root.style.cssText =
        "position:fixed;inset:0;pointer-events:none;z-index:2147483647;";
    // Labels placed so far: two offenders side by side would otherwise
    // print one label over the other, and the reader loses a Floor.
    const placed = [];
    const tag = (text, left, top) => {
        const LH = 14;
        while (
            placed.some(
                (p) =>
                    Math.abs(p.top - top) < LH && Math.abs(p.left - left) < 160
            ) &&
            top < H - LH
        )
            top += LH;
        placed.push({ left, top });
        const t = document.createElement("div");
        t.textContent = text;
        t.style.cssText =
            "position:absolute;max-width:" +
            Math.max(120, V - left - 4) +
            "px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;" +
            "font:600 11px/14px system-ui,sans-serif;color:#fff;background:" +
            RED +
            ";padding:0 3px;left:" +
            left +
            "px;top:" +
            top +
            "px;";
        root.appendChild(t);
    };
    for (const b of spec.boxes || []) {
        let { x, y, w, h } = b;
        if (w < MIN) {
            x -= (MIN - w) / 2;
            w = MIN;
        }
        if (h < MIN) {
            y -= (MIN - h) / 2;
            h = MIN;
        }
        const off = x + w <= 0 || y + h <= 0 || x >= V || y >= H;
        // Pinned inside the viewport, keeping as much of the box as shows.
        const l = Math.min(Math.max(x, 0), V - MIN),
            t = Math.min(Math.max(y, 0), H - MIN),
            r = Math.max(Math.min(x + w, V), l + MIN),
            btm = Math.max(Math.min(y + h, H), t + MIN);
        const box = document.createElement("div");
        box.setAttribute("data-ui-gate-box", "");
        box.style.cssText =
            "position:absolute;box-sizing:border-box;border:3px " +
            (off ? "dashed " : "solid ") +
            RED +
            ";box-shadow:0 0 0 1px #fff;left:" +
            l +
            "px;top:" +
            t +
            "px;width:" +
            (r - l) +
            "px;height:" +
            (btm - t) +
            "px;";
        root.appendChild(box);
        tag((off ? "off-screen " : "") + b.label, l, t >= 14 ? t - 14 : btm);
    }
    const banner = spec.banner || [];
    if (banner.length) {
        const panel = document.createElement("div");
        panel.setAttribute("data-ui-gate-banner", "");
        panel.style.cssText =
            "position:absolute;left:4px;bottom:4px;max-width:" +
            (V - 8) +
            "px;font:600 12px/16px system-ui,sans-serif;color:#fff;" +
            "background:rgba(160,0,30,.9);padding:4px 6px;white-space:pre-wrap;";
        panel.textContent = banner.join("\n");
        root.appendChild(panel);
    }
    document.body.appendChild(root);
    return root.childElementCount;
};

window.__tolariaOutlineClear = () => {
    for (const e of document.querySelectorAll("[data-ui-gate-overlay]"))
        e.remove();
};
