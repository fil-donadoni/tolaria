import { fmtMetric } from "./format.js";
import { state } from "./history-state.js";

/**
 * The "Table" card (#2625) — every metric for the current slice, one row per
 * value of the split. Owns `#tbl`.
 *
 * `onSort` is a callback, not an import of `refresh`: this module WRITES
 * `state.sort` / `state.sortDir` and then needs the orchestrator to re-run,
 * and importing `history-refresh.js` (which imports this file) would make the
 * two modules cyclic for no gain.
 */
export function renderTable(rows, split, metricNames, onSort) {
    const tbl = document.getElementById("tbl");
    const sortKey = state.sort ?? state.metric;
    const sorted = [...rows].sort(
        (a, b) =>
            ((b[sortKey] ?? 0) - (a[sortKey] ?? 0)) *
            (state.sortDir === -1 ? 1 : -1)
    );
    const head =
        `<thead><tr><th data-k="${split}">${split}</th>` +
        metricNames
            .map((m) => `<th data-k="${m}">${m.replace(/_/g, " ")}</th>`)
            .join("") +
        "</tr></thead>";
    const body =
        "<tbody>" +
        sorted
            .map(
                (r) =>
                    `<tr><td>${r[split]}</td>` +
                    metricNames
                        .map((m) => `<td>${fmtMetric(m, r[m])}</td>`)
                        .join("") +
                    "</tr>"
            )
            .join("") +
        "</tbody>";
    tbl.innerHTML = head + body;
    tbl.querySelectorAll("th").forEach((th) =>
        th.addEventListener("click", () => {
            const k = th.dataset.k;
            state.sortDir = state.sort === k ? -state.sortDir : -1;
            state.sort = k;
            onSort();
        })
    );
}
