import { state } from "./history-state.js";
import { q } from "./history-query.js";
import { seedColors } from "./history-colors.js";
import { renderNarrative } from "./history-narrative.js";
import { renderTimeSeries } from "./history-timeline.js";
import { renderRanking } from "./history-ranking.js";
import { renderTable } from "./history-metrics-table.js";
import { renderTiles } from "./history-tiles.js";

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
        `${metric.replace(/_/g, " ")} per day, by ${split}`;
    document.getElementById("rank-title").textContent =
        `${metric.replace(/_/g, " ")} by ${split}`;
    document.getElementById("rank-sub").textContent = `Top 18, descending.`;

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
