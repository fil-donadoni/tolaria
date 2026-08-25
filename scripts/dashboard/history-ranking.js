import { fmtMetric } from "./format.js";
import { showTip, hideTip } from "./tooltip.js";
import { el } from "./svg.js";

/**
 * The "Ranking" card (#2625) — top 18 values of the current split, descending.
 * Owns `#rank`; `#rank-title` / `#rank-sub` stay with history-refresh.js.
 */
export function renderRanking(rows, split, metric) {
    const svg = document.getElementById("rank");
    svg.innerHTML = "";
    const data = rows
        .map((r) => ({ k: r[split], v: r[metric] ?? 0, row: r }))
        .filter((d) => d.v > 0)
        .slice(0, 18);
    if (!data.length) {
        svg.setAttribute("height", 0);
        return;
    }
    const rowH = 26,
        padL = 168,
        padR = 90,
        padT = 6;
    const W = Math.min(1180, Math.max(560, innerWidth - 90));
    const H = padT + data.length * rowH + 8;
    svg.setAttribute("width", W);
    svg.setAttribute("height", H);
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const max = Math.max(...data.map((d) => d.v));
    const barMax = W - padL - padR;

    data.forEach((d, i) => {
        const y = padT + i * rowH;
        const w = Math.max(2, (d.v / max) * barMax);
        const lab = el("text", {
            x: padL - 10,
            y: y + 15,
            "text-anchor": "end",
            fill: "var(--text-secondary)",
            "font-size": 12,
        });
        lab.textContent = String(d.k).slice(0, 26);
        svg.appendChild(lab);
        const p = el("path", {
            // Rounded data-end only; the bar stays anchored to the axis.
            d: `M${padL},${y + 4}h${w - 4}a4,4 0 0 1 4,4v6a4,4 0 0 1 -4,4h${-(w - 4)}Z`,
            // One measure, nominal categories, a direct label on every
            // row: colour would double-encode bar length and leave any
            // ninth-and-beyond category in an indistinguishable grey.
            fill: "var(--series-1)",
        });
        p.addEventListener("mousemove", (e) =>
            showTip(
                e,
                `<b>${d.k}</b><br>${metric}: <b>${fmtMetric(metric, d.v)}</b>`
            )
        );
        p.addEventListener("mouseleave", hideTip);
        svg.appendChild(p);
        // Direct value labels: the light-mode palette has three slots
        // under 3:1 against the surface, so the relief rule applies.
        const val = el("text", {
            x: padL + w + 8,
            y: y + 15,
            fill: "var(--text-primary)",
            "font-size": 12,
        });
        val.textContent = fmtMetric(metric, d.v);
        svg.appendChild(val);
    });
}
