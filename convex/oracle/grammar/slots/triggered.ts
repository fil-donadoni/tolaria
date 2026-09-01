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
 * ── What v1 refuses, and why that is the point ─────────────────────────────
 *
 * "…, you may draw a card." is REFUSED. CR 603 optionality needs a resolution
 * body that can decline, and the frozen Effect Script grammar has no such
 * construct: `optionChoice`'s modes are validated as NON-EMPTY Op lists
 * (`gre/effects/validate.ts`), so "do nothing" is not expressible, and padding
 * a decline mode with a placeholder Op is the workaround that file's own
 * comment names as a workaround. A missing Op is not a licence to guess
 * (`.claude/rules/gre-development.md` § DSL-first authoring) — it is
 * stop-and-open-an-issue, so the 2,254 "you may" trigger cards stay `unparsed`
 * with the exact fragment recorded, which is what ranks the Op — tracked-by:
 * issue #3022.
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
    capitalise,
    sentenceRule,
    type EffectSentenceIR,
    type SentenceIR,
} from "../shared/effectClause";
import { triggerHeadRule, type TriggerHeadIR } from "../shared/triggerHead";
import type { SlotIR } from "../ir";

export const TRIGGERED_SLOT = "triggered";

/** One tail sentence: the shared effect sentence, read at trigger casing. */
const triggerSentence: Rule<SentenceIR> = rule(
    "trigger effect sentence",
    (span, ctx) => sentenceRule.run(capitalise(span), ctx)
);

/**
 * Assemble the tail into the ability's effects.
 *
 * A CR 602.5 activation restriction ("Activate only as a sorcery") is a
 * sentence a triggered ability cannot carry — there is no activation to
 * restrict — so it is refused rather than dropped. The "It can't be
 * regenerated" MODIFIER is accepted and folded into the destroy it follows,
 * the same way the activated slot folds it (CR 701.19c).
 */
function assemble(
    sentences: readonly SentenceIR[]
): { ok: true; effects: EffectSentenceIR[] } | { ok: false; reason: string } {
    const effects: EffectSentenceIR[] = [];
    for (const sentence of sentences) {
        if (sentence.role === "restriction")
            return {
                ok: false,
                reason: "an activation restriction (CR 602.5) has no meaning on a triggered ability",
            };
        if (sentence.role === "modifier") {
            const previous = effects[effects.length - 1];
            if (previous === undefined || previous.kind !== "destroy")
                return {
                    ok: false,
                    reason: '"It can\'t be regenerated." follows no destroy',
                };
            effects[effects.length - 1] = {
                ...previous,
                cantBeRegenerated: true,
            };
            continue;
        }
        effects.push(sentence.effect);
    }
    if (effects.length === 0)
        return { ok: false, reason: "the trigger has no effect sentence" };
    return { ok: true, effects };
}

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
    const assembled = assemble(parsed.value.tail.sentences);
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
