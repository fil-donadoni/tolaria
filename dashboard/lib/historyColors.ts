import { seedQuery } from "./historyQuery";
import { getHistoryMeta } from "./historyState";

/**
 * Series colour assignment for the History charts (PRD #3148 S3), ported from
 * `scripts/dashboard/history-colors.js` (#2625).
 *
 * `colorMap` and `seeded` are module-private and reachable only through
 * `seedColors()` / `colorFor()`. Nothing else on the page may mutate them.
 *
 * COLOUR IS BOUND TO THE ENTITY, never to its rank in the current view. Slots
 * are seeded once per (dataset, dimension) from an UNFILTERED ranking on that
 * dataset's canonical count metric, so a value keeps the same hue whichever
 * metric, filter or date range is selected — and across reloads, since the
 * seeding query depends on no UI state. Deriving the slot from the DISPLAYED
 * ranking instead would repaint every survivor whenever a filter changed the
 * ordering.
 */

/** The categorical ramp, declared in `dashboard/index.css`. Eight slots is the
 *  whole ramp: past that the palette stops being distinguishable, which is why
 *  the "Over time" card folds the tail into one explicit "Other". */
export const MAX_SERIES = 8;

const SERIES = Array.from(
    { length: MAX_SERIES },
    (_, i) => `var(--series-${i + 1})`
);

/** The fold-in slot — a value that is deliberately not one of the eight. */
export const OTHER = "var(--muted-foreground)";

const colorMap = new Map<string, string>();
const seeded = new Set<string>();

const slot = (i: number): string => (i < MAX_SERIES ? SERIES[i] : OTHER);

/**
 * Seed the slots for one (dataset, dimension), at most once per pair.
 *
 * Awaited BEFORE the first paint of a chart: seeding afterwards would draw the
 * chart once with fallback hues and again with the stable ones, a repaint on
 * the next tick for every value on screen.
 */
export async function seedColors(table: string, dim: string): Promise<void> {
    const key = `${table}/${dim}`;
    if (seeded.has(key)) return;
    seeded.add(key);
    const canonical = Object.keys(getHistoryMeta()?.metrics[table] ?? {})[0];
    if (!canonical) return;
    const { rows } = await seedQuery(table, canonical, dim);
    rows.forEach((r, i) => {
        const k = `${dim} ${String(r[dim])}`;
        if (!colorMap.has(k)) colorMap.set(k, slot(i));
    });
}

/** The colour for one value of one dimension. A value the seeding query never
 *  saw (new since load) takes the next free slot rather than no colour. */
export function colorFor(dim: string, value: string): string {
    const key = `${dim} ${value}`;
    const known = colorMap.get(key);
    if (known) return known;
    const used = [...colorMap.keys()].filter((k) =>
        k.startsWith(`${dim} `)
    ).length;
    const next = slot(used);
    colorMap.set(key, next);
    return next;
}

/** Test-only: drop every seeded slot, so a suite does not inherit the previous
 *  file's colour assignment. */
export function resetHistoryColors(): void {
    colorMap.clear();
    seeded.clear();
}
