import { getMeta } from "./history-state.js";

/**
 * Series colour assignment for the History charts (#2625).
 *
 * Owns `colorMap` and `seeded` — module-private, reachable only through
 * `seedColors()` / `colorFor()`. Nothing else on the page may mutate them.
 */

const SERIES = [
    "--series-1",
    "--series-2",
    "--series-3",
    "--series-4",
    "--series-5",
    "--series-6",
    "--series-7",
    "--series-8",
];
export const OTHER = "var(--muted)";
export const MAX_SERIES = 8;

/**
 * Colour is bound to the entity, never to its rank in the current
 * view. Slots are seeded once per (table, dimension) from an
 * UNFILTERED ranking on that table's canonical count metric, so the
 * same value keeps the same hue whichever metric, filter or date
 * range is selected — and across reloads, since the seeding query
 * doesn't depend on any UI state. Deriving the slot from the
 * displayed ranking instead would repaint every survivor whenever a
 * filter changed the ordering.
 */
const colorMap = new Map();
const seeded = new Set();

export async function seedColors(table, dim) {
    const key = `${table}/${dim}`;
    if (seeded.has(key)) return;
    seeded.add(key);
    const canonical = Object.keys(getMeta().metrics[table])[0];
    const res = await fetch("/api/q", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            table,
            metric: canonical,
            groupBy: [dim],
            limit: 500,
        }),
    });
    const { rows } = await res.json();
    rows.forEach((r, i) => {
        const k = `${dim} ${r[dim]}`;
        if (!colorMap.has(k))
            colorMap.set(k, i < MAX_SERIES ? `var(${SERIES[i]})` : OTHER);
    });
}

export function colorFor(dim, value) {
    const key = `${dim} ${value}`;
    if (!colorMap.has(key)) {
        // A value the seeding query never saw (new since load).
        const used = [...colorMap.keys()].filter((k) =>
            k.startsWith(dim + " ")
        ).length;
        colorMap.set(key, used < MAX_SERIES ? `var(${SERIES[used]})` : OTHER);
    }
    return colorMap.get(key);
}
