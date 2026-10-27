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
import { hasFilteredGiveUpCost, MANA_COLORS } from "../gre/constants";
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
import { printManaCost } from "./manaCost";
import {
    countFilterOf,
    declareTargets,
    lowerSentence,
    SentenceWalk,
    type SiteOptions,
} from "./lowerEffects";

/** Re-exported: `compile.test.ts` reaches for it here, and the >1-target
 *  refusal it guards is stated in this file's contract (one target per
 *  activated ability) as much as in the shared module's. */
export { declareTargets } from "./lowerEffects";

export type LowerAbilityResult =
    | { readonly ok: true; readonly ability: ActivatedAbility }
    | { readonly ok: false; readonly reason: string };

/** `activationCondition` holds ONE comparison: two conditional restrictions
 *  on one ability have no field to meet in. */
const TWO_CONDITIONS =
    "two conditional activation restrictions on one ability (activationCondition holds one comparison)";

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
            case "own-graveyard-at-least":
                // CR 602.1b / 109.5 — "your graveyard" is the controller's.
                if (ability.activationCondition !== undefined)
                    return TWO_CONDITIONS;
                ability.activationCondition = {
                    left: {
                        count: { zone: "graveyard", controller: "controller" },
                    },
                    op: "ge",
                    right: restriction.count,
                };
                break;
            case "controls-at-least": {
                // CR 602.5 + CR 109.5 — "you" is the controller; "an opponent"
                // is their one opponent (`activationConditionHolds`).
                if (ability.activationCondition !== undefined)
                    return TWO_CONDITIONS;
                const filter = countFilterOf(restriction.filter);
                if (!filter.ok) return filter.reason;
                ability.activationCondition = {
                    left: {
                        count: {
                            zone: "battlefield",
                            controller:
                                restriction.player === "you"
                                    ? "controller"
                                    : "opponent",
                            filter: filter.value,
                        },
                    },
                    op: "ge",
                    right: restriction.atLeast,
                };
                break;
            }
            case "opponent-controls-more": {
                // CR 602.5 + CR 109.5 — strictly more under the opponent's
                // control than under the controller's; a tie refuses.
                if (ability.activationCondition !== undefined)
                    return TWO_CONDITIONS;
                const filter = countFilterOf(restriction.filter);
                if (!filter.ok) return filter.reason;
                ability.activationCondition = {
                    left: {
                        count: {
                            zone: "battlefield",
                            controller: "opponent",
                            filter: filter.value,
                        },
                    },
                    op: "gt",
                    right: {
                        count: {
                            zone: "battlefield",
                            controller: "controller",
                            filter: structuredClone(filter.value),
                        },
                    },
                };
                break;
            }
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
        case "exile-self-from-hand":
        case "return-self":
            return true;
        case "sacrifice-other":
        case "return-other": {
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
    /** CR 113.1a — see `SiteOptions.grantQuotedAbility`. */
    readonly grantQuotedAbility?: SiteOptions["grantQuotedAbility"];
}): LowerAbilityResult {
    const cost = lowerActivationCost(input.cost);
    if (!cost.ok) return { ok: false, reason: cost.reason };
    // CR 113.6m — a hand-exile cost makes the ability a HAND ability. Only the
    // mana slot reads that zone (`lowerManaAbility`); on this slot the
    // ability would lower without `activateFromHand` and be offered on the
    // battlefield, where its cost cannot be paid.
    if (input.cost.atoms.some(isHandExile))
        return {
            ok: false,
            reason: "a stack ability activated from the hand is not in grammar v0 (CR 113.6m)",
        };

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
            ...(input.grantQuotedAbility !== undefined
                ? { grantQuotedAbility: input.grantQuotedAbility }
                : {}),
            // CR 118.1 — a fixed "Sacrifice this <permanent>" leg took the
            // source off the battlefield at activation.
            ...(input.cost.atoms.some((a) => a.kind === "sacrifice-self")
                ? { sourceSacrificed: true as const }
                : {}),
            // CR 608.2h — the stack item carries ONE cost-victim snapshot, so
            // "the exiled card" is readable only while no other leg (a
            // sacrifice, a graveyard exile, …) writes it first.
            ...(input.cost.atoms.some(
                (a) => a.kind === "exile-top-of-library"
            ) &&
            input.cost.atoms.every((a) => SNAPSHOT_FREE_COST_ATOMS.has(a.kind))
                ? { costExiledTopCard: true as const }
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
    // An ability whose only effect animates its own source is marked so the
    // Bot never pays for it twice (`ActivatedAbility.animatesSelf`).
    // The animation may carry its own granted ability (`grantAbility` on the
    // same source): still only the source's animation.
    const [only, ...rest] = ops;
    if (
        only!.op === "animate" &&
        "ref" in only!.target &&
        only!.target.ref === "$source" &&
        rest.every(
            (op) =>
                op.op === "grantAbility" &&
                "ref" in op.target &&
                op.target.ref === "$source"
        )
    )
        ability.animatesSelf = true;
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

/** Cost atoms that write no cost-victim snapshot, so the exiled top card's
 *  snapshot (CR 608.2h) is the only one on the stack item. */
const SNAPSHOT_FREE_COST_ATOMS: ReadonlySet<string> = new Set([
    "exile-top-of-library",
    "mana",
    "tap",
    "pay-life",
    "remove-counter",
    "add-counter",
]);

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
 *  leg on that route is silently free. The handler also pays `cost.exileThis`
 *  from the zone the ability declares (`payExileThisCost`), admitted here for
 *  the HAND form only (`lowerManaAbility`): a battlefield self-exile mana
 *  ability is a neighbouring form this grammar has no fixture for. */
const MANA_ABILITY_NON_TAP_PAYABLE_COST_LEGS: ReadonlySet<string> = new Set([
    "mana",
    "tapOtherFilter",
    // CR 122.1 / 118.1 — `activateManaAbility` and the bot's `applyTapPlan`
    // both place the counter (issue #6492).
    "addCounter",
]);

/** Cost legs a board-counted mana amount (`manaAmountSource`) may carry: the
 *  {T} that routes it to the tap mutations, and the legs that move no
 *  permanent, so the board the count reads is the board the ability resolves
 *  on (CR 608.2h). See `lowerManaAbility`. */
const BOARD_COUNT_COST_LEGS: ReadonlySet<string> = new Set([
    "tap",
    "mana",
    "life",
]);

/**
 * CR 605.1a — "[Cost]: Add <mana>. Draw a card." (Chromatic Sphere, the
 * Invasion eggs). Its effect moves a card from a library, so it is not a mana
 * ability: CR 602.2a puts it on the stack, the mana is added when it resolves,
 * and it cannot be activated mid-payment (only CR 605.3a's mana abilities can).
 * Lowered to `useStack: true` with the production as an Effect Script — a
 * fixed production is one `addMana`, a choice one `optionChoice` whose modes
 * are its options — followed by the draw. "Activate only as an instant" lowers
 * to nothing: CR 117.1b already lets an activated ability be activated any
 * time its controller has priority.
 */
const POOL_KEYS: ReadonlySet<string> = new Set(["W", "U", "B", "R", "G", "C"]);

function lowerDrawingManaShape(
    input: {
        readonly id: string;
        readonly oracleText: string;
        readonly cost: ActivationCostIR;
        readonly produces: ManaProductionIR;
    },
    cost: ActivatedAbility["cost"]
): LowerAbilityResult {
    if (input.cost.atoms.some(isHandExile))
        return {
            ok: false,
            reason: "a stack ability activated from the hand is not in grammar v0 (CR 113.6m)",
        };
    const others = (input.produces.riders ?? []).filter(
        (r) => r.kind !== "draw-card" && r.kind !== "instant-only"
    );
    if (others.length > 0)
        return {
            ok: false,
            reason: `mana rider "${others[0]!.kind}" beside a draw has no stack lowering`,
        };
    // `addMana` adds coloured and colourless units only (`EffectManaPool`):
    // a production carrying any other symbol would add nothing.
    const options =
        input.produces.kind === "fixed"
            ? [input.produces.mana]
            : input.produces.kind === "choice"
              ? input.produces.options
              : [];
    const unpoolable = options.find((mana) =>
        Object.keys(mana).some((k) => !POOL_KEYS.has(k))
    );
    if (unpoolable !== undefined)
        return {
            ok: false,
            reason: `mana production ${printManaCost(unpoolable)} beside a draw has no addMana pool`,
        };
    let production: EffectOp;
    switch (input.produces.kind) {
        case "fixed":
            production = { op: "addMana", mana: input.produces.mana };
            break;
        case "choice":
            if (
                input.produces.dealsDamageToControllerOnColoredTap !== undefined
            )
                return {
                    ok: false,
                    reason: "a coloured-tap ping beside a draw has no stack lowering",
                };
            production = {
                op: "optionChoice",
                player: "controller",
                prompt: "Choose the mana to add",
                modes: input.produces.options.map((mana) => ({
                    label: `Add ${printManaCost(mana)}`,
                    effects: [{ op: "addMana", mana: { ...mana } }],
                })),
            };
            break;
        default:
            return {
                ok: false,
                reason: `mana production "${input.produces.kind}" beside a draw has no stack lowering`,
            };
    }
    return {
        ok: true,
        ability: {
            id: input.id,
            oracleText: input.oracleText,
            cost,
            // CR 602.2a — not a mana ability (CR 605.1a), so it uses the stack.
            useStack: true,
            effects: [
                production,
                { op: "draw", player: "controller", count: 1 },
            ],
        },
    };
}

/** CR 113.6m — the "Exile this card from your hand" cost atom. */
function isHandExile(atom: CostAtomIR): boolean {
    return atom.kind === "exile-self-from-hand";
}

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
    // CR 605.1a — "its cost and effect don't move any card to or from a
    // library": a draw rider fails that criterion, so the ability is NOT a mana
    // ability and is lowered as an ordinary one on the stack.
    if ((input.produces.riders ?? []).some((r) => r.kind === "draw-card"))
        return lowerDrawingManaShape(input, cost.value);
    // CR 113.6m — "Exile this card from your hand: Add {G}." functions only in
    // the hand. A FIXED production only: `activateManaAbility` deposits it
    // directly, while a chosen colour is resolved off the permanent's
    // battlefield mana ability, which a card in hand does not have.
    const fromHand = input.cost.atoms.some(isHandExile);
    if (fromHand && input.produces.kind !== "fixed")
        return {
            ok: false,
            reason: "a mana ability activated from the hand reads a fixed production only (CR 113.6m)",
        };
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
    //      `cost.tapOtherFilter`, `cost.mana` and `cost.addCounter`.
    //
    // Only route C is a hole, and it is the one this rule newly populates:
    // "{B}, Pay 1 life: Add one mana of any color" (Blood Celebrant) would be
    // lowered into an ability that adds a colour of the activator's choosing —
    // including {B} — while the LIFE is never deducted, i.e. free, repeatable,
    // unbounded. Same for a counter-removal leg (the shape the hand-written
    // Pentad Prism declares `useStack: true` to avoid, tracked-by issue
    // #2785), and for the exile / random-discard legs the cost sub-grammar can
    // emit but no corpus card prints on this route today. So route C admits
    // the legs its mutation pays and refuses the rest — fail CLOSED, and
    // by construction, rather than one leg at a time.
    if (
        cost.value.tap !== true &&
        cost.value.sacrifice !== true &&
        !hasFilteredGiveUpCost(cost.value)
    ) {
        const unpayableHere = Object.keys(cost.value).filter(
            (leg) =>
                !MANA_ABILITY_NON_TAP_PAYABLE_COST_LEGS.has(leg) &&
                !(fromHand && leg === "exileThis")
        );
        if (unpayableHere.length > 0) {
            return {
                ok: false,
                reason: `mana ability cost leg "${unpayableHere[0]}" has no payment site on the CR 605.1a stackless path: with no tap, sacrifice or filtered give-up leg the ability routes to activateManaAbility, which pays only mana, tapOtherFilter and addCounter`,
            };
        }
    }
    // CR 608.2h / 605.1a (issue #5195) — a board COUNT is read by the tap
    // route alone (`getManaTapOptionsDetailed` → `tapUntap` /
    // `tapSourceIntoPayment`), and only a cost that leaves the board as it
    // was is counted right: a self-sacrifice or a filtered give-up leg is
    // counted BEFORE the permanent leaves (the effect, applied after costs
    // are paid, would not see it), and the no-tap route (`activateManaAbility`)
    // never reads `manaAmountSource` at all. So the count admits {T} plus the
    // legs that move no permanent — mana and life — and refuses the rest.
    if (input.produces.kind === "for-each") {
        const legs = Object.keys(cost.value);
        const unscalable = legs.filter(
            (leg) => !BOARD_COUNT_COST_LEGS.has(leg)
        );
        if (cost.value.tap !== true || unscalable.length > 0) {
            return {
                ok: false,
                reason: `a board-counted mana amount is scaled on the {T} route only, beside mana and life legs: ${
                    cost.value.tap !== true
                        ? "this cost has no {T}"
                        : `"${unscalable[0]}" changes or bypasses the counted board`
                }`,
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
    if (fromHand) ability.activateFromHand = true;
    switch (input.produces.kind) {
        case "fixed":
            ability.manaProduced = input.produces.mana;
            break;
        case "choice":
            ability.manaChoices = input.produces.options as ManaCost[];
            if (
                input.produces.dealsDamageToControllerOnColoredTap !== undefined
            )
                ability.dealsDamageToControllerOnColoredTap =
                    input.produces.dealsDamageToControllerOnColoredTap;
            break;
        // CR 608.2h / 605.1a (issue #5195) — the unit is `manaProduced`, the
        // board count multiplies it (`gre/constants.ts`'s
        // `getDynamicManaProduced`); the unit alone is the no-board fallback.
        case "for-each":
            ability.manaProduced = input.produces.unit;
            ability.manaAmountSource = { filter: input.produces.filter };
            break;
        // CR 106.7 (issue #5195) — the offered set is the board's; the static
        // list is the six-type no-board fallback every descriptor twin in the
        // catalogue carries beside its `manaColorSource` (Fellwar Stone).
        case "board-choice":
            ability.manaChoices = MANA_COLORS.map((c) => ({ [c]: 1 }));
            ability.manaColorSource = {
                filter: input.produces.filter,
                colors: "producesType",
            };
            break;
        default: {
            const never: never = input.produces;
            return {
                ok: false,
                reason: `no lowering for mana production ${JSON.stringify(never)}`,
            };
        }
    }
    // The riders below are applied by the two tap-for-mana mutations only
    // (`tapUntap`, `tapSourceIntoPayment`: route A above), never by
    // `activateManaAbility` (route C), so a cost with neither a tap nor a
    // sacrifice leg would lower to a rider the engine silently drops.
    const paidByTapRoute =
        cost.value.tap === true || cost.value.sacrifice === true;
    for (const rider of input.produces.riders ?? []) {
        if (
            rider.kind !== "sacrifice-without-counters" &&
            rider.kind !== "once-per-turn" &&
            rider.kind !== "instant-only" &&
            !paidByTapRoute
        )
            return {
                ok: false,
                reason: `mana rider "${rider.kind}" needs a tap or sacrifice cost leg: only the tap-for-mana paths apply it`,
            };
        switch (rider.kind) {
            // CR 605.1a — the unconditional ping (Ancient Tomb). The engine
            // skips it when the source was sacrificed paying the cost
            // (`applyUnconditionalTapSelfDamage`), so that shape would be a
            // dead field: refuse it.
            case "damage-to-controller":
                if (cost.value.sacrifice === true)
                    return {
                        ok: false,
                        reason: "a tap ping beside a sacrifice cost is a no-op in the engine (the source left before the ping)",
                    };
                ability.dealsDamageToControllerOnTap = rider.amount;
                break;
            // CR 605.1a — a draw moves a card from a library; routed to
            // `lowerDrawingManaShape` above, never a stackless rider.
            case "draw-card":
                return {
                    ok: false,
                    reason: "a draw disqualifies a mana ability (CR 605.1a)",
                };
            // CR 502.3 / 605.3b (issue #5509) — the stackless script arms the
            // return; the activator's next untap step performs it.
            case "return-source-at-next-untap":
                // The source a sacrifice cost ate is gone before the script
                // runs, so the return would be a dead rider: refuse it.
                if (cost.value.sacrifice === true)
                    return {
                        ok: false,
                        reason: "a next-untap return of the source beside a sacrifice cost is a no-op (the source left before the script ran)",
                    };
                ability.manaAbilityEffects = [
                    {
                        op: "returnToHandAtNextUntap",
                        target: { ref: "$source" },
                    },
                ];
                break;
            // CR 602.5b — the gate is enforced and recorded by
            // `activateManaAbility` (route C) only; the tap-for-mana and
            // cost-pick routes never read `oncePerTurn`, so a cost that
            // routes there would carry a silently unenforced restriction.
            case "once-per-turn":
                if (paidByTapRoute || hasFilteredGiveUpCost(cost.value))
                    return {
                        ok: false,
                        reason: "a once-per-turn mana ability is enforced on the no-tap route only: this cost routes through the tap or cost-pick paths, which never record the activation",
                    };
                ability.oncePerTurn = true;
                break;
            // CR 605.3a — instant speed is a mana ability's only speed.
            case "instant-only":
                break;
            // CR 122.1 / 701.21a — the engine sacrifices once the cost's
            // counter leg has been paid and none of that kind remain, so a
            // sentence naming a kind the cost never removes would read a
            // counter nobody spends: refuse rather than emit a dead rider.
            case "sacrifice-without-counters":
                if (cost.value.removeCounter?.type !== rider.counter)
                    return {
                        ok: false,
                        reason: `"if there are no ${rider.counter} counters, sacrifice it" without a cost that removes a ${rider.counter} counter`,
                    };
                ability.sacrificesSourceWhenNoCountersRemain = rider.counter;
                break;
            default: {
                const never: never = rider;
                return {
                    ok: false,
                    reason: `no lowering for mana rider ${JSON.stringify(never)}`,
                };
            }
        }
    }
    return { ok: true, ability };
}
