/**
 * The shared hover tooltip layer (#2625).
 *
 * Owns `#tip` — a single position:fixed element outside both views, so a
 * tooltip opened over a chart is never clipped by a card's scroll container.
 * `#tip` is the only mutable state here and it is the DOM node itself; nothing
 * else on the page writes to it.
 */

const tip = document.getElementById("tip");

export function showTip(evt, html) {
    tip.innerHTML = html;
    tip.style.opacity = "1";
    const pad = 14;
    const r = tip.getBoundingClientRect();
    let x = evt.clientX + pad;
    let y = evt.clientY + pad;
    if (x + r.width > innerWidth - 8) x = evt.clientX - r.width - pad;
    if (y + r.height > innerHeight - 8) y = evt.clientY - r.height - pad;
    tip.style.left = x + "px";
    tip.style.top = y + "px";
}

export const hideTip = () => (tip.style.opacity = "0");

document.addEventListener("scroll", hideTip, true);
