/**
 * The combat-damage split a blade position leads to (issue #5662).
 *
 * The split is not a `Move`: the driver submits it through
 * `setDamageAssignment` before `confirmDamage` (`src/lib/ai/realise.ts`), so a
 * blade entry about it cannot match the search's root move. This probe walks a
 * CLONE of the built position forward through the real phase machine
 * (`advancePhase`, CR 510.1) into the first combat damage step that waits on
 * an assigner, and reads the split the Bot's policy (`damageSplitsFor`)
 * chooses for `seat` there — by card NAME, like every other blade matcher.
 */
import { cloneGameState } from "../../clone";
import { findPermanent } from "../../lookup";
import { tryGetDefinition } from "../../../cards";
import { advancePhase } from "../../phases";
import type { GameState } from "../../state";
import { damageSplitsFor } from "../damageSplit";
import type { BladeSeat } from "./types";

/** At most this many phase steps between the probed window and damage. */
const MAX_STEPS = 6;

/** sourceName → targetName (or `"me"` / `"opp"` for a player) → damage.
 *  `undefined` when the walk reaches no damage step waiting on an assigner. */
export type NamedDamageSplit = Record<string, Record<string, number>>;

export function damageSplitAtDamageStep(
    built: GameState,
    seat: BladeSeat
): NamedDamageSplit | undefined {
    const state = cloneGameState(built);
    for (let i = 0; i < MAX_STEPS; i++) {
        if (
            (state.phase === "FIRST_STRIKE_DAMAGE" ||
                state.phase === "COMBAT_DAMAGE") &&
            state.combat?.damageConfirmed === false
        ) {
            break;
        }
        if (!state.combat) return undefined;
        advancePhase(state);
    }
    if (state.combat?.damageConfirmed !== false) return undefined;

    const nameOf = (id: string): string => {
        const seatIndex = state.players.findIndex((p) => p.id === id);
        if (seatIndex >= 0) return seatIndex === 0 ? "me" : "opp";
        const cardId = (
            findPermanent(state, id)?.card as { id?: string } | undefined
        )?.id;
        return (cardId && tryGetDefinition(cardId)?.name) || id;
    };
    const seatId = state.players[seat === "me" ? 0 : 1].id;
    const out: NamedDamageSplit = {};
    for (const { sourceId, assignments } of damageSplitsFor(state, seatId)) {
        const named: Record<string, number> = {};
        for (const [targetId, amount] of Object.entries(assignments)) {
            if (amount > 0) named[nameOf(targetId)] = amount;
        }
        out[nameOf(sourceId)] = named;
    }
    return out;
}
