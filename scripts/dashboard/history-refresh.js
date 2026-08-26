import { state } from "./history-state.js";
import { q } from "./history-query.js";
import { seedColors } from "./history-colors.js";
import { lookupTerm } from "./glossary.js";
import { renderNarrative } from "./history-narrative.js";
import { renderTimeSeries } from "./history-timeline.js";
import { renderRanking } from "./history-ranking.js";
import { renderTable } from "./history-metrics-table.js";
import { renderTiles } from "./history-tiles.js";

/** The glossary label for a metric/dimension, qualified by the current
 *  dataset first (see glossary.js's qualified-key fallback). */
const termLabel = (name) =>
    lookupTerm(`${state.table}.${name}`)?.label ??
    String(name).replace(/_/g, " ");

/**
 * History's orchestrator (#2625): one function that turns the current `state`
 * slice into the four chart cards plus the three narrative cards.
 *
 * It writes `#ts-title`, `#rank-title` and `#rank-sub` itself, BEFORE awaiting
 * the queries, so the headings update even when the query then fails — the
 * behaviour today, and the reason those three ids did not move into the chart
 * modules with the rest of their cards. `#ts-sub` is written by
 * `renderTimeSeries`: it depends on whether the metric stacks, which only that
 * function knows.
 *
 * Titles and the ranking subtitle are glossary-sourced (#2633): the metric
 * and split names render their human label, never the raw column name, and
 * the fixed "what question does this answer" sentence (`card.ranking` in
 * glossary.js) leads `#rank-sub`, ahead of the per-query "Top 18, descending."
 * detail.
 *
 * Nothing here mutates `state`; it only reads it.
 */
export async function refresh() {
    renderNarrative().catch((e) => {
        document.getElementById("issues-sub").textContent =
            `error: ${e.message}`;
    });
    const split = state.split,
        metric = state.metric;
    document.getElementById("ts-title").textContent =
        `${termLabel(metric)} per day, by ${termLabel(split)}`;
    document.getElementById("rank-title").textContent =
        `${termLabel(metric)} by ${termLabel(split)}`;
    document.getElementById("rank-sub").textContent =
        `${lookupTerm("card.ranking").tip} Top 18, descending.`;

    try {
        // Seed before rendering: the first paint must already use
        // the stable slots, or the chart repaints on the next tick.
        await seedColors(state.table, split);
        const [ts, byS, tot] = await Promise.all([
            q({ groupBy: ["day", split], limit: 5000 }),
            q({ groupBy: [split], limit: 500 }),
            q({ groupBy: [] }),
        ]);
        renderTimeSeries(ts.rows, split, metric);
        renderRanking(byS.rows, split, metric);
        renderTable(byS.rows, split, byS.metrics, refresh);
        renderTiles(tot.rows[0] ?? {}, byS.rows, split);
    } catch (e) {
        document.getElementById("tbl").innerHTML =
            `<tbody><tr><td class="err">${e.message}</td></tr></tbody>`;
    }
}
