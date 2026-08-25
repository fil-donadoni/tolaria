import { tier } from "./format.js";
import { dayQ } from "./history-query.js";
import {
    setIssueRows,
    renderIssueFilters,
    renderIssuesTable,
} from "./history-issues-table.js";
import {
    setSessionRows,
    renderSessionFilters,
    renderSessionsTable,
} from "./history-sessions-table.js";
import { renderFamiliesTable } from "./history-families-table.js";

/**
 * Narrative views: Issues / Sessions / Family×role (#2625).
 *
 * The one fetch site for the three row-oriented routes. It owns no state: the
 * rows go straight into the table modules that own them.
 */
export async function renderNarrative() {
    const [iss, ses, fam] = await Promise.all([
        fetch(`/api/issues?${dayQ()}`).then((r) => r.json()),
        fetch(`/api/sessions?${dayQ()}`).then((r) => r.json()),
        fetch(`/api/families?${dayQ()}`).then((r) => r.json()),
    ]);

    // Issues — fixup-rate per tier headline, then one row per issue.
    const rate = Object.entries(iss.tiers ?? {})
        .map(([m, t]) => `${tier(m)}: ${t.withFixup}/${t.issues} with fixup`)
        .join(" · ");
    document.getElementById("issues-sub").textContent =
        `Per-issue spend by role. Fixup-rate — ${rate || "no data"}. Click a header to sort, a row for its runs.`;
    setIssueRows(iss.rows);
    renderIssueFilters();
    renderIssuesTable();

    // Sessions.
    setSessionRows(ses.rows);
    renderSessionFilters();
    renderSessionsTable();

    // Family × role pivot.
    renderFamiliesTable(fam.rows);
}
