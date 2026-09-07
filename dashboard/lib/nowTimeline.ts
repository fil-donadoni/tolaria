import type { Tone } from "./tones";
import { LIGHT_GLYPHS } from "./nowLights";
import type { NowPayload } from "./nowPayload";

/**
 * The Now view's 24-hour timeline (PRD #3148 S2), ported from
 * `scripts/dashboard/now-timeline.js` (#2631) — passes as blocks, claims as
 * pins with a tail, merges as ticks, on one shared time axis.
 *
 * WHY IT EXISTS. On 2026-08-19 the driver died at 00:58 holding five claims
 * and stayed dead for eight hours. The dashboard of the day had no way to show
 * that: a killed pass and a pass that ran and found nothing to do were the
 * same word in a log, and nothing showed a claim's AGE next to whether the
 * driver was even alive. This strip is the object that would have made the
 * outage legible at a glance.
 *
 * ── THE DATA MODEL ────────────────────────────────────────────────────────
 *
 *   * PASSES (`timelinePasses`) — a LOCAL read of `loop-drain.log`. Each line
 *     carries only a START (`epoch`): `loop-drain.sh` stamps it BEFORE
 *     `claude -p` runs and appends the line only once the pass has finished,
 *     so there is no logged END. `passItems` derives one — the next pass's
 *     start, or, for the newest pass, a bounded fallback width, never a
 *     stretch to "now" (a pass that died hours ago must not be drawn as
 *     though it were still running).
 *   * CLAIMS (`claims`, the SAME `ClaimRow[]` the table and the light read) —
 *     a snapshot of what is HELD RIGHT NOW. A released claim is by
 *     construction absent, so EVERY pin has an OPEN tail running from its
 *     (proxy) take time to "now" — which is precisely the outage signal.
 *     `takenAt` reuses `ageHours`, the same claim-time proxy the table and
 *     the light already trade on, not a second one invented here.
 *   * MERGES (`recentMerges`) — `gh pr list --state merged`. Fail-closed like
 *     `claims`: `null` with a sibling `recentMergesError`, never `[]`.
 *
 * Pure: a payload and a clock in, plain data out.
 */

/** The window — 24 hours. A literal here would drift from the gather layer's
 *  own `TIMELINE_WINDOW_HOURS`; `now-timeline.test.ts` asserts they are equal
 *  (the guard runs in a `.ts` test, which CAN cross the boundary). */
export const WINDOW_HOURS = 24;
const WINDOW_MS = WINDOW_HOURS * 3600_000;

/**
 * A pass's duration is never logged — only its START. The newest pass borrows
 * this width rather than stretching to "now": drawing a pass that died hours
 * ago as though it were still running would say the opposite of what the block
 * means. Echoes `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS`'s historical 600s
 * default (PRD #2621 D13) — a number already meaningful here.
 */
const FALLBACK_PASS_WIDTH_MS = 600_000;

/** The minimum width/diameter an item renders at, in PERCENT of the track — a
 *  pass that took 30 seconds must still be findable on a 24-hour axis. */
const MIN_ITEM_PCT = 0.6;
/** Minimum centre-to-centre spacing between claim pins — see `deconflict`. */
const MIN_PIN_GAP_PCT = 1.2;
/**
 * Minimum spacing between merge ticks — MEASURED, not guessed, and re-measured
 * for #2842 against this repo's own live day (39-42 merges) at all five
 * ADR-0101 viewports: 0.8% failed on the narrowest track (390px), 1.0%/1.2%/
 * 1.6% all held with zero mismatches. 2% is kept as roughly 2x the confirmed
 * working minimum.
 */
const MIN_TICK_GAP_PCT = 2;

export type PassOutcome = "landed" | "ran-nothing" | "died";

/**
 * Which of the three outcomes a pass's `reason` code represents (#2631 AC:
 * died / ran-and-landed-nothing / landed-something must be visually distinct
 * WITHOUT colour).
 *
 * Producer census — every `reason_field` value `scripts/loop-drain.sh` writes:
 *
 * | reason           | what it means                                            | outcome     |
 * | ---------------- | -------------------------------------------------------- | ----------- |
 * | `"-"`            | `total_open`/green-sha moved — real work landed           | landed      |
 * | `"no-progress"`  | ran twice with NEITHER moving — genuinely nothing to do   | ran-nothing |
 * | `"claims-held"`  | forcibly terminated mid-batch, still holding claims (D14) | died        |
 * | `"rate-limit"`   | `claude` hit a rate/usage limit, driver stopped itself    | died        |
 * | `"claude-error"` | `claude` exited non-zero, no rate-limit match, streak out | died        |
 * | `"claude-retry"` | `claude` exited non-zero, being retried (not yet fatal)   | died        |
 *
 * An unrecognised FUTURE code defaults to `died`, the loudest bucket — fail
 * loud, not fail quiet, matching `verdictTone`'s unknown-state fallback.
 */
export function passOutcome(reason: string): PassOutcome {
    if (reason === "-") return "landed";
    if (reason === "no-progress") return "ran-nothing";
    return "died";
}

/** Tone per pass outcome — the SAME three the four lights use, so a died pass
 *  and the Claims light's ORPHANED read as `bad` in the same hue. */
export const PASS_TONE: Record<PassOutcome, Tone> = {
    landed: "good",
    "ran-nothing": "warn",
    died: "bad",
};

/** The word a table cell prints for an outcome. */
export const PASS_WORD: Record<PassOutcome, string> = {
    landed: "landed",
    "ran-nothing": "ran, nothing landed",
    died: "died",
};

/** Glossary key per pass outcome. */
export const PASS_TERM = {
    landed: "pass.landed",
    "ran-nothing": "pass.ran-nothing",
    died: "pass.died",
} as const;

/** The SAME glyph vocabulary the lights established (`● ▲ ■`) — colour is
 *  never the only carrier, on this page or in this view. */
const PASS_GLYPH: Record<PassOutcome, string> = {
    landed: LIGHT_GLYPHS.good,
    "ran-nothing": LIGHT_GLYPHS.warn,
    died: LIGHT_GLYPHS.bad,
};

/** Tone + non-colour mark per claim verdict state — the SAME mapping the
 *  claims table renders, not a second one for this view. */
const CLAIM_TONE: Record<string, Tone> = {
    orphan: "bad",
    suspect: "warn",
    live: "good",
};
const CLAIM_MARK: Record<string, string> = {
    orphan: "×",
    suspect: "?",
    live: "·",
};

const clampPct = (v: number) => Math.min(100, Math.max(0, v));

/** A timestamp's position on the window's 0–100% axis, oldest on the left. */
function pct(ms: number, startMs: number, endMs: number): number {
    if (endMs <= startMs) return 0;
    return clampPct(((ms - startMs) / (endMs - startMs)) * 100);
}

/**
 * Push overlapping point-items apart along the axis, IN PLACE — measured
 * necessary in the browser: two issues claimed 14 SECONDS apart rendered as
 * fully overlapping 14px circles, one entirely unclickable. A 24-hour axis
 * cannot show second-level separation anyway, so every item keeps its own
 * gap-worth of space. `items` must already be sorted ascending by `.left`.
 *
 * ## Why this is a two-pass cascade, not one
 *
 * Never pushes an item PAST the right edge, and never collapses two onto the
 * SAME position — both were measured live, in order, on the same real
 * 40-merge day: a forward-only cascade ran an item past 100%; a shared ceiling
 * clamp reproduced the bug one level down (the last TWO ticks landed on the
 * same clamped position); a uniform leftward SHIFT broke on a third real shape
 * (most items spread out, then a dense cluster right before "now") because
 * shifting the whole array left has nowhere to go once the head is already at
 * the edge. A fourth attempt re-spaced EVERY item evenly by rank on any
 * overflow — always valid, but a fabrication: it rewrote a claim taken 20
 * HOURS ago to render at 0%.
 *
 * The fix: forward, then backward. Run the forward pass (never earlier than an
 * item's raw position). If it fits — the ordinary case — stop. Only on
 * overflow does a backward pass clamp the newest item to the edge and walk
 * left, tightening ONLY the crowded tail; an item with slack keeps its
 * forward-pass position exactly. Only when even that runs out of room —
 * genuinely more items than the window can fit — does the rank-by-position
 * comb kick in, scoped to that one unrecoverable case.
 */
function deconflict(sortedByLeft: { left: number }[], minGapPct: number): void {
    const n = sortedByLeft.length;
    if (n === 0) return;

    const raw = sortedByLeft.map((item) => item.left);

    let cursor = 0;
    for (let i = 0; i < n; i++) {
        sortedByLeft[i].left = Math.max(raw[i], cursor);
        cursor = sortedByLeft[i].left + minGapPct;
    }

    if (sortedByLeft[n - 1].left <= 100) return;

    sortedByLeft[n - 1].left = 100;
    for (let i = n - 2; i >= 0; i--) {
        const ceiling = sortedByLeft[i + 1].left - minGapPct;
        sortedByLeft[i].left = Math.min(sortedByLeft[i].left, ceiling);
    }

    if (sortedByLeft[0].left < 0) {
        const step = 100 / n;
        sortedByLeft.forEach((item, i) => {
            item.left = i * step;
        });
    }
}

export interface PassItem {
    pass: number;
    outcome: PassOutcome;
    tone: Tone;
    term: (typeof PASS_TERM)[PassOutcome];
    glyph: string;
    reason: string;
    claudeExit: number;
    left: number;
    width: number;
}

/**
 * Pass blocks, newest-last (the log's own append order).
 *
 * Passes are ALREADY chronological, so placing each one's LEFT no earlier than
 * the previous block's right edge — one forward pass, no sort — guarantees no
 * two blocks overlap even after `MIN_ITEM_PCT` has widened a very short pass
 * past its own true end. Measured necessary: two back-to-back `died` passes
 * rendered one fully covering the other. WIDTH still reflects the real
 * duration; only POSITION shifts, and only rightward.
 */
export function passItems(data: NowPayload, nowMs: number): PassItem[] {
    const passes = data.timelinePasses ?? [];
    const startMs = nowMs - WINDOW_MS;
    let cursor = 0;
    return passes.map((p, i) => {
        const pStartMs = p.epoch * 1000;
        const next = passes[i + 1];
        const pEndMs = next
            ? next.epoch * 1000
            : Math.min(nowMs, pStartMs + FALLBACK_PASS_WIDTH_MS);
        const outcome = passOutcome(p.reason);
        const rawLeft = pct(pStartMs, startMs, nowMs);
        const left = Math.max(rawLeft, cursor);
        const width = Math.max(
            pct(pEndMs, startMs, nowMs) - rawLeft,
            MIN_ITEM_PCT
        );
        cursor = left + width;
        return {
            pass: p.pass,
            outcome,
            tone: PASS_TONE[outcome],
            term: PASS_TERM[outcome],
            glyph: PASS_GLYPH[outcome],
            reason: p.reason,
            claudeExit: p.claudeExit,
            left,
            width,
        };
    });
}

export interface ClaimItem {
    issue: number;
    title: string;
    state: string;
    tone: Tone;
    mark: string;
    term: string;
    reason: string;
    left: number;
    tailWidth: number;
}

/**
 * Claim pins. `null` (a failed read) renders no pins at all — the caller adds
 * the UNAVAILABLE note, the contract every other section follows.
 */
export function claimItems(data: NowPayload, nowMs: number): ClaimItem[] {
    const claims = data.claims ?? [];
    const startMs = nowMs - WINDOW_MS;
    const items = claims.map((c) => {
        const ageMs = (Number(c.ageHours) || 0) * 3600_000;
        // A claim OLDER than the window clamps to the left edge rather than
        // falling off it — it is still held, and hiding it would be the exact
        // "no signal" failure this view exists to fix.
        const takenAtMs = Math.max(nowMs - ageMs, startMs);
        const state = c.verdict?.state ?? "live";
        return {
            issue: c.issue,
            title: c.title,
            state,
            tone: CLAIM_TONE[state] ?? "good",
            mark: CLAIM_MARK[state] ?? "·",
            term: `claim.${state}`,
            reason: c.verdict?.reason ?? "",
            left: pct(takenAtMs, startMs, nowMs),
            tailWidth: 0,
        };
    });
    deconflict(
        [...items].sort((a, b) => a.left - b.left),
        MIN_PIN_GAP_PCT
    );
    for (const item of items) {
        item.tailWidth = Math.max(100 - item.left, MIN_ITEM_PCT);
    }
    return items;
}

export interface MergeItem {
    number: number;
    title: string;
    mergedAt: string;
    left: number;
}

/** Merge ticks. `null` (a failed read) renders none — same contract. */
export function mergeItems(data: NowPayload, nowMs: number): MergeItem[] {
    const merges = data.recentMerges ?? [];
    const startMs = nowMs - WINDOW_MS;
    const items = merges.map((m) => ({
        number: m.number,
        title: m.title,
        mergedAt: m.mergedAt,
        left: pct(Date.parse(m.mergedAt), startMs, nowMs),
    }));
    // A busy merge-train lands several PRs within minutes — see `deconflict`.
    deconflict(
        [...items].sort((a, b) => a.left - b.left),
        MIN_TICK_GAP_PCT
    );
    return items;
}

/** The section id a light never targets (there is no fifth traffic light), so
 *  it is deliberately not in `SECTION_IDS`. */
export const TIMELINE_SECTION_ID = "ls-section-timeline";
