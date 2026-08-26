import { fmtMetric } from "./format.js";
import { state } from "./history-state.js";
import { lookupTerm } from "./glossary.js";

/** The glossary label for a dimension/metric name, qualified by the current
 *  dataset first (see glossary.js's qualified-key fallback). */
const termLabel = (name) =>
    lookupTerm(`${state.table}.${name}`)?.label ??
    String(name).replace(/_/g, " ");

/**
 * The "Table" card (#2625) — every metric for the current slice, one row per
 * value of the split. Owns `#tbl` and `#tbl-sub`.
 *
 * `onSort` is a callback, not an import of `refresh`: this module WRITES
 * `state.sort` / `state.sortDir` and then needs the orchestrator to re-run,
 * and importing `history-refresh.js` (which imports this file) would make the
 * two modules cyclic for no gain.
 *
 * Column headers render the glossary LABEL (#2633), never the raw split or
 * metric name, and carry `data-term` so the tooltip engine explains each one
 * on hover/focus. `#tbl-sub` leads with the glossary's fixed "what question
 * does this answer" sentence (`card.table`).
 */
export function renderTable(rows, split, metricNames, onSort) {
    const tbl = document.getElementById("tbl");
    const sub = document.getElementById("tbl-sub");
    if (sub)
        sub.textContent = `${lookupTerm("card.table").tip} Click a header to sort.`;
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
