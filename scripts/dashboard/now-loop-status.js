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
 * DATA BOUNDARY: this module and everything it imports touch `/api/loop-status`
 * and nothing else. No History module may be imported from here, directly or
 * transitively — `scripts/__tests__/telemetry-serve.test.ts` asserts it.
 *
 * The only mutable state is `loopStatusTimer`, private to this module and
 * reachable only through `startLoopStatusPolling()`.
 */

export function renderLoopStatus(data) {
    document.getElementById("loop-status-sub").textContent =
        nowSubtitleText(data);
    document.getElementById("loop-status-body").innerHTML = nowBodyHtml(data);
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
