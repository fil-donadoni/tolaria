import type { CardPrinting } from "@convex/cards/catalogue";

/** One printing as the deck builder's visual printing picker (issue #4122)
 *  shows it. `promo` / `digital` come from the `cardPrints` table (ADR 0140);
 *  a printing known only from the hand-written catalogue or from Scryfall's
 *  editions search carries neither and reads as paper. */
export interface PickerPrinting extends CardPrinting {
    promo?: boolean;
    digital?: boolean;
}

/** The picker's three chips besides "All". Digital wins over promo: an
 *  Arena-only promo cannot be held, which is the distinction a player filters
 *  by. */
export type PrintingKind = "paper" | "promo" | "digital";

export type PrintingKindFilter = "all" | PrintingKind;

export const PRINTING_KINDS: readonly PrintingKind[] = [
    "paper",
    "promo",
    "digital",
];

export function printingKind(p: PickerPrinting): PrintingKind {
    if (p.digital) return "digital";
    if (p.promo) return "promo";
    return "paper";
}

export function countByKind(
    prints: readonly PickerPrinting[]
): Record<PrintingKindFilter, number> {
    const counts = { all: prints.length, paper: 0, promo: 0, digital: 0 };
    for (const p of prints) counts[printingKind(p)] += 1;
    return counts;
}

export function filterByKind(
    prints: readonly PickerPrinting[],
    kind: PrintingKindFilter
): PickerPrinting[] {
    return kind === "all"
        ? [...prints]
        : prints.filter((p) => printingKind(p) === kind);
}

/** `base` first (the hand-written catalogue's printings — the Card
 *  Definition's own printing among them, which the `cardPrints` sync skips by
 *  construction), then every table row not already listed, deduplicated by
 *  print id. A base printing the table also carries takes the table's flags. */
export function mergePrintings(
    base: readonly CardPrinting[],
    table: readonly PickerPrinting[]
): PickerPrinting[] {
    const byId = new Map(table.map((p) => [p.printId, p]));
    const merged: PickerPrinting[] = base.map((p) => byId.get(p.printId) ?? p);
    const seen = new Set(merged.map((p) => p.printId));
    for (const p of table) {
        if (!seen.has(p.printId)) {
            seen.add(p.printId);
            merged.push(p);
        }
    }
    return merged;
}

function fold(s: string): string {
    return s
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .toLowerCase()
        .trim();
}

/** The set codes a free-text set query names: a code typed exactly
 *  ("ody"), or any set whose full name contains the text ("odyssey",
 *  "alpha"), accent- and case-insensitive. `setNames` maps lower-case code →
 *  name; `knownCodes` are codes with no name entry (yet) that still match by
 *  code. `null` for a blank query — no set restriction. */
export function matchSetCodes(
    query: string,
    setNames: ReadonlyMap<string, string>,
    knownCodes: Iterable<string> = []
): string[] | null {
    const q = fold(query);
    if (q === "") return null;
    const hits = new Set<string>();
    for (const [code, name] of setNames) {
        if (code === q || fold(name).includes(q)) hits.add(code);
    }
    for (const code of knownCodes) {
        if (code.toLowerCase() === q) hits.add(code.toLowerCase());
    }
    return [...hits];
}

/** The Sets the `cardPrints` query is restricted to: the Format's allowed
 *  Sets (Old School / Alpha 40) intersected with the text query's matches.
 *  `null` = unrestricted. An empty array means nothing can match — the
 *  caller must not send it (the query's `or()` of zero terms). */
export function restrictSets(
    allowedSets: readonly string[] | null,
    matched: readonly string[] | null
): string[] | null {
    if (matched === null) return allowedSets ? [...allowedSets] : null;
    if (allowedSets === null) return [...matched];
    const allowed = new Set(allowedSets.map((s) => s.toLowerCase()));
    return matched.filter((s) => allowed.has(s));
}

/** Whether one printing survives the Set restriction — applied to the
 *  catalogue/Scryfall printings, which never pass through the query. */
export function inSets(p: CardPrinting, sets: readonly string[] | null) {
    return sets === null || sets.includes(p.setCode.toLowerCase());
}
