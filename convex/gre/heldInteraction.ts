// Interaction-aware combat prediction (ADR 0021, issue #229).
//
// The crude combat predictor (`dangerClock.ts`) reads creatures at their CURRENT
// effective P/T, so it is blind to interaction a player still HOLDS in hand: a
// combat trick (pump) or instant-speed removal. That blindness produces two
// misplays the bot search inherits:
//
//   * Attacker side — a held-back pump is invisible, so a bait attacker
//     (a 2/2 swinging into a 3/3 with Giant Growth in hand) is pre-judged dead
//     and the "wait, then pump" ambush never out-scores dumping the trick.
//   * Defender side — multi-block evaluation assumes the attacker has no tricks,
//     so committing several blockers to kill one attacker is scored as a clean
//     win even when a held pump (attacker survives, blockers die) or held
//     removal (one blocker killed, attacker connects) flips the exchange.
//
// Card effects are opaque imperative `resolve()` bodies, so this module reads
// OPT-IN structured `aiCombatHint`s declared on the `CardDefinition` (see
// `convex/cards/types.ts`). It models only interaction the player can actually
// cast THIS combat: an instant-timing card (CR 702.8 flash or an Instant) whose
// mana value the player has the open, untapped mana to pay — the SAME coarse,
// color-blind affordability proxy the `evaluate` flexibility term and `mana`
// term use (CR 601 colored requirements are not modelled at this resolution).
//
// PURE and prediction-only: nothing here changes how a spell actually resolves.

import type { GameState, PlayerState, CardInstanceState } from "./state";
import { isUntappedManaSource, manaValue } from "./constants";
import { getInstanceManaCost, getInstanceAiCombatHint } from "../cards/index";

/** A pump the held interaction can apply to a single creature this combat. */
export type HeldPump = { power: number; toughness: number };

/** The combat-relevant interaction a player can cast THIS combat, aggregated
 *  across their castable held instants. `pump` is the single LARGEST castable
 *  pump (a player casts the biggest trick they can on the one creature that
 *  matters); `removal` is true if any castable held instant is instant-speed
 *  creature removal. Both fields are absent / false when nothing castable
 *  carries the relevant hint. */
export type HeldInteraction = {
    pump?: HeldPump;
    removal: boolean;
};

/** Available mana for `player` — untapped mana sources on the battlefield plus
 *  floating mana. The coarse, color-blind proxy the `evaluate` `mana` /
 *  flexibility terms use (CR 601 colored costs are not modelled here): one
 *  untapped land or mana permanent counts as one mana. */
export function availableManaFor(player: PlayerState): number {
    let mana = 0;
    for (const perm of player.battlefield) {
        // CR 605.1a / 305.6 — count only sources that can actually produce
        // mana; a fetchland (no mana ability) is not one (issue #1499), nor is
        // a board-conditional source whose CURRENT output is zero — an
        // Everflowing Chalice with no charge counters (issue #1889).
        if (isUntappedManaSource(perm, player.battlefield)) {
            mana += 1;
        }
    }
    for (const c of ["W", "U", "B", "R", "G", "C"] as const) {
        mana += player.manaPool[c] ?? 0;
    }
    return mana;
}

/** Whether a hand card can be cast at instant speed — an Instant, or any card
 *  with the Flash keyword (CR 702.8). Mirrors `evaluate.hasInstantTiming` so the
 *  predictor's notion of "holdable response" matches the flexibility term's. */
function hasInstantTiming(card: CardInstanceState): boolean {
    if (card.types.includes("Instant")) return true;
    return card.staticAbilities.includes("flash");
}

/** Whether `player` holds at least one castable instant carrying an
 *  `aiCombatHint` — the castability gate (instant timing + affordable mana
 *  value) the issue calls out, reused as the entry point for "is held
 *  interaction relevant at all". Pure. */
export function hasCastableInstantHint(player: PlayerState): boolean {
    const mana = availableManaFor(player);
    return player.hand.some((card) => {
        if (!hasInstantTiming(card)) return false;
        if (!getInstanceAiCombatHint(card)) return false;
        return manaValue(getInstanceManaCost(card)) <= mana;
    });
}

/** The combat interaction `player` can cast THIS combat, aggregated from their
 *  CASTABLE held instants (instant timing + affordable mana value), reading the
 *  opt-in `aiCombatHint`s. Affordability is greedy per-card against the same
 *  available-mana count (it does NOT subtract spent mana across multiple
 *  tricks — a coarse over-estimate matching the rest of the crude predictor;
 *  the typical case is one trick). Returns the largest castable pump and whether
 *  any castable held instant is removal. */
export function castableHeldInteraction(player: PlayerState): HeldInteraction {
    const mana = availableManaFor(player);
    const result: HeldInteraction = { removal: false };
    for (const card of player.hand) {
        if (!hasInstantTiming(card)) continue;
        const hint = getInstanceAiCombatHint(card);
        if (!hint) continue;
        if (manaValue(getInstanceManaCost(card)) > mana) continue; // affordability gate
        if (hint.removal) result.removal = true;
        if (hint.pump) {
            const size = hint.pump.power + hint.pump.toughness;
            const bestSize = result.pump
                ? result.pump.power + result.pump.toughness
                : -1;
            if (size > bestSize) result.pump = { ...hint.pump };
        }
    }
    return result;
}

/** The held interaction the player with id `playerId` can bring to the combat
 *  currently in `state`, or no interaction when the player is absent. Thin
 *  state-keyed wrapper over `castableHeldInteraction`. */
export function heldInteractionFor(
    state: GameState,
    playerId: string
): HeldInteraction {
    const player = state.players.find((p) => p.id === playerId);
    if (!player) return { removal: false };
    return castableHeldInteraction(player);
}
