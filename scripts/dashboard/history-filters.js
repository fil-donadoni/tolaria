import { state, getMeta } from "./history-state.js";
import { refresh } from "./history-refresh.js";

/**
 * The History filter bar (#2625) — dataset / metric / split / date range /
 * value chips. Owns `#filters`.
 *
 * It is the main WRITER of `history-state.js`'s `state` (declared there, never
 * here), and it re-renders itself plus the whole History view on every change.
 */
export function renderFilters() {
    const f = document.getElementById("filters");
    const META = getMeta();
    const dims = META.dimensions[state.table];
    const mets = Object.keys(META.metrics[state.table]);
    if (!mets.includes(state.metric)) state.metric = mets[0];
    if (!dims.includes(state.split)) state.split = dims[2] ?? dims[0];

    const sel = (label, id, opts, cur) =>
        `<div class="field"><label for="${id}">${label}</label><select id="${id}">` +
        opts
            .map(
                (o) =>
                    `<option value="${o}"${o === cur ? " selected" : ""}>${String(o).replace(/_/g, " ")}</option>`
            )
            .join("") +
        "</select></div>";

    f.innerHTML =
        sel("Dataset", "f-table", Object.keys(META.dimensions), state.table) +
        sel("Metric", "f-metric", mets, state.metric) +
        sel(
            "Split by",
            "f-split",
            dims.filter((d) => d !== "day"),
            state.split
        ) +
        `<div class="field"><label for="f-from">From</label><input type="date" id="f-from" value="${state.from}"></div>` +
        `<div class="field"><label for="f-to">To</label><input type="date" id="f-to" value="${state.to}"></div>` +
        `<div class="field" style="flex:1;min-width:240px"><label>Filter · ${state.split}</label><div class="chips" id="f-chips"></div></div>`;

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
            refresh();
        });
    bind("f-table", "table", true);
    bind("f-metric", "metric", false);
    bind("f-split", "split", true);
    bind("f-from", "from", false);
    bind("f-to", "to", false);
}
