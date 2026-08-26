import { esc } from "./format.js";
import { LIGHT_TONES } from "./now-lights.js";

/**
 * The Now view's 24-hour timeline (#2631) — passes as blocks, claims as pins
 * with a tail, merges as ticks, on one shared time axis.
 *
 * WHY THIS EXISTS. On 2026-08-19 the driver died at 00:58 holding five
 * claims and stayed dead for eight hours. The dashboard of the day had no
 * way to show that: a killed pass and a pass that ran and found nothing to
 * do were the same word in a log, and nothing showed a claim's AGE next to
 * whether the driver was even alive. This strip is the object that would
 * have made the outage legible at a glance — five pins with open tails and a
 * gap in the passes track after 22:40, not a log file to `tail -f`.
 *
 * PURE, like every other Now module (`now.js`, `now-lights.js`): a payload
 * and a timestamp in, an HTML string out, so the `node` vitest project can
 * assert exactly what renders without a browser. `nowMs` is a parameter
 * (default `Date.now()`) rather than read internally at call sites deeper in
 * the tree, which is what makes the positioning testable at all.
 *
 * ── THE DATA MODEL (the hard part) ────────────────────────────────────────
 *
 * Three different shapes, from three different reads, none of them invented:
 *
 *   * PASSES (`data.timelinePasses`, `scripts/loop-status.ts`) — a LOCAL read
 *     of `loop-drain.log`, widened from the driver panel's own `recentPasses`
 *     (capped at 5) to the full `TIMELINE_WINDOW_HOURS` window. Each line
 *     carries only a START time (`epoch`) — `loop-drain.sh` stamps it BEFORE
 *     `claude -p` runs and only appends the line once the pass has already
 *     finished, so there is no logged END. `passItems` below derives one:
 *     the next pass's start, or — for the newest pass in the window — a
 *     bounded fallback width, never a stretch to "now" (a pass that died
 *     hours ago must not be drawn as though it were still running).
 *
 *   * CLAIMS (`data.claims`, already `ClaimRow[]` — the SAME array the
 *     claims table and the Claims light read) — a snapshot of what is HELD
 *     RIGHT NOW, nothing more. That turns out to be exactly the shape the AC
 *     needs: a claim that was released is, by construction, no longer in
 *     this array — it does not appear as a pin with a closed tail, because
 *     the Now view has no history to reconstruct one from (D1, PRD #2621:
 *     Now reads the loop-status route and no database). So EVERY pin drawn
 *     here has an OPEN tail, running from its (proxy) take time to "now" —
 *     which is precisely the outage signal: many long, unclosed tails is
 *     what "held and never released" looks like. `takenAt` reuses
 *     `ClaimRow.ageHours`, the SAME claim-time proxy the claims table and
 *     the claims light already trade on (`issue.updatedAt`) — not a second
 *     one invented for this view.
 *
 *   * MERGES (`data.recentMerges`, `scripts/loop-status.ts`) — a NEW read
 *     (`gh pr list --state merged`): nothing in the existing gather carried
 *     a merge event at all (`Receipt` has no merged outcome; the driver log
 *     proves `merges === 0` in its own branch but never LOGS a positive
 *     count). Fail-closed like `claims`/`queueDepth` — `null` with a sibling
 *     `recentMergesError` on a failed `gh` read, never a fabricated `[]`.
 *
 * ── VOCABULARY (one, not two) ─────────────────────────────────────────────
 *
 * Every interactive item declares `data-term="<glossary key>"` — the SAME
 * `GLOSSARY` module the verdict band and the four lights read from
 * (`tooltip.js`'s already-installed, document-level engine enhances it for
 * free: tabindex, `aria-describedby`, hover AND focus, Escape to dismiss).
 * Claim pins reuse the EXISTING `claim.live` / `claim.orphan` / `claim.suspect`
 * entries verbatim — no new prose, and their tips already answer "is this
 * released" ("held out of the queue by a run that is gone", "someone is
 * plausibly still on it"). Pass blocks and merge ticks use three new entries
 * this file adds to `glossary.js` (`pass.landed` / `pass.ran-nothing` /
 * `pass.died` / `pr.merged`) — new VOCABULARY, but the SAME module and the
 * SAME lookup path, never a parallel one.
 */

/** The Now timeline's window — 24 hours (issue title). A LITERAL here would
 *  drift from the gather layer's own copy; both read
 *  `scripts/lib/loop-status.ts`'s `TIMELINE_WINDOW_HOURS`. Dashboard `.js`
 *  files are plain, unbundled browser ES modules (#2625: no build step) and
 *  cannot import a `.ts` source at runtime, so the number is restated here —
 *  the two are kept from drifting apart by `now-timeline.test.ts` asserting
 *  they are equal. */
export const WINDOW_HOURS = 24;
const WINDOW_MS = WINDOW_HOURS * 3600_000;

/**
 * A pass's own duration is never logged — only its START (`DriverPassLine
 * .epoch`). The newest pass in the window borrows this width rather than
 * stretching to "now": drawing a pass that died hours ago as though it were
 * still running would say the opposite of what the block means. Chosen to
 * echo `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS`'s historical 600s default
 * (PRD #2621, D13) — a number already meaningful in this project's own
 * vocabulary, not a fresh one invented for this view.
 */
const FALLBACK_PASS_WIDTH_MS = 600_000;

/** The minimum width/diameter a timeline item renders at, in PERCENT of the
 *  track — a pass that took 30 seconds must still be findable and clickable
 *  on a 24-hour axis. */
const MIN_ITEM_PCT = 0.6;
/** Minimum centre-to-centre spacing between claim pins — see `deconflict`. */
const MIN_PIN_GAP_PCT = 1.2;
/**
 * Minimum spacing between merge ticks — MEASURED, not guessed. A real
 * synthetic pointer move (Playwright `page.mouse.move` to a tick's own
 * `getBoundingClientRect()` centre — `elementFromPoint` alone can disagree
 * with the browser's actual `:hover` target at this scale, so both were
 * checked) landed `:hover` on a NEIGHBOUR tick, not the requested one, at
 * 0.8% (~10px on a typical desktop track for 5px-wide ticks) on a live day
 * with 41 merges; still wrong at 1.6%. 2% is where it held. Wider than a
 * pin's own gap: a tick has no padding around its hit target the way a
 * 14px circular pin does.
 */
const MIN_TICK_GAP_PCT = 2;

/**
 * Which of the three outcomes a pass's `reason` code represents (#2631 AC:
 * died / ran-and-landed-nothing / landed-something must be visually distinct
 * WITHOUT colour).
 *
 * Producer census — every `reason_field` value `scripts/loop-drain.sh` can
 * write (`grep -n 'reason_field=' scripts/loop-drain.sh`; six sites, six
 * distinct values, no others):
 *
 * | reason         | what it means                                          | outcome     |
 * | -------------- | ------------------------------------------------------- | ----------- |
 * | `"-"`          | `total_open`/green-sha moved — real work landed          | landed      |
 * | `"no-progress"`| ran twice with NEITHER moving — genuinely nothing to do  | ran-nothing |
 * | `"claims-held"`| forcibly terminated mid-batch, still holding claims (D14)| died        |
 * | `"rate-limit"` | `claude` hit a rate/usage limit, driver stopped itself   | died        |
 * | `"claude-error"`| `claude` exited non-zero, no rate-limit match, streak out| died        |
 * | `"claude-retry"`| `claude` exited non-zero, being retried (not yet fatal)  | died        |
 *
 * Only `"-"` is a landing, and only `"no-progress"` is the AC's "ran and
 * landed nothing" — every other code means the pass's OWN `claude`
 * invocation did not finish on its own terms, which is what "died" names.
 * Grouped rather than given a fourth bucket: the AC asks for exactly three,
 * and none of `rate-limit`/`claude-error`/`claude-retry` is "no progress" in
 * the `no-progress` code's own sense (twice, quietly, nothing to show) — each
 * is a fault the driver detected and stopped or backed off for. An
 * unrecognised FUTURE code defaults to `died`, the loudest bucket, rather
 * than either of the calmer two — fail loud, not fail quiet, matching the
 * loud-default precedent elsewhere on this page (`verdictTone`'s unknown-state
 * fallback, `now-verdict-band.js`).
 *
 * @param {string} reason
 * @returns {"landed" | "ran-nothing" | "died"}
 */
export function passOutcome(reason) {
    if (reason === "-") return "landed";
    if (reason === "no-progress") return "ran-nothing";
    return "died";
}

/** Tone per pass outcome — the SAME three tones (not a fourth) the four
 *  lights already use, so a died pass and the Claims light's ORPHANED both
 *  read as `bad` in the same hue. */
const PASS_TONE = { landed: "good", "ran-nothing": "warn", died: "bad" };
/** Glossary key per pass outcome — new entries in `glossary.js`. */
const PASS_TERM = {
    landed: "pass.landed",
    "ran-nothing": "pass.ran-nothing",
    died: "pass.died",
};
/** The SAME glyph vocabulary `now-lights.js` established (`● ▲ ■`) — colour
 *  is never the only carrier, on this page or in this view. */
const PASS_GLYPH = {
    landed: LIGHT_TONES.good,
    "ran-nothing": LIGHT_TONES.warn,
    died: LIGHT_TONES.bad,
};

/** Tone + non-colour mark per claim verdict state — the SAME mapping
 *  `now-claims-table.js`'s `.ls-mark` already renders (`×` orphan / `?`
 *  suspect / `·` live), not a second one for this view. */
const CLAIM_TONE = { orphan: "bad", suspect: "warn", live: "good" };
const CLAIM_MARK = { orphan: "×", suspect: "?", live: "·" };

const clampPct = (v) => Math.min(100, Math.max(0, v));

/** A timestamp's position on the window's 0–100% axis, oldest on the left. */
function pct(ms, startMs, endMs) {
    if (endMs <= startMs) return 0;
    return clampPct(((ms - startMs) / (endMs - startMs)) * 100);
}

/**
 * Push overlapping point-items apart along the axis, IN PLACE, mutating
 * `.left` on each — measured necessary in the browser (Playwright +
 * `scripts/ui-gate/probe.js`, driven directly because `chrome-devtools-mcp`'s
 * shared profile was held by a concurrent session at verification time): two
 * issues claimed 14 SECONDS apart rendered as fully overlapping 14px circles,
 * one entirely unclickable (`elementFromPoint` at its centre returned its
 * neighbour's glyph, never itself). A 24-hour axis cannot show second-level
 * separation anyway, so every item keeps its OWN gap-worth of space and only
 * ever moves RIGHT of where its raw timestamp placed it — never left of it,
 * so a nudge can only make an item's reported time look slightly LATER than
 * it really was, never earlier.
 *
 * `items` must already be sorted ascending by `.left` — callers sort a COPY
 * for this (the de-collided objects are the SAME references the caller's own
 * array holds, so the effect is visible there too without a second pass).
 *
 * Never pushes an item PAST the right edge, and never collapses two items
 * onto the SAME position — measured BOTH failures live, in order, on the
 * same real 40-merge day: the naive forward-only cascade first ran an
 * item's `.left` past 100%, off the visible track entirely; a shared
 * ceiling clamp fixed that but reproduced the identical bug one level down
 * (the last TWO ticks landed on the exact same clamped position); a uniform
 * leftward SHIFT of the whole cascade fixed clustering at the very end but
 * broke on a THIRD real shape — most items spread out, then a dense cluster
 * right before "now" — because shifting the entire array left to fix the
 * tail has nowhere to go once the untouched HEAD is already sitting at (or
 * near) the left edge with no slack of its own to give up.
 *
 * That is the general lesson: a purely LOCAL cascade (each item reacting
 * only to its immediate predecessor) cannot always find a globally valid
 * layout, because slack sitting unused between two clusters is invisible
 * to it. Rather than implement full constrained isotonic placement to
 * reclaim that slack, this falls back to something simpler and PROVABLY
 * correct whenever the cascade cannot fit: throw away the raw positions
 * for spacing purposes and space every item EVENLY by rank, `i * 100/n`.
 * That is always strictly increasing (never a duplicate) and always inside
 * [0, 100) — less faithful to the exact timestamp on a very crowded window,
 * but an honest picture in its own right: a comb of evenly-spaced ticks IS
 * what "too many events to place individually by time" looks like, and the
 * ordinary (uncrowded) case never reaches this branch at all.
 *
 * @param {Array<{left: number}>} sortedByLeft
 * @param {number} minGapPct
 */
function deconflict(sortedByLeft, minGapPct) {
    const n = sortedByLeft.length;
    if (n === 0) return;
    let cursor = 0;
    for (const item of sortedByLeft) {
        if (item.left < cursor) item.left = cursor;
        cursor = item.left + minGapPct;
    }
    if (sortedByLeft[n - 1].left > 100) {
        const step = 100 / n;
        sortedByLeft.forEach((item, i) => {
            item.left = i * step;
        });
    }
}

/**
 * Pass blocks: `data.timelinePasses`, newest-last (mirrors the log's own
 * append order). See the module header for how a block's END is derived —
 * there is no logged one.
 *
 * @param {{ timelinePasses?: Array<{pass:number, claudeExit:number, pct:string, queueBefore:number, queueAfter:number, reason:string, epoch:number}> }} data
 * @param {number} nowMs
 */
export function passItems(data, nowMs) {
    const passes = data.timelinePasses ?? [];
    const startMs = nowMs - WINDOW_MS;
    // Passes are ALREADY chronological (`readRecentPasses`'s own append
    // order), so placing each one's LEFT no earlier than the previous
    // block's right edge — in this single forward pass, no separate sort —
    // is enough to guarantee no two blocks ever overlap, even after the
    // `MIN_ITEM_PCT` floor below has widened a very short pass past its own
    // true end. Measured necessary: two back-to-back `died` passes rendered
    // one fully covering the other before this (Playwright + the shared
    // occlusion probe — see `deconflict`'s own note for why not
    // `chrome-devtools-mcp` directly). WIDTH still reflects the real
    // duration (`pEndMs - pStartMs`, floored); only POSITION ever shifts,
    // and only rightward.
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

/**
 * Claim pins: `data.claims`, the SAME `ClaimRow[]` the claims table and the
 * Claims light read. `null` (a failed read) renders no pins at all — the
 * caller adds the UNAVAILABLE note, the same contract every other section on
 * this page follows for a failed `gh` read.
 *
 * Every pin's tail runs to "now" — see the module header for why that is
 * correct rather than a simplification: a released claim is simply absent
 * from this array, so there is nothing here to draw with a closed tail.
 *
 * @param {{ claims?: Array<{issue:number, title:string, ageHours:number, verdict:{state:string, reason:string}}> | null }} data
 * @param {number} nowMs
 */
export function claimItems(data, nowMs) {
    const claims = data.claims ?? [];
    const startMs = nowMs - WINDOW_MS;
    const items = claims.map((c) => {
        const ageMs = (Number(c.ageHours) || 0) * 3600_000;
        // A claim OLDER than the window clamps to the left edge rather than
        // falling off it — it is still held, and hiding it entirely would be
        // the exact "no signal" failure this view exists to fix.
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
        };
    });
    // Two claims taken moments apart otherwise render as fully overlapping
    // circles, one entirely unclickable — see `deconflict`.
    deconflict(
        [...items].sort((a, b) => a.left - b.left),
        MIN_PIN_GAP_PCT
    );
    for (const item of items) {
        item.tailWidth = Math.max(100 - item.left, MIN_ITEM_PCT);
    }
    return items;
}

/**
 * Merge ticks: `data.recentMerges`, PRs merged in the window. `null` (a
 * failed read) renders no ticks — same UNAVAILABLE contract as claims.
 *
 * @param {{ recentMerges?: Array<{number:number, title:string, mergedAt:string}> | null }} data
 * @param {number} nowMs
 */
export function mergeItems(data, nowMs) {
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

function passBlockHtml(item) {
    return (
        `<button type="button" class="ls-tl-pass tone-${item.tone}" ` +
        `style="left:${item.left.toFixed(2)}%;width:${item.width.toFixed(2)}%" ` +
        `data-term="${esc(item.term)}" data-pass="${item.pass}" ` +
        `aria-label="${esc(`pass ${item.pass}, ${item.outcome.replace("-", " ")} (exit ${item.claudeExit})`)}">` +
        `<span class="ls-tl-glyph" aria-hidden="true">${esc(item.glyph)}</span>` +
        `</button>`
    );
}

function claimPinHtml(item) {
    return (
        `<div class="ls-tl-claim-wrap" style="left:${item.left.toFixed(2)}%">` +
        `<button type="button" class="ls-tl-claim tone-${item.tone}" ` +
        `data-term="${esc(item.term)}" data-issue="${item.issue}" ` +
        `aria-label="${esc(`issue #${item.issue} ${item.title}, ${item.state}, claimed and still held`)}">` +
        `<span class="ls-tl-glyph" aria-hidden="true">${esc(item.mark)}</span>` +
        `</button>` +
        `<span class="ls-tl-claim-tail" style="width:${item.tailWidth.toFixed(2)}%" aria-hidden="true"></span>` +
        `</div>`
    );
}

function mergeTickHtml(item) {
    return (
        `<button type="button" class="ls-tl-merge" style="left:${item.left.toFixed(2)}%" ` +
        `data-term="pr.merged" data-pr="${item.number}" ` +
        `aria-label="${esc(`PR #${item.number} merged: ${item.title}`)}"></button>`
    );
}

function trackHtml(label, laneClass, itemsHtml) {
    return (
        `<div class="ls-tl-track ${laneClass}">` +
        `<span class="ls-tl-track-label">${esc(label)}</span>` +
        `<div class="ls-tl-lane">${itemsHtml}</div>` +
        `</div>`
    );
}

const axisHtml = () =>
    `<div class="ls-tl-axis">` +
    `<span class="ls-tl-tick">${WINDOW_HOURS}h ago</span>` +
    `<span class="ls-tl-tick">now</span>` +
    `</div>`;

/**
 * The whole strip: three tracks (passes, claims, merges) plus a two-label
 * axis. Callers that already know every track is empty should render
 * `emptyTimelineHtml` instead (AC: "An empty window renders as a sentence,
 * not a blank box") — this function does not make that decision itself, so
 * it stays a pure `data → markup` mapping with no branch a test would have
 * to special-case.
 */
export function timelineHtml(data, nowMs) {
    const passes = passItems(data, nowMs);
    const claims = claimItems(data, nowMs);
    const merges = mergeItems(data, nowMs);
    return (
        `<div class="ls-timeline">` +
        trackHtml(
            "Passes",
            "ls-tl-track-passes",
            passes.map(passBlockHtml).join("")
        ) +
        trackHtml(
            "Claims",
            "ls-tl-track-claims",
            claims.map(claimPinHtml).join("")
        ) +
        trackHtml(
            "Merges",
            "ls-tl-track-merges",
            merges.map(mergeTickHtml).join("")
        ) +
        axisHtml() +
        `</div>`
    );
}

const emptyTimelineHtml = () =>
    `<div class="ls-empty">Nothing ran, was claimed or merged in the last ${WINDOW_HOURS} hours.</div>`;

/** The section id `now.js` mounts this under — no light targets it (there is
 *  no fifth traffic light), so it is not added to `SECTION_IDS`
 *  (`now-lights.js`), which exists specifically to keep a light's target in
 *  sync with a section a light actually points at. */
export const TIMELINE_SECTION_ID = "ls-section-timeline";

/**
 * The whole section, heading and UNAVAILABLE notes included — what `now.js`
 * mounts. `nowMs` defaults to `Date.now()` so the real call site
 * (`nowBodyHtml`) needs no explicit clock; tests always pass one.
 *
 * @param {object} data
 * @param {number} [nowMs]
 */
export function timelineSectionHtml(data, nowMs = Date.now()) {
    const passes = passItems(data, nowMs);
    const claims = claimItems(data, nowMs);
    const merges = mergeItems(data, nowMs);
    const claimsUnavailable = data.claimsError != null;
    const mergesUnavailable = data.recentMergesError != null;
    const nothingKnown =
        passes.length === 0 &&
        claims.length === 0 &&
        merges.length === 0 &&
        !claimsUnavailable &&
        !mergesUnavailable;

    const unavailableHtml =
        (claimsUnavailable
            ? `<div class="ls-unavailable">⚠ ${esc(data.claimsError)} — claim pins may be incomplete</div>`
            : "") +
        (mergesUnavailable
            ? `<div class="ls-unavailable">⚠ ${esc(data.recentMergesError)} — merge ticks may be incomplete</div>`
            : "");

    const body = nothingKnown ? emptyTimelineHtml() : timelineHtml(data, nowMs);

    return (
        `<div id="${TIMELINE_SECTION_ID}" class="ls-section ls-timeline-section">` +
        `<b>Last ${WINDOW_HOURS}h</b>` +
        unavailableHtml +
        body +
        `</div>`
    );
}
