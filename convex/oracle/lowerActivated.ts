/**
 * Lowering: activated-ability IR → `ActivatedAbility` (CR 602.1a, ADR 0045).
 *
 * What is left here is only what is ACTIVATED-specific: the cost, the CR 602.5
 * restriction sentences, and the assembly of the two into an ability. The
 * sentence lowering and the target-slot bookkeeping moved to `lowerEffects.ts`
 * when the triggered slot (#2698) became their second consumer — see that
 * file's header for why one walk has to own the target indexes.
 */

import type { ActivatedAbility, EffectOp, ManaCost } from "../cards/types";
import {
    lowerActivationCost,
    type ActivationCostIR,
} from "./grammar/shared/cost";
import type {
    EffectSentenceIR,
    RestrictionIR,
} from "./grammar/shared/effectClause";
import type { ManaProductionIR } from "./grammar/ir";
import { declareTargets, lowerSentence, SentenceWalk } from "./lowerEffects";

/** Re-exported: `compile.test.ts` reaches for it here, and the >1-target
 *  refusal it guards is stated in this file's contract (one target per
 *  activated ability) as much as in the shared module's. */
export { declareTargets } from "./lowerEffects";

export type LowerAbilityResult =
    | { readonly ok: true; readonly ability: ActivatedAbility }
    | { readonly ok: false; readonly reason: string };

/** CR 602.5 — restriction sentences onto the ability's own fields. */
function applyRestrictions(
    ability: ActivatedAbility,
    restrictions: readonly RestrictionIR[]
): string | null {
    for (const restriction of restrictions) {
        switch (restriction.kind) {
            case "sorcery-only":
                ability.sorcerySpeedOnly = true;
                break;
            case "once-per-turn":
                ability.oncePerTurn = true;
                break;
            case "your-turn-only":
                ability.controllerTurnOnly = true;
                break;
            case "phase":
                // "only during your upkeep" is two restrictions in one
                // sentence: the STEP and whose turn it is (CR 500.2 — every
                // turn has an upkeep, including the opponent's).
                ability.activationPhaseRestriction = [restriction.phase];
                ability.controllerTurnOnly = true;
                break;
            case "any-player":
                ability.activatableByAnyPlayer = true;
                break;
            default: {
                const never: never = restriction;
                return `no lowering for restriction ${JSON.stringify(never)}`;
            }
        }
    }
    return null;
}

export function lowerActivatedAbility(input: {
    readonly id: string;
    readonly oracleText: string;
    /** CR 201.5 — the card's printed name, for the prompts a body emits. */
    readonly cardName: string;
    readonly cost: ActivationCostIR;
    readonly effects: readonly EffectSentenceIR[];
    readonly restrictions: readonly RestrictionIR[];
}): LowerAbilityResult {
    const cost = lowerActivationCost(input.cost);
    if (!cost.ok) return { ok: false, reason: cost.reason };

    const walk = new SentenceWalk();
    const ops: EffectOp[] = [];
    // CR 107.3 — an activated ability announces X in its ACTIVATION cost, as a
    // variable `{X}` pip (`readManaCost` writes it as `X: "X"`). Judged here
    // because it is a fact about the cost, exactly as the spell site judges it
    // from the printed mana cost.
    const announcesX = cost.value.mana?.X === "X";
    for (const sentence of input.effects) {
        const result = lowerSentence(sentence, walk, {
            allowX: announcesX,
            selfName: input.cardName,
        });
        if (!result.ok) return { ok: false, reason: result.reason };
        ops.push(...result.value);
    }

    const ability: ActivatedAbility = {
        id: input.id,
        oracleText: input.oracleText,
        cost: cost.value,
        // CR 602.1a / 605.3a — an activated ability that is not a mana ability
        // uses the stack. The mana slot is the only site that emits `false`.
        useStack: true,
        effects: ops,
    };
    // CR 702.33g — the kicked SWAP is a card-level field on a spell
    // (`kickedTargetRequirement`); an ability has no twin, so a gate that
    // announced one here has nowhere to declare it. UNREACHABLE today and
    // deliberately kept, the `spellSelector` case: the grammar refuses "If
    // this spell was kicked" at this site before lowering sees it, and this is
    // the second line, on the side that stays right if it ever reads one.
    if (walk.targets.kickedRequirement() !== undefined)
        return {
            ok: false,
            reason: "an ability cannot swap in a kicked target announcement (CR 702.33g)",
        };
    // CR 601.2c — `ActivatedAbility` carries its own
    // `additionalTargetRequirements` (Oko's -5), so a second instance of the
    // word "target" has a field here exactly as it does on a spell.
    const targetError = declareTargets(
        ability,
        walk.targets.requirements(),
        true
    );
    if (targetError !== null) return { ok: false, reason: targetError };

    const restrictionError = applyRestrictions(ability, input.restrictions);
    if (restrictionError !== null)
        return { ok: false, reason: restrictionError };
    return { ok: true, ability };
}

/** CR 605.1a — activation-cost legs a MANA ability (`useStack: false`) has no
 *  payment site for, so lowering one would emit free mana.
 *
 *  NOT the complement of what the mana path pays: `sacrificeFilter` and
 *  `discardFilter` reach compiled mana abilities today (8 rows) through
 *  `tapSourceIntoPayment`, and re-adjudicating those is a separate question
 *  from this one. What earns a row here is a leg that removes the SOURCE from
 *  the battlefield with no mana-path payer — `cost.returnThisToHand`
 *  (issue #3204): `activateManaAbility` handles only `tap` / `sacrifice` /
 *  `tapOtherFilter` / `mana` / `life`, and `applyActivationCostsForSearch` is
 *  never reached for a stackless ability, so "Return this artifact to its
 *  owner's hand: Add {C}" would tap for mana every priority window forever. */
const MANA_ABILITY_UNPAYABLE_COST_LEGS: ReadonlySet<string> = new Set([
    "returnThisToHand",
]);

/**
 * Mana-ability IR → `ActivatedAbility` (CR 605.1a). Shared by the mana slot
 * and by a granted ability ('Enchanted land has "{T}: Add …"', issue #3833),
 * which is the same ability printed inside quotation marks.
 */
export function lowerManaAbility(input: {
    readonly id: string;
    readonly oracleText: string;
    readonly cost: ActivationCostIR;
    readonly produces: ManaProductionIR;
}): LowerAbilityResult {
    // The cost lowering is shared with the stack-using activated slot
    // (CR 602.1a draws no distinction); only the EFFECT half differs.
    const cost = lowerActivationCost(input.cost);
    if (!cost.ok) return { ok: false, reason: cost.reason };
    // CR 605.1a — a mana ability does NOT use the stack, so it is paid by
    // `activateManaAbility` / `tapSourceIntoPayment`, not by the
    // `PendingActivation` machinery every stack ability rides. A leg neither
    // of those pays would be lowered into a definition that produces mana FOR
    // FREE, forever — and dropping a cost atom is exactly the failure
    // `grammar/shared/cost.ts`'s own header calls out (an unpayable cost
    // silently becomes no cost). Fail CLOSED here, the way
    // `lowerAdditionalCosts` and `flashbackLine` already do for the same atom
    // stream, rather than emit the ability.
    const unpayable = Object.keys(cost.value).filter((leg) =>
        MANA_ABILITY_UNPAYABLE_COST_LEGS.has(leg)
    );
    if (unpayable.length > 0) {
        return {
            ok: false,
            reason: `mana ability cost leg "${unpayable[0]}" has no payment site on the CR 605.1a stackless path`,
        };
    }
    // CR 605.1a / 118.3 (issue #4134) — the COUNTER-removal leg, which is
    // payable on the mana path only by the TAP mutations: `tapUntap` and
    // `tapSourceIntoPayment` both route it through
    // `applyManaAbilityRemoveCounterCost`. An ability with neither a `tap` nor
    // a self-`sacrifice` leg is not in `getManaTapOptionsDetailed`'s list at
    // all and goes to `activateManaAbility`, which pays `cost.mana`,
    // `cost.tapOtherFilter` and the filtered give-up costs — and has no
    // counter leg. Lowering one would emit a permanent that adds mana WITHOUT
    // ever removing the counter, i.e. unbounded mana, which is precisely why
    // the hand-written Pentad Prism declares itself `useStack: true` instead
    // (`cards/sets/5dn/colorless.ts`, tracked-by issue #2785). Same
    // fail-closed shape as the leg set above, but conditional on the rest of
    // the cost, so it cannot live in that flat key set.
    if (
        cost.value.removeCounter !== undefined &&
        cost.value.tap !== true &&
        cost.value.sacrifice !== true
    ) {
        return {
            ok: false,
            reason: 'mana ability cost leg "removeCounter" has no payment site on the CR 605.1a stackless path without a tap or sacrifice leg',
        };
    }
    const ability: ActivatedAbility = {
        id: input.id,
        oracleText: input.oracleText,
        cost: cost.value,
        // CR 605.3b — a mana ability doesn't go on the stack. Safe to emit
        // unconditionally: see the CR 605.1a argument in the slot file.
        useStack: false,
    };
    if (input.produces.kind === "fixed")
        ability.manaProduced = input.produces.mana;
    else {
        ability.manaChoices = input.produces.options as ManaCost[];
        if (input.produces.dealsDamageToControllerOnColoredTap !== undefined)
            ability.dealsDamageToControllerOnColoredTap =
                input.produces.dealsDamageToControllerOnColoredTap;
    }
    return { ok: true, ability };
}
