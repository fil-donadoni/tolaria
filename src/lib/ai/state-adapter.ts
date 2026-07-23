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
// Libraries, however, MUST be rebuilt to their wire `count` with opaque
// placeholder instances (issue #136). Enumeration ignores libraries, but the
// ISMCTS search SIMULATES the game forward — resolving draw spells and the draw
// step. A draw from an empty library trips the deck-out SBA (CR 704.5b) and
// returns a terminal win/loss, so the bot scored "force the opponent to draw"
// (Braingeyser) as a phantom lethal. Populating each library to its real count
// gives simulated draws a card to take; a genuinely-empty library (count 0)
// still decks out, preserving CR 704.5b. The placeholders are opaque: their id
// resolves to no `CardDefinition`, so `getLegalActions` never surfaces them as
// legal moves even after a simulated draw puts one in hand.

import type { CardInstanceState, GameState } from "@convex/gre";
import { PLACEHOLDER_CARD_ID } from "@convex/gre";
import type { PublicGameState } from "@convex/gameProjections";

/** Build `count` opaque library instances for a player. The instances carry
 *  only the structural fields the engine reads while a card sits in (or is
 *  drawn from) the library — identity is intentionally absent. */
function makeLibraryPlaceholders(
    playerId: string,
    count: number
): CardInstanceState[] {
    const cards: CardInstanceState[] = [];
    for (let i = 0; i < count; i++) {
        cards.push({
            id: `placeholder:${playerId}:${i}`,
            card: { id: PLACEHOLDER_CARD_ID },
            controllerId: playerId,
            ownerId: playerId,
            zone: "library",
            types: [],
            subtypes: [],
            staticAbilities: [],
            isTapped: false,
        });
    }
    return cards;
}

/** Rehydrate a bot-viewpoint `PublicGameState` into a `GameState` for
 *  enumeration and ISMCTS search. Pure; returns a shallow structural view (no
 *  deep copy needed — enumeration never mutates, and search clones first). */
export function projectedToGameState(state: PublicGameState): GameState {
    return {
        ...state,
        players: state.players.map((p) => ({
            ...p,
            // Drop nulled opponent-hand placeholders; keep the bot's own cards.
            hand: p.hand.filter((c) => c !== null),
            // Library contents are hidden on the wire, but the simulated draw
            // step / draw spells need cards to take. Rebuild to the wire count
            // with opaque placeholders so draws don't spuriously deck out.
            //
            // EXCEPTION (issue #1506): while a `search-library` choice is live,
            // the projection legitimately exposes the searched pile face-up to
            // the chooser (`librarySearch`, CR 401.4 / 701.19) — the same field
            // the human's picker renders. The search decides that choice at the
            // root now, and its candidate moves name library INSTANCE IDS the
            // server must recognise, so the real revealed cards have to be here:
            // opaque placeholders would yield a submission of fabricated ids
            // that the server rejects forever.
            library:
                p.librarySearch ??
                makeLibraryPlaceholders(p.id, p.library.count),
        })),
        stack: state.stack,
    } as unknown as GameState;
}
