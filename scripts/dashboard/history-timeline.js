import { fmtMetric, isAdditive } from "./format.js";
import { showTip, hideTip } from "./tooltip.js";
import { el, barPath, niceTicks } from "./svg.js";
import { colorFor, OTHER, MAX_SERIES } from "./history-colors.js";
import { lookupTerm } from "./glossary.js";
import { state } from "./history-state.js";

/**
 * The "Over time" card (#2625) — stacked daily bars for an additive metric,
 * one line per series for a metric that is not.
 *
 * Owns `#ts`, `#ts-sub` and `#ts-legend`. `#ts-title` stays with
 * `history-refresh.js`, which writes it BEFORE awaiting the query so the
 * heading updates even when the query then fails — the behaviour today.
 *
 * `#ts-sub` leads with the glossary's fixed "what question does this
 * answer" sentence (`card.over-time`, #2633), then the per-query stacking
 * detail this function alone knows.
 */
export function renderTimeSeries(rows, split, metric) {
    const svg = document.getElementById("ts");
    svg.innerHTML = "";
    const additive = isAdditive(metric);
    const days = [...new Set(rows.map((r) => r.day))].sort();
    const keys = [...new Set(rows.map((r) => r[split]))];
    // Series are ranked by their total when the metric sums, and by
    // their peak when it doesn't — ranking a mean by a running sum
    // would order series by how many days they appear on.
    const totalByKey = new Map();
    for (const r of rows) {
        const prev = totalByKey.get(r[split]) ?? 0;
        const v = r[metric] ?? 0;
        totalByKey.set(r[split], additive ? prev + v : Math.max(prev, v));
    }
    // Past 8 series the palette stops being distinguishable, so the
    // tail folds into one explicit "Other" rather than cycling hues.
    // A mean or a max cannot be folded — averaging averages is not
    // the average — so for those the tail is dropped and said so.
    const ranked = keys.sort((a, b) => totalByKey.get(b) - totalByKey.get(a));
    const top = ranked.slice(0, MAX_SERIES);
    const fold = new Set(additive ? ranked.slice(MAX_SERIES) : []);
    const dropped = additive ? 0 : ranked.length - top.length;
    const seriesKeys = fold.size ? [...top, "Other"] : top;

    const stack = new Map(days.map((d) => [d, new Map()]));
    for (const r of rows) {
        if (!additive && !top.includes(r[split])) continue;
        const k = fold.has(r[split]) ? "Other" : r[split];
        const m = stack.get(r.day);
        // Only a sum composes across rows; a mean or a max from the
        // server is already the value for that (day, series) cell.
        m.set(
            k,
            additive ? (m.get(k) ?? 0) + (r[metric] ?? 0) : (r[metric] ?? 0)
        );
    }

    const metricLabel =
        lookupTerm(`${state.table}.${metric}`)?.label ??
        metric.replace(/_/g, " ");
    const question = lookupTerm("card.over-time").tip;
    document.getElementById("ts-sub").textContent =
        `${question} ` +
        (additive
            ? 'Stacked; series past the eighth fold into "Other".'
            : `Not stacked — ${metricLabel} is a per-row statistic, so its parts do not add up.` +
              (dropped > 0
                  ? ` Top ${MAX_SERIES} series shown; ${dropped} omitted.`
                  : ""));

    const barW = Math.max(
        9,
        Math.min(34, Math.floor(960 / Math.max(days.length, 1)))
    );
    const gap = 6;
    const padL = 68,
        padR = 12,
        padT = 10,
        axisH = 42;
    const plotH = 260;
    const W = padL + days.length * (barW + gap) + padR;
    const H = padT + plotH + axisH;
    svg.setAttribute("width", W);
    svg.setAttribute("height", H);
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);

    // Stacked bars need the column total for the scale; unstacked
    // lines need the single largest point.
    const max = Math.max(
        ...days.map((d) => {
            const vals = [...stack.get(d).values()];
            return additive
                ? vals.reduce((a, b) => a + b, 0)
                : Math.max(0, ...vals);
        }),
        0
    );
    const ticks = niceTicks(max);
    const yTop = ticks[ticks.length - 1] || 1;
    const y = (v) => padT + plotH - (v / yTop) * plotH;

    for (const t of ticks) {
        svg.appendChild(
            el("line", {
                x1: padL - 6,
                x2: W - padR,
                y1: y(t),
                y2: y(t),
                stroke: "var(--grid)",
                "stroke-width": 1,
            })
        );
        const lab = el("text", {
            x: padL - 10,
            y: y(t) + 4,
            "text-anchor": "end",
            fill: "var(--muted)",
            "font-size": 11,
        });
        lab.textContent = fmtMetric(metric, t);
        svg.appendChild(lab);
    }

    const cx = (i) => padL + i * (barW + gap) + barW / 2;

    if (!additive) {
        // One 2px line per series, plus a marker per observed day.
        // Gaps stay gaps: a day with no rows for a series is not a
        // zero, and joining across it would invent a measurement.
        for (const k of seriesKeys) {
            const pts = days
                .map((d, i) => ({ i, d, v: stack.get(d).get(k) }))
                .filter((p) => p.v != null);
            if (!pts.length) continue;
            const stroke = colorFor(split, k);
            for (let j = 1; j < pts.length; j++) {
                if (pts[j].i !== pts[j - 1].i + 1) continue;
                svg.appendChild(
                    el("line", {
                        x1: cx(pts[j - 1].i),
                        y1: y(pts[j - 1].v),
                        x2: cx(pts[j].i),
                        y2: y(pts[j].v),
                        stroke,
                        "stroke-width": 2,
                        "stroke-linecap": "round",
                    })
                );
            }
            for (const p of pts) {
                // 2px surface ring keeps overlapping markers legible.
                svg.appendChild(
                    el("circle", {
                        cx: cx(p.i),
                        cy: y(p.v),
                        r: 4,
                        fill: stroke,
                        stroke: "var(--surface-1)",
                        "stroke-width": 2,
                    })
                );
                const hit = el("circle", {
                    cx: cx(p.i),
                    cy: y(p.v),
                    r: 12,
                    fill: "transparent",
                });
                hit.addEventListener("mousemove", (e) =>
                    showTip(
                        e,
                        `<b>${p.d}</b><br>${k}: <b>${fmtMetric(metric, p.v)}</b>`
                    )
                );
                hit.addEventListener("mouseleave", hideTip);
                svg.appendChild(hit);
            }
        }
    }

    days.forEach((d, i) => {
        const x = padL + i * (barW + gap);
        let acc = 0;
        const present = additive
            ? seriesKeys.filter((k) => (stack.get(d).get(k) ?? 0) > 0)
            : [];
        present.forEach((k, j) => {
            const v = stack.get(d).get(k);
            const y0 = y(acc + v),
                y1 = y(acc);
            // 2px surface gap between stacked segments — a separator
            // made of background, not a border drawn around marks.
            const h = Math.max(1, y1 - y0 - 2);
            const isTop = j === present.length - 1;
            const p = el("path", {
                d: isTop
                    ? barPath(x, y0, barW, h, 4)
                    : `M${x},${y0}h${barW}v${h}h${-barW}Z`,
                fill: k === "Other" ? OTHER : colorFor(split, k),
            });
            p.addEventListener("mousemove", (e) =>
                showTip(
                    e,
                    `<b>${d}</b><br>${k}: <b>${fmtMetric(metric, v)}</b><br><span style="color:var(--text-secondary)">day total ${fmtMetric(metric, acc + v + present.slice(j + 1).reduce((s, kk) => s + (stack.get(d).get(kk) ?? 0), 0))}</span>`
                )
            );
            p.addEventListener("mouseleave", hideTip);
            svg.appendChild(p);
            acc += v;
        });
        if (days.length <= 40 || i % Math.ceil(days.length / 30) === 0) {
            const t = el("text", {
                x: x + barW / 2,
                y: padT + plotH + 16,
                "text-anchor": "end",
                fill: "var(--muted)",
                "font-size": 10,
                transform: `rotate(-45 ${x + barW / 2} ${padT + plotH + 16})`,
            });
            t.textContent = d.slice(5);
            svg.appendChild(t);
        }
    });

    svg.appendChild(
        el("line", {
            x1: padL - 6,
            x2: W - padR,
            y1: padT + plotH,
            y2: padT + plotH,
            stroke: "var(--axis)",
            "stroke-width": 1,
        })
    );

    const leg = document.getElementById("ts-legend");
    leg.innerHTML = seriesKeys
        .map(
            (k) =>
                `<span><span class="sw" style="background:${k === "Other" ? OTHER : colorFor(split, k)}"></span>${k}</span>`
        )
        .join("");
}
