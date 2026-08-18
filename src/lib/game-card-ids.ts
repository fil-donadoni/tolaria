import type { Doc } from "@convex/_generated/dataModel";

/**
 * Every DISTINCT print id in a Game's decklists — the art-preload manifest
 * `<Board>` feeds to `preloadCardImages`.
 *
 * Since issue #2506 the decklists live in `gameDecks` and the `games` row
 * carries `cardIds` instead: the manifest is the one thing the client ever
 * wanted off ~7.1 KB of card entries, so it is denormalised onto the row it was
 * derived from. The `players[].deck.cards` branch is the fallback for a row
 * written before the split (`deckBackfill:migrateGameDecks` retires it).
 *
 * Extracted from the component (CLAUDE.md § Code Organization) so the
 * completeness of the id set — a broken fold-in shows up only as missing card
 * art, which no server-side test sees — is assertable end-to-end.
 *
 * Returns `undefined` while the game document is still loading, so the caller
 * can distinguish "not yet known" from "genuinely no cards".
 */
export function gameArtCardIds(
    game: Doc<"games"> | null | undefined
): string[] | undefined {
    if (!game) return undefined;
    if (game.cardIds) return game.cardIds;
    const ids = new Set<string>();
    for (const p of game.players ?? []) {
        for (const c of p.deck?.cards ?? []) ids.add(c.cardId);
    }
    return Array.from(ids);
}
