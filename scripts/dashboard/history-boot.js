import { state, setMeta } from "./history-state.js";
import { renderFilters } from "./history-filters.js";
import { refresh } from "./history-refresh.js";
import { onThemeChange } from "./theme.js";

/**
 * History's entry point (#2625) — the ONLY module `main.js` reaches, and it
 * reaches it through a `await import()` inside a try/catch.
 *
 * That indirection is what preserves #2519's guarantee across the ES-module
 * split. Before the split, "the loop-status panel must come up even with no
 * telemetry.db" was bought by ORDERING two statements inside one inline
 * script: start the poll, then run the DB-backed block in a try/catch. A
 * static `import` graph does not preserve that — every statically imported
 * module is fetched, parsed and evaluated BEFORE the importing module's first
 * statement runs, so one broken History module would take the Now panel down
 * before it ever polled. Loading History dynamically restores the ordering and
 * strengthens it: a missing asset, a syntax error or a rejected `/api/meta`
 * all land in the same `catch`, and Now is already polling by then.
 */
export async function bootstrapHistory(params) {
    // Registered before the first await so a theme toggle during a slow
    // `/api/meta` still re-renders once the data lands.
    onThemeChange(refresh);

    const META = await (await fetch("/api/meta")).json();
    if (META.error) throw new Error(META.error);
    setMeta(META);
    state.from = META.range?.min_day ?? "";
    state.to = META.range?.max_day ?? "";
    // Applied after the defaults so an explicit param always wins,
    // and validated against META so a stale link can't wedge the
    // page.
    for (const k of ["table", "metric", "split", "from", "to"]) {
        const v = params.get(k);
        if (v) state[k] = v;
    }
    if (!META.dimensions[state.table]) state.table = "agent_runs";
    document.getElementById("meta-line").textContent =
        `${META.counts.spans.toLocaleString()} spans · ${META.counts.llm.toLocaleString()} messages · ` +
        `${META.counts.agent_runs.toLocaleString()} agent runs · ` +
        `${META.range.min_day} → ${META.range.max_day} · ` +
        `ingested ${new Date(Number(META.lastIngest)).toLocaleString()}`;
    renderFilters();
    refresh();
}
