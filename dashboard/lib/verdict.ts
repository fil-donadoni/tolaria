import type { Tone } from "./tones";
import type { LoopVerdictState } from "./nowPayload";
import type { TermId } from "../glossary";

/**
 * The loop verdict's vocabulary (PRD #3148 S2), ported from
 * `scripts/dashboard/now-verdict-band.js` (#2624).
 *
 * `verdict` is `deriveLoopVerdict`'s output (`scripts/lib/loop-status.ts`),
 * the SAME object `bun run loop:status` prints. The band RENDERS it; it never
 * re-derives a health statement from `driver.armed` / `driver.pidAlive` /
 * `driver.stopFilePresent`, which is how the two surfaces used to be able to
 * disagree.
 */

/**
 * Keys are `LOOP_VERDICT_STATES`. The fallback in `verdictTone` is `bad`, not
 * `good`: an unrecognised state must shout, never render as health. The map is
 * a `Record` over the literal union, so a state added upstream is a COMPILE
 * error here — the guard the vanilla module needed a test for.
 */
export const VERDICT_TONE: Record<LoopVerdictState, Tone> = {
    "NEEDS ATTENTION": "bad",
    STALLED: "bad",
    STOPPED: "warn",
    RUNNING: "good",
    IDLE: "good",
};

export const verdictTone = (state: LoopVerdictState): Tone =>
    VERDICT_TONE[state] ?? "bad";

/** Each verdict state's own glossary entry. */
export const VERDICT_TERM: Record<LoopVerdictState, TermId> = {
    "NEEDS ATTENTION": "loop.NEEDS ATTENTION",
    STALLED: "loop.STALLED",
    STOPPED: "loop.STOPPED",
    RUNNING: "loop.RUNNING",
    IDLE: "loop.IDLE",
};

/**
 * A remedy is PROSE that BACKTICKS its literals, not a bare command string —
 * see `REMEDY` in `scripts/lib/loop-status.ts`, e.g. "`bun run loop:doctor` to
 * inspect, `bun run loop:doctor --release` to drop `in-progress` on the
 * orphans". So a copy affordance wired to the whole remedy would put an
 * English sentence on the clipboard.
 *
 * This splits it: odd indices are the backticked spans, which the band renders
 * as code with their OWN copy affordance carrying exactly that span; the prose
 * between them stays prose. A remedy with no backticks (the engine is free to
 * word one that way) gets no copy affordance at all rather than a button that
 * copies a sentence.
 */
export const splitRemedy = (remedy: string | null | undefined): string[] =>
    String(remedy ?? "").split(/`([^`]+)`/);
