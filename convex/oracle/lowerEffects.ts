/**
 * Lowering: effect SENTENCES → `EffectOp[]`, plus the target bookkeeping every
 * ability site shares (CR 601.2c via CR 602.2b / 603.3d, ADR 0045).
 *
 * Extracted from `lowerActivated.ts` when the triggered slot (#2698) became the
 * second consumer: a trigger's body is the SAME sentence list an activated
 * ability's is, and the one piece of cross-sentence bookkeeping in the grammar
 * — target SLOTS — has to be assigned by ONE walk at either site or the index
 * an Op points at drifts from the requirement that declares it.
 *
 * The site-specific parts stayed behind: an activated ability has a cost and
 * CR 602.5 restrictions, a triggered one has a head and a CR 603.4 condition.
 * What is here is exactly what both have.
 */

import type {
    EffectObjectSelector,
    EffectOp,
    EffectPlayerRef,
    EffectValue,
    TargetRequirement,
} from "../cards/types";
import { durationSpec } from "./grammar/shared/duration";
import type {
    AmountIR,
    EffectSentenceIR,
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
export type Lowered<T> =
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly reason: string };

export function lowered<T>(value: T): Lowered<T> {
    return { ok: true, value };
}

export function unlowerable<T>(reason: string): Lowered<T> {
    return { ok: false, reason };
}

/**
 * What the SITE lowering a sentence knows that the sentence itself cannot.
 *
 * Exactly one thing so far, and it is the CR 107.3 one: whether an `{X}` was
 * announced for this effect at all. The grammar reads the word "X" wherever it
 * reads a count word (`readAmount`), because that is a fact about the span;
 * whether the number exists is a fact about the COST, which lives on the card
 * (a spell's `{X}` pip) or on the ability (an activation cost's), never in the
 * sentence. A site that cannot announce an X refuses the sentence rather than
 * lowering it to a number it would have to invent — an `X` folded to 0 is a
 * card that resolves and does nothing, the exact silent shape this compiler
 * exists to refuse.
 */
export interface SiteOptions {
    /** CR 107.3 — the source announces a value for {X} (it has an `{X}` pip). */
    readonly allowX: boolean;
}

/** CR 107.3 — an effect magnitude to an `EffectValue`, X gated by the site. */
function lowerAmount(
    amount: AmountIR,
    site: SiteOptions
): Lowered<EffectValue> {
    if (amount.kind === "fixed") return lowered(amount.value);
    return site.allowX
        ? lowered({ X: true })
        : unlowerable(
              "an effect reads X but its source announces no {X} (CR 107.3)"
          );
}

/** Collects the ability's target requirements as the sentences are walked. */
export class TargetSlots {
    private readonly slots: TargetRequirement[] = [];

    /** Announce a target, returning its positional index (CR 601.2c). */
    allocate(requirement: TargetRequirement): Lowered<number> {
        if (this.slots.length > 0)
            // Reached from every ability site and from the spell and per-mode
            // sites, so the reason names the LIMIT rather than one site.
            return unlowerable(
                "grammar v0 allows one target per effect site (CR 601.2c)"
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

export function lowerSentence(
    sentence: EffectSentenceIR,
    slots: TargetSlots,
    site: SiteOptions
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
                    ability: sentence.keyword.ability,
                    duration: durationSpec(sentence.duration),
                },
            ]);
        }
        case "deal-damage": {
            const to = damageTarget(sentence.to, slots);
            if (!to.ok) return to;
            const amount = lowerAmount(sentence.amount, site);
            if (!amount.ok) return amount;
            return lowered([
                { op: "dealDamage", amount: amount.value, to: to.value },
            ]);
        }
        case "draw": {
            const player = playerRef(sentence.player, slots);
            if (!player.ok) return player;
            const count = lowerAmount(sentence.count, site);
            if (!count.ok) return count;
            return lowered([
                { op: "draw", player: player.value, count: count.value },
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
            const amount = lowerAmount(sentence.amount, site);
            if (!amount.ok) return amount;
            return lowered([
                sentence.action === "gain"
                    ? {
                          op: "gainLife",
                          player: player.value,
                          amount: amount.value,
                      }
                    : {
                          op: "loseLife",
                          player: player.value,
                          amount: amount.value,
                      },
            ]);
        }
        case "counters": {
            const target = objectSelector(sentence.subject, slots);
            if (!target.ok) return target;
            const count = lowerAmount(sentence.count, site);
            if (!count.ok) return count;
            return lowered([
                {
                    op: "counters",
                    action: "add",
                    counter: sentence.counter,
                    target: target.value,
                    count: count.value,
                },
            ]);
        }
        case "move-zone":
            return lowerMoveZone(sentence.subject, sentence.to, slots);
        case "discard-at-random": {
            const player = playerRef(sentence.player, slots);
            if (!player.ok) return player;
            const count = lowerAmount(sentence.count, site);
            if (!count.ok) return count;
            return lowered([
                {
                    op: "discardAtRandom",
                    player: player.value,
                    count: count.value,
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

/**
 * Declare the announced targets on the ability (CR 601.2c).
 *
 * Exported, and taking the requirement list as a PARAMETER rather than reading
 * `slots` from the closure, for the reason `routeLineWith` gives one directory
 * over: `TargetSlots.allocate` already refuses the second allocation, so no
 * input to `lowerActivatedAbility` can reach the >1 branch today. A refusal no
 * test can enter is a refusal nobody has watched hold — and this one is the
 * second, independent line of defence, the one that decides what happens if
 * `allocate` ever stops being the first. Injecting the list makes the branch
 * reachable now rather than when #2698's anaphora work allocates twice.
 *
 * >1 is UNLOWERABLE, not a silent drop: the ops already reference `{target: 0}`
 * and `{target: 1}` positionally, so dropping the requirements would emit a
 * definition whose script points at targets nothing declares. An unparsed card
 * costs nothing; a dangling target ref is a card that is broken on the stack.
 */
export function declareTargets(
    ability: { targetRequirement?: TargetRequirement },
    requirements: readonly TargetRequirement[]
): string | null {
    if (requirements.length > 1)
        return `${requirements.length} targets were announced but grammar v0 declares at most one (CR 601.2c)`;
    if (requirements.length === 1) ability.targetRequirement = requirements[0];
    return null;
}
