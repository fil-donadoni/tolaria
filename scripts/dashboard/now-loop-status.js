import { nowBodyHtml, nowSubtitleText } from "./now.js";
import { initNowNav } from "./now-nav.js";

/**
 * The Now view's TRANSPORT (#2519, split out in #2625, narrowed in #2630) —
 * polls GET /api/loop-status, which reads no DB, so it must render whether or
 * not telemetry.db exists.
 *
 * What is left here is only what is impure: the fetch, the poll timer, and the
 * single write into the DOM. The composition of the payload into HTML is
 * `now.js` — one payload, one composition, callable from the `node` project.
 *
 * THAT WRITE IS FOCUS-PRESERVING (PR #2837 review, finding 1). #2630 is what
 * first put focusable controls in this container — four `.ls-light` buttons
 * and the remedy's `.ls-copy` buttons — which turned a pre-existing
 * unconditional `innerHTML =` into a real defect: a ten-second poll silently
 * moved `document.activeElement` back to `<body>`, six times a minute, so a
 * light was keyboard-REACHABLE but not keyboard-OPERABLE. See
 * `writeBodyPreservingFocus` below.
 *
 * DATA BOUNDARY: this module and everything it imports touch `/api/loop-status`
 * and nothing else. No History module may be imported from here, directly or
 * transitively — `scripts/__tests__/telemetry-serve.test.ts` asserts it.
 *
 * The only mutable state is `loopStatusTimer`, private to this module and
 * reachable only through `startLoopStatusPolling()`.
 */

/**
 * The identity of a focusable control inside the Now body, stable across a
 * re-render — or `null` for anything that is not one of this container's own
 * controls, which is what makes "the operator has focused something else on
 * the page" a no-op rather than a steal.
 *
 * Not an INDEX: the four lights are fixed, but the remedy's copy buttons come
 * and go with the verdict, so position is not identity. Not a CSS SELECTOR
 * either — a `data-copy` holds arbitrary command text, and building a
 * selector out of it means escaping it correctly. Comparing a `kind:value`
 * string against this same function run over the NEW nodes needs neither.
 *
 * The timeline (#2631) added three MORE kinds of focusable control — a pass
 * block, a claim pin, a merge tick — and every poll recomputes their
 * positions from the current clock (`now-timeline.js`), so the write almost
 * never takes the "skip an unchanged write" path below; without an identity
 * here EVERY poll would silently drop focus back to `<body>`, the exact bug
 * PR #2837 round 2 fixed for the lights and the copy button.
 */
export function nowControlKey(el) {
    if (!el || !el.classList) return null;
    if (el.classList.contains("ls-light"))
        return `light:${el.dataset.target ?? ""}`;
    if (el.classList.contains("ls-copy"))
        return `copy:${el.dataset.copy ?? ""}`;
    if (el.classList.contains("ls-tl-pass"))
        return `tl-pass:${el.dataset.pass ?? ""}`;
    if (el.classList.contains("ls-tl-claim"))
        return `tl-claim:${el.dataset.issue ?? ""}`;
    if (el.classList.contains("ls-tl-merge"))
        return `tl-merge:${el.dataset.pr ?? ""}`;
    return null;
}

/** Everything in the Now body a keyboard can land on. */
const NOW_CONTROLS =
    ".ls-light, .ls-copy, .ls-tl-pass, .ls-tl-claim, .ls-tl-merge";

/**
 * Write `html` into `container` without destroying keyboard focus. Returns
 * whether the DOM was actually touched.
 *
 * TWO defences, because neither alone is enough:
 *
 *   1. SKIP an unchanged write. Most polls report the same loop state, and
 *      not re-creating identical nodes preserves more than focus — the copy
 *      button's transient "copied" label, and any running animation, survive
 *      too. Compared against the container's own serialization, so it is
 *      self-correcting: if a browser ever round-trips our markup differently
 *      the skip simply never fires and defence 2 carries the case.
 *   2. RESTORE focus across a write that did change something. A poll that
 *      lands while the payload genuinely moved (a light flipping tone is
 *      exactly when an operator is looking) must not cost the focus ring.
 *
 * `preventScroll` is load-bearing: the operator's scroll position is theirs,
 * and a poll that yanked the page back to the focused light would be a
 * louder version of the bug this fixes.
 */
export function writeBodyPreservingFocus(container, html) {
    if (container.innerHTML === html) return false;
    const active = container.ownerDocument?.activeElement ?? null;
    const key =
        active && container.contains(active) ? nowControlKey(active) : null;
    container.innerHTML = html;
    if (key === null) return true;
    for (const el of container.querySelectorAll(NOW_CONTROLS)) {
        if (nowControlKey(el) === key) {
            el.focus({ preventScroll: true });
            break;
        }
    }
    return true;
}

export function renderLoopStatus(data) {
    document.getElementById("loop-status-sub").textContent =
        nowSubtitleText(data);
    writeBodyPreservingFocus(
        document.getElementById("loop-status-body"),
        nowBodyHtml(data)
    );
    // Idempotent, and after the first body exists: the listener is delegated
    // on the container, so it survives every subsequent innerHTML rewrite.
    initNowNav();
}

export async function refreshLoopStatus() {
    try {
        const res = await fetch("/api/loop-status");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        renderLoopStatus(data);
    } catch (e) {
        document.getElementById("loop-status-sub").textContent =
            `error: ${e.message}`;
    }
}

const LOOP_STATUS_POLL_MS = 10_000;
let loopStatusTimer = null;

export function startLoopStatusPolling() {
    refreshLoopStatus();
    if (loopStatusTimer) clearInterval(loopStatusTimer);
    loopStatusTimer = setInterval(() => {
        // A forgotten background tab must not poll `gh` forever.
        if (document.visibilityState === "visible") refreshLoopStatus();
    }, LOOP_STATUS_POLL_MS);
}

document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refreshLoopStatus();
});
