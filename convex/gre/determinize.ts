// Determinization for the vs-AI Bot's ISMCTS search (ADR 0001, issue #112).
//
// Information-set Monte Carlo Tree Search reasons over the bot's OBSERVED
// state, where the opponent's hand + both players' library orders are hidden.
// `determinize(state, observerId, rng)` samples ONE plausible concrete world
// consistent with everything the observer knows: it re-deals the hidden cards
// uniformly at random into the hidden zones, while leaving every PUBLIC fact
// untouched. ISMCTS re-determinizes once per iteration so the tree is not
// overfit to a single guessed world (CR has no bearing here — this is a search
// device, never an authoritative state).
//
// What is hidden vs known, from `observerId`'s point of view:
//   * Observer's OWN hand     → known (kept exactly).
//   * Observer's OWN library  → contents may be known but ORDER generally is
//                               not; shuffle — EXCEPT the positions the
//                               observer legitimately knows (issue #1524).
//   * Opponent's hand         → hidden; its cards are indistinguishable from the
//                               opponent's library, so the two zones are pooled
//                               and re-dealt (a card the observer can't see could
//                               equally be in either zone).
//   * Opponent's library      → hidden; pooled with the opponent's hand.
//
// Public zones (battlefields, graveyards, exile, the stack, life totals, combat)
// are never touched. Zone COUNTS are always preserved: the opponent ends with
// the same hand size and library size, the observer with the same library size.
//
// PURE: clones via `cloneGameState`, draws only from the injected `rng`, never
// mutates the input. Given the same `rng` sequence it returns the same world.
//
// NOTE on the production projection: the bot consults its OWN wire viewpoint.
//   * The OBSERVER's library — since issue #1509 the state adapter rebuilds it
//     from the bot's real decklist (own-deck content is public to its owner),
//     so `determinizeObserver`'s shuffle does real work here: it hides the
//     ORDER the bot must not know while keeping the content the bot legitimately
//     does, re-sampling a plausible draw/fetch order every ISMCTS iteration.
//   * The OPPONENT's hidden zones arrive as counts with no identities (the
//     adapter fills them with opaque placeholders). BLIND — no entry in
//     `deckKnowledge` — pooling and re-dealing them is a faithful no-op, and
//     the bot searches without inventing specific opponent cards.
// Fed a full-information state (as the unit tests do), it re-deals for real.
//
// INFORMED SEATS (issue #2789, PRD #2787). When the caller supplies deck
// knowledge for a seat OTHER than the observer, that seat's hidden zones stop
// being re-dealt and start being SAMPLED from the cards its decklist still
// admits (`unseenRemainder`). This is the difference between imagining an
// opponent who has surrendered — placeholders resolve to no `CardDefinition`,
// so the simulated opponent never casts anything from this moment to the end
// of the game, a systematic optimism no search budget can correct — and one who
// holds real cards and plays them.
//
// The sample REPLACES the seat's current hidden contents rather than permuting
// them, and that is the point on a full-information state: the observer is not
// entitled to what is actually in that hand, so re-deriving it from the
// decklist is what models the observer's ignorance faithfully. On a
// wire-projected state there is nothing to discard — those slots held
// placeholders.
//
// Except where the observer HAS been shown a hidden card (`knownTo`): a
// face-up-revealed hand card, a scry-kept top card, a searched pile. Those keep
// their real instances and are struck from the pool, so the sample fills only
// the slots that are genuinely unknown. Overwriting them would be strictly
// worse than the blind path — which at least MOVES the real instance rather
// than deleting it — and would have the bot forget a card it is looking at.
//
// The observer's OWN seat never takes this path even when it has an entry: the
// bot sees its own hand, and re-sampling it would DESTROY information the bot
// legitimately has (`determinizeObserver` keeps the hand and shuffles only the
// library order).

import type { CardInstanceState, GameState, PlayerState } from "./state";
import { cloneGameState } from "./clone";
import { PLACEHOLDER_CARD_ID } from "./constants";
import { tryGetDefinition } from "../cards";
import {
    knowledgeFor,
    unseenRemainder,
    type DeckKnowledgeBySeat,
} from "./deckKnowledge";
import {
    computeLibraryTopLookedAtPlayers,
    computeLibraryTopRevealedPlayers,
} from "./libraryReveal";
import { knownLibraryIndices } from "./libraryKnownRuns";
import { shuffleWithRng } from "./rng";

/** Re-tag an instance's zone so the world stays internally consistent after a
 *  card is dealt into a different hidden zone. */
function inZone(
    card: CardInstanceState,
    zone: CardInstanceState["zone"]
): CardInstanceState {
    card.zone = zone;
    return card;
}

/** Sample one plausible world consistent with `observerId`'s observations.
 *  Public state is identical to the input; hidden zones are re-dealt uniformly
 *  at random while preserving every zone's card count. Pure.
 *
 *  `deckKnowledge` names the seats whose decklist the search is allowed to
 *  know (issue #2789). A seat listed here, other than the observer, has its
 *  hidden zones SAMPLED from that decklist's unseen remainder instead of
 *  re-dealt from its own contents; every other seat is unchanged, so a call
 *  without this argument behaves exactly as it did before it existed. */
export function determinize(
    state: GameState,
    observerId: string,
    rng: () => number,
    deckKnowledge?: DeckKnowledgeBySeat
): GameState {
    const next = cloneGameState(state);

    // CR 401.5 (issue #1095) — a library whose top card is continuously
    // revealed (Goblin Spy) is PUBLIC at index 0 to every player, the observer
    // included. That card must survive determinization pinned where it is:
    // re-sampling it would have the search reason about a top card the bot can
    // plainly see is something else. Derived from the (public) battlefield, so
    // the observer is entitled to it whichever side the source is on.
    const topRevealed = computeLibraryTopRevealedPlayers(next);
    // CR 401.5 (issue #2398) — the ASYMMETRIC half: "you may look at the top
    // card of your library" (Bolas's Citadel) is not public, so it pins the
    // top card only for the OBSERVER'S OWN library. Pinning an opponent's
    // looked-at top would hand the search information the bot cannot have;
    // NOT pinning the observer's own would have it re-sample a card it is
    // looking at right now.
    const topLookedAt = computeLibraryTopLookedAtPlayers(next);

    for (const player of next.players) {
        const pinTop =
            topRevealed.has(player.id) ||
            (player.id === observerId && topLookedAt.has(player.id));
        // ADR 0026 (issue #1524) — every position this observer legitimately
        // knows, from the SAME derivation the wire projection grants them
        // with (`knownLibraryIndices`): the contiguous known run from the top,
        // the contiguous known run from the bottom, and the CR 401.5 index-0
        // carve-out above. Re-sampling any of them would have the search
        // reason about a card the bot can plainly see is something else — the
        // scry-to-top the bot instantly forgot, before this.
        const pinned = new Set(
            knownLibraryIndices(player.library, observerId, pinTop)
        );
        if (player.id === observerId) {
            // Own hand is known; only the UNKNOWN library order is hidden.
            determinizeObserver(player, rng, pinned);
            continue;
        }
        // A decklist for this seat turns the re-deal into a SAMPLE from what
        // that decklist still admits (issue #2789).
        const deckCardIds = knowledgeFor(deckKnowledge, player.id);
        if (deckCardIds) {
            determinizeInformedOpponent(
                next,
                player,
                deckCardIds,
                observerId,
                rng,
                pinned
            );
        } else {
            // Opponent hand + library are both hidden and interchangeable.
            determinizeOpponent(player, rng, pinned);
        }
    }

    return next;
}

/** Split a library into the cards held at `pinned` indices (keyed by index) and
 *  the rest, in order. The two together always account for every card, so a
 *  caller that re-deals `unpinned` and hands it back to `placeAtPinned` cannot
 *  change the library's SIZE — which is a public fact the deck-out SBA reads
 *  (CR 704.5b). */
function splitPinned(
    library: CardInstanceState[],
    pinned: ReadonlySet<number>
): {
    held: Map<number, CardInstanceState>;
    unpinned: CardInstanceState[];
} {
    const held = new Map<number, CardInstanceState>();
    const unpinned: CardInstanceState[] = [];
    library.forEach((card, index) => {
        if (pinned.has(index)) held.set(index, card);
        else unpinned.push(card);
    });
    return { held, unpinned };
}

/** Rebuild a library of `length` cards with every pinned index holding exactly
 *  the card it held before, and `fill` (already re-dealt) flowing into the gaps
 *  in order. `fill.length` must be `length - held.size`, which `splitPinned`
 *  guarantees for every caller here. */
function placeAtPinned(
    length: number,
    held: Map<number, CardInstanceState>,
    fill: CardInstanceState[]
): CardInstanceState[] {
    if (fill.length !== length - held.size) {
        // Fail LOUD. A short `fill` would leave `undefined` in a library slot
        // rather than throw, and a hole there is a corrupt world the search
        // would happily keep expanding — the deck-out SBA (CR 704.5b) still
        // counts the slot, so nothing downstream notices.
        throw new Error(
            `determinize: ${fill.length} card(s) to fill ${length - held.size} unpinned library slot(s)`
        );
    }
    const out: CardInstanceState[] = [];
    let next = 0;
    for (let index = 0; index < length; index++) {
        const kept = held.get(index);
        out.push(kept ?? fill[next++]);
    }
    return out;
}

/** The observer keeps its hand; its library keeps its size but the positions it
 *  does NOT know are reshuffled. `pinned` holds every position it DOES know
 *  (issue #1524) — a scry keep, a Brainstorm put-back, cards ordered onto the
 *  bottom, and the CR 401.5 continuously-revealed top — in place, because none
 *  of that is hidden information and re-sampling it would delete knowledge the
 *  bot legitimately has. */
function determinizeObserver(
    player: PlayerState,
    rng: () => number,
    pinned: ReadonlySet<number>
): void {
    if (pinned.size === 0) {
        player.library = shuffleWithRng(player.library, rng);
        return;
    }
    const { held, unpinned } = splitPinned(player.library, pinned);
    player.library = placeAtPinned(
        player.library.length,
        held,
        shuffleWithRng(unpinned, rng)
    );
}

/** Pool the opponent's hand + library — indistinguishable to the observer —
 *  shuffle, then re-deal the first `handSize` cards back to the hand and the
 *  remainder to the library, preserving both counts.
 *
 *  `pinned` withholds those library positions from the pool ENTIRELY and puts
 *  their real cards straight back at their own indices: a card the observer has
 *  been shown (a CR 401.5 revealed top, a fateseal, a surveil aimed at this
 *  opponent) can neither move nor turn up in the opponent's hand (issue
 *  #1524). Every unpinned position is still pooled and re-dealt exactly as
 *  before. */
function determinizeOpponent(
    player: PlayerState,
    rng: () => number,
    pinned: ReadonlySet<number>
): void {
    const handSize = player.hand.length;
    if (pinned.size === 0) {
        // The production norm — opponent library knowledge is rare, and this
        // runs once per seat per ISMCTS iteration. Same short-circuit
        // `determinizeObserver` takes.
        const pool = shuffleWithRng([...player.hand, ...player.library], rng);
        player.hand = pool.slice(0, handSize).map((c) => inZone(c, "hand"));
        player.library = pool.slice(handSize).map((c) => inZone(c, "library"));
        return;
    }
    const { held, unpinned } = splitPinned(player.library, pinned);
    const pool = shuffleWithRng([...player.hand, ...unpinned], rng);
    player.hand = pool.slice(0, handSize).map((c) => inZone(c, "hand"));
    const fill = pool.slice(handSize).map((c) => inZone(c, "library"));
    player.library = placeAtPinned(player.library.length, held, fill);
}

/** One imagined hidden card, hydrated from its definition so a simulated
 *  draw → cast reads a fully-formed card — the same shape the state adapter's
 *  `makeRealInstance` builds for a known library.
 *
 *  The instance id is namespaced `imagined:` and carries the zone plus the
 *  slot, so it can never collide with a real instance id, with the adapter's
 *  `libcard:` / `placeholder:` ids, or with the SAME seat's other hidden zone
 *  at the same index — instance ids key the search's choice candidates and its
 *  dominance memo, and two cards sharing one id there is a silent mis-match. */
function imagineCard(
    playerId: string,
    zone: "hand" | "library",
    index: number,
    cardId: string
): CardInstanceState {
    const def = tryGetDefinition(cardId);
    return {
        id: `imagined:${zone}:${playerId}:${index}`,
        card: { id: cardId },
        types: def?.types ?? [],
        subtypes: def?.subtypes ?? [],
        power: def?.power,
        toughness: def?.toughness,
        staticAbilities: def?.staticAbilities ?? [],
        controllerId: playerId,
        ownerId: playerId,
        zone,
        isTapped: false,
    };
}

/** The "we ran out of decklist" filler. Deck accounting drifts (a card that
 *  left the game, a sideboard swap, a token that was never in the deck), and
 *  the zone COUNTS are public facts that must survive regardless: an imagined
 *  library one card short would deck the opponent out early (CR 704.5b) and
 *  hand the bot a phantom win. Opaque on purpose — a placeholder resolves to
 *  no `CardDefinition`, so `getLegalActions` never offers it as a move. */
function unknownCard(
    playerId: string,
    zone: "hand" | "library",
    index: number
): CardInstanceState {
    return {
        id: `imagined:${zone}:${playerId}:${index}`,
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

/** Sample an INFORMED opponent's hidden zones from their decklist (issue
 *  #2789). Hand and library are filled from the unseen remainder — the
 *  decklist minus every copy already accounted for in a public zone — so the
 *  bot reasons about an opponent holding cards that deck could still be
 *  holding, and never a fifth copy of a four-of.
 *
 *  Both hidden zones are drawn from ONE shuffled pool, exactly as the blind
 *  path pools hand and library: a card the observer cannot see could equally be
 *  in either zone, and splitting the draws would make the hand and the library
 *  independently sampled from the same finite multiset — which double-counts.
 *
 *  `pinned` withholds those library positions from the sample entirely and puts
 *  their real cards straight back AT THEIR OWN INDICES (issue #1524): a card
 *  the observer has been shown — the CR 401.5 continuously-revealed top, a
 *  fateseal, a surveil aimed at this opponent — can neither move nor be
 *  replaced by a guess. Their identities are also struck from the remainder
 *  first, or a card the observer is looking at right now could be dealt a
 *  second time into the hand. */
function determinizeInformedOpponent(
    state: GameState,
    player: PlayerState,
    deckCardIds: readonly string[],
    observerId: string,
    rng: () => number,
    pinned: ReadonlySet<number>
): void {
    // A hidden-zone card the observer HAS been shown is not a guess to make —
    // it is a fact to keep. `knownTo` is the engine's record of exactly that
    // (a look effect adds the looker, a reveal adds everyone, face-down exile
    // adds the controller), and it is how a face-up-revealed hand card, a
    // scry-kept top card and a searched pile all reach here.
    //
    // Replacing one of those with a sampled guess is strictly worse than the
    // blind path, which at least MOVES the real instance instead of deleting
    // it: the bot would forget a card it is looking at right now — and it bites
    // hardest exactly when it matters, since a revealed opponent hand is
    // usually revealed because the bot is mid-decision over it.
    //
    // For the LIBRARY that fact now includes the card's POSITION, so the kept
    // cards come from the pinned-index split rather than a `filter` that
    // collapsed them all to the front.
    //
    // THE TRADE that split makes (issue #1524). A known card BURIED between
    // unknowns is contiguous with neither end, so ADR 0026 does not grant its
    // position and it is no longer kept: its id goes back in the pool and can
    // be re-dealt into the hand, i.e. the observer loses "X is in the LIBRARY"
    // as well as "X is 4th". That is a smaller false belief than the one it
    // replaces — the old filter FABRICATED a near-top position for it, which
    // the bot would then value its next draw against — and it makes this path
    // agree with the blind `determinizeOpponent`, which has always pooled such
    // cards with the hand. Keeping the zone while re-sampling the position is
    // a third behaviour NEITHER path has; it belongs to both at once, not
    // here.
    const { held, unpinned } = splitPinned(player.library, pinned);
    const keptHand = player.hand.filter(
        (c) => c.knownTo?.includes(observerId) === true
    );
    const handSlots = player.hand.length - keptHand.length;
    const librarySlots = unpinned.length;

    const remainder = unseenRemainder(state, player, deckCardIds, observerId);
    // Strike every already-placed card from the pool, or it could be dealt a
    // SECOND time into a slot the observer cannot see.
    for (const c of [...held.values(), ...keptHand]) {
        const at = remainder.indexOf(String(c.card.id ?? ""));
        if (at >= 0) remainder.splice(at, 1);
    }

    const pool = shuffleWithRng(remainder, rng);
    let taken = 0;
    const draw = (zone: "hand" | "library", index: number) =>
        taken < pool.length
            ? imagineCard(player.id, zone, index, pool[taken++])
            : unknownCard(player.id, zone, index);

    // Known cards keep their real instances (and their real ids, which a move
    // naming one must round-trip to the server with); the unknown slots around
    // them are sampled.
    player.hand = [
        ...keptHand.map((c) => inZone(c, "hand")),
        ...Array.from({ length: handSlots }, (_, i) => draw("hand", i)),
    ];
    const fill = Array.from({ length: librarySlots }, (_, i) =>
        draw("library", i)
    );
    player.library = placeAtPinned(player.library.length, held, fill);
}
