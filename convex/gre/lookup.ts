// The engine's lookup leaf (issue #4452): find a player, an opponent, a
// permanent or a card in any zone, and allocate an instance id — WITHOUT
// importing the core (`./state`).
//
// A DEPENDENCY-FREE LEAF, like `playerCounters.ts`: every import below is
// `import type` and therefore erased, so this module adds ZERO runtime import
// edges. A peripheral module that imported these helpers from the core joined
// the core's import cycle, and a cycle makes any value read at
// module-evaluation time depend on bundle entry order (the findings-1969 class,
// `docs/findings/1969-figure-of-fable-import-cycle.md`). That is why ~20
// private copies of "find permanent by id" grew up beside the core's own; the
// byte-equivalent ones now import from here. The core re-exports everything
// below, so `import { getPlayer } from "./state"` keeps compiling — but a leaf
// module imports it from HERE. `lookup.test.ts` guards that this file imports
// nothing at runtime.
import type { Zone } from "./types";
import type {
    CardInstanceState,
    GameState,
    PlayerState,
} from "./state/declarations";

/** CR 400.1 — the `PlayerState` array behind each per-player zone. The stack
 *  is shared by all players, so it has no per-player field. */
export const ZONE_TO_FIELD: Record<
    Exclude<Zone, "stack">,
    keyof PlayerState
> = {
    hand: "hand",
    library: "library",
    battlefield: "battlefield",
    graveyard: "graveyard",
    exile: "exile",
};

export function getPlayer(state: GameState, playerId: string): PlayerState {
    const player = state.players.find((p) => p.id === playerId);
    if (!player) throw new Error(`Player not found: ${playerId}`);
    return player;
}

/** Returns the id of the other player (2-player game). */
export function getOpponentId(state: GameState, playerId: string): string {
    const opponent = state.players.find((p) => p.id !== playerId);
    if (!opponent) throw new Error("Opponent not found");
    return opponent.id;
}

export function allocInstanceId(counter: { nextInstanceId?: number }): string {
    counter.nextInstanceId = (counter.nextInstanceId ?? 0) + 1;
    return String(counter.nextInstanceId);
}

/** Every permanent on every player's battlefield, in player order. */
export function* allPermanents(
    state: GameState
): Generator<CardInstanceState, void, undefined> {
    for (const player of state.players) yield* player.battlefield;
}

/** Finds a permanent on any player's battlefield by instance id. */
export function findPermanent(
    state: GameState,
    cardId: string
): CardInstanceState | undefined {
    for (const player of state.players) {
        const found = player.battlefield.find((c) => c.id === cardId);
        if (found) return found;
    }
    return undefined;
}

/** Finds a card on any player's battlefield by instance id, with the
 *  controlling player and its battlefield index — the shape a caller needs to
 *  mutate or splice it in place. {@link findPermanent} when only the card is
 *  read. */
export function findOnBattlefield(
    state: GameState,
    cardId: string
): { card: CardInstanceState; player: PlayerState; idx: number } | null {
    for (const player of state.players) {
        const idx = player.battlefield.findIndex((c) => c.id === cardId);
        if (idx !== -1) return { card: player.battlefield[idx], player, idx };
    }
    return null;
}

/** Finds a card instance by id in the two PUBLIC non-battlefield zones —
 *  graveyard and exile (CR 400.2: those are the zones whose objects are open
 *  information, so an effect may legitimately read one).
 *
 *  The last-known-information lookup (CR 608.2b) for an effect whose own COST
 *  moved its source out of the zone it was activated from: Eternalize
 *  (CR 702.129a) exiles the card from the graveyard to pay, then resolves by
 *  copying it. Copiable values are printed values (CR 707.2), so where the
 *  object currently sits does not change the copy — only whether it is found.
 *
 *  Deliberately NOT hand/library-inclusive (issue #2339 review): no rules
 *  story lets an effect create a token copy of a card in a hidden zone, and
 *  exile + graveyard is exactly the pair the interpreter's own `$source`
 *  recovery checks (`getExileCardOwner ?? getGraveyardCardOwner`).
 *
 *  Deliberately NOT battlefield-inclusive: callers combine it with
 *  `findOnBattlefield`, which returns the richer `{ card, player, idx }` shape
 *  they need for in-place mutation. */
export function findCardInGraveyardOrExile(
    state: GameState,
    cardId: string
): CardInstanceState | undefined {
    for (const player of state.players) {
        for (const zone of [player.graveyard, player.exile]) {
            const found = zone.find((c) => c.id === cardId);
            if (found) return found;
        }
    }
    return undefined;
}

/** Finds a card instance by id in EVERY zone a card can sit in — battlefield,
 *  graveyard, exile, hand, library (CR 400.1). Instance ids are unique across
 *  zones, so the search order is immaterial.
 *
 *  The lookup behind the cross-ability binding memory (`captureBinding` /
 *  `recallCapturedBinding`, issue #2384): a leave-the-battlefield trigger
 *  resolves with its source ALREADY GONE from the battlefield, and the
 *  destination is whatever the departure was — a graveyard (it died), exile
 *  (it was exiled), a hand or a library (it was bounced or tucked). Unlike
 *  `findCardInGraveyardOrExile` this is deliberately hidden-zone-inclusive:
 *  the binding memory reads only what the source itself wrote about ITS OWN
 *  earlier ability, so no hidden information is exposed by finding it. Returns
 *  undefined for a token that has ceased to exist (CR 704.5d) or an id that is
 *  not in the game. */
export function findCardInAnyZone(
    state: GameState,
    cardId: string
): CardInstanceState | undefined {
    for (const player of state.players) {
        for (const zone of [
            player.battlefield,
            player.graveyard,
            player.exile,
            player.hand,
            player.library,
        ]) {
            const found = zone.find((c) => c.id === cardId);
            if (found) return found;
        }
    }
    return undefined;
}
