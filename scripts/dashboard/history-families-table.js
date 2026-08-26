import { esc, fmtUsd, mc } from "./format.js";
import { labelFor } from "./glossary.js";

/**
 * The "Agent family × role" card (#2625, retitled + glossary-sourced #2634)
 * — families as rows, agent roles as columns. Owns `#families-tbl`.
 * Stateless: the pivot is rebuilt from the rows handed in.
 *
 * The role columns (`implement`/`review`/`fixup`/`support`) already render as
 * plain English words, so relabelling isn't the point here — each gets its
 * own glossary tooltip (`role.<name>`) instead of one generic dimension tip
 * repeated four times. There is no interactive sort on this pivot (fixed,
 * descending by total, as before this change) — nothing to preserve.
 */
const ROLE_COLS = ["implement", "review", "fixup", "support"];

export function renderFamiliesTable(famRows) {
    const byFam = new Map();
    for (const r of famRows) {
        if (!byFam.has(r.family)) byFam.set(r.family, {});
        const f = byFam.get(r.family);
        const key = ROLE_COLS.includes(r.role) ? r.role : "support";
        f[key] ??= { minutes: 0, cost: 0, out_tok: 0 };
        f[key].minutes += r.minutes;
        f[key].cost += r.cost;
        f[key].out_tok += r.out_tok;
        f.issuesMax = Math.max(f.issuesMax ?? 0, r.issues);
        f.total = (f.total ?? 0) + r.cost;
    }
    const ftbl = document.getElementById("families-tbl");
    const th = (term, label = labelFor(term)) =>
        `<th data-term="${term}">${label}</th>`;
    const headRow =
        `<tr>${th("family")}${th("issues")}` +
        ROLE_COLS.map((c) => th(`role.${c}`)).join("") +
        `${th("cost", "total")}</tr>`;
    const families = [...byFam.entries()].sort(
        (a, b) => b[1].total - a[1].total
    );
    const bodyHtml = families.length
        ? families
              .map(
                  ([famName, f]) =>
                      `<tr><td>${esc(famName)}</td><td>${f.issuesMax}</td>` +
                      ROLE_COLS.map((c) =>
                          f[c]
                              ? `<td>${mc(f[c].minutes, f[c].cost)}</td>`
                              : `<td><span class='mini'>—</span></td>`
                      ).join("") +
                      `<td><b>${fmtUsd(f.total)}</b></td></tr>`
              )
              .join("")
        : `<tr><td colspan="${2 + ROLE_COLS.length + 1}"><div class="ls-empty">No agent activity is recorded against any issue family in the selected date range.</div></td></tr>`;
    ftbl.innerHTML = `<thead>${headRow}</thead><tbody>${bodyHtml}</tbody>`;
}
