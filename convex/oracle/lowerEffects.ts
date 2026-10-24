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

import {
    lowerUnlessPayment,
    unlessPaymentPrompt,
} from "./grammar/shared/unlessPayment";
import type {
    EffectObjectSelector,
    EffectOp,
    EffectMoveZone,
    CardSupertype,
    CardType,
    Color,
    EffectCardFilter,
    EffectCountSpec,
    EffectManaPool,
    EffectChoiceCount,
    EffectPlayerRef,
    EffectPredicate,
    EffectCaptureSource,
    EffectSignedValue,
    EffectTokenSpec,
    EffectValue,
    KickerCost,
    ManaCost,
    TargetRequirement,
} from "../cards/types";
import { CARD_TYPES, PERMANENT_TYPES } from "../cards/types";
import { LAND_SUBTYPE_MANA } from "../gre/constants";
import type { PermanentFilter } from "../cards/filters";
import {
    chooseColorEffects,
    colorChoiceModes,
} from "../cards/abilities/chooseColor";
import { PROTECTION_QUALITY_NAMES } from "../cards/abilities";
import { landTypeChangeEffects } from "../cards/abilities/chooseLandType";
import type { KickedRefIR } from "./grammar/shared/condition";
import type { PermanentSweepSelector } from "./grammar/shared/massSubject";
import { durationSpec } from "./grammar/shared/duration";
import {
    capitalise,
    type ActedOnCharacteristicIR,
    type ActedOnNounIR,
    type AmountIR,
    type EffectSentenceIR,
    type LibraryRestIR,
    type SubjectIR,
} from "./grammar/shared/effectClause";
import {
    announcedSlots,
    targetRequirementFromDescriptor,
    type DescriptorIR,
} from "./grammar/shared/targetFilter";
import {
    ANY_NUMBER_CEILING,
    type FrameChainIR,
    type FrameIR,
    type MoveObjectIR,
} from "./grammar/shared/verbFrames";
import type { AmongPickSentenceIR } from "./grammar/shared/fromAmong";
import { SELF_MARKER } from "./normalize";
import type { PlayerRefIR } from "./grammar/shared/playerRef";
import type { CountedSetIR } from "./grammar/shared/quantity";
import type { ZoneRefIR } from "./grammar/shared/zoneRef";
import type { QuotedAbilityIR } from "./grammar/shared/staticClause";

/**
 * CR 205.4a — "other than basic land cards": a card matches unless it is BOTH
 * a land and basic, which an AND-of-fields filter cannot spell on its own.
 */
const NOT_A_BASIC_LAND: EffectCardFilter = {
    any: [{ excludeType: "Land" }, { excludeSupertype: "Basic" }],
};

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
    /** CR 113.6b — the ability being lowered functions from the graveyard. */
    readonly functionsFromGraveyard?: boolean;
    /**
     * CR 107.3f — the binding a `payVariableMana` wrote ("$paid"), set while
     * the effect that FOLLOWS the payment is lowered: there `X` is the amount
     * paid, not an announced value, so `lowerAmount` reads `{ ref }` instead of
     * `{ X: true }` (and the site's own `allowX` is switched off, so a sweep's
     * announced-X path cannot read the wrong X). Absent = no payment is in
     * scope.
     */
    readonly paidBind?: string;
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
     * CR 113.1a — registers an ability granted in quotation marks on the
     * card's `grantTemplates[]` and returns its template id. Absent = the
     * site cannot carry a granted template, and the sentence is refused.
     */
    readonly grantQuotedAbility?: (quoted: {
        readonly text: string;
        readonly ability: QuotedAbilityIR;
    }) => Lowered<string>;
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
    /**
     * CR 118.1 + CR 608.2h — the site's activation cost SACRIFICED the source,
     * so the ability's stack item carries the source's last known
     * characteristics (`sacrificeSourceSnapshot`) and "its power" is readable
     * as `{ sacrificed: { read: "power" } }`. Absent = the source is still in
     * play, or was never the cost's victim, and the phrase is refused rather
     * than read off a snapshot that was never written.
     */
    readonly sourceSacrificed?: true;
    /**
     * CR 118.1 + CR 608.2h — the site's activation cost exiled the top card of
     * the controller's library, so the stack item carries that card's last
     * known characteristics (the additional-cost victim snapshot) and "the
     * exiled card's mana value" is readable as
     * `{ sacrificed: { read: "manaValue" } }`. Absent = no such leg: refused.
     */
    readonly costExiledTopCard?: true;
    /**
     * CR 608.2n — the site is a spell's own text (an instant or sorcery
     * resolving), so "shuffle this spell into its owner's library" has a card
     * on the stack to move. Absent = an ability's text: its stack item is no
     * card, and the sentence is refused rather than lowered into a no-op.
     */
    readonly resolvingSpell?: true;
    /**
     * CR 608.2b — the site can carry "This ability still resolves if its
     * target becomes illegal" (`TriggeredAbility.resolvesIfTargetsIllegal`).
     * Absent = it cannot (a spell, an activated ability), and a sentence
     * asking for it is refused rather than lowered into a fizzle.
     */
    readonly resolvesIfTargetsIllegal?: true;
}

/** The referents a site's anaphora may name (see `SiteOptions.antecedents`). */
export interface SiteAntecedents {
    /** "that player". */
    readonly player?: EffectPlayerRef;
    /** "that opponent" — set only by a head that names an OPPONENT. */
    readonly opponent?: EffectPlayerRef;
    /**
     * CR 506.2 + CR 508.5 — "defending player": the player the source is
     * attacking, set only by a head that is the source's own attack.
     */
    readonly defendingPlayer?: EffectPlayerRef;
    /**
     * CR 607.2a — "the exiled card": this object's linked exile, readable
     * only behind its own leaves-the-battlefield head.
     */
    readonly exiledCard?: true;
    /** "that much" — the magnitude the head's event carried (CR 120.3). */
    readonly amount?: EffectValue;
    /**
     * "that creature" — the creature the head named: the Aura's host behind
     * "at the beginning of the upkeep of enchanted creature's controller"
     * (CR 303.4b). Absent = the head named no creature.
     */
    readonly creature?: EffectObjectSelector;
    /**
     * CR 608.2h — the number of target slots announced BEFORE `creature` was
     * named. Set when the referent is a creature an earlier sentence put onto
     * the battlefield (`SentenceWalk.introduced`): targets announced before
     * that sentence are farther antecedents, one announced after it is the
     * nearer one. Absent = 0, the head's own creature.
     */
    readonly creatureAfterSlots?: number;
    /**
     * CR 608.2h — the head named an `object`, withheld from every sentence
     * after the first (`lowerTriggered.ts`). Not a referent: a marker that a
     * later "that creature" or "it" has the head's object as a second
     * candidate, so binding it to an earlier sentence's object is a guess.
     */
    readonly headNamedObject?: true;
    /**
     * CR 303.4f — the creature an "enters" head on ANOTHER permanent fired
     * for: the host "attached to that creature" names. Read only by the
     * Aura-return sentence; the general "that creature" subject keeps its own
     * antecedent (`creature`).
     */
    readonly enteringCreature?: EffectObjectSelector;
    /**
     * CR 608.2c — the head's SUBJECT is an object other than the source
     * ("Whenever a creature enters", "When enchanted creature dies"), whether
     * or not the head exposes it as a referent. A later "that creature" may
     * mean it, so binding the word to an announced target is a guess.
     */
    readonly headSubjectIsObject?: true;
    /** "that card" — a card a zone change put into a graveyard (CR 400.7e). */
    readonly card?: EffectObjectSelector;
    /**
     * CR 603.2 + CR 608.2h — "that spell": the spell a cast-trigger head
     * named (`$event.spell`, the stack-object field of `SPELL_CAST`).
     */
    readonly spell?: Extract<EffectOp, { op: "counter" }>["target"];
    /**
     * CR 404.1 / 110.2a — "that card" sits in the graveyard of the ability's
     * own controller (the head pins its owner), so putting it onto the
     * battlefield returns it under its owner's control.
     */
    readonly cardOwnedByController?: true;
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
    if (amount.kind === "sacrificed-source-characteristic")
        return site.sourceSacrificed === true
            ? lowered({ sacrificed: { read: amount.characteristic } })
            : unlowerable(
                  '"its power" names a source its own cost did not sacrifice (CR 608.2h)'
              );
    if (amount.kind === "cost-exiled-card-characteristic")
        return site.costExiledTopCard === true
            ? lowered({ sacrificed: { read: amount.characteristic } })
            : unlowerable(
                  '"the exiled card" names a card this ability\'s cost did not exile (CR 608.2h)'
              );
    if (
        amount.kind === "counted" ||
        amount.kind === "counted-difference" ||
        amount.kind === "acted-on-characteristic"
    )
        return unlowerable(
            `a ${amount.kind} amount is read only at a life-change site`
        );
    if (site.paidBind !== undefined) return lowered({ ref: site.paidBind });
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
/** CR 205.3m (issue #3721) — the ONE binding name the compiler uses for a
 *  chosen creature type. The `Choose a creature type.` sentence writes it and
 *  every `chosenType` descriptor in the same line reads it; they are separate
 *  rules in separate modules, so a shared constant is what keeps them in step.
 *  A per-line generated name would buy nothing: a line prints the instruction
 *  at most once (a second "Choose a creature type." would re-bind the same
 *  name, which `validateEffectScript` rejects as a duplicate bind — the
 *  correct answer, since no printed card does it). */
const CHOSEN_TYPE_BINDING = "$chosenType";
/** CR 205.3i / 305.6 — the two land-type picks of "Choose a land type and a
 *  basic land type", read back by "the first / second chosen type". Reserved
 *  constants for the reason `CHOSEN_TYPE_BINDING` gives. */
const FIRST_CHOSEN_LAND_TYPE_BINDING = "$firstChosenType";
const SECOND_CHOSEN_LAND_TYPE_BINDING = "$secondChosenType";
const NAMED_CARD_BINDING = "$named";
/** The picks binding of a card revealed at random from hand (CR 701.20a). */
const REVEALED_CARD_BINDING = "$revealed";

/**
 * CR 107.3 — the permanents a "where X is the number of <descriptor> target
 * opponent controls" tail counts, as the `count` construct's filter. Only a
 * colour (one) and a card type are read; any other clause is refused, never
 * dropped, because a dropped clause counts permanents the card does not mean.
 */
function boundCountFilter(descriptor: DescriptorIR): Lowered<EffectCardFilter> {
    const filter: EffectCardFilter = {};
    for (const [key, value] of Object.entries(descriptor)) {
        if (value === undefined || key === "plural") continue;
        if (key === "types") {
            // "permanents" names every permanent type, which is no narrowing.
            const types = value as readonly CardType[];
            if (types.length !== PERMANENT_TYPES.length)
                filter.type = [...types];
        } else if (key === "colors" && (value as Color[]).length === 1)
            filter.color = (value as Color[])[0]!;
        else
            return unlowerable(
                `a "${key}" clause has no cast-time count here (CR 601.2c)`
            );
    }
    return lowered(filter);
}

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
    // CR 201.2 + CR 404.1 — the cards bearing this card's own name, in every
    // graveyard.
    if (set.kind === "named-self-in-all-graveyards")
        return lowered({
            zone: "graveyard",
            acrossAllPlayers: true,
            filter: { name: site.selfName },
        });
    const { descriptor } = set;
    // CR 404.1 — "the number of creature cards in your graveyard": the
    // controller's graveyard, narrowed by card type. Any other owner ("a
    // graveyard", "target player's") or clause is refused, not dropped.
    const inGraveyard = descriptor.zone === "graveyard";
    if (inGraveyard && descriptor.zoneOwner !== "you")
        return unlowerable('a counted graveyard must be "your graveyard"');
    // CR 109.2 — the whole-board scope carries no controller clause.
    const wholeBoard = set.wholeBoard === true;
    if (!inGraveyard && !wholeBoard && descriptor.controller !== "you")
        return unlowerable('a counted set must be permanents "you control"');
    const filter: EffectCardFilter = {};
    for (const [key, value] of Object.entries(descriptor)) {
        // `plural` is the noun's number ("the number of Mountains"), not a
        // clause: it narrows nothing about what is counted. `zone`,
        // `zoneOwner` and `card` are the graveyard phrase, checked above.
        if (
            value === undefined ||
            key === "controller" ||
            key === "plural" ||
            (inGraveyard &&
                (key === "zone" || key === "zoneOwner" || key === "card"))
        )
            continue;
        if (key === "types") filter.type = [...(value as CardType[])];
        // CR 205.4a — "nonbasic": `EffectCardFilter.excludeSupertype`.
        else if (key === "excludeSupertypes")
            filter.excludeSupertype =
                (value as CardSupertype[]).length === 1
                    ? (value as CardSupertype[])[0]!
                    : [...(value as CardSupertype[])];
        else if (key === "subtypes" && (value as string[]).length === 1)
            filter.subtype = (value as string[])[0]!;
        // CR 205.3m (issue #3721) — "for each permanent you control of that
        // type" (Luminescent Rain): the subtype is the answer a
        // `chooseCreatureType` Op bound earlier in this same script, read back
        // through `EffectCardFilter.subtype`'s ref form.
        else if (key === "chosenType")
            filter.subtype = { ref: CHOSEN_TYPE_BINDING };
        else
            return unlowerable(
                `a "${key}" clause has no resolution-time count here`
            );
    }
    if (wholeBoard)
        return lowered({
            zone: "battlefield",
            acrossAllPlayers: true,
            filter,
        });
    return lowered({
        zone: inGraveyard ? "graveyard" : "battlefield",
        controller: "controller",
        filter,
    });
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
    if (amount.kind === "counted-difference") {
        // CR 107.1b — a signed difference; the consuming Op clamps it.
        const spec = lowerCountedSet(amount.set, walk.targets, site);
        if (!spec.ok) return spec;
        return lowered({
            difference: { from: { count: spec.value }, minus: amount.minus },
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
    if (
        mass.targetPlayerControls === true ||
        mass.targetOpponentControls === true
    ) {
        // CR 115.1 + CR 102.2 — "target opponent" is a player slot the
        // opponent restriction narrows (`controller: "opponent"`).
        const index = slots.allocate(
            mass.targetOpponentControls === true
                ? { type: "player", count: 1, controller: "opponent" }
                : { type: "player", count: 1 }
        );
        if (!index.ok) return index;
        subject = {
            ...mass,
            select: { ...mass.select, controller: { target: index.value } },
        };
    }
    const each: EffectObjectSelector = { ref: "$each" };
    // CR 202.3 + CR 122.1 — "with mana value equal to the number of <kind>
    // counters on this <source>": an `if` over the iterated permanent's mana
    // value against the source's live counter tally (the `counters` value
    // reads last-known information once a cost sacrificed the source).
    if (subject.manaValueEqualsSourceCounters !== undefined)
        return lowered([
            {
                op: "forEach",
                select: subject.select,
                effects: [
                    {
                        op: "if",
                        predicate: {
                            left: { manaValue: { of: each } },
                            op: "eq",
                            right: {
                                counters: {
                                    of: { ref: "$source" },
                                    type: subject.manaValueEqualsSourceCounters,
                                },
                            },
                        },
                        then: [verb(each)],
                    },
                ],
            },
        ]);
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
 * CR 120.3 — "… to each creature and each player": a fixed two-set recipient
 * union, fanned out into the same pair of sweeps the hand-written cards write
 * (Pestilence) — one `forEach` over the battlefield's creatures, one over the
 * players — because the damage-family Ops this reads for (`dealDamage`,
 * `preventDamage`) name ONE recipient in `to`, never two disjoint sets.
 */
function eachCreatureAndPlayerOps(
    toCreature: (target: EffectObjectSelector) => EffectOp,
    toPlayer: (player: EffectPlayerRef) => EffectOp,
    creatures?: PermanentSweepSelector
): EffectOp[] {
    return [
        {
            op: "forEach",
            // CR 702.9a — the creature half may be narrowed ("each creature
            // without flying and each player").
            select: creatures ?? {
                set: "permanents",
                zone: "battlefield",
                filter: { type: "Creature" },
            },
            effects: [toCreature({ ref: "$each" })],
        },
        {
            op: "forEach",
            select: { set: "players" },
            effects: [toPlayer({ ref: "$each" })],
        },
    ];
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
        another: boolean = false,
        sweptSet: boolean | "narrowed" = false
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
        // CR 601.2c — a swept group ("each of X targets") is read through
        // `forEach { set: "targets" }`, which iterates whatever was announced,
        // so like a divided group it needs no positional slot; it too must be
        // the ONLY group, since the sweep spans the whole flat target list.
        // A "narrowed" sweep (`forEach { set: "targets", zone }`) reads only
        // its own group's picks, so an earlier group (the opponent whose board
        // bounds it) does not enter the set.
        // The sweep reads EVERY graveyard card the spell announced, so an
        // earlier group that can name one would be swept with it.
        if (
            sweptSet === "narrowed" &&
            this.groups.some(
                (g) => g.zone !== undefined && g.zone !== "battlefield"
            )
        )
            return unlowerable(
                "a swept graveyard group after another graveyard group would sweep both (CR 601.2c)"
            );
        if (sweptSet === true && this.groups.length > 0)
            return unlowerable(
                "a swept target group after another target group would sweep both (CR 601.2c)"
            );
        if (slots === null && !divided && !sweptSet)
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

    /**
     * CR 702.33g + CR 115.2 — a kicker gate that REPLACES the spell target's
     * mana-value limit ("counter that spell if its mana value is 4 or less
     * instead"). The kicked announcement is the base requirement with the new
     * limit, swapped in at cast (`kickedTargetRequirement`); the width is the
     * same either way, so no positional slot moves. Refused unless the base is
     * the one group, a spell target already carrying a limit to replace.
     */
    swapKickedMvLimit(mvMax: number): Lowered<true> {
        const base = this.groups[0];
        if (
            this.kicked !== undefined ||
            this.groups.length !== 1 ||
            base === undefined ||
            base.type !== "spell" ||
            base.mvFilter?.max === undefined
        )
            return unlowerable(
                "a kicked mana-value limit replaces the limit of the one spell target (CR 702.33g)"
            );
        this.kicked = { ...base, mvFilter: { max: mvMax } };
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

    /**
     * CR 603.3d — a walk for a REFLEXIVE ability's body: its targets are
     * announced when it goes on the stack, independently of the resolving
     * ability's, so it allocates from its own slots (index 0 is ITS first
     * target); binding names stay script-wide unique.
     */
    reflexive(): SentenceWalk {
        return new SentenceWalk(new TargetSlots(), this.binds);
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
        /** A `destroy`, `exile` or announced-target `moveZone` — each carries `bind`. */
        readonly op: { op: string; bind?: string };
        readonly requirement: TargetRequirement;
    } | null = null;

    /**
     * CR 111.1 / CR 400.7j — the ONE object the last sentence that put
     * something onto the battlefield put there without targeting it (a token
     * created, the top creature card of a graveyard returned), with the Op
     * that did it: the referent of "that creature" and of "it" in the
     * sentences after it ("Exile it at the beginning of the next end step").
     * The Op is kept so a reader can give it the `bind` that names the new
     * object (the same lazy binding `actedOn` uses). `slots` is the number of
     * target slots announced before it; a later announcement is a nearer
     * antecedent and clears it.
     */
    introduced: {
        readonly op: { bind?: string };
        readonly creature: boolean;
        readonly slots: number;
    } | null = null;

    /**
     * CR 608.2c — the `distributeCountersAsChosen` Op the LAST sentence
     * lowered to, with the counter kind it put on: the antecedent of "each
     * counter you put on a creature this way". The Op is kept so the reader
     * can give it the `bind` that records the counters actually placed; any
     * other sentence in between forgets it (`lowerSentence`).
     */
    distributed: {
        readonly op: { bind?: string };
        readonly counter: string;
    } | null = null;

    /**
     * CR 608.2c — an earlier sentence dealt damage to the ONE announced target
     * (slot 0): the antecedent of "dealt damage this way". Set by the
     * `deal-damage` lowering only.
     */
    damagedTarget = false;

    /** A destroy/exile/move sat behind a gate, so no live read of its target is safe. */
    gatedRemoval = false;

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
    // CR 303.4b / CR 115.10 — the Aura's host is named by the ability's own
    // text, never announced, so no slot is consumed: `$host` is the attachment
    // snapshot every ability site is seeded with (issue #1341). Reached only
    // from the pump and keyword-grant verbs, the only two that parse it.
    if (subject.kind === "host") return lowered([{ ref: "$host" }]);
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
    // CR 608.2h — "that creature" names what the head named, unless an earlier
    // announced target is the nearer antecedent. A creature an earlier
    // sentence put onto the battlefield is nearer than the targets announced
    // before it (`SiteAntecedents.creatureAfterSlots`).
    if (subject.kind === "that-creature") {
        if (
            slots.requirements().length >
            (site.antecedents?.creatureAfterSlots ?? 0)
        )
            return unlowerable(
                '"that creature" follows an announced target, which is the nearer antecedent (CR 608.2h)'
            );
        const creature = site.antecedents?.creature;
        return creature !== undefined
            ? lowered([creature])
            : unlowerable('"that creature" names no creature at this site');
    }
    if (subject.kind === "player")
        return unlowerable("a player is not an object (CR 109.1)");
    // CR 400.7e — "that card" is a card in a graveyard, which only a zone
    // change can act on; `lowerMoveZone` binds it, every other verb refuses.
    if (subject.kind === "that-card")
        return unlowerable('"that card" is read only as a returned card');
    // CR 701.6a — "that spell" is read only by the counter verb.
    if (subject.kind === "that-spell")
        return unlowerable('"that spell" is read only as a countered spell');
    // CR 115.1 — a sweep announces nothing, so there is no slot to point at;
    // only the verbs that fan out (`sweepOps`) read one.
    if (subject.kind === "mass")
        return unlowerable("a sweep is not a single object (CR 110.1)");
    // CR 120.3 — the same two-set union, and the same reason: it names TWO
    // disjoint recipients, so there is no ONE slot to point at. Only
    // `deal-damage` and `prevent-next-damage` read it, and their own lowering
    // branches on the kind before reaching this helper.
    if (subject.kind === "each-creature-and-player")
        return unlowerable(
            "each creature and each player is two recipient sets, not one object (CR 120.3)"
        );
    if (subject.kind === "each-opponent-and-their-creatures")
        return unlowerable(
            "each opponent and their creatures is two recipient sets, not one object (CR 120.3)"
        );
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
    // CR 107.3 — "with mana value X" reads the X the source announced; a
    // source with no {X} would silently read 0.
    if (
        (subject.requirement.mvFilter?.equals === "X" ||
            subject.requirement.mvFilter?.max === "X") &&
        !site.allowX
    )
        return unlowerable(
            "a target filter reads X but its source announces no {X} (CR 107.3)"
        );
    const first = slots.allocate(subject.requirement, subject.another === true);
    if (!first.ok) return first;
    return lowered(
        Array.from({ length: width }, (_, i) => ({ target: first.value + i }))
    );
}

/**
 * CR 702.34a / 514.2 (issue #4756) — "target instant or sorcery card in your
 * graveyard gains flashback until end of turn. The flashback cost is equal to
 * its mana cost." lowers to ONE `grantFlashback` on the announced slot.
 *
 * Read for exactly the subject the corpus prints: ONE target card in YOUR
 * graveyard whose type is instant, sorcery, or either. CR 702.34a lets a
 * flashback cast happen only "if the resulting spell is an instant or sorcery
 * spell", so a wider type ("target card") would grant a Flashback the card
 * could never use; another player's graveyard and "up to" counts are
 * neighbours no card prints, refused rather than guessed.
 */
function lowerGrantFlashback(
    subject: SubjectIR,
    slots: TargetSlots,
    site: SiteOptions
): Lowered<EffectOp[]> {
    if (
        subject.kind !== "target" ||
        subject.requirement.zone !== "graveyard" ||
        subject.requirement.controller !== "you"
    )
        return unlowerable(
            "a flashback grant is read for a target card in your graveyard (CR 702.34a)"
        );
    if (subject.requirement.count !== 1)
        return unlowerable(
            "a flashback grant is read for exactly one target (CR 702.34a)"
        );
    if (
        !announcedTypes(subject.requirement).every(
            (type) => type === "Instant" || type === "Sorcery"
        )
    )
        return unlowerable(
            "a flashback grant is read for an instant or sorcery card (CR 702.34a)"
        );
    const card = objectSelector(subject, slots, site, "zone-change");
    if (!card.ok) return card;
    if (!("target" in card.value))
        return unlowerable(
            "a flashback grant names an announced target (CR 702.34a)"
        );
    return lowered([{ op: "grantFlashback", card: card.value }]);
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

/** CR 115.1 / 205.1a — the ONE announced creature a chosen-type change
 *  reaches; any other subject shape would silently drop recipients. */
function chosenTypeSelector(
    subject: SubjectIR,
    slots: TargetSlots
): Lowered<EffectObjectSelector> {
    if (subject.kind !== "target")
        return unlowerable(
            "a chosen-type change is read only on an announced target (CR 115.1)"
        );
    const requirement = subject.requirement;
    if (
        requirement.type !== "Creature" ||
        requirement.count !== 1 ||
        (requirement.zone !== undefined && requirement.zone !== "battlefield")
    )
        return unlowerable(
            "a chosen-type change reaches ONE creature on the battlefield (CR 110.1, CR 205.1a)"
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
    slots: TargetSlots,
    site: SiteOptions
): Lowered<{ target: number } | { ref: string }> {
    // CR 603.2 + CR 608.2h — "counter it": the spell the head's event named,
    // unless an announced target is the nearer antecedent.
    if (subject.kind === "pronoun") {
        if (slots.requirements().length > 0)
            return unlowerable(
                '"it" follows an announced target, which is the nearer antecedent (CR 608.2h)'
            );
        const spell = site.antecedents?.spell;
        return spell !== undefined
            ? lowered(spell)
            : unlowerable('"it" names no spell at this site');
    }
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
        // CR 102.2 — the opponents of the head's player; the two-player
        // engine (ADR 0010) has exactly one per player.
        case "opponents-of-that-player": {
            if (slots.requirements().some((r) => r.type === "player"))
                return unlowerable(
                    '"that player" may name the announced target, not the head\'s player'
                );
            const named = site.antecedents?.player;
            return named !== undefined
                ? lowered({ opponentOf: named })
                : unlowerable('"that player" names no player at this site');
        }
        case "defending-player":
            return site.antecedents?.defendingPlayer !== undefined
                ? lowered(site.antecedents.defendingPlayer)
                : unlowerable(
                      '"defending player" names no player at this site'
                  );
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
        // Resolved by the damage lowering, which owns the walk it reads.
        case "that-creature-controller":
            return unlowerable(
                '"that creature\'s controller" is read only as a damage recipient'
            );
        case "acted-on-controller":
            return unlowerable(
                '"its controller" is read only as a life recipient'
            );
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
    const introduced = walk.introduced;
    const distributed = walk.distributed;
    const out = lowerSentenceBody(
        sentence,
        walk,
        announcedCreatureSite(
            sentence,
            walk,
            introducedCreatureSite(sentence, walk, site)
        )
    );
    // CR 608.2h — "that creature" names the object the LAST sentence acted
    // on. A sentence that announced a new target without recording itself
    // (a tap, a pump) makes the older referent stale, so it is dropped rather
    // than read past: an X read off the wrong object is a silent misread.
    if (
        walk.targets.requirements().length !== announced &&
        walk.actedOn === actedOn
    )
        walk.actedOn = null;
    // CR 608.2h — the object an earlier sentence put onto the battlefield is
    // the nearest antecedent only until some OTHER sentence intervenes: one
    // that creates several tokens, returns other cards, announces a target or
    // sits behind a gate may each have introduced a nearer one. So the
    // referent survives only the sentence that set it and the sentences that
    // read it; every other sentence forgets it, and a later "it" is refused
    // rather than bound to a guess.
    if (
        walk.introduced === introduced &&
        (walk.targets.requirements().length !== announced ||
            !readsIntroduced(sentence, introduced))
    )
        walk.introduced = null;
    // CR 608.2c — "this way" names the distribution of the sentence right
    // before; any other sentence in between makes the reference stale.
    if (
        walk.distributed === distributed &&
        sentence.kind !== "delayed-remove-distributed-counters"
    )
        walk.distributed = null;
    return out;
}

/** The sentences that name `SentenceWalk.introduced` and so keep it alive. */
function readsIntroduced(
    sentence: EffectSentenceIR,
    introduced: SentenceWalk["introduced"]
): boolean {
    if (introduced === null) return false;
    if (sentence.kind === "delayed-removal") return true;
    return introduced.creature && mentionsThatCreature(sentence);
}

/**
 * CR 608.2h + CR 400.7j — a sentence reading "that creature" after an earlier
 * sentence put ONE creature onto the battlefield names THAT creature (Shallow
 * Grave's "That creature gains haste until end of turn"), the nearer
 * antecedent than anything the head named. The site is rebound for that
 * sentence only, and the introducing Op is given its `bind` only when a
 * sentence actually reads it, so a script that never names the object binds
 * nothing.
 */
function introducedCreatureSite(
    sentence: EffectSentenceIR,
    walk: SentenceWalk,
    site: SiteOptions
): SiteOptions {
    const introduced = walk.introduced;
    if (
        introduced === null ||
        !introduced.creature ||
        !mentionsThatCreature(sentence)
    )
        return site;
    // A head that names a creature or object of its own ("Whenever a creature
    // you control attacks, create a token. That creature …") leaves two
    // candidates. Refused rather than guessed: the site loses its creature,
    // so the subject finds none.
    if (headNamesAnObject(site)) {
        return {
            ...site,
            antecedents: { ...site.antecedents, creature: undefined },
        };
    }
    const bind = introduced.op.bind ?? walk.nextBind("that");
    introduced.op.bind = bind;
    return {
        ...site,
        antecedents: {
            ...site.antecedents,
            creature: { ref: bind },
            creatureAfterSlots: introduced.slots,
        },
    };
}

/**
 * CR 608.2c — a sentence reading "that creature" after the script announced
 * ONE creature target names THAT target ("Target creature can't be
 * regenerated this turn. Damage that would be dealt to that creature …"),
 * the nearer antecedent than anything the head named. Rebound for that
 * sentence only, and only when the target is the sole candidate: a creature
 * an earlier sentence put onto the battlefield, an object the site's own text
 * named, or an earlier destroy or move of the target (it is no longer where
 * the slot points) each leave the word ambiguous or stale, and the site is
 * left as it was, so the subject is refused rather than bound to a guess.
 */
function announcedCreatureSite(
    sentence: EffectSentenceIR,
    walk: SentenceWalk,
    site: SiteOptions
): SiteOptions {
    if (
        walk.introduced !== null ||
        walk.actedOn !== null ||
        !mentionsThatCreature(sentence) ||
        headNamesAnObject(site) ||
        site.antecedents?.headSubjectIsObject === true ||
        soleAnnouncedCreature(walk) === null
    )
        return site;
    return {
        ...site,
        antecedents: {
            ...site.antecedents,
            creature: { target: 0 },
            creatureAfterSlots: 1,
        },
    };
}

/**
 * CR 608.2c — the ONE creature target the script has announced, when it is
 * the only announcement and no gate sits in front of a removal of it: the
 * referent of a later "that creature". Null on every other walk.
 */
function soleAnnouncedCreature(walk: SentenceWalk): TargetRequirement | null {
    const announced = walk.targets.requirements();
    const only = announced.length === 1 ? announced[0]! : null;
    if (
        only === null ||
        only.type !== "Creature" ||
        only.count !== 1 ||
        only.zone !== undefined ||
        only.announcedOnlyIfKicked === true ||
        walk.gatedRemoval
    )
        return null;
    return only;
}

/** CR 608.2h — the site's own text named a creature or object a later
 *  pronoun may still mean, beside the one an earlier sentence introduced. */
function headNamesAnObject(site: SiteOptions): boolean {
    const named = site.antecedents;
    return (
        named?.creature !== undefined ||
        named?.object !== undefined ||
        named?.headNamedObject === true
    );
}

/** True when a `that-creature` subject sits anywhere in the sentence's IR. */
function mentionsThatCreature(node: unknown): boolean {
    if (typeof node !== "object" || node === null) return false;
    if ((node as { kind?: unknown }).kind === "that-creature") return true;
    return Object.values(node).some(mentionsThatCreature);
}

function lowerSentenceBody(
    sentence: EffectSentenceIR,
    walk: SentenceWalk,
    site: SiteOptions
): Lowered<EffectOp[]> {
    const slots = walk.targets;
    // The Verb Frame layer (`verbFrames.ts`): a sentence read as frames
    // carries no kind and lowers frame by frame, one Op each.
    if (sentence.kind === undefined)
        return lowerFrameChain(sentence, walk, site);
    switch (sentence.kind) {
        case "pump": {
            if (sentence.perOtherAttacking !== undefined) {
                // CR 508.1 — "other" excludes the SOURCE, so the pumped
                // object must be the source for the tally to mean the same
                // thing as the pump.
                const target = objectSelector(sentence.subject, slots, site);
                if (!target.ok) return target;
                if (JSON.stringify(target.value) !== '{"ref":"$source"}')
                    return unlowerable(
                        '"for each other attacking" counts the pumped source'
                    );
                const subtype = sentence.perOtherAttacking;
                const step = (n: number): EffectSignedValue => {
                    if (n === 0) return 0;
                    const count: EffectValue = {
                        count: {
                            zone: "battlefield",
                            acrossAllPlayers: true,
                            filter: {
                                type: "Creature",
                                subtype,
                                isAttacking: true,
                                excludeSource: true,
                            },
                            ...(Math.abs(n) > 1 ? { times: Math.abs(n) } : {}),
                        },
                    };
                    return n < 0 ? { negate: count } : count;
                };
                return lowered([
                    {
                        op: "pump",
                        target: target.value,
                        power: step(sentence.power),
                        toughness: step(sentence.toughness),
                        duration: durationSpec(sentence.duration),
                    },
                ]);
            }
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
            const { power, toughness } = sentence;
            // CR 205.1b + CR 613.1d — the source's own animation: one op on
            // `$source`, carrying the type line the clause printed.
            if (sentence.self !== undefined) {
                const { subtype, additionalTypes, colors, keyword, quoted } =
                    sentence.self;
                // CR 113.1a + CR 613.1f — a quoted ability rides a second Op
                // on the same source and duration, as `grantAbility`'s
                // activated leg reads the template off the source.
                let grantedActivatedId: string | undefined;
                if (quoted !== undefined) {
                    if (site.grantQuotedAbility === undefined)
                        return unlowerable(
                            "a quoted ability granted where no card template can carry it"
                        );
                    if (quoted.ability.kind !== "activated")
                        return unlowerable(
                            "an animation grants an activated ability only"
                        );
                    const id = site.grantQuotedAbility(quoted);
                    if (!id.ok) return id;
                    grantedActivatedId = id.value;
                }
                return lowered([
                    {
                        op: "animate",
                        target: { ref: "$source" },
                        power,
                        toughness,
                        subtype,
                        ...(additionalTypes.length > 0
                            ? { additionalTypes: [...additionalTypes] }
                            : {}),
                        ...(colors.length > 0 ? { colors: [...colors] } : {}),
                        ...(keyword !== undefined
                            ? { grantedAbilities: [keyword.ability] }
                            : {}),
                        duration: durationSpec(sentence.duration),
                    },
                    ...(grantedActivatedId !== undefined
                        ? [
                              {
                                  op: "grantAbility" as const,
                                  target: { ref: "$source" as const },
                                  grantedActivatedId,
                                  duration: durationSpec(sentence.duration),
                              },
                          ]
                        : []),
                ]);
            }
            if (sentence.subject.kind !== "mass")
                return unlowerable(
                    "an animation reads a sweep, not one object"
                );
            return sweepOps(sentence.subject, site, slots, (target) => ({
                op: "animate",
                target,
                power,
                toughness,
                duration: durationSpec(sentence.duration),
            }));
        }
        // CR 205.1a + CR 613.1d — the source's type line is replaced,
        // indefinitely (no `duration`): the same four Ops Oko's "becomes a
        // green Elk creature with base power and toughness 3/3" is written in.
        case "become-creature": {
            if (sentence.subject.kind !== "self")
                return unlowerable(
                    "a type-line replacement is lowered on the source only"
                );
            const target = { ref: "$source" as const };
            return lowered([
                { op: "setCardTypes", target, types: ["Creature"] },
                { op: "setSubtype", target, subtypes: [sentence.subtype] },
                ...(sentence.colors.length > 0
                    ? [
                          {
                              op: "setColor" as const,
                              target,
                              colors: [...sentence.colors],
                          },
                      ]
                    : []),
                {
                    op: "setBasePT",
                    target,
                    power: sentence.power,
                    toughness: sentence.toughness,
                },
            ]);
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
        case "grant-flashback":
            return lowerGrantFlashback(sentence.subject, slots, site);
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
            // CR 202.3 — the magnitude may be the mana value of the object an
            // earlier sentence acted on, which only the walk can resolve
            // (Orim's Thunder, issue #4221).
            // CR 107.1 — or a counted set ("equal to the number of Mountains
            // you control"), which needs the walk's target slots.
            const amount = lowerLifeAmount(sentence.amount, walk, site);
            if (!amount.ok) return amount;
            // CR 120.1 + CR 608.2h — "That artifact deals damage …": the
            // dealer is the object an earlier sentence acted on, its last
            // known information read off that Op's `bind` (Goblin Tinkerer).
            if (sentence.sourceIsActedOn !== undefined) {
                const source = actedOnDealer(sentence.sourceIsActedOn, walk);
                if (!source.ok) return source;
                const to = damageTarget(sentence.to, slots, site);
                if (!to.ok) return to;
                return lowered([
                    {
                        op: "dealDamage",
                        amount: amount.value,
                        to: to.value,
                        source: source.value,
                    },
                ]);
            }
            // CR 120.3 + CR 109.5 — "to each opponent and each creature they
            // control": both sets are dealt the damage at once, which is what
            // the no-target `dealDamageToEach` Op is (one primitive call over
            // the whole recipient set), not a pair of sequential sweeps.
            if (sentence.to.kind === "each-opponent-and-their-creatures")
                return lowered([
                    {
                        op: "dealDamageToEach",
                        amount: amount.value,
                        creatures: { controller: "opponent" },
                        players: "opponent",
                    },
                ]);
            // CR 120.3 — "to each creature and each player" names two
            // disjoint recipient sets; `dealDamage.to` names one, so this
            // fans out into a pair of sweeps instead of a single Op.
            if (sentence.to.kind === "each-creature-and-player")
                return lowered(
                    eachCreatureAndPlayerOps(
                        (target) => ({
                            op: "dealDamage",
                            amount: amount.value,
                            to: target,
                        }),
                        (player) => ({
                            op: "dealDamage",
                            amount: amount.value,
                            to: { player },
                        }),
                        sentence.to.creatures
                    )
                );
            // CR 120.3 + CR 702.9a — "to each creature without flying": one sweep.
            if (sentence.to.kind === "mass")
                return sweepOps(sentence.to, site, slots, (target) => ({
                    op: "dealDamage",
                    amount: amount.value,
                    to: target,
                }));
            const to =
                sentence.to.kind === "player" &&
                sentence.to.player.kind === "that-creature-controller"
                    ? lowerThatCreatureController(walk)
                    : damageTarget(sentence.to, slots, site);
            if (!to.ok) return to;
            const damaged = to.value as { target?: number };
            if (
                damaged.target === 0 &&
                walk.targets.requirements().length === 1
            )
                walk.damagedTarget = true;
            // CR 615.12 + CR 614.9 — "If {self} would deal damage to a creature,
            // that damage can't be prevented or dealt instead to another
            // permanent or player": the lock holds only when the target IS a
            // creature (`objectMatchesFilter` reads the live target, false for
            // a player or a creature that already left), else ordinary damage.
            if (sentence.creatureDamageLock === true) {
                if (damaged.target === undefined)
                    return unlowerable(
                        "a creature damage lock needs a target slot to test"
                    );
                return lowered([
                    {
                        op: "if",
                        predicate: {
                            objectMatchesFilter: { target: damaged.target },
                            filter: { type: "Creature" },
                        },
                        then: [
                            {
                                op: "dealDamage",
                                amount: amount.value,
                                to: to.value,
                                unpreventable: true,
                                unredirectable: true,
                            },
                        ],
                        else: [
                            {
                                op: "dealDamage",
                                amount: amount.value,
                                to: to.value,
                            },
                        ],
                    },
                ]);
            }
            return lowered([
                { op: "dealDamage", amount: amount.value, to: to.value },
            ]);
        }
        case "deal-damage-each-player-count": {
            // CR 101.4 + CR 120.1 — a `forEach` over the players (APNAP), each
            // dealt the count of the set THEY control, scaled by `times`.
            const spec = lowerCountedSet(sentence.set, slots, site);
            if (!spec.ok) return spec;
            return lowered([
                {
                    op: "forEach",
                    select: { set: "players" },
                    effects: [
                        {
                            op: "dealDamage",
                            amount: {
                                count: {
                                    ...spec.value,
                                    controller: { ref: "$each" },
                                    ...(sentence.times === 1
                                        ? {}
                                        : { times: sentence.times }),
                                },
                            },
                            to: { player: { ref: "$each" } },
                        },
                    ],
                },
            ]);
        }
        case "return-up-to-x-bounded-targets": {
            // CR 601.2c — "as you cast this spell" is the moment the count is
            // fixed; an ability has no cast to read it at.
            if (site.resolvingSpell !== true)
                return unlowerable(
                    '"as you cast this spell" names no spell at this site (CR 601.2c)'
                );
            // CR 107.3 — the count the "where X is" tail defines, over the
            // permanents the announced opponent controls.
            const filter = boundCountFilter(sentence.counted);
            if (!filter.ok) return filter;
            // CR 601.2c — the opponent is announced FIRST so the graveyard
            // group's bound can read their board (`{ target: slot }`).
            const opponent = slots.allocate({
                type: "player",
                count: 1,
                controller: "opponent",
            });
            if (!opponent.ok) return opponent;
            const requirement = targetRequirementFromDescriptor(
                sentence.cards,
                {
                    min: 0,
                    max: {
                        count: {
                            zone: "battlefield",
                            controller: { target: opponent.value },
                            filter: filter.value,
                        },
                    },
                }
            );
            if (!requirement.ok) return requirement;
            // The width is a fact about the cast: the group takes no
            // positional slot and the move reads the announced graveyard set.
            const index = slots.allocate(requirement.value, false, "narrowed");
            if (!index.ok) return index;
            return lowered([
                {
                    op: "forEach",
                    select: { set: "targets", zone: "graveyard" },
                    effects: [
                        {
                            op: "moveZone",
                            target: { ref: "$each" },
                            // A graveyard-card member names a card that is
                            // not a battlefield object: `from` re-derives it
                            // in the graveyard when the move runs.
                            from: "graveyard",
                            to: "hand",
                        },
                    ],
                },
            ]);
        }
        case "deal-damage-each-of-x-targets": {
            // CR 120.1 / 608.2h — the same dealer rule as `deal-damage`.
            if (sentence.sourceIsPronoun === true && !pronounIsSource(site))
                return unlowerable(
                    '"it deals damage" names a dealer that is not this ability\'s source (CR 120.1)'
                );
            const amount = lowerAmount(sentence.amount, site);
            if (!amount.ok) return amount;
            // CR 601.2c — the group's width IS the announced X, so the site
            // must announce one; the same gate the amount's "X" passes.
            if (!site.allowX)
                return unlowerable(
                    "an effect reads X but its source announces no {X} (CR 107.3)"
                );
            // The width is a fact about the cast: the group takes no
            // positional slot and the damage reads the announced set.
            const index = slots.allocate(
                { type: "any", count: "X" },
                false,
                true
            );
            if (!index.ok) return index;
            // CR 120.3 — each member of the announced set is dealt the whole
            // amount, one `dealDamage` per member.
            return lowered([
                {
                    op: "forEach",
                    select: { set: "targets" },
                    effects: [
                        {
                            op: "dealDamage",
                            amount: amount.value,
                            to: { ref: "$each" },
                        },
                    ],
                },
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
        case "distribute-counters": {
            // CR 601.2d — the counters twin of `deal-damage-divided`, the same
            // single divided group. The budget is a printed number: every
            // corpus "Distribute X …" defines X in a clause this sentence does
            // not read ("where X is …", a cast-time count), so X is refused.
            if (sentence.amount.kind !== "fixed")
                return unlowerable(
                    "a distributed budget is a printed number (CR 601.2d)"
                );
            const total = sentence.amount.value;
            const index = slots.allocate({
                ...sentence.among,
                count: dividedCount(sentence.among.count, total),
                divideAsChosen: { total, kind: "counters" },
            });
            if (!index.ok) return index;
            const op: Extract<EffectOp, { op: "distributeCountersAsChosen" }> =
                {
                    op: "distributeCountersAsChosen",
                    counter: sentence.counter,
                    total,
                };
            walk.distributed = { op, counter: sentence.counter };
            return lowered([op]);
        }
        case "delayed-remove-distributed-counters": {
            // CR 603.7a — the delayed trigger is created now; "this way"
            // (CR 608.2c) names the counters the sentence before put on, which
            // its Op records one entry per counter placed. The list is frozen
            // at scheduling and walked at fire time, one counter off each
            // entry's creature; a creature gone by then is skipped (CR 603.7c).
            const distributed = walk.distributed;
            if (distributed === null)
                return unlowerable(
                    '"put on a creature this way" names no counters an earlier sentence distributed (CR 608.2c)'
                );
            if (distributed.counter !== sentence.counter)
                return unlowerable(
                    `"${sentence.counter}" counters were not the ones distributed this way (CR 608.2c)`
                );
            const bind = distributed.op.bind ?? walk.nextBind("placed");
            distributed.op.bind = bind;
            const step =
                sentence.timing === "next-cleanup-step"
                    ? "cleanup step"
                    : "end step";
            return lowered([
                {
                    op: "delayedTrigger",
                    timing: sentence.timing,
                    oracleText: `For each ${sentence.counter} counter you put on a creature this way, remove a ${sentence.counter} counter from that creature at the beginning of the next ${step}.`,
                    capture: {
                        $placed: { select: { set: "bound", ref: bind } },
                    },
                    effects: [
                        {
                            op: "forEach",
                            select: { set: "bound", ref: "$placed" },
                            effects: [
                                {
                                    op: "counters",
                                    action: "remove",
                                    counter: sentence.counter,
                                    target: { ref: "$each" },
                                    count: 1,
                                },
                            ],
                        },
                    ],
                },
            ]);
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
            // CR 120.3 — the same two-set fan-out `deal-damage` reads.
            if (sentence.to.kind === "each-creature-and-player")
                return lowered(
                    eachCreatureAndPlayerOps(
                        (target) => ({
                            op: "preventDamage",
                            mode: "next-n",
                            to: target,
                            amount: sentence.amount,
                            duration: durationSpec(sentence.duration),
                        }),
                        (player) => ({
                            op: "preventDamage",
                            mode: "next-n",
                            to: { player },
                            amount: sentence.amount,
                            duration: durationSpec(sentence.duration),
                        })
                    )
                );
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
        // CR 609.7a / 615.1a — "the next time a <qualifier> source of your
        // choice would deal damage to you this turn, prevent that damage": a
        // `pick-source` choice over every permanent and every spell on the
        // stack (never a target — the ability announces none), then a
        // one-event shield keyed on the picked id. The qualifier is the
        // choice's filter: one colour as itself, two as "any of them", a card
        // type as `type`.
        case "prevent-next-damage-from-chosen-source": {
            const bind = walk.nextBind("source");
            const { colors, cardType } = sentence;
            const filter: EffectCardFilter = {
                ...(colors === undefined
                    ? {}
                    : {
                          color: colors.length === 1 ? colors[0]! : [...colors],
                      }),
                ...(cardType === undefined ? {} : { type: cardType }),
            };
            // CR 609.7b — the same qualifier, rechecked by the shield when
            // the chosen source would deal damage.
            const match = {
                ...(colors === undefined ? {} : { colors: [...colors] }),
                ...(cardType === undefined ? {} : { cardType }),
            };
            const article = /^[aeiou]/.test(sentence.phrase) ? "an" : "a";
            return lowered([
                {
                    op: "choice",
                    kind: "pick-source",
                    player: "controller",
                    zone: "battlefield-or-stack",
                    ...(Object.keys(filter).length === 0 ? {} : { filter }),
                    count: 1,
                    prompt: `Choose ${article} ${sentence.phrase}.`,
                    bind,
                },
                {
                    op: "preventDamage",
                    mode: "next-from-source",
                    source: { ref: bind },
                    to: { player: "controller" },
                    duration: durationSpec(sentence.duration),
                    ...(Object.keys(match).length === 0 ? {} : { match }),
                },
            ]);
        }
        // CR 615.1a — the two-way combat shield on the ability's own source.
        // Only `this creature` is read: a printed announced target would need
        // a slot this clause has no fixture for.
        case "prevent-combat-damage-to-and-by":
            if (sentence.subject.kind !== "self")
                return unlowerable(
                    "a two-way combat prevention shield is read for the ability's own source only (CR 615.1a)"
                );
            return lowered([
                {
                    op: "preventDamage",
                    mode: "combat-to-and-by",
                    target: { ref: "$source" },
                    duration: durationSpec(sentence.duration),
                },
            ]);
        // CR 701.14a — two creatures fight. Each side is a single creature
        // target; the ability's own source ("this creature fights …") is a
        // form with no fixture yet, and a mass or player side is no fight.
        case "fight": {
            for (const side of [sentence.creature, sentence.other])
                if (
                    side.kind !== "target" ||
                    side.requirement.type !== "Creature" ||
                    side.requirement.count !== 1
                )
                    return unlowerable(
                        "a fight is read between a single creature target on each side (CR 701.14a)"
                    );
            const creature = objectSelector(sentence.creature, slots, site);
            if (!creature.ok) return creature;
            const other = objectSelector(sentence.other, slots, site);
            if (!other.ok) return other;
            return lowered([
                { op: "fight", creature: creature.value, other: other.value },
            ]);
        }
        // CR 615.1a + CR 510.2 — the one-way source-side combat shield on an
        // announced object (Kor Haven's "target attacking creature"). The
        // ability's own source is a shape no corpus card prints here.
        case "prevent-combat-damage-by": {
            if (sentence.subject.kind !== "target")
                return unlowerable(
                    "a source-side combat prevention shield is read for an announced target only (CR 615.1a)"
                );
            const source = objectSelector(sentence.subject, slots, site);
            if (!source.ok) return source;
            return lowered([
                {
                    op: "preventDamage",
                    mode: "all-from-source",
                    source: source.value,
                    combatOnly: true,
                },
            ]);
        }
        case "redirect-next-damage": {
            // CR 614.9 / 601.2c — the printed form is TWO instances of the
            // word "target", the second marked "another". The engine announces
            // that as ONE group of count 2 and relies on its own within-group
            // distinctness (CR 601.2c, issue #1951) rather than on
            // `excludePriorTargets`, which merges earlier picks into
            // `excludeInstanceIds` and so keeps only PERMANENT picks — on a
            // recipient group spanning players it would compile and then not
            // be honoured. Fail closed on anything else: both ends must be
            // announced targets with the SAME requirement, and the second must
            // carry the printed "another", or the group would let one recipient
            // be chosen twice and the shield would redirect damage to itself.
            const { from, to } = sentence;
            if (from.kind !== "target" || to.kind !== "target")
                return unlowerable(
                    "a redirection shield names two announced targets (CR 614.9)"
                );
            if (to.another !== true)
                return unlowerable(
                    'a redirection shield\'s destination is "another target" (CR 115.3)'
                );
            if (
                JSON.stringify(from.requirement) !==
                JSON.stringify(to.requirement)
            )
                return unlowerable(
                    "a redirection shield's two recipients are announced as one group, so they must be the same requirement (CR 601.2c)"
                );
            if (from.requirement.count !== 1)
                return unlowerable(
                    "a redirection shield reads a single recipient on each end (CR 614.9)"
                );
            const amount = lowerAmount(sentence.amount, site);
            if (!amount.ok) return amount;
            const first = slots.allocate({
                ...from.requirement,
                count: 2,
            });
            if (!first.ok) return first;
            return lowered([
                {
                    op: "redirectDamage",
                    from: { target: first.value },
                    to: { target: first.value + 1 },
                    amount: amount.value,
                    duration: durationSpec(sentence.duration),
                },
            ]);
        }
        case "draw": {
            const player = playerRef(sentence.player, slots, site);
            if (!player.ok) return player;
            const count = lowerLifeAmount(sentence.count, walk, site);
            if (!count.ok) return count;
            return lowered([
                { op: "draw", player: player.value, count: count.value },
            ]);
        }
        case "destroy": {
            if (sentence.subject.kind === "mass")
                // CR 701.19c — "They can't be regenerated" rides every
                // destroy the sweep fans out.
                return sweepOps(sentence.subject, site, slots, (target) => ({
                    op: "destroy",
                    target,
                    ...(sentence.cantBeRegenerated
                        ? { cantBeRegenerated: true as const }
                        : {}),
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
            if (sentence.manaValueAtMost === undefined)
                return lowered([destroy]);
            // CR 202.3 — the bound is read off the announced
            // target as the spell resolves; an `if` is the whole encoding.
            return lowered([
                {
                    op: "if",
                    predicate: {
                        left: { manaValue: { of: target.value } },
                        op: "le",
                        right: sentence.manaValueAtMost,
                    },
                    then: [destroy],
                },
            ]);
        }
        // CR 701.13a — exile the announced permanent. `bind` is stamped by
        // `recordActedOn` when a later sentence names it (CR 608.2h).
        case "exile": {
            const target = objectSelector(sentence.subject, slots, site);
            if (!target.ok) return target;
            const exile: Extract<EffectOp, { op: "exile" }> = {
                op: "exile",
                target: target.value,
            };
            if (sentence.returnsToBattlefield === true) {
                // CR 400.7 + CR 608.2h — the flicker: the exile binds the
                // object it moved and the return reads that binding from
                // exile (`from: "exile"`), never the target slot, whose
                // object is gone. The returned permanent is a new object, so
                // nothing later reads it as the acted-on target.
                const bind = walk.nextBind("that");
                exile.bind = bind;
                return lowered([
                    exile,
                    {
                        op: "moveZone",
                        target: { ref: bind },
                        from: "exile",
                        to: "battlefield",
                    },
                ]);
            }
            recordActedOn(walk, sentence.subject, exile);
            return lowered([exile]);
        }
        // CR 701.6a — counter the announced spell, with CR 118.12a's punisher
        // when the sentence prints one.
        case "counter": {
            // CR 603.2 + CR 608.2h — "counter that spell" names the spell the
            // head's cast event carried: no announced slot, a ref to the event.
            if (sentence.subject.kind === "that-spell") {
                const spell = site.antecedents?.spell;
                if (spell === undefined)
                    return unlowerable(
                        '"that spell" names no spell at this site'
                    );
                return lowered([{ op: "counter", target: spell }]);
            }
            const target = spellSelector(sentence.subject, slots, site);
            if (!target.ok) return target;
            const counter: Extract<EffectOp, { op: "counter" }> = {
                op: "counter",
                target: target.value,
            };
            // CR 701.6a + CR 113.7a — the Counter rider "destroy that permanent"
            // acts on the SOURCE of a countered ability: the counter binds it,
            // a plain `destroy` reads the binding, and a countered spell binds nothing
            // (so the destroy skips an unwritten binding) — the oracle's own condition.
            if (sentence.destroysCounteredSource === true) {
                const source = walk.nextBind("source");
                counter.bindSource = source;
                return lowered([
                    counter,
                    { op: "destroy", target: { ref: source } },
                ]);
            }
            if (sentence.unlessPays === undefined) return lowered([counter]);
            // CR 118.12a — "[counter] unless [its controller pays]" MEANS
            // "its controller may pay; if they don't, counter it", which is
            // the `mayPay` + `if not` pair verbatim. The tally is Domain read
            // off the effect's OWN controller ("lands YOU control" — CR 109.5
            // names the spell's controller, never the taxed player), and the
            // price is the FOURTH `mayPay` cost leg: a generic amount built
            // from a runtime tally (`genericEqualTo`), never a base cost with
            // a reduction, which has nothing to subtract from.
            // The pronoun form is untaxed only (effectSentence refuses a taxed one).
            if (!("target" in target.value))
                return unlowerable('a taxed "it" names no announced spell');
            const bind = walk.nextBind("may");
            // CR 118.12a — the taxed player is the spell's controller.
            const taxed = { controllerOf: target.value };
            const payment: Extract<EffectOp, { op: "mayPay" }> =
                sentence.unlessPays.kind === "flat"
                    ? {
                          op: "mayPay",
                          player: taxed,
                          // A flat tax is a plain generic `ManaCost`.
                          cost: { X: sentence.unlessPays.amount },
                          prompt: `Pay {${sentence.unlessPays.amount}} to prevent your spell from being countered?`,
                          bind,
                      }
                    : {
                          op: "mayPay",
                          player: taxed,
                          // CR 109.5 — "lands YOU control" is the EFFECT's
                          // controller, never the taxed player; `times` is
                          // absent because the printed price is {1} per land
                          // type and the grammar reads no other
                          // (`COUNTER_DOMAIN_TAX`).
                          cost: {
                              genericEqualTo: { domain: { of: "controller" } },
                          },
                          prompt: `Pay {1} for each basic land type among lands ${site.selfName}'s controller controls to prevent your spell from being countered?`,
                          bind,
                      };
            return lowered([
                payment,
                {
                    op: "if",
                    predicate: { not: { binding: bind } },
                    then: [counter],
                },
            ]);
        }
        // CR 115.7a — change the target of the announced spell.
        case "retarget": {
            const target = spellSelector(sentence.subject, slots, site);
            if (!target.ok) return target;
            if ("ref" in target.value)
                return unlowerable("retarget names an announced spell");
            return lowered([{ op: "retarget", target: target.value }]);
        }
        case "counter-limit-instead":
            return unlowerable(
                'a counter limit "instead" is a kicker gate\'s replacement (CR 702.33g)'
            );
        case "tap-untap": {
            if (sentence.subject.kind === "mass") {
                const action = sentence.action;
                const sweep = sweepOps(
                    sentence.subject,
                    site,
                    slots,
                    (target) => ({
                        op: "tapUntap",
                        action,
                        target,
                    })
                );
                if (sentence.thenDrainsManaPool !== true || !sweep.ok)
                    return sweep;
                // CR 106.4 — "that player" is the announced player `sweepOps`
                // wrote onto the sweep's controller.
                const swept = sweep.value[0];
                const controller =
                    swept?.op === "forEach" && swept.select.set === "permanents"
                        ? swept.select.controller
                        : undefined;
                if (typeof controller !== "object" || !("target" in controller))
                    return unlowerable(
                        '"that player" names no announced player (CR 106.4)'
                    );
                return lowered([
                    ...sweep.value,
                    { op: "drainManaPool", player: controller },
                ]);
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
        case "skip-next-untap": {
            // CR 502.3 — effects can keep a permanent from untapping; one-shot flag.
            const target = objectSelector(sentence.subject, slots, site);
            if (!target.ok) return target;
            return lowered([{ op: "skipNextUntap", target: target.value }]);
        }
        case "regenerate": {
            const target = objectSelector(sentence.subject, slots, site);
            if (!target.ok) return target;
            return lowered([{ op: "regenerate", target: target.value }]);
        }
        case "combat-restriction": {
            const target = objectSelector(sentence.subject, slots, site);
            if (!target.ok) return target;
            return lowered([
                {
                    op: "restrictCombat",
                    restriction: sentence.restriction,
                    target: target.value,
                },
            ]);
        }
        case "forced-block": {
            // CR 509.1c — the blocker is the announced creature; the attacker
            // it must block is the ability's own source.
            const target = objectSelector(sentence.subject, slots, site);
            if (!target.ok) return target;
            return lowered([
                {
                    op: "restrictCombat",
                    restriction: "must-block",
                    target: target.value,
                    attacker: { ref: "$source" },
                },
            ]);
        }
        case "lock-damage": {
            // CR 615.12 + CR 614.9 — both locks on the one recipient.
            const target = objectSelector(sentence.subject, slots, site);
            if (!target.ok) return target;
            return lowered([{ op: "lockDamage", target: target.value }]);
        }
        case "exile-when-dies": {
            // CR 603.7a + CR 700.4 — the delayed trigger is created now and
            // watches the creature; when it dies, the body finds the card it
            // became in the graveyard by the id captured now (`from`), and
            // does nothing if that card has left the graveyard by then
            // (CR 603.7c).
            const watched = objectSelector(sentence.subject, slots, site);
            if (!watched.ok) return watched;
            if (!("target" in watched.value) && !("ref" in watched.value))
                return unlowerable(
                    "the watched creature is neither a target nor a binding"
                );
            return lowered([
                {
                    op: "delayedTrigger",
                    timing: "dies",
                    oracleText:
                        "When the creature dies this turn, exile the creature.",
                    watch: watched.value,
                    capture: { $captured: watched.value },
                    effects: [
                        {
                            op: "moveZone",
                            target: { ref: "$captured" },
                            from: "graveyard",
                            to: "exile",
                        },
                    ],
                },
            ]);
        }
        case "prevent-regeneration": {
            const target = objectSelector(sentence.subject, slots, site);
            if (!target.ok) return target;
            return lowered([
                { op: "preventRegeneration", target: target.value },
            ]);
        }
        case "player-lock": {
            // CR 102.2 — this engine is two-player, so "your opponents" is the
            // one opponent; the lock Op takes the relative player directly.
            const player: Lowered<EffectPlayerRef> =
                sentence.player === "opponents"
                    ? lowered("opponent")
                    : playerRef(
                          sentence.player === "defending"
                              ? { kind: "defending-player" }
                              : { kind: "target", opponent: false },
                          slots,
                          site
                      );
            if (!player.ok) return player;
            return lowered([
                sentence.casting === "all"
                    ? { op: "restrictCasting", player: player.value }
                    : {
                          op: "restrictCasting",
                          player: player.value,
                          cardTypes: [...sentence.casting],
                      },
                ...(sentence.activation
                    ? [
                          {
                              op: "restrictActivation" as const,
                              player: player.value,
                          },
                      ]
                    : []),
            ]);
        }
        case "land-play-lock": {
            // CR 305.1 + CR 101.2 — "Target player can't play lands this turn".
            const player = playerRef(
                { kind: "target", opponent: false },
                slots,
                site
            );
            if (!player.ok) return player;
            return lowered([{ op: "restrictLandPlay", player: player.value }]);
        }
        // CR 613.1b — the effect's controller gains control of the announced
        // permanent; CR 611.2b's "for as long as you control <this>" is the
        // `while-you-control-source` condition, absent = indefinite.
        case "gain-control": {
            const target = objectSelector(sentence.subject, slots, site);
            if (!target.ok) return target;
            return lowered([
                {
                    op: "gainControl",
                    target: target.value,
                    controller: "controller",
                    ...(sentence.whileYouControlSource
                        ? { duration: "while-you-control-source" as const }
                        : {}),
                },
            ]);
        }
        // CR 701.12a — control of the source and of the announced permanent is
        // exchanged, or neither moves: both `gainControl` Ops sit behind one
        // gate that needs the source in play and the announced slot filled
        // and legal (a blanked or never-filled slot reads false, CR 608.2b).
        // CR 701.21a — otherwise the source is sacrificed. No new Op: the
        // pair is the decomposition the Mechanics Registry's `exchange` row
        // prescribes.
        case "exchange-control": {
            if (
                sentence.sacrificeUnlessExchanged !== true ||
                sentence.resolvesIfTargetIllegal !== true
            )
                return {
                    ok: false,
                    reason: "an exchange of control is read only with its sacrifice fallback and its resolves-if-illegal rider",
                };
            if (site.resolvesIfTargetsIllegal !== true)
                return {
                    ok: false,
                    reason: "only a triggered ability can still resolve with an illegal target (CR 608.2b)",
                };
            const target = objectSelector(sentence.subject, slots, site);
            if (!target.ok) return target;
            if (!("target" in target.value))
                return {
                    ok: false,
                    reason: "an exchange of control names an announced target slot",
                };
            const source = { ref: "$source" } as const;
            return lowered([
                {
                    op: "if",
                    predicate: {
                        objectMatchesFilter: source,
                        filter: {},
                        controlledBy: "controller",
                    },
                    then: [
                        {
                            op: "if",
                            predicate: {
                                targetIsAnother: {
                                    target: target.value.target,
                                },
                            },
                            then: [
                                {
                                    op: "gainControl",
                                    target: source,
                                    controller: {
                                        controllerOf: {
                                            target: target.value.target,
                                        },
                                    },
                                },
                                {
                                    op: "gainControl",
                                    target: target.value,
                                    controller: "controller",
                                },
                            ],
                            else: [{ op: "sacrifice", target: source }],
                        },
                    ],
                },
            ]);
        }
        // CR 701.3a — the source attaches to the announced permanent.
        case "attach": {
            const target = objectSelector(sentence.subject, slots, site);
            if (!target.ok) return target;
            return lowered([{ op: "attach", target: target.value }]);
        }
        case "life": {
            const player =
                sentence.player.kind === "acted-on-controller"
                    ? lowerActedOnController(sentence.player.noun, walk)
                    : playerRef(sentence.player, slots, site);
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
        case "graveyard-sweep":
            // CR 400.7 — one simultaneous `forEach` over the controller's
            // graveyard cards of the type (Replenish).
            return lowered([
                {
                    op: "forEach",
                    select: {
                        set: "graveyard",
                        controller: "controller",
                        filter: { type: sentence.cardType },
                    },
                    simultaneous: true,
                    effects: [
                        {
                            op: "moveZone",
                            target: { ref: "$each" },
                            to: "battlefield",
                        },
                    ],
                },
            ]);
        case "return-self-from-graveyard":
            // CR 113.6b — only an ability that functions from the graveyard
            // can run this; the triggered site is the one that sets it.
            if (site.functionsFromGraveyard !== true)
                return unlowerable(
                    "returning this card from the graveyard needs an ability that functions there"
                );
            if (sentence.attachedTo === undefined)
                return lowered([
                    {
                        op: "moveZone",
                        target: { ref: "$source" },
                        to: sentence.to,
                    },
                ]);
            // CR 303.4f — the effect specifies the host, so no prompt is raised.
            if (site.antecedents?.enteringCreature === undefined)
                return unlowerable(
                    '"attached to that creature" needs a head that names the creature entering'
                );
            return lowered([
                {
                    op: "moveZone",
                    target: { ref: "$source" },
                    from: "graveyard",
                    to: "battlefield",
                    attachTo: site.antecedents.enteringCreature,
                },
            ]);
        case "each-player-puts":
            return lowerEachPlayerPuts(sentence, site);
        case "create-token":
            return lowerCreateToken(sentence, walk, site);
        case "optional": {
            // CR 603.2 — an optional triggered ability's controller chooses on
            // resolution, and declining does NOTHING. That is a cost-free
            // `mayPay` (its `cost` OMITTED, issue #680) whose REQUIRED boolean
            // bind an `if` reads: no placeholder Op, no empty mode, no fifth
            // structural construct. The inner sentence is lowered by THIS
            // walk, so "you may tap target creature" allocates its slot once,
            // through the shared allocator, exactly as the bare sentence does.
            // CR 603.7a — "you may draw a card at the beginning of the next
            // turn's upkeep" asks at the upkeep, not on this resolution: the
            // gate would decide the schedule instead of the draw.
            if (sentence.effect.kind === "delayed-draw-next-upkeep")
                return unlowerable(
                    "an optional delayed draw is chosen at the delayed trigger, not here"
                );
            // CR 603.2 + CR 400.7 — "you may put a <descriptor> card from
            // your hand onto the battlefield": the pick's 0..1 count IS the
            // "may" (declining picks nothing), the shape every hand-written
            // hand→battlefield drop writes.
            const pick = optionalChosenMove(sentence.effect);
            if (pick !== null)
                return sentence.then === undefined
                    ? lowerOptionalChosenMove(pick, sentence.clause)
                    : unlowerable(
                          '"If you do" behind an optional pick from a zone is not a printed form'
                      );
            const inner = gatedSentence(sentence.effect, walk, site);
            if (!inner.ok) return inner;
            const bind = walk.nextBind("may");
            // CR 118.12 — "[A player] may [do something]. If [that player]
            // does, [effect]": the optional action is a COST paid as the
            // ability resolves, and the effect happens only if it was paid in
            // full (CR 118.3 — a cost the resources do not cover is not paid:
            // a source already gone cannot be sacrificed). Saying yes is not
            // paying, so the gate reads the EVIDENCE the action left — the
            // bind of the Op that moved or sacrificed something (the same gate
            // `sacrifice-source` keeps) — and an action that leaves none
            // (a draw, a life change) is refused rather than gated on the
            // answer alone.
            let paid = inner.value;
            let then: EffectOp[] = [];
            if (sentence.then !== undefined) {
                const evidence = paidEvidence(inner.value, walk);
                if (evidence === null)
                    return unlowerable(
                        '"If you do" reads an optional action that leaves no evidence it was paid (CR 118.12)'
                    );
                const gated =
                    sentence.reflexive === undefined
                        ? gatedSentence(sentence.then, walk, site)
                        : lowerReflexive(
                              sentence.reflexive,
                              sentence.then,
                              walk,
                              site
                          );
                if (!gated.ok) return gated;
                paid = evidence.ops;
                then = [
                    {
                        op: "if",
                        predicate: {
                            boundMatchesFilter: { ref: evidence.bind },
                            filter: {},
                        },
                        then: gated.value,
                    },
                ];
            }
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
                    then: [...paid, ...then],
                },
            ]);
        }
        case "optional-hand-cost-then": {
            // CR 608.2c + CR 701.13a — the hand exile / discard is a `mayPay` HAND cost
            // leg (ADR 0079), so declining it, or an empty hand, leaves the
            // REQUIRED bind false and the gated effect undone.
            const inner = gatedSentence(sentence.effect, walk, site);
            if (!inner.ok) return inner;
            const bind = walk.nextBind("paid");
            return lowered([
                {
                    op: "mayPay",
                    player: "controller",
                    cost: {
                        hand: {
                            action: sentence.action,
                            requirements: [{ filter: {}, count: 1 }],
                        },
                    },
                    prompt: `${sentence.clause}?`,
                    bind,
                },
                {
                    op: "if",
                    predicate: { binding: bind },
                    then: inner.value,
                },
            ]);
        }
        case "draw-then-ranged-topdeck": {
            // CR 121.1 + CR 119.4 + CR 401.4 — draw N, then one ranged 0..M
            // pick among the cards drawn this turn, each card NOT put back on
            // top costing `costPerKept` life. The two printed per-card options
            // ("pay L life" / "put on top") collapse into that one pick: the
            // reachable outcomes are identical (`rangedTopdeck`).
            return lowered([
                {
                    op: "draw",
                    player: "controller",
                    count: sentence.count,
                },
                {
                    op: "rangedTopdeck",
                    player: "controller",
                    pool: "drawn-this-turn",
                    max: sentence.max,
                    costPerKept: sentence.costPerKept,
                },
            ]);
        }
        case "reveal-hand-pick": {
            // CR 701.20a — the hand is revealed to every player first; CR
            // 701.9b — the CONTROLLER picks from it (`zoneOwnerId` names whose
            // hand); the picked card is discarded (CR 701.9a) or exiled (CR
            // 701.13a). The Duress / Thoughtseize template.
            const player = playerRef(sentence.player, slots, site);
            if (!player.ok) return player;
            const bind = walk.nextBind("picked");
            const { filter, phrase } = sentence;
            return lowered([
                { op: "reveal", player: player.value, zone: "hand" },
                {
                    op: "choice",
                    kind: "choose-hand-card",
                    player: "controller",
                    zoneOwnerId: player.value,
                    zone: "hand",
                    ...(Object.keys(filter).length === 0 ? {} : { filter }),
                    count: 1,
                    prompt: `Choose ${phrase} from that player's hand.`,
                    bind,
                },
                sentence.route === "discard"
                    ? {
                          op: "discard",
                          player: player.value,
                          cards: { ref: bind },
                      }
                    : {
                          op: "moveZone",
                          cards: { ref: bind },
                          player: player.value,
                          from: "hand",
                          to: "exile",
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
        case "shuffle-hand-redraw": {
            // CR 701.24a + CR 121.1 — the whole hand goes into the library,
            // the library is shuffled, and as many cards are drawn as the hand
            // held. `bindCount` captures that size as the hand moves: the
            // `draw` after it cannot recount a hand the move has emptied.
            const bind = walk.nextBind("handSize");
            return lowered([
                {
                    op: "moveZone",
                    player: "controller",
                    from: "hand",
                    to: "library",
                    bindCount: bind,
                },
                { op: "libraryLook", action: "shuffle", player: "controller" },
                { op: "draw", player: "controller", count: { ref: bind } },
            ]);
        }
        case "shuffle-own-graveyard-into-library":
            // CR 701.24a + CR 404.1 — the whole graveyard moves to the
            // library, then the library is shuffled (Feldon's Cane's shape).
            return lowered([
                {
                    op: "moveZone",
                    player: "controller",
                    from: "graveyard",
                    to: "library",
                },
                { op: "libraryLook", action: "shuffle", player: "controller" },
            ]);
        case "search-target-library": {
            // CR 701.23a (search) + CR 701.24a (shuffle) — the CONTROLLER
            // looks through the TARGET player's library (`zoneOwnerId`), the
            // found cards leave it for exile (CR 406.1) or that player's
            // graveyard (CR 404.1), and the owner shuffles when the line says
            // so. A plain count is MANDATORY (CR 701.23b: plain "cards" states
            // no quality, so the search must find them); "up to N" is the
            // optional range. The interpreter clamps either to what the
            // library holds (CR 609.3).
            const owner = playerRef(sentence.player, slots, site);
            if (!owner.ok) return owner;
            const bind = walk.nextBind("found");
            const noun =
                (sentence.count === 1
                    ? "a card"
                    : `${countWord(sentence.count)} cards`) +
                (sentence.flashback ? " with flashback" : "");
            return lowered([
                {
                    op: "choice",
                    kind: "search-library",
                    player: "controller",
                    zone: "library",
                    zoneOwnerId: owner.value,
                    // CR 702.34a — "with flashback" narrows what the search
                    // may find to cards carrying a flashback cost.
                    ...(sentence.flashback
                        ? { filter: { hasFlashback: true as const } }
                        : {}),
                    count: sentence.upTo
                        ? { min: 0, max: sentence.count }
                        : sentence.count,
                    prompt: `Search that player's library for ${sentence.upTo ? "up to " : ""}${noun}.`,
                    bind,
                },
                {
                    op: "moveZone",
                    cards: { ref: bind },
                    player: owner.value,
                    from: "library",
                    to: sentence.route,
                },
                ...(sentence.shuffle
                    ? [
                          {
                              op: "libraryLook" as const,
                              action: "shuffle" as const,
                              player: owner.value,
                          },
                      ]
                    : []),
            ]);
        }
        case "upgrade-if-controls":
            return lowerUpgrade(sentence, walk, site);
        case "mill": {
            // CR 701.17a — the top cards of the player's library go to their
            // graveyard. No `bind` unless a pick reads the milled cards back
            // ("a land card was milled this way" is a later sentence the
            // grammar refuses).
            const player = playerRef(sentence.player, slots, site);
            if (!player.ok) return player;
            const count = lowerAmount(sentence.count, site);
            if (!count.ok) return count;
            if (sentence.pick === undefined)
                return lowered([
                    { op: "mill", player: player.value, count: count.value },
                ]);
            return lowerMillPick(
                player.value,
                count.value,
                sentence.pick,
                walk
            );
        }
        case "optional-shuffle-that-player-library": {
            // CR 701.24a + CR 608.2c — "that player" is the player whose
            // library the sentence before looked at; with no such sentence
            // (or a gate that forgot it) it names no one we can.
            const looked = walk.libraryLookedAt;
            if (looked === null)
                return unlowerable(
                    '"that player" names no library announced before it'
                );
            const bind = walk.nextBind("may");
            return lowered([
                {
                    op: "mayPay",
                    player: "controller",
                    prompt: "Have that player shuffle?",
                    bind,
                },
                {
                    op: "if",
                    predicate: { binding: bind },
                    then: [
                        {
                            op: "libraryLook",
                            action: "shuffle",
                            player: looked,
                        },
                    ],
                },
            ]);
        }
        case "shuffle-graveyard-into-library": {
            // CR 404.1 + CR 701.24a — the controller picks up to N cards from
            // the player's graveyard, they go into that player's library,
            // and that library is shuffled. The pick is a `choice` (the
            // cards are not announced targets), its bind read by the move.
            const player = playerRef(sentence.player, slots, site);
            if (!player.ok) return player;
            const bind = walk.nextBind("reclaimed");
            return lowered([
                {
                    op: "choice",
                    kind: "choose-graveyard-card",
                    player: "controller",
                    zoneOwnerId: player.value,
                    zone: "graveyard",
                    count: { min: 0, max: sentence.max },
                    prompt: `Shuffle up to ${sentence.word} target cards from that player's graveyard into their library.`,
                    bind,
                },
                {
                    op: "moveZone",
                    cards: { ref: bind },
                    player: player.value,
                    from: "graveyard",
                    to: "library",
                },
                { op: "libraryLook", action: "shuffle", player: player.value },
            ]);
        }
        case "tap-chosen-per-counter": {
            // CR 701.26a — the named player picks among their own untapped
            // permanents as many as the source has counters (the count is
            // read as the choice is raised), then each is tapped. Routed
            // through `forEach { set: "bound" }` like `untap-chosen-permanents`.
            const player = playerRef(sentence.player, slots, site);
            if (!player.ok) return player;
            const bind = walk.nextBind("tapped");
            return lowered([
                {
                    op: "choice",
                    kind: "choose-permanents",
                    player: player.value,
                    zone: "battlefield",
                    filter: sentence.filter,
                    count: {
                        counters: {
                            of: { ref: "$source" },
                            type: sentence.counterType,
                        },
                    },
                    prompt: `Tap ${sentence.phrase} you control.`,
                    bind,
                },
                {
                    op: "forEach",
                    select: { set: "bound", ref: bind },
                    effects: [
                        {
                            op: "tapUntap",
                            action: "tap",
                            target: { ref: "$each" },
                        },
                    ],
                },
            ]);
        }
        case "untap-chosen-permanents": {
            // CR 701.26b + CR 109.2 — the controller picks up to N permanents
            // from every battlefield (nothing is announced), each is untapped.
            // The pick is routed through `forEach { set: "bound" }` because a
            // `choice` Op's `bind` holds raw picks while `tapUntap.target`
            // wants a selector (the Frantic Search shape).
            const bind = walk.nextBind("untapped");
            return lowered([
                {
                    op: "choice",
                    kind: "choose-permanents",
                    player: "controller",
                    zone: "battlefield",
                    allControllers: true,
                    filter: sentence.filter,
                    count: { min: 0, max: sentence.max },
                    prompt: `${capitalise(sentence.phrase)}.`,
                    bind,
                },
                {
                    op: "forEach",
                    select: { set: "bound", ref: bind },
                    effects: [
                        {
                            op: "tapUntap",
                            action: "untap",
                            target: { ref: "$each" },
                        },
                    ],
                },
            ]);
        }
        case "exile-same-name-library-copies":
            return unlowerable(
                '"For each card exiled this way, search … same name" follows no graveyard exile'
            );
        case "exile-graveyard-and-library-copies": {
            // CR 608.2c + CR 608.2h + CR 400.7 + CR 701.23a — one `forEach`
            // over the player's graveyard (member set frozen at entry), each
            // member's graveyard copies and then its library copies leaving by
            // the member's last-known name; one shuffle after the sweep.
            const player = playerRef(sentence.player, slots, site);
            if (!player.ok) return player;
            return lowered([
                {
                    op: "forEach",
                    select: {
                        set: "graveyard",
                        controller: player.value,
                        filter: structuredClone(NOT_A_BASIC_LAND),
                    },
                    effects: [
                        {
                            op: "moveZone",
                            player: player.value,
                            fromZones: ["graveyard"],
                            filter: {
                                name: { ref: "$each.name" },
                                ...structuredClone(NOT_A_BASIC_LAND),
                            },
                            to: "exile",
                        },
                        {
                            op: "moveZone",
                            player: player.value,
                            fromZones: ["library"],
                            filter: { name: { ref: "$each.name" } },
                            to: "exile",
                        },
                    ],
                },
                ...(sentence.shuffle
                    ? [
                          {
                              op: "libraryLook" as const,
                              action: "shuffle" as const,
                              player: player.value,
                          },
                      ]
                    : []),
            ]);
        }
        case "exile-graveyard": {
            // CR 404.1 + CR 701.13a — the whole-zone `moveZone` shape: every
            // card in the announced player's graveyard goes to exile.
            const player = playerRef(sentence.player, slots, site);
            if (!player.ok) return player;
            if (sentence.exceptBasicLands)
                return lowered([
                    {
                        op: "moveZone",
                        player: player.value,
                        fromZones: ["graveyard"],
                        filter: structuredClone(NOT_A_BASIC_LAND),
                        to: "exile",
                    },
                ]);
            return lowered([
                {
                    op: "moveZone",
                    player: player.value,
                    from: "graveyard",
                    to: "exile",
                },
            ]);
        }
        case "put-back": {
            // CR 401.4 — the player chooses the cards (and their order) from
            // their own hand. "you" is the controller's own `putBack`.
            const player = playerRef(sentence.player, slots, site);
            if (!player.ok) return player;
            return lowered([
                {
                    op: "putBack",
                    player: player.value,
                    count: sentence.count,
                    prompt: putBackPrompt(sentence.count),
                },
            ]);
        }
        case "draw-put-back": {
            // CR 121.1 then CR 401.4 — the draw, then the controller puts
            // cards from their (now larger) hand back on top.
            const draw = lowerAmount(sentence.draw, site);
            if (!draw.ok) return draw;
            return lowered([
                { op: "draw", player: "controller", count: draw.value },
                {
                    op: "putBack",
                    player: "controller",
                    count: sentence.count,
                    prompt: putBackPrompt(sentence.count),
                },
            ]);
        }
        case "shuffle-self-into-library": {
            // CR 608.2n + CR 701.24a — the resolving spell, never an ability.
            if (site.resolvingSpell !== true)
                return unlowerable(
                    "only a spell's own text has a card to shuffle into the library"
                );
            return lowered([{ op: "shuffleSelfIntoLibrary" }]);
        }
        // CR 601.3 + CR 305.1 — "you" is the ability's controller; omitting
        // `actions` is the Op's own "play lands AND cast spells" default.
        case "exile-until-leaves": {
            // CR 610.3 — the exile arms the `$source`-keyed bundle (ADR 0028)
            // whose return the card pass adds as the source's own departure
            // trigger (`linkExile.ts`). A spell has no permanent to leave.
            if (site.resolvingSpell === true)
                return unlowerable(
                    '"until this leaves the battlefield" needs a permanent source (CR 610.3)'
                );
            const target = objectSelector(sentence.subject, slots, site);
            if (!target.ok) return target;
            return lowered([
                { op: "exileWithAttachments", target: target.value },
            ]);
        }
        case "return-exiled": {
            // CR 607.2a — the linked exile's card comes back under
            // its owner's control; only a head that names it can say "the".
            if (site.antecedents?.exiledCard !== true)
                return unlowerable(
                    '"the exiled card" names no exile linked to this ability (CR 607.2a)'
                );
            // CR 400.7 — a card goes to its OWNER's hand; the selector spans
            // every player's exile, and the card pass links the exile half.
            if (sentence.to === "hand")
                return lowered([
                    {
                        op: "moveZone",
                        target: { exiledWithSource: true },
                        to: "hand",
                    },
                ]);
            return lowered([{ op: "returnExiledForSource" }]);
        }
        case "return-all-exiled-with": {
            // CR 607.2a — "exiled with it" names this object's linked exile;
            // "it" is the source only behind its own leaves head.
            if (site.antecedents?.exiledCard !== true)
                return unlowerable(
                    '"cards exiled with it" names no exile linked to this ability (CR 607.2a)'
                );
            // CR 110.2a — each owner puts their own cards onto the
            // battlefield, so each enters under its owner's control; one
            // instruction, so the pile enters as one event.
            return lowered([
                {
                    op: "forEach",
                    select: { set: "exiledWithSource" },
                    simultaneous: true,
                    effects: [
                        {
                            op: "moveZone",
                            target: { ref: "$each" },
                            from: "exile",
                            to: "battlefield",
                        },
                    ],
                },
            ]);
        }
        case "graveyard-play":
            return lowered([
                { op: "grantGraveyardPlay", player: "controller" },
            ]);
        // CR 614.1a — the controller's graveyard, this turn only.
        case "graveyard-redirect":
            return lowered([
                { op: "armGraveyardRedirect", player: "controller" },
            ]);
        case "exile-if-dies": {
            // CR 614.1a + CR 608.2h — the replacement lands on "that
            // creature", the ONE creature target announced before it.
            if (soleAnnouncedCreature(walk) === null)
                return unlowerable(
                    '"that creature" names no single creature target announced before it (CR 608.2h)'
                );
            return lowered([{ op: "exileOnDeath", target: { target: 0 } }]);
        }
        case "prevent-regeneration-damaged": {
            // CR 701.19c + CR 608.2c — "a creature dealt damage this way" is
            // the ONE target announced before it; the Op no-ops on a player,
            // which is what "a creature" means for an "any target" spell.
            const announced = slots.requirements();
            const only = announced.length === 1 ? announced[0]! : null;
            if (
                only === null ||
                (only.type !== "Creature" && only.type !== "any") ||
                only.count !== 1 ||
                only.zone !== undefined ||
                only.announcedOnlyIfKicked === true ||
                !walk.damagedTarget ||
                walk.gatedRemoval
            )
                return unlowerable(
                    '"a creature dealt damage this way" names no single target announced before it (CR 608.2c)'
                );
            return lowered([
                { op: "preventRegeneration", target: { target: 0 } },
            ]);
        }
        case "exile-self": {
            // CR 608.2n — the resolving spell, never an ability: on a
            // permanent the same words exile the permanent itself.
            if (site.resolvingSpell !== true)
                return unlowerable(
                    "only a spell's own text has a card to exile instead of its graveyard"
                );
            return lowered([{ op: "exileSelf" }]);
        }
        case "explore": {
            // CR 701.44a — one permanent explores once.
            const target = objectSelector(sentence.subject, slots, site);
            if (!target.ok) return target;
            return lowered([{ op: "explore", target: target.value }]);
        }
        case "name-card":
            // CR 201.4 — the controller names the card; the binding is the one
            // the later "that name" sentence reads back as a name filter.
            return lowered([
                {
                    op: "nameCard",
                    player: "controller",
                    prompt: sentence.prompt,
                    bind: NAMED_CARD_BINDING,
                    ...(sentence.restriction === undefined
                        ? {}
                        : { nameRestriction: sentence.restriction }),
                },
            ]);
        case "reveal-random-hand-card":
            // CR 701.20a — one random card of the controller's hand.
            return lowered([
                {
                    op: "reveal",
                    player: "controller",
                    zone: "hand",
                    random: true,
                    bind: REVEALED_CARD_BINDING,
                },
            ]);
        case "named-card-reveal-gate": {
            // CR 201.2a — the revealed card is still in the hand when asked.
            const inner = gatedSentence(sentence.effect, walk, site);
            if (!inner.ok) return inner;
            return lowered([
                {
                    op: "if",
                    predicate: {
                        picksMatchFilter: { ref: REVEALED_CARD_BINDING },
                        player: "controller",
                        zone: "hand",
                        filter: { name: { ref: NAMED_CARD_BINDING } },
                    },
                    then: inner.value,
                },
            ]);
        }
        case "discard-named-from-hand": {
            // CR 701.20a — the hand is revealed first, so the discard reads
            // cards every player has seen; CR 701.9a — ALL cards with the name.
            const player = playerRef(sentence.player, slots, site);
            if (!player.ok) return player;
            return lowered([
                { op: "reveal", player: player.value, zone: "hand" },
                {
                    op: "discard",
                    player: player.value,
                    filter: { name: { ref: NAMED_CARD_BINDING } },
                },
            ]);
        }
        case "dig-named-to-hand": {
            // CR 701.20a — "your library": the controller's.
            const count = lowerAmount(sentence.count, site);
            if (!count.ok) return count;
            if (typeof count.value !== "number")
                return unlowerable("a named reveal of a variable count");
            return lowered([
                {
                    op: "digMatchingToHand",
                    player: "controller",
                    look: count.value,
                    filter: { name: { ref: NAMED_CARD_BINDING } },
                    destination: "exile",
                },
            ]);
        }
        case "delayed-draw-next-upkeep": {
            // CR 603.7a — the controller of the resolving ability controls the
            // delayed trigger; its body is the draw alone, so the shown text
            // is rebuilt from the one printed count.
            const count = lowerAmount(sentence.count, site);
            if (!count.ok) return count;
            if (count.value !== 1)
                return unlowerable(
                    "only a one-card delayed draw has a printed body"
                );
            return lowered([
                {
                    op: "delayedTrigger",
                    timing: "next-upkeep",
                    oracleText:
                        "At the beginning of the next turn's upkeep, draw a card.",
                    effects: [{ op: "draw", player: "controller", count: 1 }],
                },
            ]);
        }
        case "delayed-removal": {
            // CR 603.7a — the delayed trigger is created now; its body acts on
            // the object an earlier sentence put onto the battlefield
            // (CR 608.2h "it"), carried across by `capture` (resolved to that
            // object's id now, re-bound when the trigger fires; gone by then,
            // the body skips, CR 608.2b). To sacrifice it is its controller's
            // act (CR 701.21a), so the body names no player.
            const introduced = walk.introduced;
            if (introduced === null)
                return unlowerable(
                    '"it" names no object an earlier sentence put onto the battlefield (CR 608.2h)'
                );
            if (slots.requirements().length > introduced.slots)
                return unlowerable(
                    '"it" follows an announced target, which is the nearer antecedent (CR 608.2h)'
                );
            // The site's own object (a head whose subject is the source, a
            // per-creature combat head) is a second candidate: refused.
            if (headNamesAnObject(site))
                return unlowerable(
                    '"it" may name the site\'s own object or the one an earlier sentence put onto the battlefield (CR 608.2h)'
                );
            const bind = introduced.op.bind ?? walk.nextBind("that");
            introduced.op.bind = bind;
            const verb = sentence.verb === "exile" ? "Exile" : "Sacrifice";
            return lowered([
                {
                    op: "delayedTrigger",
                    timing: "next-end-step",
                    oracleText: `${verb} it at the beginning of the next end step.`,
                    capture: { $captured: { ref: bind } },
                    effects: [
                        { op: sentence.verb, target: { ref: "$captured" } },
                    ],
                },
            ]);
        }
        case "delayed-return": {
            // CR 603.7a — the delayed trigger is created now; its body moves
            // the one object the sentence names, carried across by `capture`
            // (gone or moved by then, the body skips, CR 608.2b).
            let capture: EffectCaptureSource;
            if (sentence.referent !== "it") {
                capture = { ref: "$source" };
            } else {
                // CR 608.2h — "it" / "that card" is the ONE announced object.
                const announced = slots.requirements();
                const actedOn = walk.actedOn;
                if (
                    announced.length !== 1 ||
                    walk.gatedRemoval ||
                    headNamesAnObject(site)
                )
                    return unlowerable(
                        '"it" names no single object announced before it (CR 608.2h)'
                    );
                if (sentence.destination === "battlefield") {
                    // A card returned from exile: the exile sentence's object.
                    if (
                        actedOn === null ||
                        actedOn.op.op !== "exile" ||
                        actedOn.requirement !== announced[0]
                    )
                        return unlowerable(
                            '"it" returned to the battlefield names no object exiled by the sentence before it (CR 608.2h)'
                        );
                    const bind = actedOn.op.bind ?? walk.nextBind("that");
                    actedOn.op.bind = bind;
                    capture = { ref: bind };
                } else {
                    if (actedOn !== null)
                        return unlowerable(
                            '"it" may name the object an earlier sentence moved or the announced target (CR 608.2h)'
                        );
                    capture = { target: 0 };
                }
            }
            const when =
                sentence.timing === "next-end-step" ? "end" : "cleanup";
            const where =
                sentence.destination === "hand"
                    ? "its owner's hand"
                    : "the battlefield under its owner's control";
            const what =
                sentence.referent !== "it"
                    ? sentence.referent
                    : sentence.destination === "battlefield"
                      ? "that card"
                      : "it";
            // The capture name follows the hand-written delayed-return
            // convention: `$self` for the source, `$c` for a bound object.
            const name =
                "ref" in capture && capture.ref === "$source" ? "$self" : "$c";
            return lowered([
                {
                    op: "delayedTrigger",
                    timing: sentence.timing,
                    oracleText: `Return ${what} to ${where} at the beginning of the next ${when} step.`,
                    capture: { [name]: capture },
                    effects: [
                        {
                            op: "moveZone",
                            target: { ref: name },
                            ...(sentence.destination === "battlefield"
                                ? { from: "exile" as const }
                                : {}),
                            to: sentence.destination,
                        },
                    ],
                },
            ]);
        }
        case "look-hand":
        case "look-random-hand": {
            // CR 400.2 — a private look: `looker` is omitted, so it defaults
            // to the resolving controller (CR 113.7).
            const player = playerRef(sentence.player, slots, site);
            if (!player.ok) return player;
            return lowered([
                {
                    op:
                        sentence.kind === "look-hand"
                            ? "lookHand"
                            : "lookRandomHand",
                    player: player.value,
                },
            ]);
        }
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
            // "you" (the imperative "Discard a card") is the controller's own
            // choice: the loot's `choose-hand-card` / discard pair, a
            // different Pending Choice kind the Bot values differently.
            if (sentence.player.kind === "you") {
                if (
                    sentence.count.kind !== "fixed" ||
                    sentence.count.value !== 1
                )
                    return unlowerable(
                        "the controller's own discard is read for one card"
                    );
                const bind = walk.nextBind("discard");
                return lowered([
                    {
                        op: "choice",
                        kind: "choose-hand-card",
                        player: "controller",
                        zone: "hand",
                        count: 1,
                        prompt: "Discard a card.",
                        bind,
                    },
                    {
                        op: "discard",
                        player: "controller",
                        cards: { ref: bind },
                    },
                ]);
            }
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
        // CR 122.1 + CR 701.21a — the source's tally, read as the sentence
        // resolves (after any counter an earlier sentence put on it), gates
        // its sacrifice.
        case "sacrifice-source-at-counters":
            return lowered([
                {
                    op: "if",
                    predicate: {
                        left: {
                            counters: {
                                of: { ref: "$source" },
                                type: sentence.counter,
                            },
                        },
                        op: "ge",
                        right: sentence.atLeast,
                    },
                    then: [{ op: "sacrifice", target: { ref: "$source" } }],
                },
            ]);
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
        case "reveal-top-to-hand": {
            // CR 701.20a — the one card revealed always goes to hand; the
            // match-all `filter` leaves nothing for `destination`, so its
            // value is inert (`destination` is required by the Op's shape).
            const dig: EffectOp = {
                op: "digMatchingToHand",
                player: "controller",
                look: 1,
                filter: {},
                destination: "graveyard",
            };
            if (!sentence.lifeLoss) return lowered([dig]);
            // CR 119.3 — "equal to its mana value" reads the card just put
            // into hand, snapshotted under the Op's own `bind`.
            return lowered([
                { ...dig, bind: "$revealed" },
                {
                    op: "loseLife",
                    player: "controller",
                    amount: { manaValue: { of: { ref: "$revealed" } } },
                },
            ]);
        }
        case "reveal-until":
            // CR 701.20a — "your library": the controller's.
            return lowered([
                {
                    op: "revealUntilMatch",
                    player: "controller",
                    filter: sentence.filter,
                    match: sentence.match,
                    rest: sentence.rest,
                },
            ]);
        case "first-player-may-reveal-until": {
            // CR 603.3d — the trigger announces an opposing player who
            // controls more creatures than the head's player; the strict
            // comparison already excludes the baseline seat. The player is
            // only announced: the dig below belongs to the head's player.
            // The baseline `than: "active"` is the upkeep player's seat, so
            // only a head naming the active player may be read.
            const first = site.antecedents?.player;
            if (
                typeof first !== "object" ||
                !("ref" in first) ||
                first.ref !== "$event.activePlayerId"
            )
                return unlowerable(
                    '"the first player" is not the player whose phase it is'
                );
            const announced = slots.allocate({
                type: "player",
                count: 1,
                playerControlsMoreThan: { type: "Creature", than: "active" },
            });
            if (!announced.ok) return announced;
            // CR 701.20a — "may reveal": the cost-free `mayPay` pair binds
            // whether the head's player took the option.
            return lowered([
                {
                    op: "mayPay",
                    player: first,
                    prompt: "Reveal cards from the top of your library until you reveal a creature card?",
                    bind: "$revealed",
                },
                {
                    op: "if",
                    predicate: { binding: "$revealed" },
                    then: [
                        {
                            op: "revealUntilMatch",
                            player: first,
                            filter: sentence.filter,
                            match: sentence.match,
                            rest: sentence.rest,
                        },
                    ],
                },
            ]);
        }
        case "search-reveal-pile-pick": {
            // CR 701.23d — a search for a bare quantity must find that many
            // (or as many as the library holds: the exact `count` clamps).
            // CR 701.20a — the reveal makes the pile public, which is what
            // lets the chooser pick from a hidden zone (`choose-library-card`
            // is refused without it). The pick goes to hand; moving the whole
            // pile to the graveyard after it moves only "the rest", since the
            // pick has already left the library. CR 701.24a — then shuffle.
            const chooser = playerRef(sentence.chooser, slots, site);
            if (!chooser.ok) return chooser;
            const found = walk.nextBind("found");
            const picked = walk.nextBind("picked");
            return lowered([
                {
                    op: "choice",
                    kind: "search-library",
                    player: "controller",
                    zone: "library",
                    count: sentence.count,
                    prompt: `Search your library for ${countWord(sentence.count)} cards.`,
                    bind: found,
                },
                { op: "reveal", player: "controller", cards: { ref: found } },
                {
                    op: "choice",
                    kind: "choose-library-card",
                    player: chooser.value,
                    zoneOwnerId: "controller",
                    zone: "library",
                    candidates: [{ ref: found }],
                    count: 1,
                    prompt: "Choose one of the revealed cards. Its owner puts that card into their hand and the rest into their graveyard.",
                    bind: picked,
                },
                {
                    op: "moveZone",
                    cards: { ref: picked },
                    player: "controller",
                    from: "library",
                    to: "hand",
                },
                {
                    op: "moveZone",
                    cards: { ref: found },
                    player: "controller",
                    from: "library",
                    to: "graveyard",
                },
                { op: "libraryLook", action: "shuffle", player: "controller" },
            ]);
        }
        case "divide-library-piles": {
            const count = lowerAmount(sentence.count, site);
            if (!count.ok) return count;
            // CR 700.3 — the opponent splits the revealed window, the
            // controller takes one pile to hand and the other goes to the
            // graveyard.
            return lowered([
                {
                    op: "divideIntoPiles",
                    objects: {
                        set: "library-top",
                        player: "controller",
                        count: count.value,
                    },
                    divider:
                        sentence.form === "separates"
                            ? "opponent"
                            : "controller",
                    chooser:
                        sentence.form === "separates"
                            ? "controller"
                            : "opponent",
                    dividePrompt: "Separate the revealed cards into two piles.",
                    pickPrompt:
                        sentence.form === "separates"
                            ? "Choose a pile: it goes to your hand, the other to your graveyard."
                            : "Choose a pile: it goes to the other player's hand, the rest to their graveyard.",
                    chosenBind: "$chosenPile",
                    otherBind: "$otherPile",
                    chosenEffect: [
                        {
                            op: "moveZone",
                            cards: { ref: "$chosenPile" },
                            player: "controller",
                            from: "library",
                            to: "hand",
                        },
                    ],
                    otherEffect: [
                        {
                            op: "moveZone",
                            cards: { ref: "$otherPile" },
                            player: "controller",
                            from: "library",
                            to: "graveyard",
                        },
                    ],
                },
            ]);
        }
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
        case "keep-one-of-each-permanent-type":
            // CR 101.4 — every player's pick is made (APNAP order) before any
            // sacrifice: `simultaneous`. CR 701.21a — the sweep sacrifices
            // every permanent the chooser controls that was not kept; one
            // permanent may answer several types (the Op's cover rule).
            return lowered([
                {
                    op: "forEach",
                    select: { set: "players" },
                    simultaneous: true,
                    effects: [
                        {
                            op: "chooseCategorized",
                            player: { ref: "$each" },
                            zone: "battlefield",
                            categories: sentence.types.map((type) => ({
                                label: type,
                                filter: { type },
                            })),
                            onPicked: "keep",
                            sweep: { action: "sacrifice" },
                            prompt: "Choose an artifact, a creature, an enchantment, and a land to keep; the rest are sacrificed.",
                        },
                    ],
                },
            ]);
        case "choose-one-per-category":
            return lowered(lowerChooseOnePerCategory(sentence));
        case "phase-out": {
            // CR 702.26b — one announced permanent; the Op fixes the return
            // (its controller's next untap step, CR 702.26a).
            const target = objectSelector(sentence.subject, slots, site);
            if (!target.ok) return target;
            return lowered([{ op: "phaseOut", target: target.value }]);
        }
        case "scry": {
            // CR 701.22a — look at the top N, any number to the bottom, the
            // rest back on top in any order: `scryReorder` to the bottom.
            const count = lowerAmount(sentence.count, site);
            if (!count.ok) return count;
            return lowered([
                {
                    op: "scryReorder",
                    player: "controller",
                    count: count.value,
                    destination: "library-bottom",
                },
            ]);
        }
        case "kicked": {
            // CR 702.33g — a kicked limit swap emits no Op: the announcement
            // itself is swapped, and the counter in front runs unchanged.
            if (sentence.effect.kind === "counter-limit-instead") {
                const left = kickedValue(sentence.kicked, site.kickers ?? []);
                if (!left.ok) return left;
                const swapped = walk.targets.swapKickedMvLimit(
                    sentence.effect.mvMax
                );
                if (!swapped.ok) return swapped;
                return lowered([]);
            }
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
        case "controls-more": {
            // CR 608.2c + CR 109.5 — read when the spell resolves: strictly
            // more permanents the filter matches under an opponent's control
            // than under the controller's. Targets inside the gate are still
            // announced (CR 601.2c); only the effect is conditional.
            // `"opponent"` is the one opponent the interpreter resolves, which
            // is every opponent in the two-player and solo games this engine
            // runs; the trigger gate (`controlsMore`) checks each opponent.
            const filter = countFilterOf(sentence.condition.filter);
            if (!filter.ok) return filter;
            const inner = gatedSentence(sentence.effect, walk, site);
            if (!inner.ok) return inner;
            return lowered([
                {
                    op: "if",
                    predicate: {
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
                    },
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
            // The replacement may re-name the base's own announced targets
            // (CR 601.2c — chosen once), never announce one of its own.
            const replay = walk.replaying(before);
            const replacement = gatedSentence(
                sentence.replacement,
                replay,
                site
            );
            if (!replacement.ok) return replacement;
            if (
                replay.targets.consumed() !== walk.targets.requirements().length
            )
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
        case "coin-flip-series": {
            // CR 107.1c + CR 705.2 (issue #3813, ADR 0144) — the nomination,
            // the series bounded by it and stopped at the first loss, and the
            // payoff gated on no flip lost ("if you win all the flips") and
            // scaled by the flips made. A literal comparand is a positive
            // integer in the value grammar, so "no losses" is `< 1`.
            const player = playerRef(sentence.player, slots, site);
            if (!player.ok) return player;
            const perFlip: EffectValue =
                sentence.perFlip === 1
                    ? { ref: "$flips" }
                    : {
                          scaled: {
                              value: { ref: "$flips" },
                              times: sentence.perFlip,
                          },
                      };
            return lowered([
                {
                    op: "chooseNumber",
                    player: "controller",
                    prompt: "Choose a number.",
                    bind: "$n",
                },
                {
                    op: "coinFlipSeries",
                    count: { ref: "$n" },
                    untilLoss: true,
                    bindFlips: "$flips",
                    bindLosses: "$losses",
                },
                {
                    op: "if",
                    predicate: {
                        left: { ref: "$losses" },
                        op: "lt",
                        right: 1,
                    },
                    then: [
                        { op: "draw", player: player.value, count: perFlip },
                    ],
                },
            ]);
        }
        case "choose-color-grant-protection": {
            // CR 613.1f — evidenced by exactly one corpus form (Glory): a
            // plain controller-scoped sweep. A target-player sweep or an
            // X-bounded one is a different selector shape (`sweepOps`'s two
            // extra branches) with no fixture behind it here — refused
            // rather than silently dropping the qualifier.
            if (sentence.subject.kind !== "mass")
                return unlowerable(
                    "protection from the chosen color reads only a mass subject (no fixture covers a single object)"
                );
            if (
                sentence.subject.targetPlayerControls === true ||
                sentence.subject.targetOpponentControls === true ||
                sentence.subject.manaValueEqualsSourceCounters !== undefined ||
                sentence.subject.manaValueAtMostX === true
            )
                return unlowerable(
                    "protection from the chosen color reads only a plain controller-scoped sweep (no fixture covers a target-player or X-bounded one)"
                );
            const select = sentence.subject.select;
            const duration = durationSpec(sentence.duration);
            return lowered([
                {
                    op: "optionChoice",
                    prompt: `Choose a color (${site.selfName}).`,
                    modes: colorChoiceModes((color) => [
                        {
                            op: "forEach",
                            select,
                            effects: [
                                {
                                    op: "grantAbility",
                                    target: { ref: "$each" },
                                    ability: `protection from ${PROTECTION_QUALITY_NAMES[color]}`,
                                    duration,
                                },
                            ],
                        },
                    ]),
                },
            ]);
        }
        // CR 205.3m (issue #3721) — "Choose a creature type." The bind name is
        // a RESERVED constant rather than something the grammar invents,
        // because the descriptor that reads it back ("of that type") is parsed
        // in a different sentence by a different rule: the two agree by naming
        // the same constant, which `tsc` checks, instead of by convention.
        case "choose-creature-type":
            return lowered([
                {
                    op: "chooseCreatureType",
                    player: "controller",
                    prompt:
                        sentence.exclude === undefined
                            ? "Choose a creature type"
                            : `Choose a creature type other than ${sentence.exclude.join(", ")}.`,
                    bind: CHOSEN_TYPE_BINDING,
                    ...(sentence.exclude === undefined
                        ? {}
                        : { exclude: [...sentence.exclude] }),
                },
            ]);
        // CR 205.1a / 611.2 (issue #4316) — the chosen type replaces the
        // subject's CREATURE types only (`family: "creature"`), reverting at
        // `duration`. Reads the SAME reserved binding the choose sentence
        // writes; a line without that sentence leaves the ref unbound, which
        // `validateEffectScript` refuses.
        case "set-chosen-creature-type": {
            const target = chosenTypeSelector(sentence.subject, slots);
            if (!target.ok) return target;
            return lowered([
                {
                    op: "setSubtype",
                    target: target.value,
                    subtypes: { ref: CHOSEN_TYPE_BINDING },
                    family: "creature",
                    duration: durationSpec(sentence.duration),
                },
            ]);
        }
        // CR 205.3i / 305.6 — two picks, the second of a BASIC land type.
        case "choose-land-types":
            return lowered([
                {
                    op: "chooseLandType",
                    player: "controller",
                    prompt: "Choose a land type",
                    bind: FIRST_CHOSEN_LAND_TYPE_BINDING,
                },
                {
                    op: "chooseLandType",
                    player: "controller",
                    prompt: "Choose a basic land type",
                    bind: SECOND_CHOSEN_LAND_TYPE_BINDING,
                    basic: true,
                },
            ]);
        // CR 305.7 / 611.2 — every land of the first pick, snapshotted as the
        // `forEach` starts (CR 611.2c — the affected set is fixed when the
        // effect begins), has its land types replaced by the second pick
        // until `duration`. Reads the bindings the choose sentence writes; a
        // line without it leaves the refs unbound, which
        // `validateEffectScript` refuses.
        case "set-chosen-land-type":
            return lowered([
                {
                    op: "forEach",
                    select: {
                        set: "permanents",
                        zone: "battlefield",
                        filter: {
                            type: "Land",
                            subtype: { ref: FIRST_CHOSEN_LAND_TYPE_BINDING },
                        },
                    },
                    effects: [
                        {
                            op: "setSubtype",
                            target: { ref: "$each" },
                            subtypes: { ref: SECOND_CHOSEN_LAND_TYPE_BINDING },
                            family: "land",
                            duration: durationSpec(sentence.duration),
                        },
                    ],
                },
            ]);
        case "replace-mana-production-color":
            return lowered([
                {
                    op: "replaceManaProductionColor",
                    player: "controller",
                    color: sentence.color,
                },
            ]);
        case "grant-mana-substitution":
            return lowered([
                {
                    op: "grantManaSubstitution",
                    player: "controller",
                    from: sentence.from,
                    breadth: sentence.breadth,
                },
            ]);
        case "pay-mana-then": {
            // CR 118.12 + CR 608.2c — the fixed payment is a `mayPay` mana
            // cost: declining, or being unable to pay, leaves the REQUIRED
            // bind false and the gated effect undone.
            const inner = gatedSentence(sentence.effect, walk, site);
            if (!inner.ok) return inner;
            const bind = walk.nextBind("paid");
            return lowered([
                {
                    op: "mayPay",
                    // CR 603.2 — "you" on a triggered ability is its controller.
                    player: "controller",
                    cost: sentence.mana,
                    prompt: capitalise(
                        sentence.clause.split(SELF_MARKER).join(site.selfName)
                    ),
                    bind,
                },
                {
                    op: "if",
                    predicate: { binding: bind },
                    then: inner.value,
                },
            ]);
        }
        case "player-attack-protection":
            // CR 508.1c — the controller can't be attacked this way until
            // their next turn; the Op owns the boundary (`gre/phases.ts`).
            return lowered([
                {
                    op: "setIslandSanctuaryProtection",
                    player: "controller",
                },
            ]);
        case "assigns-no-combat-damage":
            // CR 510.1c — the source itself assigns nothing this turn.
            return lowered([
                { op: "markAssignsNoCombatDamage", target: { ref: "$source" } },
            ]);
        case "effect-and-assigns-no-combat-damage": {
            const head = lowerSentence(sentence.effect, walk, site);
            if (!head.ok) return head;
            return lowered([
                ...head.value,
                { op: "markAssignsNoCombatDamage", target: { ref: "$source" } },
            ]);
        }
        case "pay-variable-then": {
            // CR 107.3f — the nomination and the payment are ONE decision, and
            // nominating 0 IS "if you don't" (an effect of X = 0 and declining
            // are the same game state), so there is no separate may-pay gate:
            // the payoff reads the amount paid, as every hand-written
            // `payVariableMana` card does.
            const bind = walk.nextBind("paid");
            const inner = gatedSentence(sentence.effect, walk, {
                ...site,
                allowX: false,
                paidBind: bind,
            });
            if (!inner.ok) return inner;
            // Nominating 0 is "if you don't" ONLY when the payoff scales with
            // X; a flat payoff would be granted for a payment of {0}.
            if (!JSON.stringify(inner.value).includes(`"ref":"${bind}"`))
                return unlowerable(
                    "a variable payment whose payoff never reads X (CR 107.3f)"
                );
            return lowered([
                {
                    op: "payVariableMana",
                    // CR 603.2 — "you" on a triggered ability is its controller.
                    player: "controller",
                    prompt: capitalise(
                        sentence.clause.split(SELF_MARKER).join(site.selfName)
                    ),
                    bind,
                },
                ...inner.value,
            ]);
        }
        case "grant-spell-mana-substitution":
            return lowered([
                {
                    op: "grantSpellManaSubstitution",
                    player: "controller",
                    breadth: sentence.breadth,
                },
            ]);
        case "add-mana": {
            if (sentence.perSet !== undefined) {
                // CR 106.1 + CR 107.1 — every pip is produced once per member
                // of the counted set (a pip written n times: n per member).
                const spec = lowerCountedSet(sentence.perSet, slots, site);
                if (!spec.ok) return spec;
                const mana: EffectManaPool = {};
                for (const [color, n] of Object.entries(sentence.mana)) {
                    mana[color as keyof EffectManaPool] = {
                        count:
                            n === 1
                                ? spec.value
                                : { ...spec.value, times: n as number },
                    };
                }
                return lowered([{ op: "addMana", mana }]);
            }
            if (sentence.thatPlayer !== true)
                return lowered([{ op: "addMana", mana: sentence.mana }]);
            const player = playerRef({ kind: "that-player" }, slots, site);
            if (!player.ok) return player;
            return lowered([
                { op: "addMana", mana: sentence.mana, player: player.value },
            ]);
        }
        case "add-mana-instead-if":
            // CR 608.2c — the count is met: the replacement is added; else the
            // base is. One `if`, so exactly one of the two pools is produced.
            return lowered([
                {
                    op: "if",
                    predicate: {
                        left: {
                            count: {
                                zone: sentence.condition.zone,
                                controller: "controller",
                            },
                        },
                        op: "ge",
                        right: sentence.condition.atLeast,
                    },
                    then: [{ op: "addMana", mana: sentence.replacement }],
                    else: [{ op: "addMana", mana: sentence.base }],
                },
            ]);
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
/**
 * The Verb Frame chain (`verbFrames.ts`, issue #6557), one Op per frame in
 * printed order (CR 608.2c). The chain's referent — the find of the last
 * `search` — is the binding the `moveZone` frames and the search's own reveal
 * read; the grammar refused every pronoun with no referent, so a frame that
 * reads one here and finds none is a bug in the reader, not a card.
 *
 *  - `search` (CR 701.23a): the `choice` over the controller's library. The
 *    find is OPTIONAL when the description states a quality (CR 701.23b — a
 *    search of a hidden zone for cards with a stated quality never compels
 *    it) or the quantity is a range ("up to N", "any number of"); a search
 *    for plain "a card" or "three cards" states no quality and MUST find
 *    that many, clamped by what the library holds (CR 609.3). Two arguments
 *    are the SITE's to settle: "with mana value X or less" reads the X the
 *    source announced (CR 107.3 — refused where none is, and where X is a
 *    paid amount the filter cannot carry), and "named <self>" carries the
 *    normaliser's marker, put back as the printed name here (CR 201.2) in
 *    the filter and in the prompt.
 *    The reveal (CR 701.20a) comes right after the choice, while the card is
 *    still in the library: it keeps its all-players knowledge through the
 *    move, and a later shuffle clears knowledge only of the cards still in
 *    the library. A search that finds nothing binds nothing, so every frame
 *    reading the binding is a no-op (CR 101.3).
 *  - `moveZone` (CR 400.7): the found cards leave the library for the printed
 *    destination, tapped when the line says so (CR 110.5b).
 *  - `shuffle` (CR 701.24a): the controller's library. "That player
 *    shuffles" is legal only folded onto the `search-target-library` kind by
 *    sentence assembly; reaching it here means the fold did not happen.
 *  - `bringFromOutsideGame` (CR 400.11b + CR 701.20a): the Op owns the whole
 *    member — the optional pick over the hidden outside-the-game pool, the
 *    reveal and the move to hand (outside the game is not a zone, so no
 *    `choice`/`moveZone` pair can name it).
 */
function lowerFrameChain(
    sentence: FrameChainIR,
    walk: SentenceWalk,
    site: SiteOptions
): Lowered<EffectOp[]> {
    const ops: EffectOp[] = [];
    let found: string | null = null;
    for (const frame of sentence.frames) {
        switch (frame.frame) {
            case "sacrifice": {
                const lowered = lowerSacrificeFrame(frame, walk, site);
                if (!lowered.ok) return lowered;
                ops.push(...lowered.value);
                break;
            }
            case "search": {
                const bind = walk.nextBind("found");
                if (typeof frame.filter.manaValueAtMost === "object") {
                    // CR 107.3f — "you may pay {X}. If you do, …": X is in
                    // the text, not in a cost, and is chosen as it is paid;
                    // it lives in the payment's binding, which
                    // `EffectCardFilter.manaValueAtMost` cannot read.
                    if (site.paidBind !== undefined)
                        return unlowerable(
                            '"with mana value X or less" reads an X chosen as it was paid (CR 107.3f), which a card filter cannot carry'
                        );
                    if (!site.allowX)
                        return unlowerable(
                            "a search filter reads X but its source announces no {X} (CR 107.3)"
                        );
                }
                const filter =
                    frame.filter.name === SELF_MARKER
                        ? { ...frame.filter, name: site.selfName }
                        : frame.filter;
                const statedQuality = Object.keys(filter).length > 0;
                ops.push({
                    op: "choice",
                    kind: "search-library",
                    player: "controller",
                    zone: "library",
                    ...(statedQuality ? { filter } : {}),
                    count:
                        statedQuality || frame.upTo
                            ? { min: 0, max: frame.count }
                            : frame.count,
                    prompt: `Search your library for ${frame.phrase.split(SELF_MARKER).join(site.selfName)}.`,
                    bind,
                });
                if (frame.reveal !== undefined)
                    ops.push({
                        op: "reveal",
                        player: "controller",
                        cards: { ref: bind },
                    });
                found = bind;
                break;
            }
            case "moveZone": {
                const moved = lowerMoveFrame(frame, found, walk, site);
                if (!moved.ok) return moved;
                ops.push(...moved.value);
                break;
            }
            case "shuffle":
                if (frame.player === "that-player")
                    return unlowerable(
                        '"Then that player shuffles." follows no search of a target library'
                    );
                ops.push({
                    op: "libraryLook",
                    action: "shuffle",
                    player: "controller",
                });
                break;
            case "bringFromOutsideGame":
                ops.push({
                    op: "bringFromOutsideGame",
                    player: "controller",
                    filter: frame.filter,
                    prompt: `Reveal ${frame.phrase} you own from outside the game.`,
                });
                break;
        }
    }
    if (sentence.then === undefined) return lowered(ops);
    // CR 118.12 — "If you do" behind the chain: the gated effect runs on the
    // EVIDENCE the sacrifice left (the bind of the Op that moved something;
    // an empty bind — the source already gone, nothing picked — fails the
    // gate, CR 118.3), never on the instruction alone.
    const inner =
        sentence.reflexive === undefined
            ? gatedSentence(sentence.then, walk, site)
            : lowerReflexive(sentence.reflexive, sentence.then, walk, site);
    if (!inner.ok) return inner;
    const evidence = paidEvidence(ops, walk, "sacrificed");
    if (evidence === null)
        return unlowerable(
            '"If you do" follows a chain that leaves no evidence it was done (CR 118.12)'
        );
    return lowered([
        ...evidence.ops,
        {
            op: "if",
            predicate: {
                boundMatchesFilter: { ref: evidence.bind },
                filter: {},
            },
            then: inner.value,
        },
    ]);
}

/**
 * CR 701.21a — the `sacrifice` frame, one of two shapes:
 *
 *  - a NAMED permanent (the source, the pronoun for it): one `sacrifice` Op on the object selector; with the CR
 *    118.12a rider, the `mayPay` + `if not` pair verbatim ("sacrifice it
 *    unless you <payment>" MEANS "you may pay; if you don't, sacrifice it" —
 *    Phyrexian Dreadnought), the payment one `CostLegs` leg;
 *  - a CHOSEN set (an edict): the sacrificing player CHOOSES among their own
 *    permanents, then those permanents are sacrificed — the pair every
 *    hand-written edict writes (Innocent Blood, Liliana of the Veil), the
 *    choice raised for the player who sacrifices, never the caster. A player
 *    with no matching permanent gets no candidates, so neither the prompt nor
 *    the sacrifice happens (CR 101.3 — an impossible instruction is ignored).
 */
function lowerSacrificeFrame(
    frame: Extract<FrameIR, { frame: "sacrifice" }>,
    walk: SentenceWalk,
    site: SiteOptions
): Lowered<EffectOp[]> {
    const slots = walk.targets;
    if (frame.object.kind === "named") {
        const target = objectSelector(frame.object.subject, slots, site);
        if (!target.ok) return target;
        if (frame.unless === undefined)
            return lowered([{ op: "sacrifice", target: target.value }]);
        const bind = walk.nextBind("may");
        return lowered([
            {
                op: "mayPay",
                player: "controller",
                cost: lowerUnlessPayment(frame.unless),
                prompt: unlessPaymentPrompt(frame.unless, site.selfName),
                bind,
            },
            {
                op: "if",
                predicate: { not: { binding: bind } },
                then: [{ op: "sacrifice", target: target.value }],
            },
        ]);
    }
    const { object } = frame;
    const bind = walk.nextBind("sacrifice");
    // "any number of" — the chooser sizes the pick, zero up (CR 701.21a); a
    // printed count, "X" or "that many" is the amount grammar's.
    let count: EffectChoiceCount;
    if (object.count.kind === "any-number")
        count = { min: 0, max: ANY_NUMBER_CEILING };
    else {
        const amount = lowerAmount(object.count, site);
        if (!amount.ok) return amount;
        count = amount.value;
    }
    const edict = (player: EffectPlayerRef): EffectOp[] => [
        {
            op: "choice",
            kind: "sacrifice-permanents",
            player,
            zone: "battlefield",
            filter: object.filter,
            ...(object.superlative === undefined
                ? {}
                : { superlative: object.superlative }),
            count,
            prompt: `Sacrifice ${object.phrase}.`,
            bind,
        },
        { op: "sacrifice", permanents: { ref: bind } },
    ];
    // CR 101.4 — "each player": every player chooses in APNAP order, then all
    // the picks are sacrificed together.
    if (frame.player.kind === "each-player")
        return lowered([
            {
                op: "forEach",
                select: { set: "players" },
                simultaneous: true,
                effects: edict({ ref: "$each" }),
            },
        ]);
    // CR 102.2 — in a two-player game "each opponent" is the one other
    // player, and the edict is one-sided exactly as printed.
    if (frame.player.kind === "each-opponent")
        return lowered(edict("opponent"));
    const player = playerRef(frame.player, slots, site);
    if (!player.ok) return player;
    return lowered(edict(player.value));
}

/**
 * One `moveZone` frame (`verbFrames.ts`, issue #6631), by its object class:
 *
 *  - the chain PRONOUN: the find of the search before it leaves the library
 *    for the printed destination (CR 400.7), tapped when the line says so
 *    (CR 110.5b);
 *  - a SUBJECT: the announced target, the source, the site's anaphora or a
 *    sweep, lowered by `lowerMoveZone` — the path the retired `move-zone`
 *    sentence kind took, so every Compiled Definition it produced is
 *    unchanged. "It" at a site whose head put a card into a graveyard names
 *    that card (CR 400.7e), as "that card" does;
 *  - a GRAVEYARD END CARD (CR 404.2): the positional `moveZone` selector; an
 *    announced player's graveyard allocates its player slot here;
 *  - a CHOSEN CARD: the `choice` out of the controller's own zone, then the
 *    `moveZone` of the picks;
 *  - an OWN PERMANENT (CR 400.3): the `choice` on the controller's
 *    battlefield, routed through `forEach { set: "bound" }` because the
 *    `moveZone.target` shape wants a snapshot ref.
 */
function lowerMoveFrame(
    frame: Extract<FrameIR, { frame: "moveZone" }>,
    found: string | null,
    walk: SentenceWalk,
    site: SiteOptions
): Lowered<EffectOp[]> {
    const slots = walk.targets;
    const { object, to, tapped } = frame;
    switch (object.kind) {
        case "pronoun": {
            if (found === null)
                return unlowerable(
                    `"${frame.phrase}" names a card no frame found`
                );
            return lowered([
                {
                    op: "moveZone",
                    cards: { ref: found },
                    player: "controller",
                    from: "library",
                    to: movableDestination(to),
                    ...(tapped ? { tapped: true } : {}),
                },
            ]);
        }
        case "subject": {
            const subject = object.subject;
            // CR 701.13a — the target shape's `moveZone` re-derives a departed
            // object in a graveyard and SKIPS a battlefield one bound for
            // exile or a graveyard: the source, "that creature" or the
            // head's "it" reach those zones only behind a head that put the
            // object into a graveyard; on the battlefield that is the
            // `exile` Op's kind, or a sacrifice, never this frame.
            if (
                (to.zone === "exile" || to.zone === "graveyard") &&
                (subject.kind === "self" ||
                    subject.kind === "that-creature" ||
                    subject.kind === "pronoun") &&
                site.antecedents?.card === undefined
            )
                return unlowerable(
                    `a permanent on the battlefield is not put into ${to.zone} by this frame — only a card a head put into a graveyard is`
                );
            // "that card" names the head's card only while no earlier
            // sentence introduced an object of its own.
            if (
                subject.kind === "that-card" &&
                (walk.actedOn !== null ||
                    walk.libraryLookedAt !== null ||
                    slots.requirements().length > 0)
            )
                return unlowerable(
                    '"that card" may name an object an earlier sentence introduced'
                );
            const moved = lowerMoveZone(
                subject,
                to,
                slots,
                site,
                frame.under,
                tapped
            );
            // CR 608.2h — "that creature" names ONE object, so a WIDE group
            // (an "up to N" head fanned out over several ops) leaves no
            // referent: recording the first op's would name whichever target
            // happened to be picked first. One op, one referent; more than
            // one, none.
            if (moved.ok && moved.value.length === 1)
                recordActedOn(walk, subject, moved.value[0]!);
            return moved;
        }
        case "graveyard-end": {
            // CR 404.2 — the positional selector `moveZone` ships; an
            // announced player's graveyard is a player slot allocated here.
            let player: EffectPlayerRef = "controller";
            if (object.owner === "target-player") {
                const index = slots.allocate({ type: "player", count: 1 });
                if (!index.ok) return index;
                player = { target: index.value };
            }
            const move: Extract<EffectOp, { op: "moveZone" }> = {
                op: "moveZone",
                target: {
                    zone: "graveyard",
                    position: object.position,
                    player,
                    ...(object.cardType !== null
                        ? { filter: { type: object.cardType } }
                        : {}),
                },
                to: movableDestination(to) as EffectMoveZone,
                ...(tapped ? { tapped: true } : {}),
            };
            // CR 400.7j — the returned card is an object later sentences of
            // this effect can find.
            if (to.zone === "battlefield")
                walk.introduced = {
                    op: move,
                    creature: object.cardType === "Creature",
                    slots: slots.requirements().length,
                };
            return lowered([move]);
        }
        case "chosen":
            // CR 603.2 — every printed hand→battlefield drop says "you may"
            // (folded into the pick's range by the `optional` wrapper); the
            // bare instruction is not a printed form.
            if (object.zone === "hand" && to.zone === "battlefield")
                return unlowerable(
                    "an unconditional put from the hand onto the battlefield is not a printed form"
                );
            return lowered(
                chosenMoveOps(
                    object,
                    to,
                    tapped,
                    walk.nextBind("picked"),
                    `${capitalise(frame.phrase)}.`,
                    object.count
                )
            );
        case "own-permanent": {
            // CR 400.3 — the controller picks one of their own permanents and
            // it returns to its owner's hand. The pick is routed through
            // `forEach { set: "bound" }`: a `choice` Op's `bind` holds the raw
            // picks, while `moveZone.target` wants a snapshot ref.
            const bind = walk.nextBind("bounce");
            return lowered([
                {
                    op: "choice",
                    kind: "choose-permanents",
                    player: "controller",
                    zone: "battlefield",
                    filter: object.filter,
                    count: 1,
                    prompt: `${capitalise(frame.phrase)}.`,
                    bind,
                },
                {
                    op: "forEach",
                    select: { set: "bound", ref: bind },
                    effects: [
                        {
                            op: "moveZone",
                            target: { ref: "$each" },
                            to: "hand",
                        },
                    ],
                },
            ]);
        }
    }
}

/**
 * CR 118.12 — the evidence an optional action leaves when it is paid: the bind
 * of the LAST Op that sacrificed or moved something, given one here when the
 * lowering wrote none. An action with no such Op (a draw, a life change, a
 * tap) has nothing an `If you do` can read, and `null` says so.
 */
function paidEvidence(
    ops: readonly EffectOp[],
    walk: SentenceWalk,
    prefix = "did"
): { readonly ops: EffectOp[]; readonly bind: string } | null {
    for (let i = ops.length - 1; i >= 0; i--) {
        const op = ops[i]!;
        if (op.op !== "sacrifice" && op.op !== "moveZone") continue;
        // A picked set's sacrifice binds its FIRST pick (the interpreter's
        // CR 608.2h snapshot) — nothing picked, nothing bound, gate shut.
        // That is whole evidence only for a pick of exactly one: a count of
        // two paid with one creature would still bind (CR 118.3 — a cost is
        // paid in full or not at all), so a larger pick is no evidence here.
        if ("permanents" in op && op.permanents !== undefined) {
            const ref = (op.permanents as { ref?: string }).ref;
            const pick = ops.find(
                (candidate) =>
                    candidate.op === "choice" &&
                    (candidate as { bind?: string }).bind === ref
            ) as { count?: unknown } | undefined;
            // …and no earlier sacrifice stands in for it: the LAST cost is
            // the one "If you do" asks about (CR 118.12), or nothing is.
            if (pick?.count !== 1) return null;
        } else if (!("target" in op) && !("cards" in op)) continue;
        const existing = (op as { bind?: string }).bind;
        const bind = existing ?? walk.nextBind(prefix);
        const stamped = existing === undefined ? { ...op, bind } : op;
        return {
            ops: [...ops.slice(0, i), stamped as EffectOp, ...ops.slice(i + 1)],
            bind,
        };
    }
    return null;
}

/** Every binding name an Op list reads (`ref`, `binding`) and every one it defines (`bind`). */
function collectBindings(
    node: unknown,
    reads: Set<string>,
    defines: Set<string>
): void {
    if (Array.isArray(node)) {
        for (const item of node) collectBindings(item, reads, defines);
        return;
    }
    if (typeof node !== "object" || node === null) return;
    for (const [key, value] of Object.entries(node)) {
        if (typeof value === "string" && value.startsWith("$")) {
            if (key === "bind") defines.add(value);
            else if (key === "ref" || key === "binding")
                reads.add(value.split(".")[0]!);
        } else collectBindings(value, reads, defines);
    }
}

/**
 * CR 603.12 — "[action]. When you do, <effect>.": the effect becomes a
 * REFLEXIVE triggered ability, a separate stack object that announces its own
 * targets (CR 603.3d) once the action has been performed. `capture` is the only
 * data crossing into the body (`validateEffectScript`), so a body reading a
 * binding of the resolving ability ("that creature's power") has no antecedent
 * here and is refused rather than lowered with a dangling ref (CR 608.2h).
 */
function lowerReflexive(
    text: string,
    then: EffectSentenceIR,
    walk: SentenceWalk,
    site: SiteOptions
): Lowered<EffectOp[]> {
    const inner = walk.reflexive();
    const body = gatedSentence(then, inner, site);
    if (!body.ok) return body;
    const requirements = inner.targets.requirements();
    if (requirements.length > 1)
        return unlowerable(
            "a reflexive ability announcing more than one target group is not a printed form (CR 603.3d)"
        );
    const reads = new Set<string>();
    const defines = new Set<string>();
    collectBindings(body.value, reads, defines);
    for (const name of reads)
        if (!defines.has(name))
            return unlowerable(
                `a reflexive ability reads "${name}", which crosses no capture (CR 608.2h)`
            );
    return lowered([
        {
            op: "reflexiveTrigger",
            oracleText: text.endsWith(".") ? text : `${text}.`,
            ...(requirements.length === 1
                ? { targetRequirement: requirements[0]! }
                : {}),
            effects: body.value,
        },
    ]);
}

function gatedSentence(
    sentence: EffectSentenceIR,
    walk: SentenceWalk,
    site: SiteOptions
): Lowered<EffectOp[]> {
    const antecedent = walk.libraryLookedAt;
    const actedOn = walk.actedOn;
    const inner = lowerSentence(sentence, walk, site);
    walk.libraryLookedAt = antecedent;
    // An object put onto the battlefield behind the gate may not exist, and
    // one put there before it may no longer be the nearest antecedent: no
    // later sentence names either.
    walk.introduced = null;
    // A removal behind the gate may or may not have happened, and the restore
    // below forgets it: remember that the announced object's fate is unknown.
    if (walk.actedOn !== actedOn) walk.gatedRemoval = true;
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

/** CR 401.4 — the picker's prompt for a `putBack`. */
function putBackPrompt(count: number): string {
    return count === 1
        ? "Choose a card from your hand to put on top of your library."
        : `Choose ${countWord(count)} cards from your hand to put on top of your library (last picked ends up on top).`;
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

/**
 * CR 110.2 + CR 608.2h — "that creature's controller" as a damage recipient.
 *
 * Read only when the spell announced exactly ONE target and it is a single
 * creature: with two announced objects "that creature" could name either, and
 * a guess would hit the wrong player. A creature the earlier sentence removed
 * (destroy) is gone from the battlefield by the time this sentence resolves, so
 * its controller is read from the `bind` snapshot (CR 608.2h last-known
 * information); a creature that stays (tap, pump, counter) is read live.
 */
function lowerThatCreatureController(
    walk: SentenceWalk
): Lowered<{ player: EffectPlayerRef }> {
    const announced = walk.targets.requirements();
    const only = announced.length === 1 ? announced[0]! : null;
    if (
        only === null ||
        only.type !== "Creature" ||
        only.count !== 1 ||
        only.announcedOnlyIfKicked === true ||
        walk.gatedRemoval
    )
        return unlowerable(
            '"that creature\'s controller" names no single creature target announced before it (CR 608.2h)'
        );
    const actedOn = walk.actedOn;
    if (actedOn === null)
        return lowered({ player: { controllerOf: { target: 0 } } });
    const bind = actedOn.op.bind ?? walk.nextBind("that");
    actedOn.op.bind = bind;
    return lowered({ player: { ref: `${bind}.controller` } });
}

/**
 * CR 109.4 + CR 608.2h — "its controller" / "that artifact's controller" as a
 * life recipient: the controller of the one announced object the sentence
 * before acted on, read from the `bind` snapshot the acting Op took (the
 * object has left the battlefield by now). `noun` is "it" or a card type,
 * which must be the type of the one announced target.
 */
function lowerActedOnController(
    noun: string,
    walk: SentenceWalk
): Lowered<EffectPlayerRef> {
    const announced = walk.targets.requirements();
    const only = announced.length === 1 ? announced[0]! : null;
    const actedOn = walk.actedOn;
    if (
        only === null ||
        only.count !== 1 ||
        only.announcedOnlyIfKicked === true ||
        walk.gatedRemoval ||
        actedOn === null ||
        actedOn.requirement !== only ||
        // CR 109.4 — only a battlefield permanent has a controller; a card in
        // a graveyard snapshots its owner there.
        (only.zone !== undefined && only.zone !== "battlefield") ||
        (noun !== "it" &&
            announcedTypes(only).join() !==
                noun.charAt(0).toUpperCase() + noun.slice(1))
    )
        return unlowerable(
            `"${noun === "it" ? "its" : `that ${noun}'s`} controller" names no single object announced and acted on before it (CR 608.2h)`
        );
    const bind = actedOn.op.bind ?? walk.nextBind("that");
    actedOn.op.bind = bind;
    return lowered({ ref: `${bind}.controller` });
}

/**
 * CR 120.1 + CR 608.2h — "that <noun>" as a damage SOURCE: the object the
 * last sentence acted on, named by the same noun its announcement printed
 * ("Destroy target artifact. That artifact deals …"). A noun that is not
 * that announcement's single type names some other object, and is refused.
 */
function actedOnDealer(
    noun: string,
    walk: SentenceWalk
): Lowered<EffectObjectSelector> {
    const actedOn = walk.actedOn;
    if (actedOn === null)
        return unlowerable(
            `"that ${noun}" names no object acted on before it (CR 608.2h)`
        );
    const { type, zone, count } = actedOn.requirement;
    if (
        typeof type !== "string" ||
        type.toLowerCase() !== noun ||
        count !== 1 ||
        (zone !== undefined && zone !== "battlefield")
    )
        return unlowerable(
            `"that ${noun}" is not the ${JSON.stringify(type)} acted on before it (CR 608.2h)`
        );
    const bind = actedOn.op.bind ?? walk.nextBind("that");
    actedOn.op.bind = bind;
    return lowered({ ref: bind });
}

/** Remember the announced object a sentence acted on (see `actedOn`). */
function recordActedOn(
    walk: SentenceWalk,
    subject: SubjectIR,
    op: EffectOp
): void {
    if (subject.kind !== "target") return;
    if (
        op.op === "destroy" ||
        op.op === "exile" ||
        (op.op === "moveZone" && "target" in op)
    )
        walk.actedOn = { op, requirement: subject.requirement };
}

/**
 * CR 603.2 + CR 400.7 — the one frame chain whose "you may" folds into the
 * pick: a single `moveZone` frame of a chosen card from the controller's own
 * zone, printed with a quantity of exactly one. `null` for every other
 * optional sentence, which keeps the `mayPay` gate.
 */
function optionalChosenMove(
    sentence: EffectSentenceIR
): Extract<FrameIR, { frame: "moveZone" }> | null {
    if (sentence.kind !== undefined || sentence.frames.length !== 1)
        return null;
    const frame = sentence.frames[0]!;
    if (frame.frame !== "moveZone" || frame.object.kind !== "chosen")
        return null;
    return frame.object.count === 1 ? frame : null;
}

/**
 * CR 400.7 — "You may put a <descriptor> card from your hand onto the
 * battlefield": a 0..1 pick of the controller's own zone, then the `moveZone`
 * of that pick. The pick's range IS the "may" (declining picks nothing), and
 * the prompt is the printed clause behind its "You may", the shape every
 * hand-written hand→battlefield drop writes (Goblin Lackey).
 */
function lowerOptionalChosenMove(
    frame: Extract<FrameIR, { frame: "moveZone" }>,
    clause: string
): Lowered<EffectOp[]> {
    if (frame.object.kind !== "chosen") return unlowerable("not a chosen pick");
    return lowered(
        chosenMoveOps(
            frame.object,
            frame.to,
            frame.tapped,
            "$picked",
            `You may ${clause}.`,
            { min: 0, max: 1 }
        )
    );
}

/**
 * CR 400.7 — the `choice` of cards out of the controller's own hand or
 * graveyard and the `moveZone` of the picks, in that order: the two Ops the
 * chosen-card class of the moveZone frame lowers to.
 */
function chosenMoveOps(
    object: Extract<MoveObjectIR, { kind: "chosen" }>,
    to: ZoneRefIR,
    tapped: boolean,
    bind: string,
    prompt: string,
    count: Extract<EffectOp, { op: "choice" }>["count"]
): EffectOp[] {
    const choice: Extract<EffectOp, { op: "choice" }> = {
        op: "choice",
        kind:
            object.zone === "hand"
                ? "choose-hand-card"
                : "choose-graveyard-card",
        player: "controller",
        zone: object.zone,
        ...(Object.keys(object.filter).length > 0
            ? { filter: object.filter }
            : {}),
        count,
        prompt,
        bind,
    };
    return [
        choice,
        {
            op: "moveZone",
            cards: { ref: bind },
            player: "controller",
            from: object.zone,
            to: movableDestination(to),
            ...(tapped ? { tapped: true } : {}),
        },
    ];
}

/**
 * CR 400.1 — a frame destination as the `cards`-shape `moveZone` names it:
 * the top of the library is its own value, the bottom is the plain library
 * (the leg pushes, i.e. bottoms, the card).
 */
function movableDestination(to: ZoneRefIR): EffectMoveZone | "library-top" {
    if (to.zone === "library")
        return to.position === "top" ? "library-top" : "library";
    return to.zone;
}

/**
 * CR 101.4 — "Each player [may] put[s] a <type> card from their
 * graveyard/hand onto the battlefield": a `forEach` over the players, each
 * choosing one of their own cards, then the `moveZone` of that choice.
 */
function lowerEachPlayerPuts(
    sentence: Extract<EffectSentenceIR, { kind: "each-player-puts" }>,
    site: SiteOptions
): Lowered<EffectOp[]> {
    const { from, types, optional } = sentence;
    const noun = types.map((type) => type.toLowerCase());
    const list =
        noun.length === 1
            ? noun[0]!
            : `${noun.slice(0, -1).join(", ")}, or ${noun[noun.length - 1]}`;
    const article = /^[aeiou]/.test(list) ? "an" : "a";
    const bind = "$picked";
    return lowered([
        {
            op: "forEach",
            select: { set: "players" },
            effects: [
                {
                    op: "choice",
                    kind:
                        from === "graveyard"
                            ? "choose-graveyard-card"
                            : "choose-hand-card",
                    player: { ref: "$each" },
                    zone: from,
                    filter: {
                        type: types.length === 1 ? types[0]! : [...types],
                    },
                    count: optional ? { min: 0, max: 1 } : 1,
                    prompt: `${site.selfName}: put ${article} ${list} card from your ${from} onto the battlefield${optional ? " (or none)" : ""}.`,
                    bind,
                },
                {
                    op: "moveZone",
                    cards: { ref: bind },
                    player: { ref: "$each" },
                    from,
                    to: "battlefield",
                },
            ],
        },
    ]);
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
    walk: SentenceWalk,
    site: SiteOptions
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
        // CR 111.1 — ONE token is an object later sentences can name; the
        // Op's `bind` names only the last of several, so more name none.
        else
            walk.introduced = {
                op,
                creature: true,
                slots: walk.targets.requirements().length,
            };
        return lowered([op]);
    }
    if (count.kind === "announced-x") {
        // CR 107.3 — the count is the spell's own announced X.
        const x = lowerAmount({ kind: "x" }, site);
        if (!x.ok) return x;
        op.count = x.value;
        return lowered([op]);
    }
    if (count.kind === "nontoken-creatures-to-your-graveyard-this-turn") {
        // CR 700.4 — the controller's own per-turn tally: "your graveyard" is
        // the graveyard of the player who controls the ability.
        op.count = {
            nontokenCreaturesToGraveyardThisTurn: { of: "controller" },
        };
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
    if (route.kind === "pick-from-among") {
        // CR 608.2c — "them" is the window: one card the filter admits, which
        // the controller may decline ("You may"). CR 701.20a — a revealed
        // window shows every card; a look shows only the card "reveal it"
        // names, after the pick. `foldLibraryRoute` admits only those two.
        const op: Extract<EffectOp, { op: "lookDistribute" }> = {
            op: "lookDistribute",
            keepTo: "hand",
            player: "controller",
            look: look.value,
            take: 1,
            filter: route.pick.pick.filter,
            optional: true,
            reveal: sentence.reveal ? "window" : "kept",
        };
        return lowered([withLibraryRest(op, route.rest)]);
    }
    if (route.kind === "pick-per-type") {
        // CR 205.2a + CR 608.2c — one keep per card type out of the revealed
        // window; a card of several types is kept for only one of them.
        const op: Extract<EffectOp, { op: "revealAndCategorize" }> = {
            op: "revealAndCategorize",
            player: "controller",
            look: look.value,
            reveal: "window",
            optional: true,
            categories: CARD_TYPES.map((type) => ({
                label: type,
                filter: { type },
            })),
            prompt: "Put up to one card of each card type into your hand.",
        };
        if (route.rest === "graveyard") op.destination = "graveyard";
        if (route.rest === "bottom-random-order") op.randomBottom = true;
        return lowered([op]);
    }
    const take = lowerAmount(route.count, site);
    if (!take.ok) return take;
    const op: Extract<EffectOp, { op: "lookDistribute" }> = {
        op: "lookDistribute",
        keepTo: "hand",
        player: "controller",
        look: look.value,
        take: take.value,
    };
    return lowered([withLibraryRest(op, route.rest)]);
}

/**
 * CR 701.17a + CR 400.2 — "Mill N cards. You may put a land card from among
 * them into your hand.": the pick reaches EXACTLY the cards this mill put into
 * the graveyard, never one that was already there. `mill.bindAll` records the
 * milled set and the public-zone `choice.candidates` scopes the pick to it
 * (issue #2600). Only your own mill: "your hand" is the controller's, and a
 * card milled from another player's library is not theirs to take.
 */
function lowerMillPick(
    player: EffectPlayerRef,
    count: EffectValue,
    pick: AmongPickSentenceIR,
    walk: SentenceWalk
): Lowered<EffectOp[]> {
    if (player !== "controller")
        return unlowerable('"from among them" picks from your own mill only');
    // CR 400.2 — a milled card is public; there is nothing for "reveal" to show.
    if (pick.reveal)
        return unlowerable(
            'a milled card is already public; "reveal it" shows nothing'
        );
    const milled = walk.nextBind("milled");
    const picked = walk.nextBind("pick");
    return lowered([
        { op: "mill", player, count, bindAll: milled },
        {
            op: "choice",
            kind: "choose-graveyard-card",
            player: "controller",
            zone: "graveyard",
            candidates: [{ ref: milled }],
            filter: pick.pick.filter,
            count: { min: 0, max: 1 },
            prompt: `You may put ${pick.pick.card} from among the milled cards into your hand.`,
            bind: picked,
        },
        {
            op: "moveZone",
            cards: { ref: picked },
            player: "controller",
            from: "graveyard",
            to: "hand",
        },
    ]);
}

/** CR 401.4 — where the cards a `lookDistribute` does not keep go. */
function withLibraryRest(
    op: Extract<EffectOp, { op: "lookDistribute" }>,
    rest: LibraryRestIR
): Extract<EffectOp, { op: "lookDistribute" }> {
    if (rest === "graveyard") op.destination = "graveyard";
    if (rest === "bottom-random-order") op.randomBottom = true;
    return op;
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
    site: SiteOptions,
    under?: "you",
    tapped = false
): Lowered<EffectOp[]> {
    // CR 110.5b — "onto the battlefield tapped": the entering permanent.
    const entering = (
        op: Extract<EffectOp, { op: "moveZone" }>
    ): Extract<EffectOp, { op: "moveZone" }> =>
        tapped ? { ...op, tapped: true } : op;
    // CR 110.2a + CR 400.7 — "put target creature card from a graveyard onto
    // the battlefield under your control": ANY graveyard, the controller of
    // the ability controls the new object. One announced permanent card.
    if (under === "you") {
        if (
            zone.zone !== "battlefield" ||
            subject.kind !== "target" ||
            subject.requirement.zone !== "graveyard" ||
            subject.requirement.count !== 1 ||
            typeof subject.requirement.type !== "string" ||
            !ACTED_ON_PERMANENT_TYPES.has(subject.requirement.type)
        )
            return unlowerable(
                "only one permanent card from a graveyard is put under your control in grammar v0"
            );
        const taken = objectSelectors(subject, slots, site);
        if (!taken.ok) return taken;
        return lowered(
            taken.value.map((target) =>
                entering({
                    op: "moveZone",
                    target,
                    to: "battlefield",
                    controller: "controller",
                })
            )
        );
    }
    // CR 400.7e — "return that card to its owner's hand": the card the site's
    // zone change put into a graveyard. Only the hand is read — the one
    // destination a printed line asks for — so no other zone pair is claimed.
    if (subject.kind === "that-card") {
        const card = site.antecedents?.card;
        if (card === undefined)
            return unlowerable('"that card" names no card at this site');
        // CR 701.13a — "exile that card": the card sits in a graveyard, so it
        // is the graveyard-card `moveZone`, not the battlefield `exile` Op.
        if (zone.zone === "exile")
            return lowered([{ op: "moveZone", target: card, to: "exile" }]);
        // CR 110.2a — "return that card to the battlefield", only behind a
        // head that makes the card's owner the ability's controller.
        if (zone.zone === "battlefield") {
            if (site.antecedents?.cardOwnedByController !== true)
                return unlowerable(
                    '"that card" may be put onto the battlefield only from its controller\'s own graveyard'
                );
            return lowered([
                entering({ op: "moveZone", target: card, to: "battlefield" }),
            ]);
        }
        // CR 401.2 — "put it on top of / on the bottom of its owner's
        // library": the card moves by id and the top is the 1-based slot the
        // target shape repositions to; no position pushes, i.e. bottoms it.
        if (zone.zone === "library" && zone.owner === "its-owner")
            return lowered([
                zone.position === "top"
                    ? { op: "moveZone", target: card, to: "library-top" }
                    : { op: "moveZone", target: card, to: "library" },
            ]);
        if (zone.zone !== "hand" || zone.owner !== "its-owner")
            return unlowerable(
                "\"that card\" is returned only to its owner's hand, to exile, to the battlefield or to an end of its owner's library"
            );
        return lowered([{ op: "moveZone", target: card, to: "hand" }]);
    }
    // CR 400.3 + CR 110.1 — "Return all permanents to their owners' hands":
    // one `moveZone` to the hand per swept permanent. Only the hand: it is the
    // one destination a printed sweep return asks for.
    if (subject.kind === "mass") {
        if (zone.zone !== "hand" || zone.owner !== "its-owner")
            return unlowerable(
                "a sweep is returned to its owners' hands in grammar v0"
            );
        return sweepOps(subject, site, slots, (target) => ({
            op: "moveZone",
            target,
            to: "hand",
        }));
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
    // ONE target: N cards returned by one instruction enter together, which a
    // sequence of single `moveZone` Ops does not say, and no corpus card prints
    // it. ONE permanent type: a list in `requirement.type` is an OR to the
    // engine ("artifact creature card" would admit any artifact card or any
    // creature card), and a non-permanent type ("card", instant, sorcery) names
    // an object that cannot enter the battlefield.
    const reanimated =
        zone.zone === "battlefield" &&
        subject.kind === "target" &&
        subject.requirement.zone === "graveyard" &&
        subject.requirement.controller === "you" &&
        subject.requirement.count === 1 &&
        typeof subject.requirement.type === "string" &&
        ACTED_ON_PERMANENT_TYPES.has(subject.requirement.type);
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
    if (reanimated)
        return lowered(
            targets.value.map((target) =>
                entering({ op: "moveZone", target, to: "battlefield" })
            )
        );
    // CR 400.3 — "put target creature you control on top of its owner's
    // library": an object only ever reaches its OWNER's library, and "on top"
    // is the 1-based `position: 1` that `moveZone` ships (Teferi, Oust). One
    // announced object only: N objects put on top at once need the owner's
    // chosen order, which a sequence of single Ops does not give.
    const oneObject =
        (subject.kind === "target" && subject.requirement.count === 1) ||
        subject.kind === "self" ||
        subject.kind === "pronoun" ||
        subject.kind === "that-creature";
    // CR 401.2 — "on top of its owner's library": a battlefield permanent
    // takes the 1-based `position: 1`; a card that may sit in a graveyard —
    // an announced graveyard card, "that card", or the source / "it" behind
    // a head that put it there — takes `to: "library-top"`, the one value
    // the graveyard leg repositions with (a `position` on a graveyard card
    // is ignored by the engine and the card is appended, i.e. bottomed).
    const maybeInGraveyard =
        (subject.kind === "target" &&
            subject.requirement.zone === "graveyard") ||
        ((subject.kind === "self" || subject.kind === "pronoun") &&
            site.antecedents?.card !== undefined);
    if (
        zone.zone === "library" &&
        zone.owner === "its-owner" &&
        zone.position === "top" &&
        oneObject
    )
        return lowered(
            targets.value.map((target) =>
                maybeInGraveyard
                    ? { op: "moveZone", target, to: "library-top" }
                    : { op: "moveZone", target, to: "library", position: 1 }
            )
        );
    // CR 401.2 — "on the bottom of its owner's library": `"bottom"` is the
    // position the battlefield leg takes; a graveyard-sourced card is pushed,
    // which bottoms it, so the position is written only for a permanent.
    if (
        zone.zone === "library" &&
        zone.owner === "its-owner" &&
        zone.position === "bottom" &&
        oneObject
    )
        return lowered(
            targets.value.map((target) =>
                subject.kind === "target" &&
                subject.requirement.zone === "graveyard"
                    ? { op: "moveZone", target, to: "library" }
                    : {
                          op: "moveZone",
                          target,
                          to: "library",
                          position: "bottom",
                      }
            )
        );
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

const COLOR_CATEGORIES: readonly { label: string; color: Color }[] = [
    { label: "White", color: "W" },
    { label: "Blue", color: "U" },
    { label: "Black", color: "B" },
    { label: "Red", color: "R" },
    { label: "Green", color: "G" },
];

/**
 * CR 101.4 + CR 701.21a / CR 701.9a — `chooseCategorized` over a closed
 * category axis. Every player's pick is made (APNAP order) before any
 * sacrifice, so the sacrificing leg is `simultaneous`; a hand is revealed
 * (CR 701.20a) to everyone before the colour pick, as a pass of its own.
 */
function lowerChooseOnePerCategory(
    sentence: Extract<EffectSentenceIR, { kind: "choose-one-per-category" }>
): EffectOp[] {
    const eachPlayer = (
        effects: EffectOp[],
        simultaneous = false
    ): EffectOp => ({
        op: "forEach",
        select: { set: "players" },
        ...(simultaneous ? { simultaneous: true } : {}),
        effects,
    });
    const player: EffectPlayerRef = { ref: "$each" };
    if (sentence.axis === "color")
        return [
            eachPlayer([{ op: "reveal", player, zone: "hand" }]),
            eachPlayer([
                {
                    op: "chooseCategorized",
                    player,
                    zone: "hand",
                    categories: COLOR_CATEGORIES.map(({ label, color }) => ({
                        label,
                        filter: { color },
                    })),
                    onPicked: "keep",
                    sweep: {
                        filter: { excludeType: "Land" },
                        action: "discard",
                    },
                    prompt: "Choose one card of each color to keep.",
                },
            ]),
        ];
    const categories = Object.keys(LAND_SUBTYPE_MANA).map((subtype) => ({
        label: subtype,
        filter: { subtype },
    }));
    if (sentence.rest === "return-chosen")
        return [
            eachPlayer([
                {
                    op: "chooseCategorized",
                    player,
                    zone: "battlefield",
                    categories,
                    onPicked: "returnToHand",
                    prompt: "Choose a land of each basic land type to return to hand.",
                },
            ]),
        ];
    return [
        eachPlayer(
            [
                {
                    op: "chooseCategorized",
                    player,
                    zone: "battlefield",
                    categories,
                    onPicked: "keep",
                    sweep: { filter: { type: "Land" }, action: "sacrifice" },
                    prompt: "Choose a land of each basic land type to keep; the rest are sacrificed.",
                },
            ],
            true
        ),
    ];
}
