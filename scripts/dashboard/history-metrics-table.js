import { fmtMetric } from "./format.js";
import { state } from "./history-state.js";
import { labelFor } from "./glossary.js";

/** The glossary label for a dimension/metric name, qualified by the current
 *  dataset first (glossary.js's `labelFor` — the one authority). */
const termLabel = (name) => labelFor(name, state.table);

/**
 * The "Table" card (#2625) — every metric for the current slice, one row per
 * value of the split. Owns `#tbl`; `#tbl-sub` stays with `history-refresh.js`,
 * which writes it BEFORE awaiting the query so the subtitle is present even
 * on a query failure or before first paint (#2633/#2839) — the same reason
 * `#rank-sub` stays there instead of here.
 *
 * `onSort` is a callback, not an import of `refresh`: this module WRITES
 * `state.sort` / `state.sortDir` and then needs the orchestrator to re-run,
 * and importing `history-refresh.js` (which imports this file) would make the
 * two modules cyclic for no gain.
 *
 * Column headers render the glossary LABEL (#2633), never the raw split or
 * metric name, and carry `data-term` so the tooltip engine explains each one
 * on hover/focus.
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
        `<thead><tr><th data-k="${split}" data-term="${state.table}.${split}">${termLabel(split)}</th>` +
        metricNames
            .map(
                (m) =>
                    `<th data-k="${m}" data-term="${state.table}.${m}">${termLabel(m)}</th>`
            )
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
