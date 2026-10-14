/**
 * Shared sub-grammar: A TOKEN-CREATION CLAUSE, THEN ANOTHER — "Create two 1/1
 * white Soldier creature tokens, then you gain 1 life for each creature you
 * control" (CR 111.1, CR 608.2c).
 *
 * CR 608.2c — a spell or ability is followed "in the order written", so
 * "<clause>, then <clause>" is two effects in that order, exactly as
 * "<Clause>. <Clause>." is. The rule reads the tail with the SAME sentence
 * grammar a full stop would introduce and hands the two effects to sentence
 * assembly as a list, so the lowering never learns the join was a comma.
 *
 * Only a token-creation HEAD opens the connector: the corpus prints no other
 * head with a second clause this grammar reads yet, and a general
 * "clause, then clause" waits for the second head that shows the axis
 * (issue #4250). Each existing pattern with its own ", then" (loot, library
 * look) is an exact shape read before this rule is asked.
 *
 * Fail-closed:
 *  - a tail the clause grammar cannot read fails the sentence with THAT
 *    clause's own reason, never "no slot consumed the line";
 *  - a tail that is not an effect (a restriction, a modifier) is a line we
 *    misread;
 *  - a tail that is itself a chain is a shape nobody prints;
 *  - a tail that points back at the token ("it", "that token", "them") needs
 *    the antecedent the created token would be, and the sentence walk binds
 *    those pronouns to the SITE's object instead — reading one here would
 *    silently attach the second clause to the wrong permanent;
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
    if (span.startsWith("Draw ")) return readDrawThenDraw(span, at, readTail);
    if (!span.startsWith("Create ")) return null;
    const created = createTokenRule.run(span.slice(0, at), ctx);
    if (!created.ok) return created;
    const tailSpan = span.slice(at + THEN.length);
    if (POINTS_BACK_AT_TOKEN.test(tailSpan))
        return fail(
            `"${tailSpan}" points back at the token just created; the referent is not bound here`,
            span
        );
    const tail = readTail(tailSpan);
    if (!tail.ok) return tail;
    if (tail.value.role !== "effect")
        return fail(
            `", then" continues with an effect, not a ${tail.value.role}`,
            span
        );
    if (NEEDS_EARLIER_CHOICE.has(tail.value.effect.kind))
        return fail(
            `", then" continues with "${tail.value.effect.kind}", which reads a choice an earlier sentence makes; a chain's tail has no antecedent`,
            span
        );
    const head: EffectSentenceIR = { kind: "create-token", ...created.value };
    return ok({
        role: "then-chain" as const,
        effects: [head, tail.value.effect],
    });
}

/**
 * CR 121.1 + CR 608.2c — "Draw a card, then draw cards equal to <count>": two
 * draws in printed order, the second reading a count the first has already
 * changed (the tail resolves AFTER the head, as a full stop would).
 *
 * The head and the tail must BOTH be draws. The loot ("Draw a card, then
 * discard a card") and the put-back ("Draw a card, then put a card from your
 * hand on top") are exact shapes of their own, read by the sentence grammar,
 * and a draw head with any other tail is not this chain.
 */
function readDrawThenDraw(
    span: string,
    at: number,
    readTail: (tail: string) => RuleResult<SentenceIR>
): RuleResult<SentenceIR> | null {
    const tailSpan = span.slice(at + THEN.length);
    if (!tailSpan.startsWith("draw ")) return null;
    const head = readTail(span.slice(0, at));
    if (!head.ok) return head;
    const tail = readTail(tailSpan[0]!.toUpperCase() + tailSpan.slice(1));
    if (!tail.ok) return tail;
    if (
        head.value.role !== "effect" ||
        head.value.effect.kind !== "draw" ||
        tail.value.role !== "effect" ||
        tail.value.effect.kind !== "draw"
    )
        return fail('"Draw …, then draw …" chains two draws', span);
    return ok({
        role: "then-chain" as const,
        effects: [head.value.effect, tail.value.effect],
    });
}
