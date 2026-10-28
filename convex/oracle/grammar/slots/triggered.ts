/**
 * Slot: triggered abilities (CR 113.3c — "when", "whenever", "at").
 *
 * `"[Trigger event], [optional intervening-if,] [Effect.]"` — the head is the
 * shared trigger-head sub-grammar, the optional middle is the shared condition
 * sub-grammar (CR 603.4), and the tail is the SAME effect sentences the
 * activated slot uses. The full stop belongs to the ability, exactly as
 * CR 113.3b makes it belong to an activated one.
 *
 * ── The comma is found, never assumed ──────────────────────────────────────
 *
 * `pair` tries EVERY ", " in the line as the split point and requires exactly
 * one to parse both sides. That matters here more than anywhere else in the
 * grammar: "When this creature enters, destroy target creature, then draw a
 * card" has three commas, and a rule that took the first would be right by
 * luck while a rule that took the last would silently drop the head's second
 * half. Because the head table is exact, only one split can produce a head at
 * all — so the correct comma is DERIVED rather than chosen.
 *
 * ── Case ───────────────────────────────────────────────────────────────────
 *
 * A trigger's effect clause is printed lowercase ("…, draw a card") while the
 * same sentence at a spell or activated site is capitalised ("Draw a card").
 * Only the sentence-initial letter differs, and only for the FUNCTION words the
 * effect grammar dispatches on, so the tail is re-capitalised before it is
 * handed to the shared sentence rule — the mirror of `uncapitalise`, which the
 * subject rule already applies in the other direction.
 *
 * ── Optionality (CR 603.2) ─────────────────────────────────────────────────
 *
 * "…, you may draw a card." is READ, onto the idiom the DSL has expressed since
 * issue #680: a `mayPay` Op with its `cost` OMITTED is a bare cost-free "you
 * may" decision whose REQUIRED boolean `bind` a following `if` reads, so
 * declining runs nothing at all — no placeholder Op, no empty mode, no new
 * structural construct (issue #3022). An earlier revision of this comment
 * claimed the opposite, naming `optionChoice`'s non-empty-mode validation as an
 * ENGINE gap; the capability was already shipped and in use at ~79 `mayPay`
 * sites under `convex/cards/sets/**`, one of them at a trigger site (Fasting,
 * DRK). The marker itself lives in the SHARED sentence grammar
 * (`optionalSentenceRule`), so the lowering walk that allocates target slots is
 * the same one either way.
 *
 * What stays refused is everything the sentence grammar could not read anyway:
 * a "you may" whose inner sentence does not parse fails the WHOLE line, exactly
 * as it did before the marker existed (ADR 0105).
 */

import {
    fail,
    listOf,
    ok,
    oneOf,
    pair,
    rule,
    terminated,
    type Rule,
} from "../../rule";
import {
    conditionRule,
    kickedTriggerConditionRule,
    type TriggerConditionIR,
} from "../shared/condition";
import {
    assembleSentences,
    assemblyTrace,
    capitalise,
    kickedInsteadSentenceRule,
    optionalSentenceRule,
    sentenceRule,
    objectPronounListRule,
    sourcePronounListRule,
    type SentenceIR,
} from "../shared/effectClause";
import {
    headPronounReferent,
    triggerHeadRule,
    type TriggerHeadIR,
} from "../shared/triggerHead";
import type { SlotIR } from "../ir";

export const TRIGGERED_SLOT = "triggered";

/** One tail sentence: the shared effect sentence, read at trigger casing. */
const plainSentence: Rule<SentenceIR> = rule(
    "trigger effect sentence",
    (span, ctx) => sentenceRule.run(capitalise(span), ctx)
);

/**
 * The same sentence, with CR 603.2's optional marker in front of it.
 *
 * Wrapped OUTSIDE the casing rule, because the marker is printed lowercase at
 * this site and the sentence behind it is capitalised by the rule it wraps —
 * one table, read through one rule, at both casings.
 */
const triggerSentence: Rule<SentenceIR> = kickedInsteadSentenceRule(
    optionalSentenceRule(plainSentence)
);

interface TailIR {
    readonly condition?: TriggerConditionIR;
    readonly sentences: readonly SentenceIR[];
    /** The first sentence opened on "it", read as the head's referent
     *  (CR 608.2h — `headPronounReferent` says which object that is). */
    readonly boundPronoun: boolean;
}

const plainTail: Rule<TailIR> = rule("trigger effects", (span, ctx) => {
    const parsed = objectPronounListRule(
        listOf("effect sentences", ". ", triggerSentence)
    ).run(span, ctx);
    return parsed.ok
        ? ok({
              sentences: parsed.value.value,
              boundPronoun: parsed.value.boundPronoun,
          })
        : parsed;
});

/** CR 603.4 — "…, if <condition>, <effect>." */
const conditionalTail: Rule<TailIR> = pair(
    "conditional trigger tail",
    ", ",
    oneOf("trigger condition", [conditionRule, kickedTriggerConditionRule]),
    plainTail,
    (condition, tail): TailIR => ({ ...tail, condition })
);

/**
 * CR 608.2h — behind an intervening "if" (CR 603.4) the condition is the
 * nearer antecedent ("if your life total is less than …, it becomes …"), so
 * a pronoun there is not bound to the source: the tail must not open on one.
 */
const conditionalTailNoPronoun: Rule<TailIR> = rule(
    "conditional trigger tail",
    (span, ctx) => {
        const parsed = conditionalTail.run(span, ctx);
        // CR 702.33e — "if it was kicked …, it deals 2 damage": the
        // condition's "it" IS the permanent the head names, so it displaces
        // no referent and the tail's "it" keeps naming the source.
        // CR 603.4 — "if <player> controls no <things>, it …": a zero count
        // names no object, so the pronoun has no nearer antecedent either.
        const condition = parsed.ok ? parsed.value.condition : undefined;
        const namesNoObject =
            condition?.kind === "kicked-permanent" ||
            (condition?.kind === "controls" &&
                "atMost" in condition &&
                condition.atMost === 0);
        if (parsed.ok && parsed.value.boundPronoun && !namesNoObject)
            return fail(
                '"it" after an intervening-if clause may name the condition, not the source',
                span
            );
        return parsed;
    }
);

/**
 * CR 608.2h + CR 603.4 — "…, if this permanent is an enchantment, it becomes
 * …": the condition's subject IS the source, so the effect's leading "it" is
 * the source too, whatever object the head names (a spell cast by an
 * opponent). Read ONLY behind that one condition and only for a sentence that
 * opens on the pronoun; every other conditional tail keeps its rule above.
 */
const selfTypeConditionalTail: Rule<TailIR> = rule(
    "self-type conditional trigger tail",
    (span, ctx) => {
        const parsed = pair(
            "self-type conditional trigger tail",
            ", ",
            conditionRule,
            sourcePronounListRule(
                listOf("effect sentences", ". ", triggerSentence)
            ),
            (condition, tail) => ({ condition, tail })
        ).run(span, ctx);
        if (!parsed.ok) return parsed;
        // A tail that does not open on "it" is `conditionalTail`'s.
        if (!parsed.value.tail.boundPronoun)
            return fail("the effect does not open on a pronoun", span);
        if (parsed.value.condition.kind !== "self-has-type")
            return fail("not a self-type condition", span);
        // Only the one verb with a fixture reads the source here.
        const first = parsed.value.tail.value[0];
        if (first?.role !== "effect" || first.effect.kind !== "become-creature")
            return fail("only a type-line replacement is read here", span);
        return ok<TailIR>({
            condition: parsed.value.condition,
            sentences: parsed.value.tail.value,
            // Bound to the SOURCE, not the head's referent: the head check on
            // `boundPronoun` does not apply.
            boundPronoun: false,
        });
    }
);

/**
 * The tail, with or without a condition.
 *
 * `oneOf`, not a cascade: a tail both readings accept would be a line whose
 * meaning depends on which rule ran first, and the honest answer to that is to
 * fail the card (see `rule.ts`). It cannot happen today — a condition clause is
 * not an effect sentence and vice versa — which is exactly why the guarantee is
 * cheap to keep.
 */
const triggerTail: Rule<TailIR> = oneOf("trigger tail", [
    selfTypeConditionalTail,
    conditionalTailNoPronoun,
    plainTail,
]);

const triggeredBody: Rule<SlotIR> = rule("triggered body", (span, ctx) => {
    const parsed = pair(
        TRIGGERED_SLOT,
        ", ",
        triggerHeadRule,
        triggerTail,
        (head, tail): { head: TriggerHeadIR; tail: TailIR } => ({ head, tail })
    ).run(span, ctx);
    if (!parsed.ok) return parsed;
    // CR 608.2h — "Whenever this creature attacks, it gets +1/+1 …". The
    // pronoun names the head's subject, and only some heads name an object at
    // all: "Whenever another creature you control enters, it gets …" names the
    // ENTERING creature, a referent this grammar does not bind, so the line
    // stays unread rather than pumping the wrong object.
    if (
        parsed.value.tail.boundPronoun &&
        headPronounReferent(parsed.value.head) === null
    )
        return fail(
            '"it" opens the effect but the trigger\'s head names no object',
            span
        );
    // CR 702.33e — "If it was kicked" names the permanent the trigger is
    // printed on, whose spell was kicked. That is only what "it" means behind a
    // head that fires on THIS permanent entering; behind "another creature
    // enters" it would name a different object, and behind "dies" the kicked
    // fact is read off a permanent that has already left.
    if (
        parsed.value.tail.sentences.some((s) => s.role === "kicked-instead") &&
        !(
            parsed.value.head.kind === "enters" &&
            parsed.value.head.scope === "self"
        )
    )
        return fail(
            '"If it was kicked" needs a head that fires when this permanent enters',
            span
        );
    // CR 702.33e — the same holds for the intervening-if form: "it" is the
    // permanent this trigger is printed on, entering.
    if (
        parsed.value.tail.condition?.kind === "kicked-permanent" &&
        !(
            parsed.value.head.kind === "enters" &&
            parsed.value.head.scope === "self"
        )
    )
        return fail(
            '"if it was kicked" needs a head that fires when this permanent enters',
            span
        );
    // CR 602.5 — there is no activation to restrict on a trigger, so a
    // restriction sentence here is a line we have misread.
    const assembled = assembleSentences(parsed.value.tail.sentences, {
        site: "trigger",
        rejectRestrictions:
            "an activation restriction (CR 602.5) has no meaning on a triggered ability",
    });
    if (!assembled.ok)
        return fail(
            assembled.reason,
            span,
            assemblyTrace(span, parsed.value.tail.sentences.length)
        );
    return ok({
        kind: "triggered" as const,
        head: parsed.value.head,
        ...(parsed.value.tail.condition !== undefined
            ? { condition: parsed.value.tail.condition }
            : {}),
        effects: assembled.effects,
    });
});

/** CR 113.3c — the ability's own full stop closes the line. */
/** CR 603.2 — the per-turn limit sentence a trigger may end on, with the
 *  count its words print ("once" / "twice"). */
const TRIGGER_LIMIT_SENTENCE =
    /^(.+)\. This ability triggers only (once|twice) each turn$/;
const TRIGGER_LIMIT_COUNT = { once: 1, twice: 2 } as const;

/**
 * "<trigger>. This ability triggers only twice each turn." — the limit is a
 * property of the ability, not an effect sentence, so it is read off the end
 * and the rest is the ordinary triggered body. The limit stays attached to the
 * IR; lowering refuses any head whose factory cannot count it.
 */
const limitedTriggeredBody: Rule<SlotIR> = rule(
    "triggered body with a per-turn limit",
    (span, ctx) => {
        const match = span.match(TRIGGER_LIMIT_SENTENCE);
        if (match === null) return triggeredBody.run(span, ctx);
        const body = triggeredBody.run(match[1]!, ctx);
        if (!body.ok) return body;
        if (body.value.kind !== "triggered")
            return fail("a per-turn limit behind a non-triggered body", span);
        return ok({
            ...body.value,
            maxTriggersPerTurn:
                TRIGGER_LIMIT_COUNT[
                    match[2] as keyof typeof TRIGGER_LIMIT_COUNT
                ],
        });
    }
);

export const triggeredSlot: Rule<SlotIR> = terminated(
    ".",
    limitedTriggeredBody
);
