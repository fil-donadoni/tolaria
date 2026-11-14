import type { CardPrinting } from "@convex/cards/catalogue";

export interface EditionOption {
    printId: string;
    label: string;
}

/** Labels each printing by its set code, disambiguating same-set variants
 *  (e.g. the three LEB basic-land arts) with a `#n` suffix. Order matches the
 *  input (original definition first). */
export function editionOptions(
    prints: readonly CardPrinting[]
): EditionOption[] {
    const total = new Map<string, number>();
    for (const p of prints) {
        total.set(p.setCode, (total.get(p.setCode) ?? 0) + 1);
    }
    const seen = new Map<string, number>();
    return prints.map((p) => {
        const n = (seen.get(p.setCode) ?? 0) + 1;
        seen.set(p.setCode, n);
        const base = p.setCode.toUpperCase();
        return {
            printId: p.printId,
            label: (total.get(p.setCode) ?? 0) > 1 ? `${base} #${n}` : base,
        };
    });
}

/** The print id to show/add by default. When the set filter is active and the
 *  card has a printing in a selected set, that printing wins; otherwise the
 *  original `CardDefinition` (`prints[0]`). */
export function defaultEdition(
    prints: readonly CardPrinting[],
    activeSets: string[]
): string {
    if (activeSets.length > 0) {
        const hit = prints.find((p) => activeSets.includes(p.setCode));
        if (hit) return hit.printId;
    }
    return prints[0].printId;
}

/** The printing a result cell shows (issue #8755): the user's preferred
 *  printing when its Set is visible in this view, else `fallback` (the
 *  `defaultEdition` printing). A preferred printing outside the Format's
 *  allowed Sets (`null` = every Set) or outside an active Set filter falls
 *  back for this view only — the preference itself is never deleted, so a
 *  Format or filter that allows it shows it again. Display only: deck
 *  legality stays server-side (ADR 0140). */
export function preferredEdition(
    fallback: CardPrinting,
    preferred: CardPrinting | undefined,
    allowedSets: readonly string[] | null,
    activeSets: readonly string[]
): CardPrinting {
    if (!preferred) return fallback;
    const set = preferred.setCode.toLowerCase();
    const within = (sets: readonly string[]) =>
        sets.some((s) => s.toLowerCase() === set);
    if (allowedSets !== null && !within(allowedSets)) return fallback;
    if (activeSets.length > 0 && !within(activeSets)) return fallback;
    return preferred;
}
