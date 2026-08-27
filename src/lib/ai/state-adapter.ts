// Adapts the bot's projected wire state into a GameState the GRE move enumerator
// can read (ADR 0001, issue #110).
//
// The brain consumes `projectPublicState(state, seq, botId)` — the SAME wire
// projection a human client receives (criterion 5): the bot's own hand is
// visible, the opponent's hand is nulled, and libraries are reduced to a count.
// Slim card refs (`card: { id }`) are already structurally valid
// `CardInstanceState`s — the engine reads only `card.id`.
//
// Hands, like libraries, MUST be rebuilt to their wire LENGTH (issue #2006).
// This adapter used to `filter(c => c !== null)` the opponent's hand away, on
// the reasoning that `enumerateMoves` only reads the acting player's hand — but
// a hand's SIZE is public information (CR 402.2) and the engine reads it at
// every effect site the search walks through: `ctx.getHandSize` (The Rack,
// Storm World, Storm Seeker, Ivory Tower) and the Effect Script `count`'s
// `zone: "hand"` (Dark Suspicions, issue #2006). With the nulls dropped, both
// read 0 for any NON-VIEWER in a client-side engine run, and the sign of the
// error flips with who owns the card:
//   * bot controls Dark Suspicions → the human's hand reads 0, so the trigger
//     prices and simulates as a dead card;
//   * human controls it            → the HUMAN's hand (the subtrahend) reads 0,
//     so the bot simulates an inflated incoming life loss.
// Padding to the wire length with the same opaque placeholders the library path
// already uses restores the cardinality without inventing identities the bot may
// not see — the placeholder id resolves to no `CardDefinition`, so
// `getLegalActions` (`gre/rules.ts`, the PLACEHOLDER_CARD_ID guard) never
// surfaces one as a legal move even once a simulated turn makes it the acting
// player's hand. `determinize` then pools hand+library and re-deals at the same
// sizes, so the padded hand stays consistent across ISMCTS iterations.
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
// Deck knowledge — REAL identities, PER SEAT (issue #2788, generalising
// #1509). A seat's own deck content is public knowledge to its owner; only the
// ORDER is hidden (see `determinize`). The caller supplies a
// `DeckKnowledgeBySeat` — zero or more `{ playerId, cardIds }` entries, one per
// seat the search is allowed to know about. For a seat with an entry, that
// seat's library is rebuilt from the deck's real card identities minus the
// cards already visible in that seat's other zones — so a simulated
// fetch/tutor subtree searches the actual fetchable cards (`libraryTargetWorth`,
// the search-library candidate generator, #1429) instead of worthless
// placeholders. `determinize` shuffles those real identities every ISMCTS
// iteration, preserving the hidden ORDER.
//
// A seat with NO entry — the common case for every seat but the bot's own —
// keeps the placeholder path: opaque instances whose id resolves to no
// `CardDefinition`, so `getLegalActions` never surfaces them as legal moves
// even after a simulated draw puts one in hand. This blind mode is not a
// fallback to delete later: the lower difficulty levels use it on purpose, and
// the future belief-pool sampler (PRD #2787) will be a THIRD mode alongside
// it, never a replacement for the placeholder machinery.

import type { CardInstanceState, GameState } from "@convex/gre";
import { PLACEHOLDER_CARD_ID } from "@convex/gre";
import type { PublicGameState, PublicPlayer } from "@convex/gameProjections";
import { tryGetDefinition } from "@convex/cards";

/** One seat's known deck content, wired into the adapter so that seat's
 *  library reconstructs with real card identities (issue #1509). `cardIds` are
 *  card DEFINITION ids (the maindeck as of game start); `playerId` selects
 *  which seat it belongs to. */
export type SeatDeckKnowledge = { playerId: string; cardIds: string[] };

/** Deck knowledge available to the search, addressed PER SEAT rather than as a
 *  single seat's list (issue #2788 — a prefactor for the opponent model, PRD
 *  #2787). Plain array of plain records — arrays/strings only — so it survives
 *  the structured-clone `postMessage` hop unchanged. A seat absent from this
 *  array is BLIND: it keeps today's opaque placeholders (see the header note).
 *  Today only the bot's own seat is ever populated, so every imagined world is
 *  byte-identical to before this type existed. */
export type DeckKnowledgeBySeat = SeatDeckKnowledge[];

/** Look up one seat's deck knowledge, if the caller supplied any for it. The
 *  single fail-closed discriminator the whole per-seat generalisation rests
 *  on: a seat is informed if and only if it has an entry HERE, never by an
 *  implicit "today only one seat is ever populated" invariant. */
function knowledgeFor(
    deckKnowledge: DeckKnowledgeBySeat | undefined,
    playerId: string
): string[] | undefined {
    return deckKnowledge?.find((k) => k.playerId === playerId)?.cardIds;
}

/** One opaque hidden-zone instance — identity intentionally absent. The ZONE is
 *  part of the instance id so a player's hand placeholder and their library
 *  placeholder at the same index can never collide (instance ids key the
 *  search's choice candidates and dominance memo). */
function makePlaceholder(
    playerId: string,
    index: number,
    zone: "library" | "hand" = "library"
): CardInstanceState {
    return {
        id: `placeholder:${zone}:${playerId}:${index}`,
        card: { id: PLACEHOLDER_CARD_ID },
        controllerId: playerId,
        ownerId: playerId,
        zone,
        types: [],
        subtypes: [],
        staticAbilities: [],
        isTapped: false,
    };
}

/** Rebuild a player's hand to its WIRE LENGTH (issue #2006).
 *
 *  `projectPublicState` emits a non-viewer's hand as `null[]` — one null per
 *  card — so the LENGTH is the public hand size (CR 402.2) even though every
 *  identity is hidden. Visible entries (the viewer's own hand, and an
 *  opponent's hand exposed face-up by a live cross-player hand pick) pass
 *  through untouched; each null becomes an opaque placeholder, exactly as
 *  `makeLibraryPlaceholders` does for a hidden library. */
function rebuildHand(player: PublicPlayer): CardInstanceState[] {
    return player.hand.map((c, i) =>
        c === null
            ? makePlaceholder(player.id, i, "hand")
            : (c as unknown as CardInstanceState)
    );
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

/** ADR 0026 — overlay the library identities the WIRE already told this viewer
 *  about (`PublicLibrary.known[]`: each entry is a card the projection decided
 *  the viewer legitimately sees, at its top-relative `index`) onto a rebuilt
 *  library, replacing the placeholder / deck-reconstruction guess at that slot.
 *
 *  Without this, every rebuild path above throws the reveal away and the bot
 *  searches a library whose known positions hold cards it can plainly see are
 *  something else. The channel is mechanism-agnostic on purpose: it carries a
 *  scry/Brainstorm-kept top card and the CR 401.5 continuous top reveal (Goblin
 *  Spy, issue #1095) alike — the adapter does not need to know which.
 *
 *  SWAP, never STAMP — the invariant a length check does not catch. For the
 *  bot's OWN library, `makeRealLibrary` has already emitted a faithful multiset
 *  of the cards still in the deck; its ORDER is meaningless (`Map` insertion
 *  order, reshuffled by `determinize` anyway) but its CONTENTS are not.
 *  Overwriting the slot at a known index would duplicate the revealed card and
 *  delete whatever the reconstruction had there — deck `[Mountain, Forest,
 *  Island]` with Island revealed on top becomes `[Island, Forest, Island]`: a
 *  phantom the bot can draw, and a real card it never can. So when the known
 *  card is found elsewhere in the rebuilt library, the two slots EXCHANGE
 *  occupants and the multiset is preserved exactly.
 *
 *  When no donor slot holds that card id, the library is the OPAQUE kind
 *  (placeholders padded to the wire `count` — an opponent's library, or a
 *  deck-accounting remainder): its occupants carry no multiset meaning, so the
 *  placeholder is simply replaced. Either way length is unchanged (out-of-range
 *  indices are ignored), so the deck-out SBA count (CR 704.5b) stays exact.
 *
 *  Identities are hydrated from the definition exactly like `makeRealInstance`,
 *  and the wire instance's own id is kept so a move naming that card round-trips
 *  to a server whose ids match. */
function overlayKnownLibraryCards(
    library: CardInstanceState[],
    player: PublicPlayer
): CardInstanceState[] {
    const known = Array.isArray(player.library)
        ? undefined
        : player.library.known;
    if (!known || known.length === 0) return library;
    const out = [...library];
    // Slots already resolved to a known card — never raided for a donor, or an
    // earlier entry's placement would be undone by a later one.
    const pinned = new Set<number>();
    for (const entry of known) {
        const index = entry.index;
        if (index < 0 || index >= out.length) continue;
        const cardId = entry.card.card.id;
        if (out[index].card.id !== cardId) {
            // Find this card elsewhere in the rebuilt library and exchange the
            // two slots, so nothing is duplicated and nothing is lost.
            const donor = out.findIndex(
                (c, j) => j !== index && !pinned.has(j) && c.card.id === cardId
            );
            // No donor → opaque/placeholder library, nothing to preserve.
            if (donor >= 0) out[donor] = out[index];
        }
        const def = tryGetDefinition(cardId);
        out[index] = {
            ...entry.card,
            types: def?.types ?? entry.card.types ?? [],
            subtypes: def?.subtypes ?? entry.card.subtypes ?? [],
            power: def?.power ?? entry.card.power,
            toughness: def?.toughness ?? entry.card.toughness,
            staticAbilities:
                def?.staticAbilities ?? entry.card.staticAbilities ?? [],
            zone: "library",
        } as CardInstanceState;
        pinned.add(index);
    }
    return out;
}

/** Rehydrate a bot-viewpoint `PublicGameState` into a `GameState` for
 *  enumeration and ISMCTS search. Each seat named in `deckKnowledge` has its
 *  library rebuilt with real card identities (issue #1509, generalised to
 *  per-seat by #2788); every other seat's library rebuilds to its wire count
 *  with opaque placeholders. Pure; returns a shallow structural view (no deep
 *  copy needed — enumeration never mutates, and search clones first). */
export function projectedToGameState(
    state: PublicGameState,
    deckKnowledge?: DeckKnowledgeBySeat
): GameState {
    return {
        ...state,
        players: state.players.map((p) => ({
            ...p,
            // Rebuild to the wire LENGTH: a hand's SIZE is public (CR 402.2)
            // and every hand-size read in the engine goes through this pile
            // (issue #2006 — see the header note).
            hand: rebuildHand(p),
            // Library contents are hidden on the wire, but the simulated draw
            // step / draw spells / fetch searches need cards to take. Rebuild
            // to the wire count.
            //
            // EXCEPTION (issue #1506): while a `search-library` choice is live,
            // the projection legitimately exposes the searched pile face-up to
            // the chooser (`librarySearch`, CR 401.4 / 701.23) — the same field
            // the human's picker renders. The search decides that choice at the
            // root now, and its candidate moves name library INSTANCE IDS the
            // server must recognise, so the real revealed cards MUST win: opaque
            // placeholders (or fabricated deck-reconstruction ids) would yield a
            // submission of ids the server rejects forever. `librarySearch`
            // therefore takes precedence over the deck-knowledge reconstruction.
            //
            // Otherwise (issue #1509, per-seat since #2788): rebuild to the
            // wire count with THIS seat's known decklist for real identities
            // where we have one, opaque placeholders otherwise, so simulated
            // draws/fetches valuate real cards instead of blanks.
            //
            // Either way, the identities the wire ALREADY revealed to this
            // viewer (`library.known[]` — a scry-kept top card, or the CR 401.5
            // continuous top reveal, issue #1095) are overlaid onto the result
            // at their exact indices, so the bot never searches a top card it
            // can plainly see is a different card.
            library:
                p.librarySearch ??
                overlayKnownLibraryCards(
                    (() => {
                        const cardIds = knowledgeFor(deckKnowledge, p.id);
                        return cardIds
                            ? makeRealLibrary(state, p, cardIds)
                            : makeLibraryPlaceholders(p.id, p.library.count);
                    })(),
                    p
                ),
        })),
        stack: state.stack,
    } as unknown as GameState;
}
