/**
 * Characteristic-setting static frames (CR 613, issue #4565).
 *
 * The static-clause sub-grammar's anthem and keyword frames only ADD to what a
 * permanent already is (CR 613.4c, 613.1f). The four frames here SET a
 * characteristic instead, and each lowers to the layer its rule names:
 *
 *   "<set> lose all abilities and have base power and toughness N/N"
 *                                            → layer 6 `ability-loss` + 7b `pt-set`
 *   "All creatures of the chosen type get +N/+N"
 *                                            → layer 7c `pt-buff`, chosen-type scope
 *   "Each other non-Aura enchantment is a creature in addition to its other
 *    types and has base power and base toughness each equal to its mana value"
 *                                            → layer 4 `type-add` + `pt-cda`
 *   "<self>'s power and toughness are each equal to the number of land cards
 *    in all graveyards"                      → CR 604.3 `pt-cda`, self scope
 *
 * Every filter is read MATERIALISED: `type-add` and `ability-loss` are applied
 * imperatively when a permanent enters (`compiledStatics.ts`), so a clause
 * over mutable combat or tap state would be inert on a card that reads
 * `ready`. Each frame is anchored on its whole sentence; a neighbour with a
 * different verb, quantity or characteristic is refused, never partly read.
 */

import { isSelfPhrase } from "./cost";
import { signedModifier } from "./effectClause";
import { descriptorRule, staticFilterFromDescriptor } from "./targetFilter";
import {
    fail,
    ok,
    pattern,
    rule,
    type Rule,
    type RuleResult,
} from "../../rule";
import type { CardType, PermanentFilter } from "../../../cards/types";

/** What one characteristic-setting static line means. */
export type CharacteristicStaticIR =
    /** CR 613.1f / 613.4b — "<set> lose all abilities and have base P/T N/N". */
    | {
          readonly kind: "ability-loss-pt-set";
          readonly filter: PermanentFilter;
          readonly power: number;
          readonly toughness: number;
      }
    /** CR 607.2d / 613.4c — "All creatures of the chosen type get +N/+N". */
    | {
          readonly kind: "chosen-type-pt-buff";
          readonly power: number;
          readonly toughness: number;
      }
    /** CR 613.1d / 613.4 — "<each> is a <type> in addition to its other types
     *  and has base power and toughness each equal to its mana value". */
    | {
          readonly kind: "animate-mana-value-pt";
          readonly filter: PermanentFilter;
          readonly addTypes: readonly CardType[];
      }
    /** CR 604.3 — "<self>'s power and toughness are each equal to the number
     *  of <type> cards in all graveyards". */
    | {
          readonly kind: "self-pt-cda-graveyards";
          readonly cardTypes: readonly CardType[];
      };

/** CR 205.2a — the card-type words a graveyard count may name. */
const CARD_TYPE_WORDS: ReadonlyMap<string, CardType> = new Map<
    string,
    CardType
>([
    ["artifact", "Artifact"],
    ["creature", "Creature"],
    ["enchantment", "Enchantment"],
    ["land", "Land"],
    ["planeswalker", "Planeswalker"],
]);

const ABILITY_LOSS_PT_SET =
    /^(.+) lose all abilities and have base power and toughness (\d+)\/(\d+)$/;

/**
 * Humility. CR 613.1f strips the abilities (layer 6) and CR 613.4b sets the
 * base P/T (sublayer 7b): one clause, two effects, one filter. The subject is
 * a plural set — "All creatures" — read by the shared descriptor, with a
 * leading "All " carrying no filtering meaning.
 */
export const abilityLossPtSetRule: Rule<CharacteristicStaticIR> = pattern(
    "ability loss and base P/T",
    ABILITY_LOSS_PT_SET,
    (match): RuleResult<CharacteristicStaticIR> => {
        const subject = match[1]!;
        const head = subject.startsWith("All ")
            ? subject.slice("All ".length)
            : subject;
        const descriptor = descriptorRule.run(head, undefined);
        if (!descriptor.ok) return descriptor;
        if (descriptor.value.plural !== true)
            return fail("a set of permanents needs a plural subject", subject);
        const filter = staticFilterFromDescriptor(
            descriptor.value,
            "materialised"
        );
        if (!filter.ok) return filter;
        return ok({
            kind: "ability-loss-pt-set" as const,
            filter: filter.value,
            power: Number(match[2]),
            toughness: Number(match[3]),
        });
    }
);

const CHOSEN_TYPE_PUMP =
    /^All creatures of the chosen type get ([+-]\d+)\/([+-]\d+)$/;

/**
 * Engineered Plague. "The chosen type" is the creature type the SOURCE chose as
 * it entered (CR 607.2d, 614.12a) — `lower.ts` checks the card prints the
 * as-enters choice, since this per-line rule cannot see the other lines.
 */
export const chosenTypePumpRule: Rule<CharacteristicStaticIR> = pattern(
    "chosen type pump",
    CHOSEN_TYPE_PUMP,
    (match): RuleResult<CharacteristicStaticIR> =>
        ok({
            kind: "chosen-type-pt-buff" as const,
            power: signedModifier(match[1]!),
            toughness: signedModifier(match[2]!),
        })
);

const ANIMATE_MANA_VALUE =
    /^Each (.+) is an? (\S+) in addition to its other types and has base power and base toughness each equal to its mana value$/;

/**
 * Opalescence. CR 205.1b: "in addition to its other types" ADDS the card type
 * (layer 4, CR 613.1d) rather than replacing the type line; the base P/T is
 * "its" mana value — the AFFECTED permanent's (CR 202.3), not the source's.
 * "Each other …" excludes the source (CR 109.2).
 */
export const animateManaValueRule: Rule<CharacteristicStaticIR> = pattern(
    "animate with mana value P/T",
    ANIMATE_MANA_VALUE,
    (match): RuleResult<CharacteristicStaticIR> => {
        const subject = match[1]!;
        const other = subject.startsWith("other ");
        const descriptor = descriptorRule.run(
            other ? subject.slice("other ".length) : subject,
            undefined
        );
        if (!descriptor.ok) return descriptor;
        if (descriptor.value.plural === true)
            return fail('"Each" introduces a singular descriptor', subject);
        const filter = staticFilterFromDescriptor(
            descriptor.value,
            "materialised"
        );
        if (!filter.ok) return filter;
        const added = CARD_TYPE_WORDS.get(match[2]!);
        if (added === undefined)
            return fail(`"${match[2]}" is not a card type`, match[2]!);
        return ok({
            kind: "animate-mana-value-pt" as const,
            filter: other
                ? { ...filter.value, excludeSource: true }
                : filter.value,
            addTypes: [added],
        });
    }
);

const SELF_CDA_GRAVEYARDS =
    /^(.+)'s power and toughness are each equal to the number of (\S+) cards in all graveyards$/;

/**
 * Terravore. A characteristic-defining ability (CR 604.3) over a count of cards
 * of one type in every graveyard (CR 404.1). Only a card-type word is a count
 * this frame reads: "creature cards in all graveyards" is the same form,
 * "cards in your graveyard" is another and refuses.
 */
export const selfPtCdaGraveyardsRule: Rule<CharacteristicStaticIR> = rule(
    "self P/T equal to graveyard cards",
    (span, ctx): RuleResult<CharacteristicStaticIR> => {
        const match = span.match(SELF_CDA_GRAVEYARDS);
        if (match === null)
            return fail(
                'not "<self>\'s power and toughness are each equal to …"',
                span
            );
        // The possessive keeps the card's own name out of `substituteSelf`
        // (a name followed by `'` is deliberately not substituted), so the
        // self reference is the printed name itself (CR 201.5).
        const subject = match[1]!;
        if (!isSelfPhrase(subject) && subject !== ctx?.card.name)
            return fail(`"${subject}" is not the permanent itself`, subject);
        const cardType = CARD_TYPE_WORDS.get(match[2]!);
        if (cardType === undefined)
            return fail(`"${match[2]}" is not a card type`, match[2]!);
        return ok({
            kind: "self-pt-cda-graveyards" as const,
            cardTypes: [cardType],
        });
    }
);
