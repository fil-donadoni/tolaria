import type { Tone } from "./tones";
import type { TermId } from "../glossary";
import type { ClaimStage, ClaimVerdictState, SessionView } from "./nowPayload";

/**
 * The claims table's vocabulary (PRD #3148 S2), ported from
 * `scripts/dashboard/now-claims-table.js` (#2632/#3135).
 */

/**
 * The classifier's own "too young to judge" cutoff, MIRRORED rather than
 * imported (#2632 AC: "the same constant, not a new one").
 * `scripts/loop-doctor.ts` exports the real value as `DEFAULT_MIN_AGE_HOURS`;
 * this is a browser program that cannot pull a Node-typed module into its
 * type-check (see `nowPayload.ts`). The drift guard runs the other direction,
 * in a `.ts` test that CAN cross the boundary:
 * `loop-status-dashboard.test.ts` imports both and asserts they are equal.
 */
export const MIN_AGE_HOURS = 2;

/**
 * `×`/`?`/`·` become WORDS (#2632 AC). The per-row REASON stays dynamic — the
 * glossary's `claim.*` entries carry only a STATIC explanation, not the
 * specific "claimed 24h ago" a row needs — so this map holds only the three
 * fixed words, in lower case, mirroring the Claims light's own
 * `ORPHANED`/`UNSURE`/`WORKING`.
 */
export const VERDICT_WORD: Record<ClaimVerdictState, string> = {
    orphan: "orphaned",
    suspect: "unsure",
    live: "working",
};

export const VERDICT_TONE: Record<ClaimVerdictState, Tone> = {
    orphan: "bad",
    suspect: "warn",
    live: "good",
};

export const VERDICT_TERM: Record<ClaimVerdictState, TermId> = {
    orphan: "claim.orphan",
    suspect: "claim.suspect",
    live: "claim.live",
};

/**
 * Stage → a sentence naming what is DONE and what is MISSING (#2632 AC), more
 * specific than the glossary's own short `stage.*` label ("branch pushed").
 * The term is still declared, so the glossary's explanation is available as a
 * SECOND, complementary layer.
 */
export const STAGE_SENTENCE: Record<ClaimStage, string> = {
    claimed: "Claimed, no worktree yet",
    worktree: "Worktree started, no branch pushed yet",
    "branch pushed": "Branch pushed, no PR yet",
    "PR open": "PR open, waiting for review",
    merging: "Approved, merging",
};

export const STAGE_TERM: Record<ClaimStage, TermId> = {
    claimed: "stage.claimed",
    worktree: "stage.worktree",
    "branch pushed": "stage.branch pushed",
    "PR open": "stage.PR open",
    merging: "stage.merging",
};

/**
 * `blocks N others` (#2632 AC) — the number of OPEN issues that name this
 * claim as a blocker. `countDependents` reuses `parseDependencies`
 * (`lib/queue-plan.ts`) — ONE parser, correctly — but that also matches prose
 * keywords ("depends on #N", "requires #N", "after #N") anywhere in a body,
 * not only an explicit `## Blocked by` list item. The tooltip must not claim a
 * stricter form than what was actually counted (#2632 review finding 7), so it
 * names both.
 */
export const dependentsTitle = (issue: number, n: number): string =>
    `${n} open ${n === 1 ? "issue names" : "issues name"} #${issue} as a blocker — ` +
    `a "Blocked by" entry or blocking language ("depends on"/"requires"/"after") ` +
    `elsewhere in the body`;

/** Tone + glossary term per liveness word the server sends. */
export const LIVENESS: Record<
    string,
    { tone: Tone; term: TermId; word: string }
> = {
    active: { tone: "good", term: "live.active", word: "active" },
    live: { tone: "warn", term: "live.live", word: "recent" },
    idle: { tone: "neutral", term: "live.idle", word: "idle" },
};

/** A session's display name: its title, else its first prompt, else its id. */
export function sessionLabel(
    s: Pick<SessionView, "title" | "lastPrompt" | "session">
): string {
    const raw = s.title || s.lastPrompt || s.session;
    const oneLine = String(raw).replace(/\s+/g, " ").trim();
    return oneLine.length > 72 ? `${oneLine.slice(0, 72)}…` : oneLine;
}
