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
import { conditionRule, type ConditionIR } from "../shared/condition";
import {
    assembleSentences,
    capitalise,
    optionalSentenceRule,
    sentenceRule,
    type SentenceIR,
} from "../shared/effectClause";
import { triggerHeadRule, type TriggerHeadIR } from "../shared/triggerHead";
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
const triggerSentence: Rule<SentenceIR> = optionalSentenceRule(plainSentence);

interface TailIR {
    readonly condition?: ConditionIR;
    readonly sentences: readonly SentenceIR[];
}

const plainTail: Rule<TailIR> = rule("trigger effects", (span, ctx) => {
    const parsed = listOf("effect sentences", ". ", triggerSentence).run(
        span,
        ctx
    );
    return parsed.ok ? ok({ sentences: parsed.value }) : parsed;
});

/** CR 603.4 — "…, if <condition>, <effect>." */
const conditionalTail: Rule<TailIR> = pair(
    "conditional trigger tail",
    ", ",
    conditionRule,
    plainTail,
    (condition, tail): TailIR => ({ condition, sentences: tail.sentences })
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
    conditionalTail,
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
    // CR 602.5 — there is no activation to restrict on a trigger, so a
    // restriction sentence here is a line we have misread.
    const assembled = assembleSentences(parsed.value.tail.sentences, {
        site: "trigger",
        rejectRestrictions:
            "an activation restriction (CR 602.5) has no meaning on a triggered ability",
    });
    if (!assembled.ok) return fail(assembled.reason, span);
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
export const triggeredSlot: Rule<SlotIR> = terminated(".", triggeredBody);
