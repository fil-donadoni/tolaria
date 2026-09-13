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
// cost the player's open, untapped sources can actually pay — COLOUR INCLUDED
// since issue #3531, through the one shared reader (`canPayCost`,
// `manaAvailability.ts`) the `evaluate` flexibility term and the castability
// gates ask. This module used to carry its OWN copy of the colour-blind
// `availableManaFor` proxy, so it predicted a Giant Growth off three Islands.
//
// PURE and prediction-only: nothing here changes how a spell actually resolves.

import type { GameState, PlayerState } from "./state";
import { hasInstantSpeed } from "./constants";
import { canPayCost, manaUnitsFor, type ManaUnits } from "./manaAvailability";
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

/** Whether `player` holds at least one castable instant carrying an
 *  `aiCombatHint` — the castability gate (instant timing + affordable mana
 *  value) the issue calls out, reused as the entry point for "is held
 *  interaction relevant at all". Pure. */
export function hasCastableInstantHint(
    state: GameState | undefined,
    player: PlayerState
): boolean {
    const units = manaUnitsFor(state, player);
    return player.hand.some((card) => {
        if (!hasInstantSpeed(card)) return false;
        if (!getInstanceAiCombatHint(card)) return false;
        return canPayCost(units, getInstanceManaCost(card), {
            life: player.life,
        });
    });
}

/** The combat interaction `player` can cast THIS combat, aggregated from their
 *  CASTABLE held instants (instant timing + affordable mana value), reading the
 *  opt-in `aiCombatHint`s. Affordability is greedy per-card against the same
 *  available-mana count (it does NOT subtract spent mana across multiple
 *  tricks — a coarse over-estimate matching the rest of the crude predictor;
 *  the typical case is one trick). Returns the largest castable pump and whether
 *  any castable held instant is removal. */
export function castableHeldInteraction(
    state: GameState | undefined,
    player: PlayerState
): HeldInteraction {
    const units: ManaUnits = manaUnitsFor(state, player);
    const result: HeldInteraction = { removal: false };
    for (const card of player.hand) {
        if (!hasInstantSpeed(card)) continue;
        const hint = getInstanceAiCombatHint(card);
        if (!hint) continue;
        // Affordability gate — colour included (issue #3531).
        if (
            !canPayCost(units, getInstanceManaCost(card), { life: player.life })
        )
            continue;
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
    return castableHeldInteraction(state, player);
}
