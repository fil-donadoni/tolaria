import type { GameState, PlayerState } from "./state";
import { manaCensusFor, type ManaUnits } from "./manaAvailability";

/** Both halves of one seat's mana census — what {@link manaCensusFor} returns:
 *  `now` is what the seat can pay with this instant, `base` what its mana base
 *  is made of. */
export type ManaCensus = { now: ManaUnits; base: ManaUnits };

/** The mana censuses of ONE fixed position, keyed by player id and computed on
 *  first ask (issue #4461, PRD #4454).
 *
 *  A census walks the seat's whole battlefield, and one evaluation used to ask
 *  for the same seat's several times: the material terms, then every
 *  castable-interaction read of the combat terms, then the search's own
 *  castable-instant probes on the same position. The answer cannot change
 *  while the position does not, so whoever owns the position — an evaluation,
 *  a policy probe, a rollout ply, a tree node — opens one memo and hands it to
 *  every reader.
 *
 *  The contract is the owner's: a memo is valid only while its `state` is not
 *  mutated, so it never outlives the read-only stretch it was opened for. The
 *  units are shared between readers, which is sound because every consumer
 *  takes them as `ManaUnits` (read-only) and the cost matcher copies before it
 *  consumes (`consumeColoredAndHybridPips`, `gre/payWith.ts`). */
export type ManaCensusMemo = Map<string, ManaCensus>;

export function newManaCensusMemo(): ManaCensusMemo {
    return new Map();
}

/** `player`'s census of `state` — from `memo` when it already holds one,
 *  computed (and kept) otherwise. Without a memo, a fresh census: exactly
 *  {@link manaCensusFor}. */
export function censusOf(
    state: GameState | undefined,
    player: PlayerState,
    memo?: ManaCensusMemo
): ManaCensus {
    if (!memo) return manaCensusFor(state, player);
    let census = memo.get(player.id);
    if (!census) {
        census = manaCensusFor(state, player);
        memo.set(player.id, census);
    }
    return census;
}
