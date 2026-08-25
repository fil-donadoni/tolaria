import { fmtMetric, isAdditive } from "./format.js";
import { state, getMeta } from "./history-state.js";

/** The metric tiles above the History cards (#2625). Owns `#tiles`. */
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
                    `<div class="tile"><div class="k">${m.replace(/_/g, " ")}</div><div class="v">${fmtMetric(m, total[m])}</div></div>`
            )
            .join("") +
        (top
            ? `<div class="tile"><div class="k">top ${split}</div><div class="v">${top[split]}</div><div class="n">${fmtMetric(state.metric, top[state.metric])}${
                  // A share only exists when the parts sum to the
                  // whole. avg / avg is a ratio of two statistics,
                  // and reads as a percentage that can exceed 100.
                  isAdditive(state.metric)
                      ? ` · ${((top[state.metric] / (total[state.metric] || 1)) * 100).toFixed(0)}% of total`
                      : ` · highest ${state.metric.replace(/_/g, " ")}`
              }</div></div>`
            : "");
}
