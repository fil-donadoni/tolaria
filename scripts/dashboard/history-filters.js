import { state, getMeta } from "./history-state.js";
import { refresh } from "./history-refresh.js";
import { lookupTerm } from "./glossary.js";

/**
 * The History filter bar (#2625) — dataset / metric / split / date range /
 * value chips. Owns `#filters`.
 *
 * It is the main WRITER of `history-state.js`'s `state` (declared there, never
 * here), and it re-renders itself plus the whole History view on every change.
 *
 * ## Glossary-sourced labels (#2633)
 *
 * Every option renders the glossary LABEL for its raw name, never the raw
 * name itself — `agent_runs` reads "subagent runs", `cmd_bucket` reads
 * "command family". The `<option value>` stays the raw key (`history-state.js`
 * and the query layer both key on it), only the visible text changes. Metric
 * and split options are looked up QUALIFIED by the current dataset first
 * (`lookupTerm` falls back to the bare term when no qualified entry exists —
 * see glossary.js), because the same name can mean something different per
 * table (`agent_runs.messages` vs `llm.messages`).
 *
 * Each field's `<label>` also carries `data-term` for the CURRENTLY selected
 * value, so hovering/focusing "Dataset", "Metric" or "Split by" surfaces that
 * value's tooltip — the tooltip engine (`tooltip.js`) reads the attribute
 * live, so updating it in place (no full re-render) is enough to keep it
 * correct after a metric-only change.
 */

/** The glossary label for a term, qualified by `scope` when given, falling
 *  back to the raw term itself when nothing resolves. */
function labelFor(term) {
    return lookupTerm(term)?.label ?? String(term).replace(/_/g, " ");
}

const qualified = (scope, name) => (scope ? `${scope}.${name}` : name);

/**
 * Keep the Metric field's caption `data-term` pointed at the CURRENT
 * selection, without a full `renderFilters()` re-render — the one field
 * whose `change` handler doesn't rebuild `#filters` (`bind("f-metric", ...,
 * false)` below). The tooltip engine reads `data-term` live on every hover,
 * so updating just the attribute is enough. Exported for direct testing —
 * the alternative is driving a real DOM `change` event through to
 * `refresh()`'s network calls just to observe this one attribute.
 */
export function syncMetricLabelTerm() {
    const lbl = document.querySelector('label[for="f-metric"]');
    if (lbl)
        lbl.setAttribute("data-term", qualified(state.table, state.metric));
}

export function renderFilters() {
    const f = document.getElementById("filters");
    const META = getMeta();
    const dims = META.dimensions[state.table];
    const mets = Object.keys(META.metrics[state.table]);
    if (!mets.includes(state.metric)) state.metric = mets[0];
    if (!dims.includes(state.split)) state.split = dims[2] ?? dims[0];

    const sel = (labelText, id, opts, cur, scope, labelTerm) =>
        `<div class="field"><label for="${id}"${labelTerm ? ` data-term="${labelTerm}"` : ""}>${labelText}</label><select id="${id}">` +
        opts
            .map((o) => {
                const text = labelFor(qualified(scope, o));
                return `<option value="${o}"${o === cur ? " selected" : ""}>${text}</option>`;
            })
            .join("") +
        "</select></div>";

    const splitTerm = qualified(state.table, state.split);
    f.innerHTML =
        sel(
            "Dataset",
            "f-table",
            Object.keys(META.dimensions),
            state.table,
            undefined,
            state.table
        ) +
        sel(
            "Metric",
            "f-metric",
            mets,
            state.metric,
            state.table,
            qualified(state.table, state.metric)
        ) +
        sel(
            "Split by",
            "f-split",
            dims.filter((d) => d !== "day"),
            state.split,
            state.table,
            splitTerm
        ) +
        `<div class="field"><label for="f-from">From</label><input type="date" id="f-from" value="${state.from}"></div>` +
        `<div class="field"><label for="f-to">To</label><input type="date" id="f-to" value="${state.to}"></div>` +
        `<div class="field" style="flex:1;min-width:240px"><label>Filter · <span data-term="${splitTerm}">${labelFor(splitTerm)}</span></label><div class="chips" id="f-chips"></div></div>`;

    const vals = META.values[state.table][state.split] ?? [];
    const active = new Set(state.filters[state.split] ?? []);
    document.getElementById("f-chips").innerHTML = vals
        .map(
            (v) =>
                `<button class="chip" data-v="${v}" aria-pressed="${active.has(v)}">${v}</button>`
        )
        .join("");
    document.querySelectorAll("#f-chips .chip").forEach((c) =>
        c.addEventListener("click", () => {
            const v = c.dataset.v;
            const cur = new Set(state.filters[state.split] ?? []);
            cur.has(v) ? cur.delete(v) : cur.add(v);
            if (cur.size) state.filters[state.split] = [...cur];
            else delete state.filters[state.split];
            renderFilters();
            refresh();
        })
    );

    const bind = (id, key, rerenderFilters) =>
        document.getElementById(id).addEventListener("change", (e) => {
            state[key] = e.target.value;
            if (key === "table") {
                state.filters = {};
                state.sort = null;
            }
            if (key === "split") state.sort = null;
            if (rerenderFilters) renderFilters();
            else if (key === "metric") syncMetricLabelTerm();
            refresh();
        });
    bind("f-table", "table", true);
    bind("f-metric", "metric", false);
    bind("f-split", "split", true);
    bind("f-from", "from", false);
    bind("f-to", "to", false);
}
