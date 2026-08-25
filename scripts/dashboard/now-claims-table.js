import { esc } from "./format.js";

/**
 * The claimed-issues table of the Now panel (#2519, split out in #2625).
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

function claimsBodyHtml(data) {
    const claims = data.claims;
    if (data.claimsError != null) {
        return `<div class="ls-unavailable">⚠ ${esc(data.claimsError)}<br>cannot tell whether anything is claimed — not the same as "no claimed issues"</div>`;
    }
    if (!claims || !claims.length) {
        return `<div class="ls-empty">no claimed issues</div>`;
    }
    return (
        `<div class="tbl-wrap"><table><thead><tr><th></th><th>issue</th><th>pri</th><th>stage</th><th>age</th><th>title</th></tr></thead><tbody>` +
        claims
            .map((c) => {
                const verdictState = c.verdict?.state ?? "live";
                const reason = esc(c.verdict?.reason ?? "");
                const mark =
                    verdictState === "orphan"
                        ? `<span class="ls-mark orphan" title="${reason}">×</span>`
                        : verdictState === "suspect"
                          ? `<span class="ls-mark suspect" title="${reason}">?</span>`
                          : `<span class="ls-mark live" title="${reason}">·</span>`;
                return (
                    `<tr><td>${mark}</td><td>#${c.issue}</td><td>${esc(c.priority ?? "—")}</td>` +
                    `<td><span class="ls-stage">${esc(c.stage)}</span></td>` +
                    `<td>${Number(c.ageHours ?? 0).toFixed(1)}h</td>` +
                    `<td>${esc(c.title)}</td></tr>`
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
