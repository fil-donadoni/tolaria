// Activation mana affordability (issue #10370).
//
// "Could this payer fund this activated ability's mana cost right now?" — the
// affordance question the board's actionable ring and ability menu ask, and the
// one they used to skip ("mana is deferred to the payment phase"). Answered
// server-side, from the ONE pair of authorities the engine already has:
//
//   * the PRICE is `resolveActivationManaCost` — the total both `activateAbility`
//     commit paths charge (printed cost, dynamic legs, cost modifiers, the
//     default Phyrexian split), CR 602.2b;
//   * the FUNDS are `planManaPayment` (moves.ts) — the payment planner the
//     Bot's own activation enumerator gates on: pool, every untapped source,
//     `tapOtherFilter` converters, the CR 609.4b substitutions scoped to this
//     ability's source (`getAbilityManaSubstitutions`, Agatha's Soul
//     Cauldron), and the CR 602.1 bar on a `{T}` source funding itself
//     (issue #3081). A colour-strict census reads every one of those wrong.
//
// Projected onto the wire as `unaffordableAbilityIds` (gameProjections.ts), so
// the client never re-derives mana availability (ADR 0074). The mutation stays
// the authority; this is the affordance only.
//
// Fails OPEN (reports affordable) wherever the price is not knowable before
// announcement or the census under-counts what the payment may spend: a hidden
// affordable ability is a worse affordance bug than a ringed unaffordable one.
//
// PURE. No async, no state mutation.

import type { ActivatedAbility } from "../cards/types";
import type { CardInstanceState, GameState, PlayerState } from "./state";
import { isUnrestrictedRiderUnit } from "./state";
import { resolveActivationManaCost } from "./activation";
import { planManaPayment } from "./moves";

/** True when `ability` carries any mana leg the payment phase would charge. */
function hasManaLeg(ability: ActivatedAbility): boolean {
    const cost = ability.cost;
    return (
        cost.mana !== undefined ||
        cost.manaEqualToCounterCount !== undefined ||
        cost.manaEqualToEnchantedCreatureCost === true
    );
}

/** CR 106.6 — restricted floating mana whose restriction may or may not admit
 *  this ability: the planner takes none for an activation, so its presence
 *  makes the planner an under-count. */
function holdsRestrictedMana(payer: PlayerState): boolean {
    return (payer.restrictedMana ?? []).some(
        (unit) => unit.amount > 0 && !isUnrestrictedRiderUnit(unit)
    );
}

/** A per-payer affordability probe, asked once per ability with a mana leg. */
export function activationManaProbe(
    state: GameState,
    payer: PlayerState
): (source: CardInstanceState, ability: ActivatedAbility) => boolean {
    const restricted = holdsRestrictedMana(payer);
    return (source, ability) => {
        if (!hasManaLeg(ability)) return true;
        // Priced only once the target is chosen (CR 107.3), and a generic leg
        // paid by tapping permanents (CR 701.67a): neither price is knowable
        // here.
        if (ability.cost.xFromTargetSpellMv !== undefined) return true;
        if (ability.cost.tapOtherFilter?.substitutesGeneric !== undefined) {
            return true;
        }
        if (restricted) return true;
        let manaCost: Record<string, number> | undefined;
        try {
            // CR 107.3 — a chosen X is priced at its minimum, 0.
            manaCost = resolveActivationManaCost(
                state,
                payer,
                source,
                ability,
                undefined,
                undefined
            ).manaCost;
        } catch {
            // The commit itself would refuse; that refusal is not ours to
            // pre-empt as a mana question.
            return true;
        }
        if (!manaCost) return true;
        // CR 602.1 / 302.1 — a source whose {T} is part of the cost can't also
        // tap for the mana that funds it (issue #3081's bar).
        return (
            planManaPayment(
                state,
                payer,
                manaCost,
                undefined,
                source,
                ability.cost.tap === true ? source.id : undefined
            ) !== null
        );
    };
}

/** The ids among `abilities` whose mana cost `probe`'s payer cannot fund —
 *  undefined when there are none, so the wire carries nothing in the common
 *  case. */
export function unaffordableAbilityIds(
    probe: ReturnType<typeof activationManaProbe>,
    source: CardInstanceState,
    abilities: readonly ActivatedAbility[]
): string[] | undefined {
    let out: string[] | undefined;
    for (let i = 0; i < abilities.length; i++) {
        const ability = abilities[i];
        if (!ability.useStack) continue;
        if (!probe(source, ability)) (out ??= []).push(ability.id);
    }
    return out;
}
