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
import { hasFilteredGiveUpCost } from "../gre/constants";
import {
    lowerActivationCost,
    type ActivationCostIR,
    type CostAtomIR,
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
            case "activate-from-graveyard":
                ability.activateFromGraveyard = true;
                break;
            default: {
                const never: never = restriction;
                return `no lowering for restriction ${JSON.stringify(never)}`;
            }
        }
    }
    return null;
}

/**
 * A cost leg that may take the SOURCE off the battlefield: the three that name
 * it, and a sacrifice of "an <X>" whose filter could pick an Aura (an Aura is
 * an Enchantment, CR 303.4). A filter naming no card type, or one that lists
 * Enchantment, is read as "could" — fail-closed, because a cost that let the
 * player sacrifice the Aura itself would compile to an inert ability.
 */
function mayRemoveSource(atom: CostAtomIR): boolean {
    switch (atom.kind) {
        case "sacrifice-self":
        case "exile-self":
        case "return-self":
            return true;
        case "sacrifice-other": {
            const { types, subtypes } = atom.filter;
            if (types === undefined)
                return (
                    subtypes === undefined || [subtypes].flat().includes("Aura")
                );
            return [types].flat().includes("Enchantment");
        }
        default:
            return false;
    }
}

/** CR 303.4b — the sentence acts on the Aura's host ("enchanted creature"). */
function actsOnHost(sentence: EffectSentenceIR): boolean {
    return "subject" in sentence && sentence.subject.kind === "host";
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

    // CR 608.2h — the printed card still pumps its host after the Aura is
    // sacrificed, because the effect uses the Aura's last known information.
    // `$host` does not carry that: it is seeded from the LIVE attachment link
    // when the ability resolves (`seedSourceBindings`), which a cost that
    // removes the Aura has already ended, so the ability would be paid for and
    // do nothing. An engine limit, not a rules one — refused rather than
    // compiled into an inert card, and the form stays a gap of its own until
    // the host is captured as last-known information.
    if (
        input.cost.atoms.some(mayRemoveSource) &&
        input.effects.some(actsOnHost)
    )
        return {
            ok: false,
            reason: "an Aura removed by its own cost needs its host as last-known information, which $host (seeded from the live attachment) does not carry (CR 608.2h)",
        };

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
            // CR 118.1 — a fixed "Sacrifice this <permanent>" leg took the
            // source off the battlefield at activation.
            ...(input.cost.atoms.some((a) => a.kind === "sacrifice-self")
                ? { sourceSacrificed: true as const }
                : {}),
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
    // CR 702.33g (issue #4220) — the OTHER encoding, refused here for the same
    // reason: only a SPELL's announcement filters its group list by the kicker
    // payment (`castAnnouncedTargetGroups`), so a gated group declared at this
    // site would be announced on every activation.
    if (walk.targets.hasKickerGatedGroup())
        return {
            ok: false,
            reason: "an ability cannot announce a target only if kicked (CR 702.33g)",
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

/** CR 605.1a / 118.3 — the ONLY legs `activateManaAbility` (`convex/game.ts`)
 *  pays, i.e. what a mana ability may cost when its shape routes there: no
 *  `tap`, no self-`sacrifice`, no filtered give-up leg. Read against that
 *  handler, not guessed — it pays `cost.tapOtherFilter`
 *  (`payTapOtherAbilityCost`) and `cost.mana` (`payManaCostWithRiders`) and
 *  then resolves; the bot's mirror `applyTapPlan` does the same. Every other
 *  leg on that route is silently free. */
const MANA_ABILITY_NON_TAP_PAYABLE_COST_LEGS: ReadonlySet<string> = new Set([
    "mana",
    "tapOtherFilter",
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
    // CR 605.1a — `cost.tapOtherFilter` is paid on route C below ONLY
    // (`activateManaAbility`, `payTapOtherAbilityCost`). Routes A and B never
    // read it: `activateManaAbility` throws "Use tapUntap" for a `tap` /
    // `sacrifice` cost and `tapUntap` pays mana, life, counters and discard
    // but no tap-other pick, so "{T}, Tap an untapped creature you control:
    // Add one mana of any color" would tap the source, tap nothing else, and
    // produce mana. Fail CLOSED until those routes have a tap-other leg
    // (docs/findings/4140-mana-tap-route-pays-no-tap-other.md).
    if (
        cost.value.tapOtherFilter !== undefined &&
        (cost.value.tap === true ||
            cost.value.sacrifice === true ||
            hasFilteredGiveUpCost(cost.value))
    ) {
        return {
            ok: false,
            reason: `mana ability cost leg "tapOtherFilter" has no payment site beside a tap, sacrifice or filtered give-up leg: those routes never pick the permanents to tap`,
        };
    }
    // CR 605.1a / 118.3 (issue #4134) — the stackless NO-TAP path, classified
    // by ROUTE rather than leg by leg, because which mutation pays a mana
    // ability is decided by its cost's SHAPE:
    //
    //   A. a `tap` or self-`sacrifice` leg → `getManaTapOptionsDetailed`'s
    //      list → `tapUntap` / `tapSourceIntoPayment`, which pay mana, life,
    //      the counter leg (`applyManaAbilityRemoveCounterCost`) and the
    //      discard;
    //   B. no tap/sacrifice but a FILTERED give-up leg → the cost-pick window
    //      (`beginNonStackFilterCostActivation`), whose commit pays every leg;
    //   C. none of those → `activateManaAbility`, which pays exactly
    //      `cost.tapOtherFilter` and `cost.mana` and NOTHING else.
    //
    // Only route C is a hole, and it is the one this rule newly populates:
    // "{B}, Pay 1 life: Add one mana of any color" (Blood Celebrant) would be
    // lowered into an ability that adds a colour of the activator's choosing —
    // including {B} — while the LIFE is never deducted, i.e. free, repeatable,
    // unbounded. Same for a counter-removal leg (the shape the hand-written
    // Pentad Prism declares `useStack: true` to avoid, tracked-by issue
    // #2785), and for the exile / random-discard legs the cost sub-grammar can
    // emit but no corpus card prints on this route today. So route C admits
    // the two legs its mutation pays and refuses the rest — fail CLOSED, and
    // by construction, rather than one leg at a time.
    if (
        cost.value.tap !== true &&
        cost.value.sacrifice !== true &&
        !hasFilteredGiveUpCost(cost.value)
    ) {
        const unpayableHere = Object.keys(cost.value).filter(
            (leg) => !MANA_ABILITY_NON_TAP_PAYABLE_COST_LEGS.has(leg)
        );
        if (unpayableHere.length > 0) {
            return {
                ok: false,
                reason: `mana ability cost leg "${unpayableHere[0]}" has no payment site on the CR 605.1a stackless path: with no tap, sacrifice or filtered give-up leg the ability routes to activateManaAbility, which pays only mana and tapOtherFilter`,
            };
        }
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
