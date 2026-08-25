import { esc } from "./format.js";

/**
 * The loop verdict band (#2624, split out in #2625).
 *
 * `verdict` is `deriveLoopVerdict`'s output (scripts/lib/loop-status.ts), the
 * SAME object `bun run loop:status` prints. This RENDERS it; it never
 * re-derives a health statement from `driver.armed` / `driver.pidAlive` /
 * `driver.stopFilePresent`, which is how the two surfaces used to be able to
 * disagree.
 *
 * Pure — a verdict in, an HTML string out — so the guard in
 * `scripts/__tests__/loop-status-dashboard.test.ts` can CALL it rather than
 * grep for its source.
 */

/**
 * Keys are `LOOP_VERDICT_STATES`; the guard in
 * `scripts/__tests__/loop-status-dashboard.test.ts` fails if the engine grows
 * a state this map does not name. The fallback in `verdictTone` below is
 * `bad`, not `good`: an unrecognised state must shout, never render as health.
 */
export const VERDICT_TONE = {
    "NEEDS ATTENTION": "bad",
    STALLED: "bad",
    STOPPED: "warn",
    RUNNING: "good",
    IDLE: "good",
};

/** The tone class for a state — unknown states get the loud one. */
export const verdictTone = (state) => VERDICT_TONE[state] ?? "bad";

export function verdictBandHtml(verdict) {
    if (!verdict) return "";
    return (
        `<div class="ls-verdict">` +
        `<span class="ls-verdict-state ${verdictTone(verdict.state)}">${esc(verdict.state)}</span>` +
        `<span class="ls-verdict-sentence">${esc(verdict.sentence)}</span>` +
        `<span class="ls-verdict-remedy">→ ${esc(verdict.remedy)}</span>` +
        `</div>` +
        (verdict.findings ?? [])
            .map(
                (f) =>
                    `<div class="ls-finding">· ${esc(f.code)}: ${esc(f.detail)}</div>`
            )
            .join("")
    );
}
