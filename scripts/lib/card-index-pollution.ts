/**
 * Pure predicate shared by `check-card-index.ts` and its test — kept out of
 * that file's top-level script body (which runs `getAllCards()` and calls
 * `process.exit` on failure at IMPORT time) so it can be unit-tested without
 * executing the whole guard as a side effect.
 *
 * A `data/card-index.json` row is "pollution" (indexed but not implemented)
 * UNLESS it is a compiled-sourced row (issue #2702) — a compiled `ready` row
 * has no hand-written `CardDefinition` to match against, by construction, so
 * its absence from `registryIds` is expected, not a stale/leaked entry.
 */
export interface CardIndexEntryForPollutionCheck {
    readonly scryfallId: string;
    readonly source?: "compiled";
}

export function isPollutionEntry(
    entry: CardIndexEntryForPollutionCheck,
    registryIds: ReadonlySet<string>
): boolean {
    return entry.source !== "compiled" && !registryIds.has(entry.scryfallId);
}
