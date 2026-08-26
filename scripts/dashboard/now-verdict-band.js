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

/**
 * The remedy is PROSE that BACKTICKS its literals, not a bare command string
 * — see the `REMEDY` map in `scripts/lib/loop-status.ts`, e.g. "`bun run
 * loop:doctor` to inspect, `bun run loop:doctor --release` to drop
 * `in-progress` on the orphans". So a copy button wired to the whole remedy
 * would put an English sentence on the clipboard.
 *
 * Instead each backtick-quoted span becomes a `<code>` with its OWN copy
 * affordance carrying exactly that span, and the prose between them is
 * rendered as prose. A remedy with no backticks (the engine is free to word
 * one that way) gets no copy affordance at all rather than a button that
 * copies a sentence — #2630 replaces this whole treatment with a real action
 * button where D4 allows one.
 *
 * THE LABEL SAYS "Copy <literal>", NOT "Copy the command <literal>" (PR #2837
 * review, finding 2). Only five of the seven `REMEDY` values backtick a
 * command: `orphans` backticks the label `in-progress` and `feed` backticks
 * `ready-for-agent`, both GitHub label names you paste into `gh`, not things
 * you run. A screen reader announcing "Copy the command ready-for-agent" is
 * simply wrong, and sniffing "does this look like a command" would be a guess
 * this module has no business making — the button copies the literal, so the
 * literal is what the accessible name states. The guard iterates `REMEDY`
 * (exported from `scripts/lib/loop-status.ts` for exactly that), so a new
 * remedy is covered the day it is written.
 *
 * Pure, and exported on its own so the `node` project can assert what lands
 * on the clipboard without a DOM.
 */
export function remedyHtml(remedy) {
    // Odd indices are the backticked spans: "a `b` c" → ["a ", "b", " c"].
    return String(remedy ?? "")
        .split(/`([^`]+)`/)
        .map((part, i) =>
            i % 2 === 0
                ? esc(part)
                : `<code class="ls-cmd">${esc(part)}</code>` +
                  `<button type="button" class="ls-copy" data-copy="${esc(part)}" ` +
                  `aria-label="Copy ${esc(part)}" title="Copy">copy</button>`
        )
        .join("");
}

export function verdictBandHtml(verdict) {
    if (!verdict) return "";
    return (
        `<div class="ls-verdict">` +
        `<span class="ls-verdict-state ${verdictTone(verdict.state)}">${esc(verdict.state)}</span>` +
        `<span class="ls-verdict-sentence">${esc(verdict.sentence)}</span>` +
        `<span class="ls-verdict-remedy">→ ${remedyHtml(verdict.remedy)}</span>` +
        `</div>` +
        (verdict.findings ?? [])
            .map(
                (f) =>
                    `<div class="ls-finding">· ${esc(f.code)}: ${esc(f.detail)}</div>`
            )
            .join("")
    );
}
