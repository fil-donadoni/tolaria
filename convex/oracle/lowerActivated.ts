/**
 * Lowering: activated-ability IR → `ActivatedAbility` (CR 602.1a, ADR 0045).
 *
 * Separate from `lower.ts` because it is where the ONE piece of cross-sentence
 * bookkeeping in grammar v0 lives: target slots. An announced target is
 * positional — the effect script says `{ target: 0 }` and the engine resolves
 * it against the stack item's `targets[]` in declaration order (CR 601.2c via
 * CR 602.2b) — so the sentence that names a target and the op that acts on it
 * are joined by an INDEX, and an index assigned by two different passes is an
 * index that drifts. Both are assigned here, in one walk, in sentence order.
 *
 * Grammar v0 allows at most ONE target per ability. That is not a shortcut for
 * a missing engine feature (`additionalTargetRequirements` exists and is
 * shipped) — it is the fail-closed reading of an ambiguity English has and the
 * IR does not: "Destroy target creature. Destroy target artifact." names two
 * targets, but "Tap target creature. It doesn't untap" names one, and telling
 * those apart is the anaphora work #2698 does. Until then a second target
 * phrase refuses the card.
 */

import type {
    ActivatedAbility,
    EffectObjectSelector,
    EffectOp,
    EffectPlayerRef,
    TargetRequirement,
} from "../cards/types";
import {
    lowerActivationCost,
    type ActivationCostIR,
} from "./grammar/shared/cost";
import { durationSpec } from "./grammar/shared/duration";
import type {
    EffectSentenceIR,
    RestrictionIR,
    SubjectIR,
} from "./grammar/shared/effectClause";
import type { PlayerRefIR } from "./grammar/shared/playerRef";
import type { ZoneRefIR } from "./grammar/shared/zoneRef";

/**
 * A lowering step's outcome.
 *
 * Explicitly tagged rather than `T | string`: `playerRef` legitimately RESOLVES
 * to the string `"controller"` (`EffectPlayerRef` is a string union), so a
 * `typeof x === "string"` error check read every "you draw a card" as the
 * failure `"controller"` and made the card unparsed. A union whose success and
 * failure arms share a runtime type cannot be discriminated by that type.
 */
type Lowered<T> =
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly reason: string };

function lowered<T>(value: T): Lowered<T> {
    return { ok: true, value };
}

function unlowerable<T>(reason: string): Lowered<T> {
    return { ok: false, reason };
}

export type LowerAbilityResult =
    | { readonly ok: true; readonly ability: ActivatedAbility }
    | { readonly ok: false; readonly reason: string };

/** Collects the ability's target requirements as the sentences are walked. */
class TargetSlots {
    private readonly slots: TargetRequirement[] = [];

    /** Announce a target, returning its positional index (CR 601.2c). */
    allocate(requirement: TargetRequirement): Lowered<number> {
        if (this.slots.length > 0)
            return unlowerable(
                "grammar v0 allows one target per activated ability"
            );
        this.slots.push(requirement);
        return lowered(this.slots.length - 1);
    }

    requirements(): readonly TargetRequirement[] {
        return this.slots;
    }
}

function objectSelector(
    subject: SubjectIR,
    slots: TargetSlots
): Lowered<EffectObjectSelector> {
    if (subject.kind === "self") return lowered({ ref: "$source" });
    if (subject.kind === "player")
        return unlowerable("a player is not an object (CR 109.1)");
    if (subject.requirement.type === "player")
        return unlowerable("a player is not an object (CR 109.1)");
    const index = slots.allocate(subject.requirement);
    return index.ok ? lowered({ target: index.value }) : index;
}

function playerRef(
    ref: PlayerRefIR,
    slots: TargetSlots
): Lowered<EffectPlayerRef> {
    switch (ref.kind) {
        case "you":
            return lowered("controller");
        case "target": {
            const requirement: TargetRequirement = ref.opponent
                ? { type: "player", count: 1, controller: "opponent" }
                : { type: "player", count: 1 };
            const index = slots.allocate(requirement);
            return index.ok ? lowered({ target: index.value }) : index;
        }
        // CR 101.4 — "each player" / "each opponent" is a forEach over the
        // player set, and folding it into a single ref would silently make a
        // symmetrical effect one-sided. Refused until the construct is needed.
        case "each-player":
        case "each-opponent":
            return unlowerable('"each player" is not in grammar v0');
    }
}

/**
 * The damage recipient (CR 119.3), which may be an object OR a player —
 * "any target" is either at announcement, so the two cases share one slot.
 */
function damageTarget(
    subject: SubjectIR,
    slots: TargetSlots
): Lowered<EffectObjectSelector | { player: EffectPlayerRef }> {
    if (subject.kind === "player") {
        const player = playerRef(subject.player, slots);
        return player.ok ? lowered({ player: player.value }) : player;
    }
    return objectSelector(subject, slots);
}

function lowerSentence(
    sentence: EffectSentenceIR,
    slots: TargetSlots
): Lowered<EffectOp[]> {
    switch (sentence.kind) {
        case "pump": {
            const target = objectSelector(sentence.subject, slots);
            if (!target.ok) return target;
            return lowered([
                {
                    op: "pump",
                    target: target.value,
                    power: sentence.power,
                    toughness: sentence.toughness,
                    duration: durationSpec(sentence.duration),
                },
            ]);
        }
        case "grant-ability": {
            const target = objectSelector(sentence.subject, slots);
            if (!target.ok) return target;
            return lowered([
                {
                    op: "grantAbility",
                    target: target.value,
                    ability: sentence.ability,
                    duration: durationSpec(sentence.duration),
                },
            ]);
        }
        case "deal-damage": {
            const to = damageTarget(sentence.to, slots);
            if (!to.ok) return to;
            return lowered([
                { op: "dealDamage", amount: sentence.amount, to: to.value },
            ]);
        }
        case "draw": {
            const player = playerRef(sentence.player, slots);
            if (!player.ok) return player;
            return lowered([
                { op: "draw", player: player.value, count: sentence.count },
            ]);
        }
        case "destroy": {
            const target = objectSelector(sentence.subject, slots);
            if (!target.ok) return target;
            // CR 701.19c — a "can't be regenerated" clause is a property of
            // the destruction, not a second effect.
            return lowered(
                sentence.cantBeRegenerated
                    ? [
                          {
                              op: "destroy",
                              target: target.value,
                              cantBeRegenerated: true,
                          },
                      ]
                    : [{ op: "destroy", target: target.value }]
            );
        }
        case "tap-untap": {
            const target = objectSelector(sentence.subject, slots);
            if (!target.ok) return target;
            return lowered([
                {
                    op: "tapUntap",
                    action: sentence.action,
                    target: target.value,
                },
            ]);
        }
        case "regenerate": {
            const target = objectSelector(sentence.subject, slots);
            if (!target.ok) return target;
            return lowered([{ op: "regenerate", target: target.value }]);
        }
        case "life": {
            const player = playerRef(sentence.player, slots);
            if (!player.ok) return player;
            return lowered([
                sentence.action === "gain"
                    ? {
                          op: "gainLife",
                          player: player.value,
                          amount: sentence.amount,
                      }
                    : {
                          op: "loseLife",
                          player: player.value,
                          amount: sentence.amount,
                      },
            ]);
        }
        case "counters": {
            const target = objectSelector(sentence.subject, slots);
            if (!target.ok) return target;
            return lowered([
                {
                    op: "counters",
                    action: "add",
                    counter: sentence.counter,
                    target: target.value,
                    count: sentence.count,
                },
            ]);
        }
        case "move-zone":
            return lowerMoveZone(sentence.subject, sentence.to, slots);
        case "discard-at-random": {
            const player = playerRef(sentence.player, slots);
            if (!player.ok) return player;
            return lowered([
                {
                    op: "discardAtRandom",
                    player: player.value,
                    count: sentence.count,
                },
            ]);
        }
        default: {
            const never: never = sentence;
            return unlowerable(
                `no lowering for effect ${JSON.stringify(never)}`
            );
        }
    }
}

/**
 * CR 400.6 — a zone change of an object already in play.
 *
 * Only the destinations whose `moveZone` shape is unambiguous are lowered.
 * "to the top of your library" and "to the battlefield" both exist in the
 * engine but read a DIFFERENT source zone than the one this sentence implies,
 * and guessing the source is how a recursion effect becomes a reanimation one.
 */
function lowerMoveZone(
    subject: SubjectIR,
    zone: ZoneRefIR,
    slots: TargetSlots
): Lowered<EffectOp[]> {
    const target = objectSelector(subject, slots);
    if (!target.ok) return target;
    if (zone.zone === "hand" && zone.owner === "its-owner")
        return lowered([{ op: "moveZone", target: target.value, to: "hand" }]);
    if (zone.zone === "graveyard" && zone.owner === "its-owner")
        return lowered([
            { op: "moveZone", target: target.value, to: "graveyard" },
        ]);
    if (zone.zone === "exile")
        return lowered([{ op: "moveZone", target: target.value, to: "exile" }]);
    return unlowerable(
        `"${zone.zone}" is not a zone destination in grammar v0`
    );
}

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
    readonly cost: ActivationCostIR;
    readonly effects: readonly EffectSentenceIR[];
    readonly restrictions: readonly RestrictionIR[];
}): LowerAbilityResult {
    const cost = lowerActivationCost(input.cost);
    if (!cost.ok) return { ok: false, reason: cost.reason };

    const slots = new TargetSlots();
    const ops: EffectOp[] = [];
    for (const sentence of input.effects) {
        const result = lowerSentence(sentence, slots);
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
    const requirements = slots.requirements();
    if (requirements.length === 1) ability.targetRequirement = requirements[0];

    const restrictionError = applyRestrictions(ability, input.restrictions);
    if (restrictionError !== null)
        return { ok: false, reason: restrictionError };
    return { ok: true, ability };
}
