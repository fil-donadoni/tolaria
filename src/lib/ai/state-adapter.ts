// Adapts the bot's projected wire state into a GameState the GRE move enumerator
// can read (ADR 0001, issue #110).
//
// The brain consumes `projectPublicState(state, seq, botId)` — the SAME wire
// projection a human client receives (criterion 5): the bot's own hand is
// visible, the opponent's hand is nulled, and libraries are reduced to a count.
// `enumerateMoves` only ever reads the acting player's hand and both
// battlefields, so dropping the nulled opponent-hand placeholders and the hidden
// library contents loses nothing the bot is allowed to act on. Slim card refs
// (`card: { id }`) are already structurally valid `CardInstanceState`s — the
// engine reads only `card.id`.

import type { GameState } from "@convex/gre";
import type { PublicGameState } from "@convex/gameProjections";

/** Rehydrate a bot-viewpoint `PublicGameState` into a `GameState` for
 *  enumeration. Pure; returns a shallow structural view (no deep copy needed —
 *  enumeration never mutates). */
export function projectedToGameState(state: PublicGameState): GameState {
    return {
        ...state,
        players: state.players.map((p) => ({
            ...p,
            // Drop nulled opponent-hand placeholders; keep the bot's own cards.
            hand: p.hand.filter((c) => c !== null),
            // Library contents are hidden on the wire and irrelevant to move
            // legality — the bot cannot act from its library.
            library: [],
        })),
        stack: state.stack,
    } as unknown as GameState;
}
