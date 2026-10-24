/**
 * Shared sub-grammar: the ", then" CHAIN — "Create two 1/1 white Soldier
 * creature tokens, then you gain 1 life for each creature you control",
 * "Scry 2, then draw a card" (CR 608.2c).
 *
 * CR 608.2c — a spell or ability is followed "in the order written", so
 * "<clause>, then <clause>" is two effects in that order, exactly as
 * "<Clause>. <Clause>." is. The rule reads BOTH halves with the SAME sentence
 * grammar a full stop would introduce and hands the effects to sentence
 * assembly as a list, so the lowering never learns the join was a comma.
 *
 * The connector opens after ANY head the sentence grammar reads (the
 * `, then` Composition Rule generalised from its token-creation idiom, issue
 * #6557), and only AFTER the whole sentence failed to read as one (`sentenceRule`
 * asks `wholeSentence` first): an exact shape with its own ", then" (the
 * loot, the library look, the shuffle-and-redraw) is read whole and never
 * re-read as a chain. A tail that is itself a chain is flattened — "A, then
 * B, then C" is three effects in printed order.
 *
 * Fail-closed:
 *  - a half the clause grammar cannot read fails the sentence with THAT
 *    half's own reason, never "no slot consumed the line";
 *  - a half that is not an effect (a restriction, a modifier) is a line we
 *    misread;
 *  - a tail that points back at a TOKEN the head created ("it", "that
 *    token", "them") needs the antecedent the created token would be, and the
 *    sentence walk binds those pronouns to the SITE's object instead — reading
 *    one here would silently attach the second clause to the wrong permanent.
 *    Behind any other head the pronoun means what it means across a full
 *    stop (CR 608.2c), and the lowering's anaphora binds or refuses it;
 *  - a tail that reads a choice an EARLIER sentence made has no antecedent
 *    here at all (`NEEDS_EARLIER_CHOICE` below).
 */

import { fail, ok, type RuleResult } from "../../rule";
import type { EffectSentenceIR, SentenceIR } from "./effectClause";
import { createTokenRule } from "./tokenSpec";

const THEN = ", then ";

/**
 * CR 608.2c + CR 105.1 — an effect whose meaning depends on a pick an EARLIER
 * sentence made ("the chosen color") can never be a chain's tail. A chain is
 * ONE sentence, and `assembleSentences` folds a "Choose a color." marker onto
 * the sentence that FOLLOWS it — it never looks inside a flattened chain, so
 * a tail read here would be accepted with no marker on the line at all. The
 * bare-sentence path refuses exactly this; without this set the chain path is
 * a way around it.
 *
 * Every `EffectSentenceIR` kind that reads an earlier sentence's choice
 * belongs here.
 */
const NEEDS_EARLIER_CHOICE: ReadonlySet<EffectSentenceIR["kind"]> = new Set([
    "choose-color-grant-protection",
]);

/** A word that names the token the head created (CR 608.2h). */
const POINTS_BACK_AT_TOKEN =
    /\b(?:it|its|them|they|their|that token|those tokens|that creature|those creatures)\b/i;

export function readThenChain(
    span: string,
    ctx: unknown,
    readTail: (tail: string) => RuleResult<SentenceIR>
): RuleResult<SentenceIR> | null {
    const at = span.indexOf(THEN);
    if (at === -1) return null;
    const tailSpan = span.slice(at + THEN.length);
    let head: EffectSentenceIR;
    if (span.startsWith("Create ")) {
        const created = createTokenRule.run(span.slice(0, at), ctx);
        if (!created.ok) return created;
        if (POINTS_BACK_AT_TOKEN.test(tailSpan))
            return fail(
                `"${tailSpan}" points back at the token just created; the referent is not bound here`,
                span
            );
        head = { kind: "create-token", ...created.value };
    } else {
        const read = readTail(span.slice(0, at));
        if (!read.ok) return read;
        if (read.value.role !== "effect")
            return fail(
                `", then" follows an effect, not a ${read.value.role}`,
                span
            );
        head = read.value.effect;
    }
    const tail = readTail(tailSpan);
    if (!tail.ok) return tail;
    const effects: EffectSentenceIR[] =
        tail.value.role === "then-chain"
            ? [...tail.value.effects]
            : tail.value.role === "effect"
              ? [tail.value.effect]
              : [];
    if (effects.length === 0)
        return fail(
            `", then" continues with an effect, not a ${tail.value.role}`,
            span
        );
    for (const effect of effects)
        if (effect.kind !== undefined && NEEDS_EARLIER_CHOICE.has(effect.kind))
            return fail(
                `", then" continues with "${effect.kind}", which reads a choice an earlier sentence makes; a chain's tail has no antecedent`,
                span
            );
    // CR 121.1 + CR 608.2c — "Draw a card, then draw cards equal to <count>":
    // the second draw reads a count the first has already changed (the tail
    // resolves AFTER the head, as a full stop would). A plain second draw is
    // one draw with a bigger number, a shape no card prints.
    if (
        head.kind === "draw" &&
        effects.length === 1 &&
        effects[0]!.kind === "draw" &&
        effects[0]!.count.kind !== "counted"
    )
        return fail('"Draw …, then draw …" chains two draws', span);
    return ok({
        role: "then-chain" as const,
        effects: [head, ...effects],
    });
}
