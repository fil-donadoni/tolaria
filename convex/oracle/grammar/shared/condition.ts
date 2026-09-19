/**
 * Shared sub-grammar: CONDITION — the intervening-if clause on a trigger
 * (CR 603.4), "…, if you control a Goblin, …".
 *
 * "Dropped intervening-if" is a named competitor misparse: the ability still
 * triggers, so nothing looks broken until the game state quietly diverges. The
 * fail-closed half of that rule is what this file is — a condition phrase the
 * grammar cannot read fails the LINE, so the trigger is never emitted without
 * its gate.
 *
 * ── Why v1 knows exactly one condition ─────────────────────────────────────
 *
 * The corpus measurement behind #2698 is the whole argument: of the trigger
 * lines carrying an intervening-if, 1,113 cards sit behind 1,086 DISTINCT
 * condition fragments — an almost perfectly flat tail, where "if this land is
 * tapped" (5 cards) is near the TOP. There is no head to this distribution, so
 * a vocabulary sized to it would be a hundred one-card rules, each a fresh
 * chance to misread a clause. `controls` is the one shape that repeats across
 * unrelated cards, and the next member is earned by a fragment count rather
 * than by anticipation — the same rule an Effect Op earns its registry row by
 * (ADR 0045).
 */

import {
    fail,
    ok,
    rule,
    type Rule,
    type RuleResult,
    subGrammar,
} from "../../rule";
import { readManaCost } from "../../manaCost";
import { SELF_MARKER } from "../../normalize";
import { readNumberWord } from "./quantity";
import { descriptorRule, permanentFilterFromDescriptor } from "./targetFilter";
import type { PermanentFilter } from "../../../cards/filters";
import type { ManaCost } from "../../../cards/types";

export const CONDITION = "condition";

/**
 * A condition, in the sentence's own vocabulary.
 *
 * `atLeast` rather than a bare boolean because CR 603.4 conditions count
 * ("if you control two or more Goblins"); v1 only READS the singular article,
 * but the field means the comparison rather than the phrasing, so the plural
 * rule that arrives later changes the grammar and not the IR.
 */
export type ConditionIR = {
    readonly kind: "controls";
    readonly filter: PermanentFilter;
    readonly atLeast: number;
};

/**
 * The conditions an intervening "if" reads (CR 603.4): `controls`, shared with
 * the resolution-time and static sites, plus the members that only make sense
 * on a trigger because they name the TRIGGERING player ("that player") — a
 * referent a static ability has no event to take from.
 */
export type TriggerConditionIR =
    | ConditionIR
    /**
     * CR 305.6 — "if there are four or more basic land types among lands
     * that player controls" (Mask of Intolerance, issue #4127). "that
     * player" is anaphora: lowering binds it to the head's named player, or
     * refuses the line.
     */
    | {
          readonly kind: "basic-land-types";
          readonly player: "that-player";
          readonly atLeast: number;
      };

const ARTICLES: readonly string[] = ["a ", "an "];

/**
 * Filter clauses the CONDITION cannot decide, and therefore must not compile.
 *
 * `conditionHolds` (`cards/compiledTriggers.ts`) evaluates the filter against
 * the `TriggerStateView` battlefield rows, whose `supertypes` is OPTIONAL: a
 * live `CardInstanceState` carries no bare `supertypes` field (CR 205.4a
 * supertypes are printed-plus-mutations, which is why the cost path injects a
 * `supertypesOf` resolver), so `matchesPermanentFilter` falls through to `[]`
 * and a supertype clause matches NOTHING. "If you control a legendary
 * creature" would compile `ready` and then never fire — a row that is
 * playable-looking and plays wrong, which is precisely the class ADR 0105
 * exists to deny. Refused here until the condition can read the live value.
 */
const UNEVALUABLE_FILTER_KEYS = [
    "supertypes",
    "excludeSupertypes",
] as const satisfies readonly (keyof PermanentFilter)[];

/**
 * `"if you control a Goblin"` (CR 603.4 / 109.5 — "you" is the ability's
 * controller).
 *
 * The controller relation lives in the CONDITION, not in the descriptor: the
 * clause already says "you control", so a descriptor that ALSO carried a
 * controller clause ("if you control a creature you control") would be a
 * phrase we have misread. `permanentFilterFromDescriptor` refuses a
 * `controller` field outright, which is exactly that check and is not repeated
 * here.
 */
export const conditionRule: Rule<TriggerConditionIR> = subGrammar(
    CONDITION,
    rule<TriggerConditionIR>(CONDITION, (span, ctx) => {
        const opener = "if ";
        if (!span.startsWith(opener))
            return fail("not a condition this grammar knows", span);
        const clause = span.slice(opener.length);
        const domain = clause.match(BASIC_LAND_TYPES);
        if (domain !== null) return readBasicLandTypes(domain[1]!, span);
        return controlsRule.run(clause, ctx);
    }),
    // CR 603.4 — an intervening "if" clause opens with the word itself.
    (span) => /^if /i.test(span)
);

/** CR 305.6 — the domain count, over the triggering player's lands. */
const BASIC_LAND_TYPES =
    /^there are (\S+) or more basic land types among lands that player controls$/;

/**
 * CR 305.6 — five basic land types exist, so a threshold is a number word from
 * two to five: "one or more" is not how the corpus prints "a basic land type",
 * and anything past five is a threshold no board can meet — both a phrase we
 * have misread.
 */
function readBasicLandTypes(
    word: string,
    span: string
): RuleResult<TriggerConditionIR> {
    const atLeast = /^[a-z]+$/.test(word) ? readNumberWord(word) : null;
    if (atLeast === null || atLeast < 2 || atLeast > 5)
        return fail(`"${word}" is not a basic-land-type threshold`, span);
    return ok({
        kind: "basic-land-types" as const,
        player: "that-player" as const,
        atLeast,
    });
}

/**
 * `"you control a Goblin"` — the controls clause itself, without the word that
 * introduces it. Shared by the three sites that print it: the intervening "if"
 * above (CR 603.4), a resolution-time "If you control …, … instead" (CR 608.2c)
 * and a static's "as long as you control …" (CR 611.3a). One reading for all
 * three, so a descriptor one site accepts is never refused by another.
 */
export const controlsRule: Rule<ConditionIR> = rule("controls", (span, ctx) => {
    const opener = "you control ";
    if (!span.startsWith(opener))
        return fail("not a condition this grammar knows", span);
    const rest = span.slice(opener.length);
    const article = ARTICLES.find((a) => rest.startsWith(a));
    if (article === undefined)
        return fail(
            'a "you control" condition counts a singular descriptor',
            span
        );
    const descriptor = descriptorRule.run(rest.slice(article.length), ctx);
    if (!descriptor.ok) return descriptor;
    if (descriptor.value.plural === true)
        return fail('"a" introduces a singular descriptor', span);
    const filter = permanentFilterFromDescriptor(descriptor.value, {
        colors: true,
    });
    if (!filter.ok) return filter;
    const unevaluable = UNEVALUABLE_FILTER_KEYS.find(
        (key) => filter.value[key] !== undefined
    );
    if (unevaluable !== undefined)
        return fail(
            `a "${unevaluable}" clause cannot be evaluated at trigger-check time (CR 205.4a)`,
            span
        );
    return ok({
        kind: "controls" as const,
        filter: filter.value,
        atLeast: 1,
    });
});

// ── "if this spell was kicked" (CR 702.33d / 702.33f) ──────────────────────

export const KICKED_CONDITION = "kicked condition";

/**
 * CR 702.33d — which "kicked" a later clause reads back.
 *
 * `any` is "if this spell was kicked": at least one of the spell's kicker
 * costs was paid. `named` is "if this spell was kicked with its {1}{U} kicker"
 * (CR 702.33f), kept as the PRINTED cost — the kicker id it names is a fact
 * about the card's kicker line, not about this clause, so it is resolved in
 * lowering, where a cost that names no kicker the card has fails the card.
 */
export type KickedRefIR =
    | { readonly kind: "any" }
    | { readonly kind: "named"; readonly mana: ManaCost };

/** Nouns naming the kicked object — the spell itself (CR 702.33e). */
const KICKED_SUBJECTS: ReadonlySet<string> = new Set([
    "this spell",
    SELF_MARKER,
]);

const KICKED = /^if (.+?) was kicked(?: with its (\{[^ ]+\}) kicker)?$/;

/**
 * `"if this spell was kicked"` / `"if this spell was kicked with its {2}{R}
 * kicker"` — the intervening clause of CR 702.33e's linked abilities.
 *
 * A separate rule from `conditionRule` rather than a second member of its
 * union, because the two gate different things at different times: a
 * `controls` condition is a CR 603.4 intervening-if re-read off the board as a
 * trigger resolves, while "kicked" is a fact FIXED as the spell was cast
 * (CR 601.2b) and read off the spell's own payment record. One IR for both
 * would let a lowering site accept a condition it has no reader for.
 *
 * The subject must be the spell (CR 702.33e: the abilities "can refer only to
 * those specific kicker … abilities" printed on the same object) — "this
 * creature" is the PERMANENT form, read by the static slot's entry rider, and
 * anything else is a phrase we have misread.
 */
function kickedConditionRuleFor(
    label: string,
    subjects: ReadonlySet<string>
): Rule<KickedRefIR> {
    return rule<KickedRefIR>(label, (span) => {
        const match = span.match(KICKED);
        if (match === null)
            return fail("not a kicked condition this grammar knows", span);
        if (!subjects.has(match[1]!))
            return fail(
                `"${match[1]}" is not the kicked spell (CR 702.33e)`,
                span
            );
        if (match[2] === undefined) return ok({ kind: "any" as const });
        const mana = readManaCost(match[2]);
        if (!mana.ok) return fail(mana.reason, mana.fragment);
        return ok({ kind: "named" as const, mana: mana.cost });
    });
}

export const kickedConditionRule: Rule<KickedRefIR> = kickedConditionRuleFor(
    KICKED_CONDITION,
    KICKED_SUBJECTS
);

/**
 * CR 702.33e — the same condition as an ETB trigger prints it: "When this
 * creature enters, … If it was kicked, …". "It" is the permanent the trigger is
 * printed on, which came from the kicked spell; the SLOT owns the check that
 * the head really names the source (a trigger on "another creature" makes "it"
 * someone else's), so this rule only widens the subject.
 */
export const kickedPermanentConditionRule: Rule<KickedRefIR> =
    kickedConditionRuleFor("kicked permanent condition", new Set(["it"]));
