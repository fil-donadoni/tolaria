import { esc, tier, fmtNum, fmtUsd } from "./format.js";

/**
 * The per-row agent-run drill-down (#2625) — shared verbatim by the Issues and
 * the Sessions tables, which differ only in the `/api/runs` query they pass.
 */
export function runsRowsHtml(rows) {
    const cells = rows
        .map(
            (r) => `<tr class="mini-run">
                        <td>${esc(r.description ?? r.agent_id)}</td>
                        <td>${esc(r.role)}</td>
                        <td>${tier(r.model)}</td>
                        <td>${r.min}'</td>
                        <td>${r.msgs}</td>
                        <td>${r.avg_ctx_k}k</td>
                        <td>${fmtNum(r.out_tok, true)}</td>
                        <td>${fmtUsd(r.cost)}</td></tr>`
        )
        .join("");
    return `<tr class="drill"><td colspan="99"><table>
                    <thead><tr><th>agent</th><th>role</th><th>tier</th><th>min</th><th>msgs</th><th>avg ctx</th><th>out tok</th><th>cost</th></tr></thead>
                    <tbody>${cells}</tbody></table></td></tr>`;
}

export async function toggleDrill(tr, url) {
    const next = tr.nextElementSibling;
    if (next?.classList.contains("drill")) {
        next.remove();
        return;
    }
    const j = await (await fetch(url)).json();
    tr.insertAdjacentHTML("afterend", runsRowsHtml(j.rows));
}
