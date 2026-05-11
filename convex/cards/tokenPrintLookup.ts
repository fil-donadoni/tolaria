// Build-time generated mapping of cardScryfallId → printed token Scryfall
// ids. Refresh by running `node scripts/fetch-token-prints.mjs <set.ts>`.
// Source of truth: Scryfall's `all_parts[]` reverse-link.

import tokenPrints from "./generated/token-prints.json";

type TokenPrintEntry = { scryfallId: string; name: string };
const PRINTS: Record<string, TokenPrintEntry[]> = tokenPrints;

/** Returns the Scryfall id of a printed token associated with `cardId`.
 *
 *  When `tokenName` is given, the lookup matches the entry whose `name`
 *  equals it (case-insensitive). Useful for cards that produce multiple
 *  distinct tokens — the resolve fn passes the spec's `name` so the right
 *  printing is selected. When `tokenName` is omitted, the first entry is
 *  returned (single-token cards: most cases).
 *
 *  Returns undefined when:
 *   - `cardId` has no entry in the mapping (the card isn't a token producer
 *     according to Scryfall, or the mapping hasn't been regenerated)
 *   - the named token has no matching entry
 *
 *  Callers (`createToken` resolves) should pass the result as
 *  `TokenSpec.imagePrintId`. The image layer will fall back to
 *  `TokenPlaceholder` when undefined. */
export function tokenPrintIdFor(
    cardId: string,
    tokenName?: string
): string | undefined {
    const entries = PRINTS[cardId];
    if (!entries || entries.length === 0) return undefined;
    if (!tokenName) return entries[0].scryfallId;
    const wanted = tokenName.toLowerCase();
    return entries.find((e) => e.name.toLowerCase() === wanted)?.scryfallId;
}
