// The Auto-Tap leg of a `may-pay` payment (CR 608.2g / 605.3a — "If an effect
// gives a player the option to pay mana, they may activate mana abilities
// before taking that action"). One set of solver inputs, read by the mutation
// that taps (`autoTapForMayPay`, `game.ts`) and by the wire projection that
// tells the client whether Pay can be offered, so "Pay is enabled" and "the
// payment succeeds" cannot drift.
import {
    autoTapCombatWindow,
    buildAutoTapSources,
    solveSmartAutoTap,
    type AutoTapSource,
} from "./autoTap";
import { manaGateBattlefields } from "./constants";
import {
    getManaSubstitutions,
    getMayPaySacrificeCandidateIds,
    isManaCostCovered,
    normalizeManaCost,
    normalizeMayPayCost,
    spendablePoolForRestriction,
    type GameState,
    type ManaSubstitution,
    type PendingChoice,
} from "./state";

/** What {@link solveSmartAutoTap} needs to plan a `may-pay` mana leg. */
export type MayPayAutoTapInputs = {
    /** Every unit already floating the payment may spend (CR 106.6) — the
     *  same pool `canPayMayPayCost` reads, so it is used before any tap. */
    pool: Record<string, number>;
    cost: Record<string, number>;
    substitutions: ManaSubstitution[];
    sources: AutoTapSource[];
};

/** The Auto-Tap inputs for `choice`'s mana leg, or `null` when there is nothing
 *  to tap for: not a `may-pay`, no mana leg, or the pool already covers it. */
export function mayPayAutoTapInputs(
    state: GameState,
    choice: PendingChoice
): MayPayAutoTapInputs | null {
    if (choice.kind !== "may-pay" || !choice.cost) return null;
    const norm = normalizeMayPayCost(choice.cost);
    if (!norm.mana) return null;
    const player = state.players.find((p) => p.id === choice.playerId);
    if (!player) return null;
    const pool = spendablePoolForRestriction(player, choice.manaRestriction);
    const cost = normalizeManaCost(norm.mana);
    const substitutions = getManaSubstitutions(state, player.id);
    if (isManaCostCovered(pool, cost, substitutions)) return null;
    const sources = buildAutoTapSources(
        player.battlefield,
        manaGateBattlefields(state),
        {
            // CR 106.6 — a restricted option is planned exactly when the
            // payment may spend its mana (`mayPayUnitIsEligible`).
            payingFor: {
                kind: "may-pay",
                restriction: choice.manaRestriction,
            },
        },
        state,
        {
            // CR 111.10a — Treasures are spent on the terms of a cast, never
            // one the cost's own sacrifice leg may still name.
            spendTreasures: {
                except: new Set(
                    norm.permanent
                        ? getMayPaySacrificeCandidateIds(
                              state,
                              player.id,
                              choice.cost
                          )
                        : []
                ),
            },
            combatWindow: autoTapCombatWindow(state, player.id),
        }
    );
    return { pool, cost, substitutions, sources };
}

/** Whether tapping untapped sources can make up what the pool is short of on
 *  `choice`'s mana leg (CR 118.3). False when the pool already covers it: there
 *  is nothing to tap, and the pool alone answers. */
export function mayPayManaAutoTappable(
    state: GameState,
    choice: PendingChoice
): boolean {
    const inputs = mayPayAutoTapInputs(state, choice);
    return (
        inputs !== null &&
        solveSmartAutoTap(
            inputs.pool,
            inputs.cost,
            inputs.substitutions,
            inputs.sources
        ) !== null
    );
}
