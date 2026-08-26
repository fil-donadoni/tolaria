/**
 * The shared tooltip layer (#2625) and the term-driven tooltip engine (#2629).
 *
 * Owns `#tip` — a single position:fixed element outside both views, so a
 * tooltip opened over a chart is never clipped by a card's scroll container.
 * `#tip` is the only mutable state here and it is the DOM node itself; nothing
 * else on the page writes to it.
 *
 * ## Two ways in
 *
 * 1. `showTip(evt, html)` / `hideTip()` — the imperative pair the chart
 *    surfaces already use (`history-timeline.js`, `history-ranking.js`), where
 *    the tooltip body is per-datum HTML nobody could have declared in advance.
 *    Signatures unchanged from #2625.
 * 2. `data-term="<key>"` — the declarative path (#2629). Any element carrying
 *    it gets its glossary label and explanation, with no handler wired at the
 *    call site. That is the whole point: a later ticket labels a column by
 *    adding an attribute to a template string.
 *
 * ## Why the declarative path is DELEGATED
 *
 * Every table on this dashboard re-renders by assigning `innerHTML`, which
 * destroys and recreates its nodes. Per-element listeners would have to be
 * re-attached after each render, and the one that gets forgotten is a dead
 * tooltip nobody notices. So hover, focus and Escape are handled once, on the
 * document, by looking up `event.target.closest("[data-term]")`. The only
 * per-element work is the ENHANCEMENT — `tabindex`, `aria-describedby`, and
 * filling an empty element with its label — and a `MutationObserver` does that
 * for nodes as they arrive, so nothing has to remember to call anything.
 *
 * ## Keyboard reachability
 *
 * A hover-only tooltip is unreachable without a mouse. Enhanced terms get
 * `tabindex="0"` and open on focus, positioned under the element rather than
 * under a cursor that is not there, and `Escape` dismisses whatever is open.
 *
 * ## No DOM at module scope
 *
 * `#tip` is resolved lazily, and the document-level listeners install on first
 * use. That keeps this module importable under the `node` vitest project, so
 * `dashboard-glossary.test.ts` can drive the engine against a real DOM rather
 * than grep its source.
 */

import { lookupTerm } from "./glossary.js";
import { esc } from "./format.js";

/** @type {HTMLElement | null} */
let tipEl = null;
let listenersInstalled = false;
/** @type {MutationObserver | undefined} */
let termObserver;

/** The `#tip` layer, resolved on first use. Null when the shell has no
 *  tooltip layer (a surface that imported this module standalone). */
function layer() {
    if (tipEl && tipEl.isConnected !== false) return tipEl;
    tipEl = document.getElementById("tip");
    if (tipEl && !tipEl.hasAttribute("role")) {
        tipEl.setAttribute("role", "tooltip");
        tipEl.setAttribute("aria-hidden", "true");
    }
    return tipEl;
}

/** Place the layer near a viewport point, flipping when it would overflow. */
function place(el, clientX, clientY) {
    const pad = 14;
    const r = el.getBoundingClientRect();
    let x = clientX + pad;
    let y = clientY + pad;
    if (x + r.width > innerWidth - 8) x = clientX - r.width - pad;
    if (y + r.height > innerHeight - 8) y = clientY - r.height - pad;
    el.style.left = x + "px";
    el.style.top = y + "px";
}

function open(el, html) {
    el.innerHTML = html;
    el.style.opacity = "1";
    el.setAttribute("aria-hidden", "false");
}

/**
 * Show the tooltip at a pointer event's position.
 * @param {{ clientX: number, clientY: number }} evt
 * @param {string} html
 */
export function showTip(evt, html) {
    const el = layer();
    if (!el) return;
    installListeners();
    open(el, html);
    place(el, evt.clientX, evt.clientY);
}

/**
 * Show the tooltip anchored under an element — the keyboard path, where there
 * is no cursor to position against.
 * @param {Element} anchor
 * @param {string} html
 */
export function showTipFor(anchor, html) {
    const el = layer();
    if (!el) return;
    installListeners();
    open(el, html);
    const r = anchor.getBoundingClientRect();
    place(el, r.left, r.bottom - 6);
}

export const hideTip = () => {
    const el = layer();
    if (!el) return;
    el.style.opacity = "0";
    el.setAttribute("aria-hidden", "true");
};

/**
 * The tooltip body for a glossary entry: the human label in bold, then the
 * sentence saying what the term counts. Both escaped — a glossary entry is
 * data, not markup.
 * @param {{ label: string, tip: string }} entry
 */
export function tooltipHtml(entry) {
    return `<b>${esc(entry.label)}</b><br>${esc(entry.tip)}`;
}

/** The nearest ancestor (or self) that declares a resolvable term. */
function termTargetOf(node) {
    if (!node || typeof node.closest !== "function") return null;
    const el = node.closest("[data-term]");
    if (!el) return null;
    const entry = lookupTerm(el.getAttribute("data-term"));
    return entry ? { el, entry } : null;
}

/**
 * Enhance every declared term under `root`: focusable, described by the
 * tooltip layer, and — when the element is empty AND has no accessible name
 * of its own — filled with its human label so a surface can write
 * `<th data-term="cmd_bucket"></th>` and get "command family".
 *
 * The `aria-label` exception (#2631 fixup) exists because an element can be
 * "empty" on purpose — a merge tick (`.ls-tl-merge`, `now-timeline.js`) is a
 * 5px-wide colour mark with NO visible label by design, its accessible name
 * carried entirely by its own `aria-label`. Filling `textContent` there
 * doesn't just duplicate the name, it PAINTS OVER the mark: measured in a
 * real browser, a 45px-wide "merged" text run rendered on top of every 5px
 * tick, all 40 of a live day's ticks illegible. An element that already
 * declares `aria-label` has already answered "what do I say to non-sighted
 * users" — this function's job is the DESCRIPTION (the tooltip body), not a
 * second, competing NAME.
 *
 * Idempotent (a re-enhanced element is skipped via `data-term-ready`), and it
 * reports the terms it could NOT resolve so a caller or a test can see a
 * misdeclared term instead of a silently plain element.
 *
 * @param {ParentNode} [root]
 * @returns {{ enhanced: Element[], unknown: string[] }}
 */
export function enhanceTerms(root) {
    const scope = root ?? document;
    const enhanced = [];
    const unknown = [];
    const candidates = [];
    if (
        typeof (/** @type {Element} */ (scope).matches) === "function" &&
        /** @type {Element} */ (scope).matches("[data-term]")
    ) {
        candidates.push(/** @type {Element} */ (scope));
    }
    candidates.push(...scope.querySelectorAll("[data-term]"));

    for (const el of candidates) {
        const term = el.getAttribute("data-term");
        const entry = lookupTerm(term);
        if (!entry) {
            if (term) unknown.push(term);
            continue;
        }
        if (el.getAttribute("data-term-ready") === "1") continue;
        el.setAttribute("data-term-ready", "1");
        if (
            !el.hasAttribute("aria-label") &&
            (!el.textContent || !el.textContent.trim())
        ) {
            el.textContent = entry.label;
        }
        el.classList.add("term");
        if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "0");
        el.setAttribute("aria-describedby", "tip");
        enhanced.push(el);
    }
    return { enhanced, unknown };
}

/** Document-level listeners, installed exactly once. */
function installListeners() {
    if (listenersInstalled) return;
    listenersInstalled = true;

    // Scroll moves the anchor out from under a fixed layer — #2625.
    document.addEventListener("scroll", hideTip, true);

    // Escape dismisses whatever is open, from anywhere on the page. Not
    // conditional on focus being inside a term: the tooltip is a fixed overlay
    // and the user's mental model is "Escape closes the thing on screen".
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") hideTip();
    });

    // Delegation, not per-element listeners: the tables re-render by
    // innerHTML. `mouseover`/`mouseout` rather than `mouseenter`/`mouseleave`
    // because only the former bubble.
    document.addEventListener("mouseover", (e) => {
        const hit = termTargetOf(e.target);
        if (hit) showTip(e, tooltipHtml(hit.entry));
    });
    document.addEventListener("mouseout", (e) => {
        if (termTargetOf(e.target)) hideTip();
    });
    document.addEventListener("focusin", (e) => {
        const hit = termTargetOf(e.target);
        if (hit) showTipFor(hit.el, tooltipHtml(hit.entry));
    });
    document.addEventListener("focusout", (e) => {
        if (termTargetOf(e.target)) hideTip();
    });
}

/**
 * Start the declarative engine: delegated behaviour plus an observer that
 * enhances terms as they are rendered. Idempotent; call it once from the
 * entry point.
 *
 * @param {ParentNode} [root]
 * @returns {{ enhanced: Element[], unknown: string[] }} the first pass
 */
export function installTooltipEngine(root) {
    const scope = root ?? document;
    installListeners();
    const first = enhanceTerms(scope);
    if (typeof MutationObserver === "function" && !termObserver) {
        termObserver = new MutationObserver((records) => {
            for (const rec of records) {
                for (const node of rec.addedNodes) {
                    if (node.nodeType === 1) enhanceTerms(node);
                }
            }
        });
        termObserver.observe(scope, { childList: true, subtree: true });
    }
    return first;
}

/** Reset every module-level latch. Test-only — the engine is a singleton on
 *  the page, and a suite that swaps the global document needs a way to say so. */
export function resetTooltipEngine() {
    tipEl = null;
    listenersInstalled = false;
    if (termObserver) {
        termObserver.disconnect();
        termObserver = undefined;
    }
}
