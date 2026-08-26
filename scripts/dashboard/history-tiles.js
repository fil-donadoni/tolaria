import { fmtMetric, isAdditive } from "./format.js";
import { state, getMeta } from "./history-state.js";
import { lookupTerm } from "./glossary.js";

/** The glossary label for a metric/dimension name, qualified by the current
 *  dataset first (see glossary.js's qualified-key fallback). */
const termLabel = (name) =>
    lookupTerm(`${state.table}.${name}`)?.label ??
    String(name).replace(/_/g, " ");

/**
 * The metric tiles above the History cards (#2625). Owns `#tiles`.
 *
 * Tile captions render the glossary LABEL for each metric/split (#2633),
 * never the raw column name, and carry `data-term` for the tooltip engine.
 */
export function renderTiles(total, rowsBySplit, split) {
    const t = document.getElementById("tiles");
    const mets = getMeta().metrics[state.table];
    const names = Object.keys(mets);
    const pick = names.slice(0, 4);
    const top = rowsBySplit[0];
    t.innerHTML =
        pick
            .map(
                (m) =>
                    `<div class="tile"><div class="k" data-term="${state.table}.${m}">${termLabel(m)}</div><div class="v">${fmtMetric(m, total[m])}</div></div>`
            )
            .join("") +
        (top
            ? `<div class="tile"><div class="k">top <span data-term="${state.table}.${split}">${termLabel(split)}</span></div><div class="v">${top[split]}</div><div class="n">${fmtMetric(state.metric, top[state.metric])}${
                  // A share only exists when the parts sum to the
                  // whole. avg / avg is a ratio of two statistics,
                  // and reads as a percentage that can exceed 100.
                  isAdditive(state.metric)
                      ? ` · ${((top[state.metric] / (total[state.metric] || 1)) * 100).toFixed(0)}% of total`
                      : ` · highest ${termLabel(state.metric)}`
              }</div></div>`
            : "");
}
