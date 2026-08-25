import { esc, fmtUsd, mc } from "./format.js";

/**
 * The "Family × role" card (#2625) — families as rows, agent roles as columns.
 * Owns `#families-tbl`. Stateless: the pivot is rebuilt from the rows handed in.
 */
export function renderFamiliesTable(famRows) {
    const roles = ["implement", "review", "fixup"];
    const byFam = new Map();
    for (const r of famRows) {
        if (!byFam.has(r.family)) byFam.set(r.family, {});
        const f = byFam.get(r.family);
        const key = roles.includes(r.role) ? r.role : "support";
        f[key] ??= { minutes: 0, cost: 0, out_tok: 0 };
        f[key].minutes += r.minutes;
        f[key].cost += r.cost;
        f[key].out_tok += r.out_tok;
        f.issues = (f.issues ?? 0) + 0; // issues counted per role; use max
        f.issuesMax = Math.max(f.issuesMax ?? 0, r.issues);
        f.total = (f.total ?? 0) + r.cost;
    }
    const ftbl = document.getElementById("families-tbl");
    ftbl.innerHTML =
        `<thead><tr><th>family</th><th>issues</th>` +
        [...roles, "support"].map((c) => `<th>${c}</th>`).join("") +
        `<th>total</th></tr></thead><tbody>` +
        [...byFam.entries()]
            .sort((a, b) => b[1].total - a[1].total)
            .map(
                ([famName, f]) =>
                    `<tr><td>${esc(famName)}</td><td>${f.issuesMax}</td>` +
                    [...roles, "support"]
                        .map((c) =>
                            f[c]
                                ? `<td>${mc(f[c].minutes, f[c].cost)}</td>`
                                : `<td><span class='mini'>—</span></td>`
                        )
                        .join("") +
                    `<td><b>${fmtUsd(f.total)}</b></td></tr>`
            )
            .join("") +
        `</tbody>`;
}
