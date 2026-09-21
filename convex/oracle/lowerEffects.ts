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
    CardType,
    Color,
    EffectCardFilter,
    EffectCountSpec,
    EffectPlayerRef,
    EffectPredicate,
    EffectSignedValue,
    EffectTokenSpec,
    EffectValue,
    KickerCost,
    ManaCost,
    TargetRequirement,
} from "../cards/types";
import { PERMANENT_TYPES } from "../cards/types";
import type { PermanentFilter } from "../cards/filters";
import { chooseColorEffects } from "../cards/abilities/chooseColor";
import { landTypeChangeEffects } from "../cards/abilities/chooseLandType";
import type { KickedRefIR } from "./grammar/shared/condition";
import { durationSpec } from "./grammar/shared/duration";
import {
    capitalise,
    type ActedOnCharacteristicIR,
    type ActedOnNounIR,
    type AmountIR,
    type EffectSentenceIR,
    type SubjectIR,
} from "./grammar/shared/effectClause";
import { announcedSlots } from "./grammar/shared/targetFilter";
import { SELF_MARKER } from "./normalize";
import type { PlayerRefIR } from "./grammar/shared/playerRef";
import type { CountedSetIR } from "./grammar/shared/quantity";
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
    /**
     * CR 201.5 — the card's PRINTED name, for the display strings a lowering
     * emits (today: a `mayPay` prompt).
     *
     * The same species of site fact as `allowX`: `normalize.ts` replaced the
     * card's own name with `SELF_MARKER` so the GRAMMAR could bind a REFERENT
     * rather than a string, and a sentence span therefore cannot know what to
     * put back. `lowerSpell.ts` makes the argument in full for a mode's picker
     * label — "{self} deals 5 damage" is never valid output, and it shipped on
     * 18 of 34 modal rows before PR #3044's review caught it. A prompt is read
     * by a player exactly as that label is.
     */
    readonly selfName: string;
    /**
     * CR 702.33e — the kicker costs this site's card prints, with their ids.
     *
     * A site fact for the reason `allowX` is one: "If this spell was kicked"
     * is a fact about the sentence, but whether the card HAS a kicker to have
     * been kicked with, and which id "its {1}{U} kicker" names, are facts about
     * the card's kicker line. Absent = the site reads no kicker at all, and a
     * kicked sentence there is refused rather than lowered into a gate that
     * can never open.
     */
    readonly kickers?: readonly KickerCost[];
    /**
     * What this site's anaphora NAME. "that player" and "that
     * card" are read by the grammar as words; their referent is printed
     * outside the sentence (a trigger head: "each PLAYER'S upkeep", "enchanted
     * creature DIES", issue #4127), so only the site can supply it. Absent =
     * the site introduced no such referent, and a sentence using the word is
     * refused rather than bound to a guess.
     */
    readonly antecedents?: SiteAntecedents;
}

/** The referents a site's anaphora may name (see `SiteOptions.antecedents`). */
export interface SiteAntecedents {
    /** "that player". */
    readonly player?: EffectPlayerRef;
    /** "that opponent" — set only by a head that names an OPPONENT. */
    readonly opponent?: EffectPlayerRef;
    /** "that much" — the magnitude the head's event carried (CR 120.3). */
    readonly amount?: EffectValue;
    /** "that card" — a card a zone change put into a graveyard (CR 400.7e). */
    readonly card?: EffectObjectSelector;
    /**
     * "it" — the OBJECT the site's own text named before the sentence
     * (CR 608.2h): the source on a head whose subject IS the source, the
     * attacking or blocking creature on a per-creature combat head
     * (CR 508.3a / 509.3a). Absent = the site named no object, and a sentence
     * opening on the pronoun is refused rather than pointed at a guess.
     */
    readonly object?: EffectObjectSelector;
}

/** CR 608.2h — true when this site's "it" names the ability's own source. The
 *  one place the selector is read back as an identity rather than used, for
 *  the Op that can only ever act FROM the source (`dealDamage`). */
function pronounIsSource(site: SiteOptions): boolean {
    const object = site.antecedents?.object;
    return (
        object !== undefined &&
        "ref" in object &&
        (object as { ref?: unknown }).ref === "$source"
    );
}

/**
 * CR 601.2d — a divided group's count, without the bound the budget already
 * imposes.
 *
 * Each target must receive at least 1 of the budget, so a fixed total of N
 * cannot be split among more than N targets, and the announcement caps an
 * open count at the total (`announcedTargetCount`). A printed "one, two, or
 * three" over 3 damage is therefore the same announcement as no `max` at all,
 * and is written the way the catalogue writes it (`{ min: 1 }`). A `max`
 * BELOW the budget ("one, two, or three" over 4 damage — Forked Lightning) is
 * a real limit the budget does not impose, and stays.
 */
function dividedCount(
    count: TargetRequirement["count"],
    total: number | "X"
): TargetRequirement["count"] {
    if (typeof count !== "object" || count.max === undefined) return count;
    if (
        typeof count.max === "number" &&
        typeof total === "number" &&
        count.max >= total
    )
        return { min: count.min };
    return count;
}

/** CR 107.3 — an effect magnitude to an `EffectValue`, X gated by the site. */
function lowerAmount(
    amount: AmountIR,
    site: SiteOptions
): Lowered<EffectValue> {
    if (amount.kind === "fixed") return lowered(amount.value);
    if (amount.kind === "event-amount")
        return site.antecedents?.amount !== undefined
            ? lowered(site.antecedents.amount)
            : unlowerable('"that much" names no amount at this site');
    if (amount.kind === "counted" || amount.kind === "acted-on-characteristic")
        return unlowerable(
            `a ${amount.kind} amount is read only at a life-change site`
        );
    return site.allowX
        ? lowered({ X: true })
        : unlowerable(
              "an effect reads X but its source announces no {X} (CR 107.3)"
          );
}

/**
 * CR 107.1 — the set a life-change amount counts, as the `count` construct.
 *
 * A permanent set is the CONTROLLER's permanents, narrowed by card type and/or
 * one subtype, and nothing else: every other descriptor clause (a colour, a
 * tapped state, "on the battlefield") is refused rather than dropped, because
 * a dropped clause counts permanents the card does not mean.
 */
function lowerCountedSet(
    set: CountedSetIR,
    slots: TargetSlots,
    site: SiteOptions
): Lowered<EffectCountSpec> {
    if (set.kind === "cards-in-hand") {
        const controller = playerRef(set.player, slots, site);
        return controller.ok
            ? lowered({ zone: "hand", controller: controller.value })
            : controller;
    }
    const { descriptor } = set;
    if (descriptor.controller !== "you")
        return unlowerable('a counted set must be permanents "you control"');
    const filter: EffectCardFilter = {};
    for (const [key, value] of Object.entries(descriptor)) {
        if (value === undefined || key === "controller") continue;
        if (key === "types") filter.type = [...(value as CardType[])];
        else if (key === "subtypes" && (value as string[]).length === 1)
            filter.subtype = (value as string[])[0]!;
        else
            return unlowerable(
                `a "${key}" clause has no resolution-time count here`
            );
    }
    return lowered({ zone: "battlefield", controller: "controller", filter });
}

/**
 * The amount of a life change (CR 119.3): everything `lowerAmount` reads, plus
 * a counted set and a characteristic of the object the sentence before acted on.
 * Only this site resolves them — the sets need the target slots and the
 * acted-on object lives on the walk.
 */
function lowerLifeAmount(
    amount: AmountIR,
    walk: SentenceWalk,
    site: SiteOptions
): Lowered<EffectValue> {
    if (amount.kind === "counted") {
        const spec = lowerCountedSet(amount.set, walk.targets, site);
        if (!spec.ok) return spec;
        return lowered({
            count:
                amount.times === 1
                    ? spec.value
                    : { ...spec.value, times: amount.times },
        });
    }
    if (amount.kind === "acted-on-characteristic")
        return lowerActedOnCharacteristic(
            amount.noun,
            amount.characteristic,
            walk
        );
    return lowerAmount(amount, site);
}

/** CR 110.4a — the card types "that permanent" can name. */
const ACTED_ON_PERMANENT_TYPES: ReadonlySet<string> = new Set(PERMANENT_TYPES);

/** The phrase a noun was printed as, for a refusal a reader can find. */
const ACTED_ON_PHRASE: Readonly<Record<ActedOnNounIR, string>> = {
    it: "its",
    card: "that card's",
    permanent: "that permanent's",
};

/** The word a characteristic was printed as; the key is its snapshot slot. */
const ACTED_ON_WORD: Readonly<Record<ActedOnCharacteristicIR, string>> = {
    manaValue: "mana value",
    power: "power",
    toughness: "toughness",
};

/**
 * CR 202.3 / CR 208.1 + CR 608.2h — "<phrase> mana value" / "its power" /
 * "its toughness": one characteristic of the object an earlier sentence acted
 * on, read off the snapshot that sentence's Op took.
 *
 * The snapshot is the whole point. By the time this value is read the object
 * has left the battlefield — destroyed, or returned to a hand — so a live
 * read would find nothing and the effect would silently be worth 0. `bind` on
 * the acting Op captures the object as it last existed (CR 608.2h), and the
 * `ref` here reads that capture; the Op is given the binding here, on demand,
 * so a sentence that never asks for the value adds no binding. Power and
 * toughness are the EFFECTIVE values at that moment, so an anthem's bonus is
 * in the snapshot (CR 613.4c).
 *
 * "That permanent" additionally CONSTRAINS the antecedent: a permanent is a
 * card or token ON THE BATTLEFIELD (CR 110.1) of a permanent card type
 * (CR 110.4a), so BOTH facets of the recorded requirement are checked. The
 * zone facet is the one with teeth — "Return target creature card from your
 * graveyard to your hand" records a requirement whose type is `Creature` and
 * whose zone is the graveyard, and a type-only check would read the umbrella
 * noun off a card that was never a permanent. "Its" and "that card's" name
 * whatever the sentence before acted on, which is what makes the umbrella
 * noun worth reading separately.
 *
 * Power and toughness constrain it further, to a CREATURE on the battlefield.
 * A noncreature permanent has neither (CR 208.3), and `bindSnapshot` records
 * 0/0 for a card off the battlefield — which does have printed values
 * (CR 208.1), so this is an engine limit, not a rule — so either read would
 * be worth 0 without saying so.
 */
function lowerActedOnCharacteristic(
    noun: ActedOnNounIR,
    characteristic: ActedOnCharacteristicIR,
    walk: SentenceWalk
): Lowered<EffectValue> {
    const phrase = ACTED_ON_PHRASE[noun];
    const word = ACTED_ON_WORD[characteristic];
    const actedOn = walk.actedOn;
    if (actedOn === null)
        return unlowerable(
            `"${phrase} ${word}" names no object acted on before it (CR 608.2h)`
        );
    const readsPermanentStat = characteristic !== "manaValue";
    if (noun === "permanent" || readsPermanentStat) {
        const { type, zone, count } = actedOn.requirement;
        const types = announcedTypes(actedOn.requirement);
        // `bind` snapshots exactly ONE object, so a wider announcement leaves
        // the phrase naming whichever slot happened to be first. Every facet
        // is checked here rather than leaned on upstream: the sentence
        // grammar refuses a multi-object `destroy` today, and a check that is
        // fail-closed only because of that is fail-closed by accident.
        const admitted = readsPermanentStat
            ? types.every((one) => one === "Creature")
            : types.every((one) => ACTED_ON_PERMANENT_TYPES.has(one));
        if (
            types.length === 0 ||
            !admitted ||
            (zone !== undefined && zone !== "battlefield") ||
            count !== 1
        )
            return unlowerable(
                readsPermanentStat
                    ? `"${phrase} ${word}" is not read off the ${JSON.stringify(type)} in ${zone ?? "battlefield"} acted on before it — the snapshot records power and toughness only for a creature on the battlefield`
                    : `"that permanent" is not the ${JSON.stringify(type)} in ${zone ?? "battlefield"} acted on before it (CR 110.1)`
            );
    }
    const bind = actedOn.op.bind ?? walk.nextBind("that");
    actedOn.op.bind = bind;
    return lowered({ ref: `${bind}.${characteristic}` });
}

/**
 * CR 110.1 — a verb applied to every member of a sweep.
 *
 * `forEach` over the battlefield with the verb's Op reading `$each`, the shape
 * every hand-written sweep writes (Tranquility, Armageddon). A bound on the
 * announced X (CR 202.3 + CR 107.3) is an `if` INSIDE the iteration reading
 * the member's own mana value: `PermanentFilter` has no mana-value field, so
 * folding the bound into the selector would be dropped, and a dropped bound
 * destroys everything the sweep names.
 */
/**
 * CR 613.4c + CR 207.2c — one stat of a pump: the printed number, or that step
 * per basic land type among the controller's lands (`domain`), negated for a
 * shrink. A zero stat has no step to scale.
 */
function pumpStep(
    step: number,
    perDomain: boolean
): number | EffectSignedValue {
    if (!perDomain) return step;
    const domain: EffectValue = { domain: { of: "controller" } };
    return step < 0 ? { negate: domain } : domain;
}

function sweepOps(
    mass: Extract<SubjectIR, { kind: "mass" }>,
    site: SiteOptions,
    slots: TargetSlots,
    verb: (target: EffectObjectSelector) => EffectOp
): Lowered<EffectOp[]> {
    // CR 115.1 — "creatures TARGET PLAYER controls": the swept battlefield is
    // an announced player's, so the slot is allocated here, in sentence order,
    // and written onto the selector as its controller.
    let subject = mass;
    if (mass.targetPlayerControls === true) {
        const index = slots.allocate({ type: "player", count: 1 });
        if (!index.ok) return index;
        subject = {
            ...mass,
            select: { ...mass.select, controller: { target: index.value } },
        };
    }
    const each: EffectObjectSelector = { ref: "$each" };
    if (!subject.manaValueAtMostX)
        return lowered([
            { op: "forEach", select: subject.select, effects: [verb(each)] },
        ]);
    if (!site.allowX)
        return unlowerable(
            "a sweep reads X but its source announces no {X} (CR 107.3)"
        );
    return lowered([
        {
            op: "forEach",
            select: subject.select,
            effects: [
                {
                    op: "if",
                    predicate: {
                        left: { manaValue: { of: each } },
                        op: "le",
                        right: { X: true },
                    },
                    then: [verb(each)],
                },
            ],
        },
    ]);
}

/**
 * CR 701.8 — does this spell body destroy every land in play, unconditionally?
 *
 * The hand-written catalogue marks such a spell `destroysAllLands` (Armageddon)
 * because `spellWouldDestroyLandControlledBy` (`gre/targetFilters.ts`) reads
 * the spell DECLARATIVELY — it never runs the body — and answers only for a
 * single-target destroy or that flag. A compiled sweep is a `forEach`, which
 * that predicate does not walk, so without the marker Equinox could not counter
 * a compiled "Destroy all lands." while it counters the hand-written one.
 *
 * Exactly the shape `sweepOps` emits for an unscoped Land sweep and nothing
 * else: a controller scope, an "other" exclusion or a wider type list is a
 * different classification, and a sweep behind an `if` is not unconditional.
 */
export function destroysEveryLand(effects: readonly EffectOp[]): boolean {
    return effects.some((op) => {
        if (op.op !== "forEach" || op.select.set !== "permanents") return false;
        const { select } = op;
        const filter = select.filter;
        if (
            select.controller !== undefined ||
            select.excludeSource === true ||
            filter === undefined ||
            Object.keys(filter).length !== 1 ||
            filter.type !== "Land"
        )
            return false;
        return (
            op.effects.length === 1 &&
            op.effects[0]!.op === "destroy" &&
            JSON.stringify(op.effects[0]) ===
                JSON.stringify({ op: "destroy", target: { ref: "$each" } })
        );
    });
}

/** CR 601.2c — is this count's width decided by the card rather than the cast? */
function fixedWidth(count: TargetRequirement["count"]): boolean {
    if (typeof count === "number") return true;
    if (count === "X") return false;
    return count.min === count.max;
}

/**
 * CR 115.3 — can an earlier group's picks actually exclude this one?
 *
 * `excludePriorTargets` is applied by merging the earlier picks into
 * `excludeInstanceIds`, and that merge keeps only `type: "permanent"` picks.
 * A group that selects anything else (a card in a graveyard, a player, a
 * spell) would carry the directive and never feel it.
 */
function excludableByPriorPicks(requirement: TargetRequirement): boolean {
    if (requirement.zone !== undefined && requirement.zone !== "battlefield")
        return false;
    const types = Array.isArray(requirement.type)
        ? requirement.type
        : [requirement.type];
    return types.every(
        (t) => t !== "player" && t !== "spell" && t !== "card" && t !== "any"
    );
}

/**
 * Collects the ability's target GROUPS as the sentences are walked.
 *
 * A group is one instance of the word "target" (CR 115.3) and occupies as many
 * positional slots as its count announces (`announcedSlots`); an Effect Script
 * indexes the FLAT concatenation of every group's slots, which is the shape
 * `gre/moves.ts` builds and `game.ts` commits onto the stack item. So the two
 * numbers this class hands out are different things and are kept apart: the
 * GROUP index is what `requirements()` is ordered by and what a replay counts,
 * the SLOT index is what `{ target: N }` carries.
 */
export class TargetSlots {
    private readonly groups: TargetRequirement[] = [];
    /** The first positional slot of each group, parallel to `groups`. */
    private readonly firsts: number[] = [];
    private width = 0;

    /**
     * Announce a target, returning its FIRST positional index (CR 601.2c).
     *
     * `another` is the sentence's printed "ANOTHER target …" (CR 115.3). It
     * decides nothing about the filter and everything about which groups may
     * coexist:
     *
     *   - the FIRST group can never be "another" — there is no earlier
     *     instance of the word "target" for it to exclude, and the reading it
     *     would have instead ("another" than the SOURCE, `excludeSource`) is a
     *     permanent's ability talking about itself, which this walk cannot
     *     tell apart from the spell case and so refuses rather than guesses;
     *   - a LATER group may print it or not. Printed, it is the directive
     *     that forbids naming an object an earlier group already named
     *     (`excludePriorTargets`). Not printed, it is a second plain instance
     *     of the word "target", which CR 115.3 lets name the SAME object as
     *     the first — so it is announced as its own group with NO exclusion,
     *     never widened into the first group's count (that would forbid the
     *     repeat CR 601.2c allows, a narrower spell than the card);
     *
     * Two further refusals keep a LATER group honest, and both are about
     * something the announcement cannot say rather than about the sentence:
     *
     *   - the flat slot list has NO GAPS, so every later group's index shifts
     *     with how many targets an earlier VARIABLE-WIDTH group was actually
     *     given. "Return up to two target creature cards … Another target
     *     creature gets -2/-2" would put the pump at slot 2 while a one-card
     *     pick leaves the creature AT slot 1 — the pump does nothing and the
     *     second `moveZone` bounces the creature instead. A group may follow
     *     only groups of fixed width.
     *   - `excludePriorTargets` is a directive the engine applies by merging
     *     the earlier picks into `excludeInstanceIds`, and that merge keeps
     *     only `type: "permanent"` picks (`game.ts` —
     *     `excludingPriorTargets`, mirrored in `gre/moves.ts` and
     *     `gre/activation.ts`). On a graveyard-card, player or spell group
     *     the word "another" would compile and then not be honoured — the
     *     one thing a fail-closed compiler may not do with a printed word.
     */
    allocate(
        requirement: TargetRequirement,
        another: boolean = false
    ): Lowered<number> {
        const slots = announcedSlots(requirement.count);
        // CR 601.2d — a divide group's op reads the announced split, not a
        // positional slot, so its open-ended count needs none. It does need
        // to be the ONLY group: the divide budget is scoped to the whole flat
        // target list (`finalizeDivideAmounts`, `dealDamageDividedAsChosen`),
        // so a second group would be folded into the split and take damage the
        // card never gave it (Fiery Justice's DIVERGENCE, tracked-by #2910).
        const divided = requirement.divideAsChosen !== undefined;
        if (divided && this.groups.length > 0)
            return unlowerable(
                "a divided group after another target group would share its budget (CR 601.2d)"
            );
        if (slots === null && !divided)
            return unlowerable(
                "a variable target count has no positional slot (CR 601.2c)"
            );
        if (this.groups.length === 0) {
            if (another)
                return unlowerable(
                    '"another target" names no earlier target here (CR 115.3)'
                );
            this.groups.push(requirement);
        } else {
            // CR 115.3 — the word "another" is the ONLY thing that excludes an
            // earlier pick. A plain second "target" (issue #3875: Agony Warp's
            // two pumps, Bounty of Might's three) is an independent group
            // that may name the same object, and a kicker-gated sentence is
            // always one (CR 702.33g, issue #4220): "has its effect only if
            // that spell was kicked", so its target is a NEW instance of the
            // word "target" whether or not the card printed "another", and
            // the announcement expresses it as its own group rather than as
            // a widened count (`announcedOnlyIfKicked`).
            const plain = !another;
            if (this.openEnded)
                return unlowerable(
                    "a target group after a variable-width announcement has no fixed positional slot (CR 601.2c)"
                );
            if (!plain && !excludableByPriorPicks(requirement))
                return unlowerable(
                    '"another target" is honoured only against battlefield permanents (CR 115.3)'
                );
            // CR 115.3 — a printed "another" is a DIRECTIVE on the later
            // group (`excludePriorTargets`, issue #3236): when the target walk
            // reaches it, every pick already made for an earlier group is
            // merged into `excludeInstanceIds`, which is the filter
            // `getLegalTargets`, `selectTarget` and the client's highlight
            // already read.
            this.groups.push(
                plain
                    ? requirement
                    : { ...requirement, excludePriorTargets: true }
            );
        }
        this.firsts.push(this.width);
        this.width += slots ?? 0;
        if (!fixedWidth(requirement.count)) this.openEnded = true;
        return lowered(this.firsts[this.firsts.length - 1]!);
    }

    /**
     * Is the announcement's total width already decided by the CARD rather
     * than by the cast? A variable-width group ("up to two") and a kicked
     * widening both make it depend on choices made at announcement, and a
     * group allocated after either would be indexed from a width nobody can
     * write down at compile time.
     */
    private openEnded = false;

    requirements(): readonly TargetRequirement[] {
        return this.groups;
    }

    /** The first positional slot of group `index` (see the class header). */
    firstSlotOf(index: number): number | undefined {
        return this.firsts[index];
    }

    private kicked?: TargetRequirement;
    private kickerGatedGroups = 0;

    /**
     * CR 702.33g — settle the group(s) a kicker gate announced, into one of
     * the TWO encodings the engine has for "the spell's controller chooses
     * those targets only if that spell was kicked".
     *
     * 1. **The count-widening swap** (`CardDefinition.kickedTargetRequirement`)
     *    — the base requirement with a WIDER count, swapped in at
     *    announcement. The catalogue writes Magma Burst and Falling Timber
     *    ("any target" 1 → 2) this way, and the encoding carries the exclusion
     *    for free: CR 601.2c forbids naming one object twice for a single
     *    instance of the word "target", so a count of 2 is already "another".
     *    Admitted ONLY for a gate that printed "another" over the SAME
     *    descriptor the base announced — a wider count is the only thing it
     *    can say. PREFERRED when it applies, so every card already on it keeps
     *    its behaviour and its prompt (issue #4220).
     * 2. **The gated GROUP** (`TargetRequirement.announcedOnlyIfKicked`, issue
     *    #4220) — an independent group with its own descriptor and its own
     *    count, announced only on a kicked cast. This is the shape for a gate
     *    naming a DIFFERENT set ("Destroy target artifact or enchantment. If
     *    this spell was kicked, it deals damage ... to target creature"),
     *    which has no count to widen: widening would offer two artifacts, a
     *    different spell.
     *
     * Either way the announcement is OPEN-ENDED afterwards — its width now
     * depends on the kicker decision, so a later group's positional slot could
     * not be written down (`allocate` refuses one).
     */
    foldKickerGatedTargets(before: number): Lowered<true> {
        // UNREACHABLE by construction and kept for the same reason
        // `castAdjustedTargetRequirement`'s morph branch is (`game.ts`): both
        // settlements below set `openEnded`, so a SECOND gate's group is
        // refused by `allocate` first, with its own message ("a target group
        // after a variable-width announcement has no fixed positional slot"),
        // which `kickerLine.test.ts` pins. This is the line that stays right
        // if the width bookkeeping ever changes.
        if (this.kicked !== undefined || this.kickerGatedGroups > 0)
            return unlowerable(
                "two kicker gates each announce a target (CR 702.33g)"
            );
        if (this.groups.length !== before + 1)
            return unlowerable(
                "one kicker gate announces more than one target group (CR 702.33g)"
            );
        const base = this.groups[before - 1];
        const gated = this.groups[before]!;
        const gatedSlots = announcedSlots(gated.count);
        if (gatedSlots === null)
            return unlowerable(
                "a variable target count has no positional slot (CR 601.2c)"
            );
        const baseSlots =
            base === undefined ? null : announcedSlots(base.count);
        if (
            before === 1 &&
            base !== undefined &&
            baseSlots !== null &&
            JSON.stringify({ ...base, excludePriorTargets: true }) ===
                JSON.stringify(gated)
        ) {
            // Encoding 1. The group is dropped but its slots are NOT
            // reclaimed: the gated op already points at index `baseSlots`,
            // which only the kicked announcement fills, and a later group
            // reusing that index would collide with it.
            this.kicked = { ...base, count: baseSlots + gatedSlots };
            this.groups.pop();
            this.firsts.pop();
            this.openEnded = true;
            return lowered(true);
        }
        // Encoding 2. The group stays where it was allocated, carrying the
        // gate as a declaration the announcement reads (CR 601.2c — "A spell
        // may require some targets only if an alternative or additional cost
        // (such as a kicker cost) ... was chosen for it"). Its slots keep the
        // indices `allocate` handed the gated ops, because on a kicked cast
        // every earlier group is announced in full before it.
        this.groups[before] = { ...gated, announcedOnlyIfKicked: true };
        this.kickerGatedGroups += 1;
        this.openEnded = true;
        return lowered(true);
    }

    /** CR 702.33g — the swapped-in announcement, if a gate folded one. */
    kickedRequirement(): TargetRequirement | undefined {
        return this.kicked;
    }

    /** CR 702.33g (issue #4220) — did a gate declare a group announced only on
     *  a kicked cast? The SECOND of the two encodings, and like the first it
     *  is a SPELL's announcement: only `announceCast` filters its group list
     *  by the kicker payment, so a site whose targets are chosen anywhere else
     *  (an activated ability, a triggered ability, a mode) must refuse it
     *  rather than emit a group nothing would ever drop. */
    hasKickerGatedGroup(): boolean {
        return this.kickerGatedGroups > 0;
    }
}

/**
 * The bookkeeping ONE walk over an ability's sentence list owns.
 *
 * Two things now share the walk, for the same reason: both are cross-sentence
 * and both break silently when a second copy exists. Target SLOTS index the
 * requirements the ability declares, so an Op emitted by sentence 2 that
 * pointed into sentence 1's private allocator would dangle. BINDING NAMES are
 * script-wide identifiers (`validateEffectScript` rejects a dangling or
 * duplicated one), so two optional sentences in one ability must not both be
 * called `$may`.
 */
/**
 * CR 601.2c — the SAME announced targets, read a second time.
 *
 * An `upgrade-if-controls` lowers its base effect and its upgraded twin, and
 * both name the one target the ability announced. The twin is lowered through
 * these slots: each allocation must be the requirement the base allocated at
 * that position, and gets the base's index back — never a second slot.
 */
class ReplayedTargetSlots extends TargetSlots {
    private readonly source: TargetSlots;
    private next: number;
    constructor(source: TargetSlots, from: number) {
        super();
        this.source = source;
        this.next = from;
    }
    override allocate(
        requirement: TargetRequirement,
        another: boolean = false
    ): Lowered<number> {
        const prior = this.source.requirements()[this.next];
        // The base allocated the group, so the base's `excludePriorTargets`
        // is already on the recorded requirement; the replay's own span
        // carries the word again and must agree, which the equality below
        // checks once the directive is applied the same way. At group 0 there
        // is nothing for it to exclude, and the base class refuses the word
        // outright there — so the replay refuses it too rather than dropping
        // it and letting the equality pass.
        if (another && this.next === 0)
            return unlowerable(
                '"another target" names no earlier target here (CR 115.3)'
            );
        const asAllocated = another
            ? { ...requirement, excludePriorTargets: true }
            : requirement;
        if (
            prior === undefined ||
            JSON.stringify(prior) !== JSON.stringify(asAllocated)
        )
            return unlowerable(
                "the replacement names a target its base effect did not (CR 601.2c)"
            );
        const first = this.source.firstSlotOf(this.next);
        if (first === undefined)
            return unlowerable(
                "the replacement names a target its base effect did not (CR 601.2c)"
            );
        this.next += 1;
        return lowered(first);
    }
    override requirements(): readonly TargetRequirement[] {
        return this.source.requirements();
    }
    override firstSlotOf(index: number): number | undefined {
        return this.source.firstSlotOf(index);
    }
    /** How many of the source's slots the replay has read back. */
    consumed(): number {
        return this.next;
    }
}

export class SentenceWalk {
    readonly targets: TargetSlots;
    private readonly binds: { count: number };

    constructor(
        targets: TargetSlots = new TargetSlots(),
        binds: { count: number } = { count: 0 }
    ) {
        this.targets = targets;
        this.binds = binds;
    }

    /** A walk over the same targets from `from`, sharing binding names. */
    replaying(from: number): SentenceWalk & {
        readonly targets: ReplayedTargetSlots;
    } {
        return new SentenceWalk(
            new ReplayedTargetSlots(this.targets, from),
            this.binds
        ) as SentenceWalk & { readonly targets: ReplayedTargetSlots };
    }
    /**
     * CR 608.2c — the player whose library the last `look-reorder` looked
     * at, when that player was announced as a target: the referent of "That
     * player looks at …" in the sentence after it. Set by that lowering only,
     * so the anaphora binds to nothing it was not written for.
     */
    libraryLookedAt: EffectPlayerRef | null = null;
    /**
     * CR 608.2h — the announced object the last sentence acted on, with the
     * Op that acted on it: the referent of "that creature's mana value" in
     * the sentence after it. The Op is kept (not a copy) so the reader can
     * give it the `bind` that snapshots the object before it changes zone;
     * set only by the lowerings that record it, so the anaphora binds to
     * nothing it was not written for.
     */
    actedOn: {
        /** A `destroy` or announced-target `moveZone` — both carry `bind`. */
        readonly op: { bind?: string };
        readonly requirement: TargetRequirement;
    } | null = null;

    /** A binding name unique within this ability's script. */
    nextBind(prefix: string): string {
        this.binds.count += 1;
        return `$${prefix}${this.binds.count}`;
    }
}

/**
 * What an announced slot may hold, per KIND of verb — the allow-list
 * `selectorsFor` checks a slot against (issue #4192).
 *
 * - `battlefield`: destroy, tap/untap, regenerate, pump, keyword grant and
 *   counters. They read the characteristics of, and write to, a PERMANENT
 *   (CR 110.1), so a slot a player can fill, or one that selects a card in
 *   another zone, is a slot they cannot act on.
 * - `zone-change`: `moveZone`. It reads a card in ANY zone (a graveyard return
 *   is its commonest form), but a player is still not a thing that moves.
 * - `damage`: CR 115.4 / CR 120.3 — damage is dealt to a creature,
 *   planeswalker, battle OR player, so "any target" is exactly the slot it
 *   wants.
 */
type SlotReach = "battlefield" | "zone-change" | "damage";

/** The card types a slot announces, however many the requirement lists. */
function announcedTypes(requirement: TargetRequirement): ReadonlyArray<string> {
    return Array.isArray(requirement.type)
        ? requirement.type
        : [requirement.type];
}

/**
 * Why `reach` cannot act on this slot, or `null` when it can.
 *
 * Each refusal is its OWN string: `oracle:report --gap` ranks a refusal by the
 * text it carries, so two reasons are two Grammar Gaps and one shared reason
 * would size neither ("each stays refused under its own gap key",
 * `targetFilter.ts`). Neither collides with the colour change's own pair
 * (`colorChangeSelector`), whose subject is a different characteristic.
 */
function slotReachRefusal(
    requirement: TargetRequirement,
    reach: SlotReach
): string | null {
    if (reach === "damage") return null;
    // CR 115.4 — "any target" (and a printed "creature or player" union) may
    // be filled by a player, which is not an object (CR 109.1) and has none of
    // the characteristics these verbs read or write. A scalar `"player"` was
    // already refused, under its own reason, by the caller.
    if (announcedTypes(requirement).some((t) => t === "any" || t === "player"))
        return '"any target" may be a player, which is not an object (CR 115.4, CR 109.1)';
    if (reach === "zone-change") return null;
    // CR 400.1 / CR 110.1 — a permanent is a card ON THE BATTLEFIELD, and the
    // battlefield verbs write there. A `zone` other than the battlefield, or
    // the `"card"` type that only ever selects outside it, announces a slot
    // whose object is somewhere the verb does not reach.
    if (
        (requirement.zone !== undefined &&
            requirement.zone !== "battlefield") ||
        announcedTypes(requirement).includes("card")
    )
        return "a card outside the battlefield is not a permanent (CR 110.1, CR 400.1)";
    return null;
}

/**
 * CR 115.1 — the object(s) a verb acts on, and the ONE place a target group is
 * announced.
 *
 * `single` is what the two exported shapes differ by, and it is checked
 * BEFORE the allocation so a verb that cannot fan out refuses a wide
 * announcement instead of consuming a slot for it: acting on the first slot
 * and dropping the rest is the half-a-feature "up to two" used to be refused
 * for — the card would read as printed and do half of what it says.
 *
 * `reach` is the ALLOW-list of announced-slot shapes the calling verb can act
 * on (`SlotReach`): a shape the verb has not been shown is refused rather than
 * allocated, because the shape a refusal list forgets is the one that compiles
 * to an ability that is activated legally, targeted legally, and then reaches
 * an object that is not where it looks (issue #4192).
 */
function selectorsFor(
    subject: SubjectIR,
    slots: TargetSlots,
    single: boolean,
    reach: SlotReach,
    site: SiteOptions
): Lowered<EffectObjectSelector[]> {
    if (subject.kind === "self") return lowered([{ ref: "$source" }]);
    // CR 608.2h — "it" names whatever the SITE printed before the sentence…
    if (subject.kind === "pronoun") {
        // …unless the script has announced a target first, in which case THAT
        // is the nearer antecedent ("Destroy target creature. It …" names the
        // creature, not the head's subject) and the site's referent is the
        // wrong one. Refused rather than guessed — the same rule the
        // intervening-if pronoun guard applies one layer up.
        if (slots.requirements().length > 0)
            return unlowerable(
                '"it" follows an announced target, which is the nearer antecedent (CR 608.2h)'
            );
        const object = site.antecedents?.object;
        return object !== undefined
            ? lowered([object])
            : unlowerable('"it" names no object at this site');
    }
    if (subject.kind === "player")
        return unlowerable("a player is not an object (CR 109.1)");
    // CR 400.7e — "that card" is a card in a graveyard, which only a zone
    // change can act on; `lowerMoveZone` binds it, every other verb refuses.
    if (subject.kind === "that-card")
        return unlowerable('"that card" is read only as a returned card');
    // CR 115.1 — a sweep announces nothing, so there is no slot to point at;
    // only the verbs that fan out (`sweepOps`) read one.
    if (subject.kind === "mass")
        return unlowerable("a sweep is not a single object (CR 110.1)");
    if (subject.requirement.type === "player")
        return unlowerable("a player is not an object (CR 109.1)");
    // CR 112.1 / CR 110.1 — a SPELL is a card on the STACK; a permanent is a
    // card on the battlefield. Every verb reaching this helper acts on the
    // battlefield, so a spell target here is a line misread, not a narrower
    // one: "Return target spell to its owner's hand" is CR 400.7's stack
    // departure, which has an Op of its own (`moveSpellFromStack`, issue
    // #2605) precisely because it is NOT a permanent bounce and NOT a counter
    // (CR 701.6a — a counter CANCELS the spell; a bounce does not, so nothing
    // watching for a countered spell sees one). Lowering it as `moveZone`
    // compiled Reprieve into a spell
    // that does something else. The stack verbs read their own selector.
    //
    // CR 115.2 — the "spell OR permanent" union is refused here for the same
    // reason and one more: half of what it announces is not on the
    // battlefield at all, so a battlefield verb reading it would act on some
    // of its legal targets and silently no-op on the rest. The only verbs
    // that may read it are the ones that work in both zones (`setColor`'s
    // layer-5 colour change, CR 613.1e), and they call their own selector.
    if (subject.requirement.type === "spell-or-permanent")
        // Its OWN reason, not the bare spell's: `oracle:report --gap` ranks a
        // refusal by the string it carries, and the two phrases are two
        // Grammar Gaps ("each stays refused under its own gap key",
        // `targetFilter.ts`). Collapsed, "Destroy target spell or permanent."
        // would rank inside "Destroy target spell." and neither would be
        // sized.
        return unlowerable(
            "a spell-or-permanent slot spans two zones; a battlefield verb reads one (CR 115.2)"
        );
    if (subject.requirement.type === "spell")
        return unlowerable(
            "a spell is on the stack, not the battlefield (CR 112.1)"
        );
    const refusal = slotReachRefusal(subject.requirement, reach);
    if (refusal !== null) return unlowerable(refusal);
    const width = announcedSlots(subject.requirement.count);
    if (width === null)
        return unlowerable(
            "a variable target count has no positional slot (CR 601.2c)"
        );
    if (single && width !== 1)
        return unlowerable(
            "this verb acts on one object, and the sentence announced more (CR 601.2c)"
        );
    const first = slots.allocate(subject.requirement, subject.another === true);
    if (!first.ok) return first;
    return lowered(
        Array.from({ length: width }, (_, i) => ({ target: first.value + i }))
    );
}

/** The single object a verb with no fan-out acts on (see `selectorsFor`). */
function objectSelector(
    subject: SubjectIR,
    slots: TargetSlots,
    site: SiteOptions,
    reach: SlotReach = "battlefield"
): Lowered<EffectObjectSelector> {
    const one = selectorsFor(subject, slots, true, reach, site);
    return one.ok ? lowered(one.value[0]!) : one;
}

/**
 * CR 601.2c — every positional slot ONE announced target group occupies.
 *
 * `objectSelector`'s fan-out twin: "Return up to two target creature cards
 * from your graveyard to your hand" announces one group two slots wide, and
 * the Effect Script names each slot with its own op (`{ target: 0 }`,
 * `{ target: 1 }` — the shape the hand-written Force of Vigor already
 * writes). CR 601.2c — under an "up to N" head the player announces HOW MANY
 * targets they will choose, so a slot they did not fill was never a target at
 * all: its op finds nothing and does nothing, and the same pair of ops is
 * right for zero, one and two chosen targets.
 */
function objectSelectors(
    subject: SubjectIR,
    slots: TargetSlots,
    site: SiteOptions
): Lowered<EffectObjectSelector[]> {
    return selectorsFor(subject, slots, false, "zone-change", site);
}

/**
 * CR 613.1e — the object a layer-5 colour change acts on.
 *
 * The one selector in this file that spans both zones, because the effect
 * does: colour is a characteristic (CR 109.3) of an OBJECT (CR 109.1), and
 * CR 105.3's replacement applies to a spell on the stack exactly as it does
 * to a permanent ("target spell or permanent becomes the color of your
 * choice", Blind Seer; "target instant or sorcery spell …", Vodalian
 * Mystic). So it accepts the source, a permanent slot, a spell slot and
 * CR 115.2's union — everything `objectSelector` accepts, plus the two stack
 * shapes it refuses — and nothing else: a player has no colour (CR 109.1),
 * and a sweep announces no slot to point at (CR 115.1).
 */
function colorChangeSelector(
    subject: SubjectIR,
    slots: TargetSlots,
    site: SiteOptions
): Lowered<EffectObjectSelector> {
    if (subject.kind !== "target") return objectSelector(subject, slots, site);
    const requirement = subject.requirement;
    // An ALLOW-list, not a refusal list, because the two shapes that have to
    // be refused here are the two a refusal list forgets. `"any"` (CR 115.4 —
    // "any target") announces a slot a PLAYER can fill, and a player has no
    // colour; `zone: "graveyard"` announces a card outside both zones this Op
    // writes (`setColorOverride` reaches a permanent or a spell and nothing
    // else). Either one lowers to an ability that is legally activated, whose
    // target is legally chosen, and that then does nothing — the silent shape
    // the compiler exists to refuse. No printed card spells either, so this
    // guard is unreachable from the corpus today and stays as the second line.
    if (
        requirement.type === "spell" ||
        requirement.type === "spell-or-permanent"
    )
        return slotFor(requirement, slots);
    if (requirement.type === "player" || requirement.type === "any")
        return unlowerable("a player has no color (CR 109.1)");
    if (requirement.type === "card" || requirement.zone === "graveyard")
        return unlowerable(
            "a colour change reaches the battlefield and the stack (CR 613.1e)"
        );
    return slotFor(requirement, slots);
}

/**
 * CR 305.7 — the object a layer-4 land-type change acts on.
 *
 * An ALLOW-list of ONE shape, and the narrowest selector in this file,
 * because the rule it serves is narrow in the CR itself: CR 305.7 is written
 * about a LAND, and the sentence it reads never announces anything else. A
 * `setSubtype` pointed at a creature would write "Island" into that
 * creature's subtype line — CR 305.7's mana ability comes with the LAND card
 * type (CR 305.6), so the permanent would take the name and none of the
 * meaning, and the card would be legally activated, legally targeted, and
 * quietly wrong (the shape issue #4192 exists to refuse).
 *
 * `$source` is refused for the same reason and one more: the ability's own
 * source is a land only on a card that prints one, nothing in this file can
 * check that, and no corpus card spells the self form.
 *
 * The `count` leg is the one axis no printed line can reach — a plural
 * subject prints "become", which the rule's own pattern does not match — and
 * it is here anyway, like the second line of `colorChangeSelector` above,
 * because a fan-out this selector cannot express would otherwise lower to
 * `{ target: 0 }` and silently drop every other announced land.
 */
function landTypeChangeSelector(
    subject: SubjectIR,
    slots: TargetSlots
): Lowered<EffectObjectSelector> {
    if (subject.kind !== "target")
        return unlowerable(
            "a land-type change is read only on an announced target (CR 115.1)"
        );
    const requirement = subject.requirement;
    if (
        requirement.type !== "Land" ||
        requirement.count !== 1 ||
        (requirement.zone !== undefined && requirement.zone !== "battlefield")
    )
        return unlowerable(
            "a land-type change reaches ONE land on the battlefield (CR 110.1, CR 305.7)"
        );
    return slotFor(requirement, slots);
}

/** Announce `requirement` and point an Op at the slot it took (CR 601.2c). */
function slotFor(
    requirement: TargetRequirement,
    slots: TargetSlots
): Lowered<EffectObjectSelector> {
    const index = slots.allocate(requirement);
    return index.ok ? lowered({ target: index.value }) : index;
}

/**
 * CR 112.1 — the announced SPELL a stack verb acts on.
 *
 * `objectSelector`'s twin one zone over, and separate for the reason that
 * helper refuses a spell at all: the two sets of verbs are disjoint, and a
 * single selector serving both would make every battlefield verb able to read
 * a stack object by accident.
 *
 * Its own guard is UNENTERABLE today and deliberately kept: the counter rule
 * checks the same two facts before it builds the IR (`effectClause.ts` — a
 * subject that is not an announced spell fails the sentence), so no input
 * reaches this refusal. It is the second line, on the side that would still
 * be right if a future stack verb reached here from a rule that did not
 * check — which is the only way a lowering learns of a grammar's mistake.
 */
function spellSelector(
    subject: SubjectIR,
    slots: TargetSlots
): Lowered<{ target: number }> {
    if (subject.kind !== "target" || subject.requirement.type !== "spell")
        return unlowerable("a stack verb names an announced spell (CR 112.1)");
    const index = slots.allocate(subject.requirement, subject.another === true);
    return index.ok ? lowered({ target: index.value }) : index;
}

function playerRef(
    ref: PlayerRefIR,
    slots: TargetSlots,
    site: SiteOptions
): Lowered<EffectPlayerRef> {
    switch (ref.kind) {
        case "you":
            return lowered("controller");
        // The player the site's head named; none, no binding.
        case "that-player":
        case "that-opponent": {
            const word =
                ref.kind === "that-player" ? "that player" : "that opponent";
            // A player the body itself introduced ("target opponent … That
            // player …") is the nearer antecedent; binding the head's would
            // name the wrong player, so the line is refused instead.
            if (slots.requirements().some((r) => r.type === "player"))
                return unlowerable(
                    `"${word}" may name the announced target, not the head's player`
                );
            const named =
                ref.kind === "that-player"
                    ? site.antecedents?.player
                    : site.antecedents?.opponent;
            return named !== undefined
                ? lowered(named)
                : unlowerable(`"${word}" names no player at this site`);
        }
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
    slots: TargetSlots,
    site: SiteOptions
): Lowered<EffectObjectSelector | { player: EffectPlayerRef }> {
    if (subject.kind === "player") {
        const player = playerRef(subject.player, slots, site);
        return player.ok ? lowered({ player: player.value }) : player;
    }
    return objectSelector(subject, slots, site, "damage");
}

export function lowerSentence(
    sentence: EffectSentenceIR,
    walk: SentenceWalk,
    site: SiteOptions
): Lowered<EffectOp[]> {
    const announced = walk.targets.requirements().length;
    const actedOn = walk.actedOn;
    const out = lowerSentenceBody(sentence, walk, site);
    // CR 608.2h — "that creature" names the object the LAST sentence acted
    // on. A sentence that announced a new target without recording itself
    // (a tap, a pump) makes the older referent stale, so it is dropped rather
    // than read past: an X read off the wrong object is a silent misread.
    if (
        walk.targets.requirements().length !== announced &&
        walk.actedOn === actedOn
    )
        walk.actedOn = null;
    return out;
}

function lowerSentenceBody(
    sentence: EffectSentenceIR,
    walk: SentenceWalk,
    site: SiteOptions
): Lowered<EffectOp[]> {
    const slots = walk.targets;
    switch (sentence.kind) {
        case "pump": {
            const power = pumpStep(sentence.power, sentence.perDomain === true);
            const toughness = pumpStep(
                sentence.toughness,
                sentence.perDomain === true
            );
            if (sentence.subject.kind === "mass")
                return sweepOps(sentence.subject, site, slots, (target) => ({
                    op: "pump",
                    target,
                    power,
                    toughness,
                    duration: durationSpec(sentence.duration),
                }));
            const target = objectSelector(sentence.subject, slots, site);
            if (!target.ok) return target;
            return lowered([
                {
                    op: "pump",
                    target: target.value,
                    power,
                    toughness,
                    duration: durationSpec(sentence.duration),
                },
            ]);
        }
        case "animate": {
            // CR 205.1b — only with the "They're still <types>" rider, which
            // is what says the swept set KEEPS its types; the Op adds Creature
            // in addition to them, so the bare sentence (whose reading would
            // replace them) has no encoding.
            if (sentence.retainsTypes !== true)
                return unlowerable(
                    "an animation that does not say the permanents are still what they were replaces their types (CR 205.1a)"
                );
            if (sentence.subject.kind !== "mass")
                return unlowerable(
                    "an animation reads a sweep, not one object"
                );
            const { power, toughness } = sentence;
            return sweepOps(sentence.subject, site, slots, (target) => ({
                op: "animate",
                target,
                power,
                toughness,
                duration: durationSpec(sentence.duration),
            }));
        }
        case "grant-ability": {
            const target = objectSelector(sentence.subject, slots, site);
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
        // CR 613.1e / CR 105.1 — the pick is the pre-existing `optionChoice`
        // Op, one mode per colour, each mode a single `setColor` (ADR 0045
        // "generalize, don't add" — no choice-kind construct). The builder is
        // the catalogue's own `chooseColorEffects`, imported rather than
        // re-derived: it is the shape five hand-written cards already ship,
        // so reusing it is what makes those cards round-trip instead of
        // diverging by a mode ordering nobody would notice.
        case "set-color-choice": {
            const target = colorChangeSelector(sentence.subject, slots, site);
            if (!target.ok) return target;
            return lowered(
                chooseColorEffects(
                    target.value,
                    sentence.duration === undefined
                        ? undefined
                        : durationSpec(sentence.duration),
                    `Choose a color (${site.selfName}).`
                )
            );
        }
        // CR 305.7 / CR 613.1d — the land types the line offers, each mode a
        // single `setSubtype` (ADR 0045 "generalize, don't add": the pick is
        // the pre-existing `optionChoice` Op, no choice-kind construct). The
        // builder is the catalogue's own `landTypeChangeEffects`, imported
        // rather than re-derived, so the hand-written Dream Thrush and Kavu
        // Recluse round-trip instead of diverging by a mode ordering nobody
        // would notice.
        case "set-land-type": {
            const target = landTypeChangeSelector(sentence.subject, slots);
            if (!target.ok) return target;
            return lowered(
                landTypeChangeEffects(
                    target.value,
                    sentence.offered,
                    durationSpec(sentence.duration),
                    `Choose a basic land type (${site.selfName}).`
                )
            );
        }
        case "deal-damage": {
            // CR 120.1 / 608.2h — `dealDamage` deals from the ability's own
            // source and has no field for another dealer, so "IT deals N
            // damage" is readable exactly when the site's "it" IS that source
            // (Pitchburn Devils' dies head). Behind a head that names another
            // creature the sentence is refused, not silently re-pointed at the
            // source — which would be a card dealing its damage from the wrong
            // object.
            if (sentence.sourceIsPronoun === true && !pronounIsSource(site))
                return unlowerable(
                    '"it deals damage" names a dealer that is not this ability\'s source (CR 120.1)'
                );
            const to = damageTarget(sentence.to, slots, site);
            if (!to.ok) return to;
            // CR 202.3 — the magnitude may be the mana value of the object an
            // earlier sentence acted on, which only the walk can resolve
            // (Orim's Thunder, issue #4221).
            const amount =
                sentence.amount.kind === "acted-on-characteristic"
                    ? lowerActedOnCharacteristic(
                          sentence.amount.noun,
                          sentence.amount.characteristic,
                          walk
                      )
                    : lowerAmount(sentence.amount, site);
            if (!amount.ok) return amount;
            return lowered([
                { op: "dealDamage", amount: amount.value, to: to.value },
            ]);
        }
        case "deal-damage-divided": {
            // CR 120.1 / 608.2h — the same dealer rule as `deal-damage`.
            if (sentence.sourceIsPronoun === true && !pronounIsSource(site))
                return unlowerable(
                    '"it deals damage" names a dealer that is not this ability\'s source (CR 120.1)'
                );
            // `dealDamageDividedAsChosen.total` is a number or "X" and nothing
            // else; `lowerAmount` gates X on the site announcing one.
            if (
                sentence.amount.kind !== "fixed" &&
                sentence.amount.kind !== "x"
            )
                return unlowerable(
                    "a divided budget is a printed number or X (CR 601.2d)"
                );
            const budget = lowerAmount(sentence.amount, site);
            if (!budget.ok) return budget;
            const total: number | "X" =
                sentence.amount.kind === "fixed" ? sentence.amount.value : "X";
            const index = slots.allocate({
                ...sentence.among,
                count: dividedCount(sentence.among.count, total),
                divideAsChosen: { total },
            });
            if (!index.ok) return index;
            return lowered([{ op: "dealDamageDividedAsChosen", total }]);
        }
        // CR 615.12 — the game-scoped anti-prevention lock. No fields, no
        // target, no duration argument: the Op is turn-scoped by construction
        // and cleared at CLEANUP (CR 514.2), exactly as Stomp's first line
        // reads it (issue #3303).
        case "suppress-damage-prevention":
            return lowered([{ op: "suppressDamagePrevention" }]);
        // CR 615.7 — a prevent-the-next-N shield on the announced recipient.
        // `preventDamage`'s `next-n` recipient union mirrors `dealDamage`'s,
        // so the same selector (and its "damage" reach, which admits "any
        // target") names it.
        case "prevent-next-damage": {
            const to = damageTarget(sentence.to, slots, site);
            if (!to.ok) return to;
            return lowered([
                {
                    op: "preventDamage",
                    mode: "next-n",
                    to: to.value,
                    amount: sentence.amount,
                    duration: durationSpec(sentence.duration),
                },
            ]);
        }
        case "draw": {
            const player = playerRef(sentence.player, slots, site);
            if (!player.ok) return player;
            const count = lowerAmount(sentence.count, site);
            if (!count.ok) return count;
            return lowered([
                { op: "draw", player: player.value, count: count.value },
            ]);
        }
        case "destroy": {
            if (sentence.subject.kind === "mass")
                return sweepOps(sentence.subject, site, slots, (target) => ({
                    op: "destroy",
                    target,
                }));
            const target = objectSelector(sentence.subject, slots, site);
            if (!target.ok) return target;
            // CR 701.19c — a "can't be regenerated" clause is a property of
            // the destruction, not a second effect.
            const destroy: Extract<EffectOp, { op: "destroy" }> =
                sentence.cantBeRegenerated
                    ? {
                          op: "destroy",
                          target: target.value,
                          cantBeRegenerated: true,
                      }
                    : { op: "destroy", target: target.value };
            recordActedOn(walk, sentence.subject, destroy);
            return lowered([destroy]);
        }
        // CR 701.6a — counter the announced spell, with CR 118.12a's punisher
        // when the sentence prints one.
        case "counter": {
            const target = spellSelector(sentence.subject, slots);
            if (!target.ok) return target;
            const counter: EffectOp = { op: "counter", target: target.value };
            if (sentence.unlessPays === undefined) return lowered([counter]);
            // CR 118.12a — "[counter] unless [its controller pays]" MEANS
            // "its controller may pay; if they don't, counter it", which is
            // the `mayPay` + `if not` pair verbatim. The tally is Domain read
            // off the effect's OWN controller ("lands YOU control" — CR 109.5
            // names the spell's controller, never the taxed player), and the
            // price is the FOURTH `mayPay` cost leg: a generic amount built
            // from a runtime tally (`genericEqualTo`), never a base cost with
            // a reduction, which has nothing to subtract from.
            const bind = walk.nextBind("may");
            return lowered([
                {
                    op: "mayPay",
                    // CR 118.12a — the taxed player is the spell's controller.
                    player: {
                        controllerOf: target.value,
                    },
                    // CR 109.5 — "lands YOU control" is the EFFECT's
                    // controller, never the taxed player; `times` is absent
                    // because the printed price is {1} per land type and the
                    // grammar reads no other (`COUNTER_DOMAIN_TAX`).
                    cost: {
                        genericEqualTo: { domain: { of: "controller" } },
                    },
                    prompt: `Pay {1} for each basic land type among lands ${site.selfName}'s controller controls to prevent your spell from being countered?`,
                    bind,
                },
                {
                    op: "if",
                    predicate: { not: { binding: bind } },
                    then: [counter],
                },
            ]);
        }
        case "tap-untap": {
            if (sentence.subject.kind === "mass") {
                const action = sentence.action;
                return sweepOps(sentence.subject, site, slots, (target) => ({
                    op: "tapUntap",
                    action,
                    target,
                }));
            }
            const target = objectSelector(sentence.subject, slots, site);
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
            const target = objectSelector(sentence.subject, slots, site);
            if (!target.ok) return target;
            return lowered([{ op: "regenerate", target: target.value }]);
        }
        case "life": {
            const player = playerRef(sentence.player, slots, site);
            if (!player.ok) return player;
            const amount = lowerLifeAmount(sentence.amount, walk, site);
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
            const target = objectSelector(sentence.subject, slots, site);
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
        case "move-zone": {
            // "that card" names the head's card only while no earlier
            // sentence introduced an object of its own.
            if (
                sentence.subject.kind === "that-card" &&
                (walk.actedOn !== null ||
                    walk.libraryLookedAt !== null ||
                    slots.requirements().length > 0)
            )
                return unlowerable(
                    '"that card" may name an object an earlier sentence introduced'
                );
            const moved = lowerMoveZone(
                sentence.subject,
                sentence.to,
                slots,
                site
            );
            // CR 608.2h — "that creature" names ONE object, so a WIDE group
            // (an "up to N" head fanned out over several ops) leaves no
            // referent: recording the first op's would name whichever target
            // happened to be picked first. One op, one referent; more than
            // one, none.
            if (moved.ok && moved.value.length === 1)
                recordActedOn(walk, sentence.subject, moved.value[0]!);
            return moved;
        }
        case "create-token":
            return lowerCreateToken(sentence, walk);
        case "optional": {
            // CR 603.2 — an optional triggered ability's controller chooses on
            // resolution, and declining does NOTHING. That is a cost-free
            // `mayPay` (its `cost` OMITTED, issue #680) whose REQUIRED boolean
            // bind an `if` reads: no placeholder Op, no empty mode, no fifth
            // structural construct. The inner sentence is lowered by THIS
            // walk, so "you may tap target creature" allocates its slot once,
            // through the shared allocator, exactly as the bare sentence does.
            const inner = gatedSentence(sentence.effect, walk, site);
            if (!inner.ok) return inner;
            const bind = walk.nextBind("may");
            return lowered([
                {
                    op: "mayPay",
                    // CR 603.2 — "you" on a triggered ability is its
                    // controller; no other site emits this shape today.
                    player: "controller",
                    prompt: `${capitalise(sentence.clause.split(SELF_MARKER).join(site.selfName))}?`,
                    bind,
                },
                {
                    op: "if",
                    predicate: { binding: bind },
                    then: inner.value,
                },
            ]);
        }
        case "loot": {
            // CR 121.1 then CR 701.9a — draw, then discard cards of the
            // controller's choice: the draw / choose-hand-card / discard
            // sequence every hand-written looter writes.
            const draw = lowerAmount(sentence.draw, site);
            if (!draw.ok) return draw;
            const discard = lowerAmount(sentence.discard, site);
            if (!discard.ok) return discard;
            if (typeof discard.value !== "number")
                return unlowerable("a loot discards a printed number of cards");
            const bind = walk.nextBind("discard");
            return lowered([
                { op: "draw", player: "controller", count: draw.value },
                {
                    op: "choice",
                    kind: "choose-hand-card",
                    player: "controller",
                    zone: "hand",
                    count: discard.value,
                    prompt:
                        discard.value === 1
                            ? "Discard a card."
                            : `Discard ${countWord(discard.value)} cards.`,
                    bind,
                },
                { op: "discard", player: "controller", cards: { ref: bind } },
            ]);
        }
        case "upgrade-if-controls":
            return lowerUpgrade(sentence, walk, site);
        case "discard-at-random": {
            const player = playerRef(sentence.player, slots, site);
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
        case "discard": {
            // CR 701.9b — the affected player CHOOSES. The interpreter clamps
            // the pick to the hand. The choice / discard pair is the one every
            // hand-written "target player discards N cards" writes (Mind
            // Rot), the choice raised for the player who discards.
            //
            // "you" is refused: the controller's own choice is the loot's
            // `choose-hand-card`, a different Pending Choice kind the Bot
            // values differently, and Oracle never prints "you discards".
            if (sentence.player.kind === "you")
                return unlowerable(
                    "a discard by the controller is not the affected-player discard"
                );
            const player = playerRef(sentence.player, slots, site);
            if (!player.ok) return player;
            const count = lowerAmount(sentence.count, site);
            if (!count.ok) return count;
            if (typeof count.value !== "number")
                return unlowerable("a discard names a printed number of cards");
            const bind = walk.nextBind("discard");
            return lowered([
                {
                    op: "choice",
                    kind: "discard-hand",
                    player: player.value,
                    zone: "hand",
                    count: count.value,
                    prompt:
                        count.value === 1
                            ? "Discard a card."
                            : `Discard ${countWord(count.value)} cards.`,
                    bind,
                },
                { op: "discard", player: player.value, cards: { ref: bind } },
            ]);
        }
        case "sacrifice": {
            // CR 701.21a — an edict: the sacrificing player CHOOSES among their
            // own permanents, then those permanents are sacrificed. The pair is
            // the one every hand-written edict writes (Innocent Blood, Liliana
            // of the Veil), the choice raised for the player who sacrifices —
            // never the caster. A player with no matching permanent gets no
            // candidates, so neither the prompt nor the sacrifice happens
            // (CR 101.3 — an impossible instruction is ignored).
            const bind = walk.nextBind("sacrifice");
            const edict = (player: EffectPlayerRef): EffectOp[] => [
                {
                    op: "choice",
                    kind: "sacrifice-permanents",
                    player,
                    zone: "battlefield",
                    filter: sentence.filter,
                    ...(sentence.superlative === undefined
                        ? {}
                        : { superlative: sentence.superlative }),
                    count: sentence.count,
                    prompt: `Sacrifice ${sentence.phrase}.`,
                    bind,
                },
                { op: "sacrifice", permanents: { ref: bind } },
            ];
            // CR 101.4 — "each player": every player chooses in APNAP order,
            // then all the picks are sacrificed together.
            if (sentence.player.kind === "each-player")
                return lowered([
                    {
                        op: "forEach",
                        select: { set: "players" },
                        simultaneous: true,
                        effects: edict({ ref: "$each" }),
                    },
                ]);
            // CR 102.2 — in a two-player game "each opponent" is the one
            // other player, and the edict is one-sided exactly as printed.
            if (sentence.player.kind === "each-opponent")
                return lowered(edict("opponent"));
            const player = playerRef(sentence.player, slots, site);
            if (!player.ok) return player;
            return lowered(edict(player.value));
        }
        case "conjunction": {
            // CR 608.2c — the halves in the order printed, each through the
            // shared walk so a target announced in one is allocated once.
            const ops: EffectOp[] = [];
            for (const effect of sentence.effects) {
                const half = lowerSentence(effect, walk, site);
                if (!half.ok) return half;
                ops.push(...half.value);
            }
            return lowered(ops);
        }
        case "look-distribute":
            return lowerLookDistribute(sentence, site);
        case "look-reorder": {
            const count = lowerAmount(sentence.count, site);
            if (!count.ok) return count;
            if (sentence.looker === "that-player") {
                // CR 608.2c — "That player" is the player the sentence before
                // looked at; with no such sentence it names no one we can.
                const chooser = walk.libraryLookedAt;
                if (chooser === null)
                    return unlowerable(
                        '"that player" names no player announced before it'
                    );
                const player = playerRef(sentence.library, slots, site);
                if (!player.ok) return player;
                return lowered([
                    {
                        op: "scryReorder",
                        player: player.value,
                        chooser,
                        count: count.value,
                        destination: "none",
                    },
                ]);
            }
            const player = playerRef(sentence.library, slots, site);
            if (!player.ok) return player;
            if (player.value === "controller")
                return lowered([
                    {
                        op: "scryReorder",
                        player: player.value,
                        count: count.value,
                        destination: "none",
                    },
                ]);
            // The library is another player's but the looker is "you": the
            // card overrides CR 401.4's default (the owner arranges), so the
            // controller orders it (`chooser`, the fateseal seam).
            walk.libraryLookedAt = player.value;
            return lowered([
                {
                    op: "scryReorder",
                    player: player.value,
                    chooser: "controller",
                    count: count.value,
                    destination: "none",
                },
            ]);
        }
        case "kicked": {
            // CR 702.33g — a target inside the gate is chosen only if the
            // spell was kicked; a card-level `targetRequirement` would demand
            // it on every cast, so the announcement either SWAPS a wider one
            // in (`kickedTargetRequirement`) or declares the gate on the group
            // itself (`announcedOnlyIfKicked`). `foldKickerGatedTargets` picks
            // between them; measured on the walk, so a target allocated by
            // the inner sentence is seen however it was reached.
            const before = walk.targets.requirements().length;
            const inner = gatedSentence(sentence.effect, walk, site);
            if (!inner.ok) return inner;
            if (walk.targets.requirements().length !== before) {
                const folded = walk.targets.foldKickerGatedTargets(before);
                if (!folded.ok) return folded;
            }
            const left = kickedValue(sentence.kicked, site.kickers ?? []);
            if (!left.ok) return left;
            return lowered([
                {
                    op: "if",
                    predicate: { left: left.value, op: "ge", right: 1 },
                    then: inner.value,
                },
            ]);
        }
        case "replace-if-kicked": {
            // CR 702.33e + CR 608.2c — kicked: the replacement happens; else the
            // base does. Both halves are sweeps (`foldKickedInstead`), so no
            // target may be announced on either side: a slot allocated in one
            // branch only has no encoding (CR 702.33g).
            const before = walk.targets.requirements().length;
            const base = gatedSentence(sentence.base, walk, site);
            if (!base.ok) return base;
            const replacement = gatedSentence(sentence.replacement, walk, site);
            if (!replacement.ok) return replacement;
            if (walk.targets.requirements().length !== before)
                return unlowerable(
                    "a target announced in only one branch of a kicked replacement has no encoding (CR 702.33g)"
                );
            const left = kickedValue(sentence.kicked, site.kickers ?? []);
            if (!left.ok) return left;
            return lowered([
                {
                    op: "if",
                    predicate: { left: left.value, op: "ge", right: 1 },
                    then: replacement.value,
                    else: base.value,
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
 * Lower a sentence behind a gate ("you may", "if this spell was kicked").
 *
 * A library looked at behind a gate may never have been looked at, so it is
 * no antecedent for a "That player" after the gate: the walk's referent is
 * restored to what it was before the gated sentence.
 */
function gatedSentence(
    sentence: EffectSentenceIR,
    walk: SentenceWalk,
    site: SiteOptions
): Lowered<EffectOp[]> {
    const antecedent = walk.libraryLookedAt;
    const actedOn = walk.actedOn;
    const inner = lowerSentence(sentence, walk, site);
    walk.libraryLookedAt = antecedent;
    walk.actedOn = actedOn;
    return inner;
}

/**
 * CR 608.2c — "<base>. If you control a <A> and a <B>, <upgraded> instead."
 *
 * The replacement is decided as the ability RESOLVES, so it is an `if` over
 * `count` predicates (one per controls clause, each "at least one", read off
 * the controller's battlefield — CR 109.5's "you") rather than a CR 603.4
 * intervening-if. There is no conjunction in the predicate vocabulary and no
 * fifth construct to add one (ADR 0045), so the conjunction is the nesting:
 * `if A { if B { upgraded } else { base } } else { base }`. The base script
 * appears once per `else`; `if` branches see a CLONE of the bindings in scope
 * (`validateEffectScript`), so a bind inside it is legal in both.
 */
function lowerUpgrade(
    sentence: Extract<EffectSentenceIR, { kind: "upgrade-if-controls" }>,
    walk: SentenceWalk,
    site: SiteOptions
): Lowered<EffectOp[]> {
    const from = walk.targets.requirements().length;
    const base = lowerSentence(sentence.base, walk, site);
    if (!base.ok) return base;
    const replay = walk.replaying(from);
    const upgraded = lowerSentence(sentence.upgraded, replay, site);
    if (!upgraded.ok) return upgraded;
    if (replay.targets.consumed() !== walk.targets.requirements().length)
        return unlowerable(
            "the replacement does not name every target its base effect did (CR 601.2c)"
        );
    const predicates: EffectPredicate[] = [];
    for (const condition of sentence.conditions) {
        const filter = countFilterOf(condition.filter);
        if (!filter.ok) return filter;
        predicates.push({
            left: {
                count: {
                    zone: "battlefield",
                    controller: "controller",
                    filter: filter.value,
                },
            },
            op: "ge",
            right: condition.atLeast,
        });
    }
    let script: EffectOp[] = upgraded.value;
    for (const predicate of [...predicates].reverse())
        script = [
            {
                op: "if",
                predicate,
                then: script,
                else: structuredClone(base.value),
            },
        ];
    return lowered(script);
}

/**
 * A controls clause's `PermanentFilter` as the `count` construct's
 * `EffectCardFilter` — the two members a condition emits today (CR 205.2a
 * types, CR 105.1 colours). Any other field is refused rather than dropped: a
 * dropped clause counts permanents the card does not mean.
 */
function countFilterOf(filter: PermanentFilter): Lowered<EffectCardFilter> {
    const out: EffectCardFilter = {};
    for (const [key, value] of Object.entries(filter)) {
        if (value === undefined) continue;
        if (key === "types") out.type = [...(value as CardType[])];
        else if (key === "colors") out.color = [...(value as Color[])];
        else
            return unlowerable(
                `a "${key}" clause has no resolution-time count here`
            );
    }
    return lowered(out);
}

/** A small count as the word Oracle text prints ("two"), for a prompt. */
function countWord(n: number): string {
    const words = [
        "zero",
        "one",
        "two",
        "three",
        "four",
        "five",
        "six",
        "seven",
    ];
    return words[n] ?? String(n);
}

/** Remember the announced object a sentence acted on (see `actedOn`). */
function recordActedOn(
    walk: SentenceWalk,
    subject: SubjectIR,
    op: EffectOp
): void {
    if (subject.kind !== "target") return;
    if (op.op === "destroy" || (op.op === "moveZone" && "target" in op))
        walk.actedOn = { op, requirement: subject.requirement };
}

/**
 * CR 111.1 — create creature tokens (CR 205.2a: also artifacts when printed
 * so, and then colorless — CR 105.2c, `colors: []`), lowered to `createToken`
 * in the shape every hand-written producer writes: the controller creates them (CR 111.2),
 * the name is the subtypes — a DEVIATION from CR 111.4, which appends the
 * word "Token", kept because it is the catalogue's convention for every
 * unnamed token and the key `token-prints.json` art is looked up by (a name
 * is never read to decide anything here: no card in this form names its own
 * token) — and the art is NOT pinned on the spec: the runtime resolves
 * it per producer from `token-prints.json` (`tokenPrintIdFor`), and the
 * compiled pool's art-completeness guard (`tokenPrintLookup.test.ts`) holds
 * every compiled producer to it.
 *
 * "where X is that <noun>'s mana value" (CR 202.3) reads the object the
 * sentence before acted on, snapshotted by that Op's `bind` before it left
 * the battlefield (CR 608.2h) — the Artifact Mutation shape. A noun that is
 * not the announced object's type names an object we cannot point at.
 */
function lowerCreateToken(
    sentence: Extract<EffectSentenceIR, { kind: "create-token" }>,
    walk: SentenceWalk
): Lowered<EffectOp[]> {
    const { token, count } = sentence;
    // CR 702.1 — a keyword the engine does not implement is a token that
    // silently lacks it (Guard A, #962).
    if (token.keyword !== null && token.keyword.status !== "implemented")
        return unlowerable(
            `the token's keyword "${token.keyword.ability}" is not implemented`
        );
    const spec: EffectTokenSpec = {
        name: token.subtypes.join(" "),
        // CR 205.2a — "artifact creature token": both card types, in the
        // order `GOLEM_TOKEN` writes them.
        types: token.artifact ? ["Artifact", "Creature"] : ["Creature"],
        subtypes: [...token.subtypes],
        power: token.power,
        toughness: token.toughness,
        colors: [...token.colors],
    };
    if (token.keyword !== null) spec.staticAbilities = [token.keyword.ability];
    const op: Extract<EffectOp, { op: "createToken" }> = {
        op: "createToken",
        token: spec,
        controller: "controller",
    };
    if (count.kind === "fixed") {
        if (count.value !== 1) op.count = count.value;
        return lowered([op]);
    }
    const actedOn = walk.actedOn;
    if (actedOn === null)
        return unlowerable(
            `"that ${count.noun}" names no object acted on before it (CR 608.2h)`
        );
    const type = actedOn.requirement.type;
    if (typeof type !== "string" || type.toLowerCase() !== count.noun)
        return unlowerable(
            `"that ${count.noun}" is not the ${JSON.stringify(type)} acted on before it`
        );
    const bind = actedOn.op.bind ?? walk.nextBind("that");
    actedOn.op.bind = bind;
    op.count = { ref: `${bind}.manaValue` };
    return lowered([op]);
}

/**
 * CR 702.33d / 702.33f — the value a kicked gate reads.
 *
 * "Kicked" (CR 702.33d) is "any of that spell's kicker costs" paid, which is
 * the stack item's whole kicker tally — `{ kickerCount: true }`, the reading
 * the hand-written catalogue uses for the phrase. "Kicked with its {A}
 * kicker" (CR 702.33f) names ONE of two or more kicker costs by its printed
 * cost, and reads that kicker's own payment record. A cost that matches no
 * kicker, or more than one, is a sentence linked to nothing we can name.
 */
export function kickedValue(
    kicked: KickedRefIR,
    kickers: readonly KickerCost[]
): Lowered<EffectValue> {
    if (kickers.length === 0)
        return unlowerable(
            "a kicked condition on a card that prints no kicker (CR 702.33e)"
        );
    if (kicked.kind === "any") return lowered({ kickerCount: true });
    if (kickers.length < 2)
        return unlowerable(
            'only a card with two or more kicker costs names "its [A] kicker" (CR 702.33f)'
        );
    const printed = manaKey(kicked.mana);
    const named = kickers.filter(
        (k) => k.mana !== undefined && manaKey(k.mana) === printed
    );
    if (named.length !== 1)
        return unlowerable(
            `"its kicker" names ${named.length} of this card's kicker costs (CR 702.33f)`
        );
    return lowered({ additionalCostPaid: named[0]!.id });
}

/** A key-order-insensitive identity for a fixed `ManaCost` (no nested pips). */
function manaKey(mana: ManaCost): string {
    return JSON.stringify(
        Object.entries(mana).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    );
}

/**
 * CR 401.4 — look at (CR 701.20a: or reveal) the top of your library and route
 * it: `lookDistribute`, the Op every hand-written card of this shape uses.
 *
 * "Put all <Subtype> cards revealed this way into your hand" keeps EVERY
 * matching card: `take` is the whole window and `optional: false`, so the
 * clamp to the matching count (`lookDistribute` keeps at most the filtered
 * cards) makes the keep exactly "all of them". "Put <N> of them" is a pick of
 * N. The rest go to the bottom in the owner's chosen order (CR 401.4) by
 * default, in a random order (`randomBottom`), or to the graveyard.
 */
function lowerLookDistribute(
    sentence: Extract<EffectSentenceIR, { kind: "look-distribute" }>,
    site: SiteOptions
): Lowered<EffectOp[]> {
    const look = lowerAmount(sentence.count, site);
    if (!look.ok) return look;
    const route = sentence.route;
    if (route.kind === "all-of-subtype")
        return lowered([
            {
                op: "lookDistribute",
                player: "controller",
                look: look.value,
                take: look.value,
                keepTo: "hand",
                filter: { subtype: route.subtype },
                optional: false,
                reveal: "window",
            },
        ]);
    const take = lowerAmount(route.count, site);
    if (!take.ok) return take;
    const op: Extract<EffectOp, { op: "lookDistribute" }> = {
        op: "lookDistribute",
        keepTo: "hand",
        player: "controller",
        look: look.value,
        take: take.value,
    };
    if (route.rest === "graveyard") op.destination = "graveyard";
    if (route.rest === "bottom-random-order") op.randomBottom = true;
    return lowered([op]);
}

/**
 * CR 400.6 — a zone change of an object already in play.
 *
 * Only the destinations whose `moveZone` shape is unambiguous are lowered.
 * "to the top of your library" exists in the engine but reads a DIFFERENT
 * source zone than the one this sentence implies, and guessing the source is
 * how a recursion effect becomes a reanimation one. "To the battlefield" is
 * lowered for exactly ONE source: a target in YOUR graveyard, where the sentence
 * itself names the zone it leaves.
 */
function lowerMoveZone(
    subject: SubjectIR,
    zone: ZoneRefIR,
    slots: TargetSlots,
    site: SiteOptions
): Lowered<EffectOp[]> {
    // CR 400.7e — "return that card to its owner's hand": the card the site's
    // zone change put into a graveyard. Only the hand is read — the one
    // destination a printed line asks for — so no other zone pair is claimed.
    if (subject.kind === "that-card") {
        const card = site.antecedents?.card;
        if (card === undefined)
            return unlowerable('"that card" names no card at this site');
        if (zone.zone !== "hand" || zone.owner !== "its-owner")
            return unlowerable(
                '"that card" is returned only to its owner\'s hand in grammar v0'
            );
        return lowered([{ op: "moveZone", target: card, to: "hand" }]);
    }
    // CR 400.3 — an object can only ever reach its OWNER's hand, so "to your
    // hand" and "to its owner's hand" name the same zone exactly when the
    // object is yours. A card in YOUR graveyard is: it got there as a
    // countered, discarded, destroyed or sacrificed object, or as a resolved
    // instant or sorcery, and CR 404.1 puts each of those on top of its
    // OWNER's graveyard. A permanent you merely control is NOT, and reading
    // "to your hand" as `to: "hand"` there would compile a bounce into a
    // theft that the engine would then silently undo.
    const yourHand =
        zone.zone === "hand" &&
        zone.owner === "you" &&
        subject.kind === "target" &&
        subject.requirement.zone === "graveyard" &&
        subject.requirement.controller === "you";
    const targets = objectSelectors(subject, slots, site);
    if (!targets.ok) return targets;
    // CR 400.7 / CR 110.2a — "return target creature card from your graveyard
    // to the battlefield": the card becomes a NEW object and enters under the
    // control of the player the effect tells to put it there. The graveyard is
    // YOURS (CR 404.1 files a card in its OWNER's graveyard), so owner and the
    // controller the engine gives a reanimated card coincide. Any other source
    // (a graveyard that is not yours, a library, a hand, exile) names a
    // different owner/controller question this rule does not answer. Exactly
    // ONE target: N cards returned by one instruction enter together (CR 400.7),
    // which a sequence of single `moveZone` Ops does not say, and no corpus
    // card prints it.
    const reanimated =
        zone.zone === "battlefield" &&
        subject.kind === "target" &&
        subject.requirement.zone === "graveyard" &&
        subject.requirement.controller === "you" &&
        subject.requirement.count === 1;
    const each = (
        to: "hand" | "graveyard" | "exile" | "battlefield"
    ): Lowered<EffectOp[]> =>
        lowered(
            targets.value.map((target) => ({ op: "moveZone", target, to }))
        );
    if (zone.zone === "hand" && (zone.owner === "its-owner" || yourHand))
        return each("hand");
    if (zone.zone === "graveyard" && zone.owner === "its-owner")
        return each("graveyard");
    if (zone.zone === "exile") return each("exile");
    if (reanimated) return each("battlefield");
    return unlowerable(
        `"${zone.zone}" is not a zone destination in grammar v0`
    );
}

/**
 * Declare the announced targets on the ability (CR 601.2c).
 *
 * Exported, and taking the requirement list as a PARAMETER rather than reading
 * `slots` from the closure, for the reason `routeLineWith` gives one directory
 * over: the `groups = false` refusal below is the TRIGGER site's ceiling, and a
 * triggered ability reaches it through `TargetSlots.allocate` admitting a
 * second group (issue #3875). Injecting the list keeps the branch testable on
 * its own, independent of what `allocate` admits at any moment.
 *
 * A group the site cannot DECLARE is UNLOWERABLE, never a silent drop: the ops
 * already reference `{target: 0}` and `{target: 1}` positionally, so dropping
 * the requirements would emit a definition whose script points at targets
 * nothing declares. An unparsed card costs nothing; a dangling target ref is a
 * card that is broken on the stack.
 *
 * `groups` is the site's own answer to "can I carry a SECOND instance of the
 * word target?" (CR 115.3), and it is a fact about the engine shape the site
 * writes onto, not about the sentence: a spell and an activated ability each
 * have an `additionalTargetRequirements` list, a TRIGGERED ability has no such
 * field (`gre/state.ts` — no twin on a triggered ability), so the trigger site
 * keeps the one-group ceiling and says so by omitting the flag.
 */
export function declareTargets(
    ability: {
        targetRequirement?: TargetRequirement;
        additionalTargetRequirements?: TargetRequirement[];
    },
    requirements: readonly TargetRequirement[],
    groups: boolean = false
): string | null {
    if (requirements.length > 1 && !groups)
        return `${requirements.length} target groups were announced but this site declares at most one (CR 601.2c)`;
    if (requirements.length === 0) return null;
    // CR 702.33g / 601.2c (issue #4220) — `targetRequirement` is the group
    // EVERY cast announces, so a kicker-gated group may never sit there: a
    // card whose only target is inside the gate (Probe) declares none and puts
    // its one group on `additionalTargetRequirements`, which is the list the
    // announcement filters before choosing which group opens the selection
    // (`castAnnouncedTargetGroups`, `gre/kicker.ts`). The catalogue guard
    // (`kickerGatedGroups.catalogue.test.ts`) asserts the same invariant over
    // hand-written cards.
    if (requirements[0]!.announcedOnlyIfKicked) {
        ability.additionalTargetRequirements = [...requirements];
        return null;
    }
    ability.targetRequirement = requirements[0];
    if (requirements.length > 1)
        ability.additionalTargetRequirements = requirements.slice(1);
    return null;
}
