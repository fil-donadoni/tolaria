import { esc, fmtAgo, issueLink } from "./format.js";

/**
 * The claimed-issues table of the Now panel (#2519, split out in #2625,
 * reworded for a person in #2632).
 *
 * `claims` is `null` (with a sibling `claimsError`) when the underlying `gh`
 * read failed (#2519 round 3, finding 5) — rendered as an explicit
 * UNAVAILABLE banner, never as an empty/zeroed section, which is
 * indistinguishable from a healthy read that genuinely found nothing (the
 * exact bug: at 0/5000 GraphQL quota this panel used to say "no claimed
 * issues", reading as an idle, drained loop).
 *
 * Pure — the loop-status payload in, an HTML string out.
 */

/** `claims.length`, or the word that says the count is not knowable. */
export const claimsHeaderCount = (data) =>
    data.claims === null ? "UNAVAILABLE" : data.claims.length;

/**
 * The classifier's own "too young to judge" cutoff, MIRRORED rather than
 * imported (#2632 AC: "amber past the classifier's threshold — the same
 * constant, not a new one"). `scripts/loop-doctor.ts` exports the real value
 * as `DEFAULT_MIN_AGE_HOURS`, but a plain, unbundled browser ES module
 * cannot import a `.ts` source at runtime (#2625) — exactly the reason
 * `now-timeline.js`'s `WINDOW_HOURS` mirrors `TIMELINE_WINDOW_HOURS` instead
 * of importing it. The drift guard runs the other direction, in a `.ts` test
 * that CAN cross the boundary: `loop-status-dashboard.test.ts` imports both
 * `MIN_AGE_HOURS` (here) and `DEFAULT_MIN_AGE_HOURS` (`../loop-doctor`) and
 * asserts they are equal.
 */
export const MIN_AGE_HOURS = 2;

/** `×`/`?`/`·` become words (#2632 AC) — the per-row REASON stays dynamic
 *  (a `title`, mirroring this table's pre-existing tooltip mechanism; the
 *  glossary's `claim.*` entries only carry a STATIC explanation, not the
 *  specific "claimed 24h ago" a row needs), so this map carries only the
 *  three fixed words, never re-declared as `claim.*` glossary labels (those
 *  are the terser "orphan"/"suspect"/"live" nouns used elsewhere, e.g. the
 *  Claims light's `ORPHANED`/`UNSURE`/`WORKING` words in `now-lights.js`,
 *  which this mirrors in lower case). */
const VERDICT_WORD = {
    orphan: "orphaned",
    suspect: "unsure",
    live: "working",
};

/**
 * Stage → a sentence naming what is DONE and what is MISSING (#2632 AC),
 * more specific than the glossary's own short `stage.*` label ("branch
 * pushed"). A genuinely new glossary TERM was not added for this (brief:
 * report the need rather than editing `glossary.js`) — this local mapping is
 * the reported need. `data-term` is still set to the existing `stage.*` key
 * so hovering/focusing surfaces the glossary's own explanation as a SECOND,
 * complementary layer (`enhanceTerms` only fills EMPTY text content, so the
 * sentence below is never overwritten).
 */
const STAGE_SENTENCE = {
    claimed: "Claimed, no worktree yet",
    worktree: "Worktree started, no branch pushed yet",
    "branch pushed": "Branch pushed, no PR yet",
    "PR open": "PR open, waiting for review",
    merging: "Approved, merging",
};

const plural = (n, one, many) => (n === 1 ? one : many);

function verdictMarkHtml(c) {
    const state = c.verdict?.state ?? "live";
    const reason = c.verdict?.reason ?? "";
    const word = VERDICT_WORD[state] ?? state;
    return (
        `<span class="ls-mark ${esc(state)}" title="${esc(reason)}" ` +
        `aria-label="${esc(word)}: ${esc(reason)}">${esc(word)}</span>`
    );
}

function stageHtml(stage, issue) {
    const sentence = STAGE_SENTENCE[stage] ?? stage;
    // `data-issue` gives `nowControlKey` (`now-loop-status.js`) a per-row
    // identity for the focus-preserving poll write — the SAME reason
    // `.ls-tl-claim` carries `data-issue` rather than keying off the stage
    // VALUE, which is not unique across rows (#2632 review finding 4).
    return `<span class="ls-stage" data-term="stage.${esc(stage)}" data-issue="${esc(issue)}">${esc(sentence)}</span>`;
}

/** Amber past `MIN_AGE_HOURS` — the same threshold `classifyClaim` uses to
 *  decide a claim is old enough to judge (below it, a claim with no branch
 *  and no PR is `suspect`, not `orphan`; see `loop-doctor.ts`). */
function ageHtml(ageHours) {
    const amber = typeof ageHours === "number" && ageHours >= MIN_AGE_HOURS;
    return `<span class="ls-age${amber ? " amber" : ""}">${esc(fmtAgo(ageHours))}</span>`;
}

/**
 * `blocks N others` (#2632 AC) — the number of OPEN issues that name this
 * claim in their own `## Blocked by` section (`countDependents`,
 * `lib/loop-status.ts`). `c.dependents` is `null` when that read failed
 * (rendered as ONE table-level note by `dependentsUnavailableHtml`, not a
 * per-row badge nobody could distinguish from "checked, blocks nothing") and
 * `undefined` on a fixture that predates this field — both render no badge,
 * which is also the correct rendering of a row that was checked and found to
 * block nothing.
 */
function blocksBadgeHtml(c) {
    const n = c.dependents;
    if (typeof n !== "number" || n <= 0) return "";
    const label = `blocks ${n} ${plural(n, "other", "others")}`;
    // `countDependents` reuses `parseDependencies` (`lib/queue-plan.ts`) —
    // ONE parser, correctly, but it also matches prose keywords ("depends
    // on #N", "requires #N", "after #N") anywhere in the body, not only an
    // explicit `## Blocked by` list item. The tooltip must not claim a
    // stricter form than what was actually counted (#2632 review finding
    // 7), so it names both.
    const title = `${n} open ${plural(n, "issue names", "issues name")} #${c.issue} as a blocker — a "Blocked by" entry or blocking language ("depends on"/"requires"/"after") elsewhere in the body`;
    return ` <span class="ls-blocks" title="${esc(title)}">${esc(label)}</span>`;
}

/**
 * ONE note when the blocked-by read failed, not a per-row absence (#2632 AC:
 * "a failed read renders as an explicit unavailable state, distinct from an
 * empty one") — mirrors `claimsBodyHtml`'s own `data.claimsError` banner.
 * The claims themselves are still known and still render; only the "blocks
 * N others" fact is unavailable, so this degrades ONE feature rather than
 * the whole table.
 */
function dependentsUnavailableHtml(data) {
    if (data.dependentsError == null) return "";
    return (
        `<div class="ls-unavailable">⚠ blocked-by counts unavailable — ${esc(data.dependentsError)}` +
        `<br>cannot tell whether any claim blocks others — not the same as "blocks nothing"</div>`
    );
}

function claimsBodyHtml(data) {
    const claims = data.claims;
    if (data.claimsError != null) {
        return `<div class="ls-unavailable">⚠ ${esc(data.claimsError)}<br>cannot tell whether anything is claimed — not the same as "no claimed issues"</div>`;
    }
    if (!claims || !claims.length) {
        return `<div class="ls-empty">no claimed issues</div>`;
    }
    return (
        dependentsUnavailableHtml(data) +
        `<div class="tbl-wrap"><table><thead><tr><th></th><th>issue</th><th>Priority</th><th>stage</th><th>age</th><th>title</th></tr></thead><tbody>` +
        claims
            .map((c) => {
                return (
                    `<tr><td>${verdictMarkHtml(c)}</td><td>${issueLink(c.issue)}</td><td>${esc(c.priority ?? "—")}</td>` +
                    `<td>${stageHtml(c.stage, c.issue)}</td>` +
                    `<td>${ageHtml(c.ageHours)}</td>` +
                    `<td>${esc(c.title)}${blocksBadgeHtml(c)}</td></tr>`
                );
            })
            .join("") +
        `</tbody></table></div>`
    );
}

/** The whole "Claimed issues (N)" block, heading included. */
export function claimsSectionHtml(data) {
    return `<div style="margin-top:12px"><b>Claimed issues (${claimsHeaderCount(data)})</b>${claimsBodyHtml(data)}</div>`;
}
