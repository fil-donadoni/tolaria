/**
 * Shared sub-grammar: MASS SUBJECT — "all enchantments", "all lands you
 * control", "all other creatures you control", "each artifact, creature, and
 * enchantment with mana value X or less" (CR 109.2, CR 110.1).
 *
 * A mass subject names every permanent a descriptor matches, WITHOUT
 * announcing a target: nothing is chosen (CR 115.1), so the whole of its
 * lowering is a `forEach` over the battlefield rather than a target slot. It
 * reads the SAME descriptor a target does (`descriptorRule`) and adds only what
 * the determiner contributes, which is why it lives beside `targetFilter.ts`
 * and not as a second noun grammar.
 *
 * ── Three determiners, each with a fixture ─────────────────────────────────
 *
 * `all <plural>`, `all other <plural>` and `each <singular list>`. The number
 * of the noun is checked against the determiner — "all enchantment" and "each
 * enchantments" are not English, and a grammar that read them would be
 * accepting a sentence nobody printed. (For a noun LIST the descriptor reports
 * plural if ANY member is, so agreement is only enforced on a single noun; the
 * lowering of a list is the same either way.)
 *
 * "other" is the source excluding itself — the object the ability is printed
 * on — the same reflexive exclusion `forEach`'s `excludeSource` names.
 *
 * ── What is refused, and why it is not a gap in the reader ─────────────────
 *
 * The `forEach` selector expresses type, subtype, negated type and "you
 * control" — the descriptor fields whose engine meaning is one-to-one. A field
 * outside them (a colour, a keyword, a combat role, a power bound, another
 * controller) is refused HERE, by name, rather than dropped: a sweep that
 * silently ignored "white" would destroy every creature, and that is the
 * fail-open shape this compiler exists to prevent (ADR 0105). Each refusal
 * stays in the backlog under its own gap key.
 *
 * ── "with mana value X or less" ────────────────────────────────────────────
 *
 * Read HERE, not by the descriptor: the X is the announced {X} of the ability
 * (CR 107.3), a fact the descriptor's numeric bound cannot carry, and reading
 * it there would widen every target site to a form no fixture covers. A
 * `PermanentFilter` has no mana-value field, so the bound is not a filter
 * clause — it lowers to an `if` over the iterated permanent's mana value
 * inside the sweep, using only the four frozen constructs (ADR 0045).
 */

import { PERMANENT_TYPES } from "../../../cards/types";
import type { CardType, EffectForEachSelector } from "../../../cards/types";
import { fail, ok, rule, type Rule, subGrammar } from "../../rule";
import { descriptorRule, type DescriptorIR } from "./targetFilter";

export const MASS_SUBJECT = "mass subject";

/** The battlefield-sweep arm of the `forEach` selector (CR 110.1). */
export type PermanentSweepSelector = Extract<
    EffectForEachSelector,
    { set: "permanents" }
>;

/**
 * A mass subject as the sentence means it: the swept set, and whether it is
 * bounded by the announced X.
 */
export interface MassSubjectIR {
    readonly select: PermanentSweepSelector;
    /** CR 202.3 + CR 107.3 — "… with mana value X or less". */
    readonly manaValueAtMostX: boolean;
}

/** " with mana value X or less" — the one bound this sub-grammar reads. */
const MANA_VALUE_AT_MOST_X = / with mana value X or less$/;

/**
 * "artifact, creature, and enchantment" / "artifacts and enchantments" → the
 * or-list the descriptor reader knows. In a SWEEP the two are one set: "each
 * artifact, creature, and enchantment" is every permanent that is any of them
 * (CR 205.2a), so the conjunction is a union.
 *
 * Only a list of BARE single words is rewritten. An adjective on a member
 * ("nonland artifacts and creatures") is a scope question — does "nonland"
 * reach "creatures"? — that the descriptor reader has no reading for, so the
 * `and` is left where it is and the descriptor refuses the span.
 */
function conjunctionToDisjunction(noun: string): string {
    const list = noun.match(
        /^([A-Za-z]+(?:, [A-Za-z]+)*)(,)? and ([A-Za-z]+)(.*)$/
    );
    if (list === null) return noun;
    const [, head, comma, last, rest] = list as unknown as [
        string,
        string,
        string | undefined,
        string,
        string,
    ];
    return `${head}${comma ?? ""} or ${last}${rest}`;
}

/** Every permanent type, as a set — "permanent" names all of them. */
const ALL_PERMANENT_TYPES: ReadonlySet<CardType> = new Set(PERMANENT_TYPES);

/**
 * Descriptor → the `forEach` battlefield selector, or the reason the sweep has
 * no encoding. The accepted fields are exactly the ones below; everything else
 * refuses.
 */
function sweepSelector(
    descriptor: DescriptorIR,
    other: boolean,
    list: boolean
):
    | { readonly ok: true; readonly value: PermanentSweepSelector }
    | {
          readonly ok: false;
          readonly reason: string;
          readonly fragment: string;
      } {
    for (const field of Object.keys(descriptor)) {
        if (
            ![
                "types",
                "subtypes",
                "excludeTypes",
                "controller",
                "plural",
            ].includes(field)
        )
            return {
                ok: false,
                reason: `"${field}" is not expressible on a sweep selector`,
                fragment: field,
            };
    }
    // The descriptor does not record WHETHER several nouns came from a list (a
    // union) or from stacked words (an intersection), and `EffectCardFilter`
    // ORs within one field but ANDs across fields. So a noun list mixing card
    // types with subtypes ("artifacts and Forests") would lower to
    // `{ type, subtype }`, which matches only Forest artifacts — fewer objects
    // than the sentence names — and stacked subtypes ("Elf Warriors") would
    // lower to an OR of both, more. Both directions are refused; only a list of
    // types, a list of subtypes, or ONE subtype beside its card type
    // ("Elf creatures") has a single reading.
    if (
        list &&
        descriptor.types !== undefined &&
        descriptor.subtypes !== undefined
    )
        return {
            ok: false,
            reason: "a list mixing card types and subtypes has no single selector",
            fragment: "subtypes",
        };
    if (!list && (descriptor.subtypes?.length ?? 0) > 1)
        return {
            ok: false,
            reason: "stacked subtypes are an intersection a selector cannot express",
            fragment: "subtypes",
        };
    if (descriptor.controller === "opponent")
        return {
            ok: false,
            reason: "a sweep of the opponent's permanents is not in this grammar",
            fragment: "controller",
        };
    // "permanent" names every permanent type (CR 110.1), so a union that
    // covers them all constrains nothing — omitting it is what a hand-written
    // "destroy all nonland permanents" writes, and it is one clause fewer for
    // a reader to misread.
    const types = descriptor.types;
    const coversAll =
        types !== undefined &&
        types.length === ALL_PERMANENT_TYPES.size &&
        types.every((t) => ALL_PERMANENT_TYPES.has(t));
    const filter: NonNullable<PermanentSweepSelector["filter"]> = {};
    if (types !== undefined && !coversAll)
        filter.type = types.length === 1 ? types[0]! : [...types];
    const subtypes = descriptor.subtypes;
    if (subtypes !== undefined)
        filter.subtype = subtypes.length === 1 ? subtypes[0]! : [...subtypes];
    const excluded = descriptor.excludeTypes;
    if (excluded !== undefined)
        filter.excludeType =
            excluded.length === 1 ? excluded[0]! : [...excluded];
    const select: PermanentSweepSelector = {
        set: "permanents",
        zone: "battlefield",
        ...(descriptor.controller === "you"
            ? { controller: "controller" as const }
            : {}),
        ...(Object.keys(filter).length > 0 ? { filter } : {}),
        ...(other ? { excludeSource: true } : {}),
    };
    return { ok: true, value: select };
}

/**
 * `"all <plural descriptor>"`, `"all other <plural descriptor>"`,
 * `"each <singular descriptor>"`, read as one mass subject.
 *
 * All-consuming: the determiner, the optional "other" and the mana-value bound
 * are peeled off the span whole, and the remainder is the descriptor's to read
 * or refuse.
 */
export const massSubjectRule: Rule<MassSubjectIR> = subGrammar(
    MASS_SUBJECT,
    rule(MASS_SUBJECT, (span, ctx) => {
        let determiner: "all" | "each";
        let other = false;
        let rest: string;
        if (span.startsWith("all other ")) {
            determiner = "all";
            other = true;
            rest = span.slice("all other ".length);
        } else if (span.startsWith("all ")) {
            determiner = "all";
            rest = span.slice("all ".length);
        } else if (span.startsWith("each ")) {
            determiner = "each";
            rest = span.slice("each ".length);
        } else {
            return fail('a mass subject opens with "all" or "each"', span);
        }
        const bounded = MANA_VALUE_AT_MOST_X.test(rest);
        if (bounded) rest = rest.replace(MANA_VALUE_AT_MOST_X, "");
        const descriptor = descriptorRule.run(
            conjunctionToDisjunction(rest),
            ctx
        );
        if (!descriptor.ok) return descriptor;
        const plural = descriptor.value.plural === true;
        if (determiner === "all" && !plural)
            return fail('"all" is followed by a plural noun', span);
        if (determiner === "each" && plural)
            return fail('"each" is followed by a singular noun', span);
        // A noun LIST — commas, "and" or "or" — is a union of its members.
        const selector = sweepSelector(
            descriptor.value,
            other,
            /, | and | or /.test(rest)
        );
        if (!selector.ok) return fail(selector.reason, selector.fragment);
        return ok({ select: selector.value, manaValueAtMostX: bounded });
    })
);
