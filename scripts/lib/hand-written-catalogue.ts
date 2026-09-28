/**
 * The hand-written catalogue as the Bot-play measurements see it (ADR 0141):
 * the card-index join `target-bot-reach.ts` measures with and
 * `seed-bot-findings.ts` counts with — one copy, so "hand-written" names the
 * same card set in the sweep and on the admin page.
 */

/** A `data/card-index.json` row, as far as the seed reads it. */
export interface CardIndexEntry {
    readonly oracleId?: string;
    readonly firstPrintId?: string;
    readonly source?: string;
}

/**
 * The hand-written catalogue, by oracle id → the print id its definition is
 * registered under: a card-index row the compiler did not produce, joined to
 * a registered definition through its first print.
 */
export function handWrittenPrintIds(
    index: readonly CardIndexEntry[],
    registeredPrintIds: Iterable<string>
): Map<string, string> {
    const oracleIdByPrintId = new Map<string, string>();
    for (const e of index) {
        if (e.source === "compiled" || !e.oracleId || !e.firstPrintId) continue;
        oracleIdByPrintId.set(e.firstPrintId, e.oracleId);
    }
    const handWritten = new Map<string, string>();
    for (const printId of registeredPrintIds) {
        const oracleId = oracleIdByPrintId.get(printId);
        if (oracleId !== undefined && !handWritten.has(oracleId))
            handWritten.set(oracleId, printId);
    }
    return handWritten;
}
