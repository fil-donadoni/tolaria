import { state, stateToParams } from "./history-state.js";
import { q } from "./history-query.js";
import { seedColors } from "./history-colors.js";
import { lookupTerm, labelFor } from "./glossary.js";
import { renderNarrative } from "./history-narrative.js";
import { renderTimeSeries } from "./history-timeline.js";
import { renderRanking } from "./history-ranking.js";
import { renderTable } from "./history-metrics-table.js";
import { renderTiles } from "./history-tiles.js";

/** The glossary label for a metric/dimension, qualified by the current
 *  dataset first (glossary.js's `labelFor` — the one authority). */
const termLabel = (name) => labelFor(name, state.table);

/**
 * Write the current `state` slice into the URL (#2635), preserving every
 * OTHER param (`view`, `theme`) the way `tabs.js`'s own `replaceState` call
 * does — a `new URLSearchParams(location.search)` base, never a fresh one.
 * `replaceState`, not `pushState`: a filter tweak is not a browser-history
 * stop a Back button should walk through one click at a time.
 *
 * Guarded on `location`/`history` existing: `history-filters.test.ts` and
 * `history-tables.test.ts` drive `refresh()` against a happy-dom `document`
 * installed on `globalThis` WITHOUT installing `location`/`history` (neither
 * test needs them), so an unconditional read would throw a `ReferenceError`
 * before either test's own fixtures/mocks ever ran. A page that lacks both
 * globals has nothing to sync into, so skipping is the correct behaviour, not
 * only the test-safe one.
 */
function syncUrlFromState() {
    if (typeof location === "undefined" || typeof history === "undefined")
        return;
    const next = stateToParams(new URLSearchParams(location.search));
    history.replaceState(null, "", `?${next}`);
}

/**
 * History's orchestrator (#2625): one function that turns the current `state`
 * slice into the four chart cards plus the three narrative cards.
 *
 * It writes `#ts-title`, `#rank-title`, `#rank-sub`, `#tbl-sub`, `#fam-title`
 * and `#fam-sub` itself, BEFORE awaiting the queries, so the
 * headings/subtitles update even when the query then fails, or before first
 * paint — the behaviour today, and the reason those ids did not move into
 * the chart modules with the rest of their cards. `#ts-sub` is the one
 * exception, written by `renderTimeSeries`: it depends on whether the metric
 * stacks, which only that function knows.
 *
 * Titles and the ranking/table subtitles are glossary-sourced (#2633): the
 * metric and split names render their human label, never the raw column
 * name, and the fixed "what question does this answer" sentence
 * (`card.ranking` / `card.table` in glossary.js) leads `#rank-sub` /
 * `#tbl-sub`, ahead of the per-query "Top 18, descending." /
 * "Click a header to sort." detail. Every card carries a subtitle even on a
 * query failure — that is the acceptance criterion this file exists to meet,
 * and why none of these writes waits on the `try` (or, for the Family × role
 * pivot, on `renderNarrative()`'s three awaited fetches — #2634 review
 * finding 2: that card's title/subtitle are static glossary copy with no
 * dependency on fetched data, so writing them from inside `renderNarrative()`
 * only meant a failed `/api` read left the card with no subtitle at all).
 * `getElementById` is null-guarded here only (unlike the other four writes)
 * because `history-filters.test.ts`'s wiring test drives `refresh()` through
 * a real `change` event with a deliberately partial fixture DOM that has
 * never included `#fam-title`/`#fam-sub`.
 *
 * Nothing here mutates `state`; it only reads it — including the URL sync
 * below (#2635), which is why `refresh()` is the one place that call needed
 * adding: every writer of `state` (`history-filters.js`'s binds and chip
 * clicks, `history-metrics-table.js`'s header-click sort) already calls
 * `refresh()` right after mutating it, so this is the single choke point
 * where "state changed" becomes "the URL says so" without a second call site
 * at each writer to forget.
 */
export async function refresh() {
    syncUrlFromState();
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
    document.getElementById("tbl-sub").textContent =
        `${lookupTerm("card.table").tip} Click a header to sort.`;
    const famTitle = document.getElementById("fam-title");
    if (famTitle) famTitle.textContent = lookupTerm("card.family-role").label;
    const famSub = document.getElementById("fam-sub");
    if (famSub) famSub.textContent = lookupTerm("card.family-role").tip;

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
