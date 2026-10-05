// Card Prints (ADR 0140, issue #5106) — the pure half of every consumer that
// lists or picks a printing. `cardPrints` rows are read above this module
// (`convex/cardPrints.ts` queries, hooks under `src/lib/`); everything here is
// synchronous. A Card Definition's OWN printing (`printId === cardId`) has no
// row, so each helper weighs it from the registry's home Set.
import { getDefinitionSetCode, type CardPrinting } from "./catalogue";

/** The `cardPrints` fields a printing list keys on. */
export interface PrintingRow {
    printId: string;
    set: string;
}

/** Every printing of `definitionId`: its own first, with its home Set, then
 *  `rows` in the order given. When `allowedSets` is non-null the list is
 *  narrowed to those Sets, by each printing's OWN Set (an LEB-printed Mountain
 *  is offered under an `["leb"]` Format although its definition is an LEA
 *  card). Pass rows already filtered server-side — this filter only drops the
 *  definition's own printing when its home Set is not allowed. */
export function printingsWithHome(
    definitionId: string,
    rows: readonly PrintingRow[],
    allowedSets: readonly string[] | null = null
): CardPrinting[] {
    const home: CardPrinting = {
        printId: definitionId,
        setCode: getDefinitionSetCode(definitionId),
    };
    const all = [
        home,
        ...rows.map((row) => ({ printId: row.printId, setCode: row.set })),
    ];
    if (allowedSets === null) return all;
    const allowed = new Set(allowedSets);
    return all.filter((p) => allowed.has(p.setCode));
}

/** The printing of `definitionId` in the EARLIEST of `allowedSets` (list
 *  order is the Format's precedence — Old School, Alpha 40), given the
 *  earliest `cardPrints` row the table has (`cardPrints.earliestInSets`).
 *  Ties keep the definition's own printing, then the row. `defaultId` — the
 *  definition's own — when neither is in `allowedSets`, so the deck's
 *  validator, not this pick, surfaces the illegality. */
export function earliestLegalPrintId(
    definitionId: string,
    allowedSets: readonly string[],
    row: PrintingRow | undefined
): string {
    const order = new Map(allowedSets.map((set, i) => [set, i]));
    let bestId = definitionId;
    let bestRank = Infinity;
    const candidates: CardPrinting[] = printingsWithHome(
        definitionId,
        row ? [row] : []
    );
    for (const printing of candidates) {
        const rank = order.get(printing.setCode);
        if (rank !== undefined && rank < bestRank) {
            bestRank = rank;
            bestId = printing.printId;
        }
    }
    return bestId;
}
