// Adapts the bot's projected wire state into a GameState the GRE move enumerator
// can read (ADR 0001, issue #110).
//
// The brain consumes `projectPublicState(state, seq, botId)` — the SAME wire
// projection a human client receives (criterion 5): the bot's own hand is
// visible, the opponent's hand is nulled, and libraries are reduced to a count.
// `enumerateMoves` only ever reads the acting player's hand and both
// battlefields, so dropping the nulled opponent-hand placeholders loses nothing
// the bot is allowed to act on. Slim card refs (`card: { id }`) are already
// structurally valid `CardInstanceState`s — the engine reads only `card.id`.
//
// Libraries, however, MUST be rebuilt to their wire `count` (issue #136).
// Enumeration ignores libraries, but the ISMCTS search SIMULATES the game
// forward — resolving draw spells, the draw step, AND fetch/tutor searches. A
// draw from an empty library trips the deck-out SBA (CR 704.5b) and returns a
// terminal win/loss, so the bot scored "force the opponent to draw"
// (Braingeyser) as a phantom lethal. Populating each library to its real count
// gives simulated draws a card to take; a genuinely-empty library (count 0)
// still decks out, preserving CR 704.5b.
//
// Own library — REAL identities (issue #1509). The content of one's OWN deck is
// public knowledge to its owner; only the ORDER is hidden (see `determinize`).
// When the caller supplies the bot's decklist (`ownDeck`), its library is
// rebuilt from the deck's real card identities minus the cards already visible
// in the bot's other zones — so a simulated fetch/tutor subtree searches the
// actual fetchable cards (`libraryTargetWorth`, the search-library candidate
// generator, #1429) instead of worthless placeholders. `determinize` shuffles
// those real identities every ISMCTS iteration, preserving the hidden ORDER.
// Without a decklist (older callers, opponent libraries) the placeholder path
// stands: opaque instances whose id resolves to no `CardDefinition`, so
// `getLegalActions` never surfaces them as legal moves even after a simulated
// draw puts one in hand.

import type { CardInstanceState, GameState } from "@convex/gre";
import { PLACEHOLDER_CARD_ID } from "@convex/gre";
import type { PublicGameState, PublicPlayer } from "@convex/gameProjections";
import { tryGetDefinition } from "@convex/cards";

/** The bot's own decklist, wired into the adapter so its library reconstructs
 *  with real card identities (issue #1509). `cardIds` are card DEFINITION ids
 *  (the maindeck as of game start); `playerId` selects which player it belongs
 *  to (only that player's library gets real identities). */
export type OwnDeckList = { playerId: string; cardIds: string[] };

/** One opaque library instance — identity intentionally absent. */
function makePlaceholder(playerId: string, index: number): CardInstanceState {
    return {
        id: `placeholder:${playerId}:${index}`,
        card: { id: PLACEHOLDER_CARD_ID },
        controllerId: playerId,
        ownerId: playerId,
        zone: "library",
        types: [],
        subtypes: [],
        staticAbilities: [],
        isTapped: false,
    };
}

/** Build `count` opaque library instances for a player (no decklist known). */
function makeLibraryPlaceholders(
    playerId: string,
    count: number
): CardInstanceState[] {
    const cards: CardInstanceState[] = [];
    for (let i = 0; i < count; i++) cards.push(makePlaceholder(playerId, i));
    return cards;
}

/** One real library instance, shaped exactly like an engine-native library card
 *  (`buildPlayerState`): characteristics hydrated from the definition so a
 *  simulated draw → cast reads a fully-formed card. */
function makeRealInstance(
    playerId: string,
    index: number,
    cardId: string
): CardInstanceState {
    const def = tryGetDefinition(cardId);
    return {
        id: `libcard:${playerId}:${index}`,
        card: { id: cardId },
        types: def?.types ?? [],
        subtypes: def?.subtypes ?? [],
        power: def?.power,
        toughness: def?.toughness,
        staticAbilities: def?.staticAbilities ?? [],
        controllerId: playerId,
        ownerId: playerId,
        zone: "library",
        isTapped: false,
    };
}

/** Decrement a card-id multiset by one; no-op if the id is absent (a token or a
 *  card that left the game isn't in the deck list). */
function removeOne(multiset: Map<string, number>, cardId: string): void {
    const n = multiset.get(cardId);
    if (n === undefined) return;
    if (n <= 1) multiset.delete(cardId);
    else multiset.set(cardId, n - 1);
}

/** Reconstruct a player's library from its real decklist (issue #1509): the
 *  deck multiset minus every card the bot can already see it holds elsewhere
 *  (hand, battlefield, graveyard, exile, and its own cards on the stack). The
 *  remainder — the cards still in the library — is emitted as real instances,
 *  truncated or padded with placeholders to the wire `count` so the deck-out
 *  SBA (CR 704.5b) stays exact even when deck accounting drifts (mulliganed
 *  cards, tokens, cards that left the game). Order is irrelevant here —
 *  `determinize` reshuffles every ISMCTS iteration. */
function makeRealLibrary(
    state: PublicGameState,
    player: PublicPlayer,
    deckCardIds: string[]
): CardInstanceState[] {
    const count = player.library.count;

    // Deck as a card-id multiset.
    const remaining = new Map<string, number>();
    for (const id of deckCardIds) {
        remaining.set(id, (remaining.get(id) ?? 0) + 1);
    }

    // Subtract the bot-owned cards already visible outside the library.
    for (const c of player.hand) {
        if (c) removeOne(remaining, c.card.id);
    }
    for (const c of player.battlefield) removeOne(remaining, c.card.id);
    for (const c of player.graveyard) removeOne(remaining, c.card.id);
    for (const c of player.exile) removeOne(remaining, c.card.id);
    for (const item of state.stack) {
        if (item.ownerId === player.id) removeOne(remaining, item.card.id);
    }

    // The remainder is the library content. Emit real instances up to `count`,
    // then pad with placeholders (or truncate) so length === count exactly.
    const realIds: string[] = [];
    for (const [id, n] of remaining) {
        for (let i = 0; i < n; i++) realIds.push(id);
    }

    const cards: CardInstanceState[] = [];
    const take = Math.min(realIds.length, count);
    for (let i = 0; i < take; i++) {
        cards.push(makeRealInstance(player.id, i, realIds[i]));
    }
    for (let i = take; i < count; i++) {
        cards.push(makePlaceholder(player.id, i));
    }
    return cards;
}

/** Rehydrate a bot-viewpoint `PublicGameState` into a `GameState` for
 *  enumeration and ISMCTS search. When `ownDeck` is supplied, that player's
 *  library is rebuilt with real card identities (issue #1509); every other
 *  library rebuilds to its wire count with opaque placeholders. Pure; returns a
 *  shallow structural view (no deep copy needed — enumeration never mutates, and
 *  search clones first). */
export function projectedToGameState(
    state: PublicGameState,
    ownDeck?: OwnDeckList
): GameState {
    return {
        ...state,
        players: state.players.map((p) => ({
            ...p,
            // Drop nulled opponent-hand placeholders; keep the bot's own cards.
            hand: p.hand.filter((c) => c !== null),
            // Library contents are hidden on the wire, but the simulated draw
            // step / draw spells / fetch searches need cards to take. Rebuild
            // to the wire count.
            //
            // EXCEPTION (issue #1506): while a `search-library` choice is live,
            // the projection legitimately exposes the searched pile face-up to
            // the chooser (`librarySearch`, CR 401.4 / 701.19) — the same field
            // the human's picker renders. The search decides that choice at the
            // root now, and its candidate moves name library INSTANCE IDS the
            // server must recognise, so the real revealed cards MUST win: opaque
            // placeholders (or fabricated deck-reconstruction ids) would yield a
            // submission of ids the server rejects forever. `librarySearch`
            // therefore takes precedence over the ownDeck reconstruction.
            //
            // Otherwise (issue #1509): rebuild to the wire count with the bot's
            // own decklist for real identities where we have them, opaque
            // placeholders for every other library, so simulated draws/fetches
            // valuate real cards instead of blanks.
            library:
                p.librarySearch ??
                (ownDeck && ownDeck.playerId === p.id
                    ? makeRealLibrary(state, p, ownDeck.cardIds)
                    : makeLibraryPlaceholders(p.id, p.library.count)),
        })),
        stack: state.stack,
    } as unknown as GameState;
}
