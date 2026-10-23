/**
 * Shared sub-grammar: A COUNTER OF THE TRIGGERING SPELL, AND ANOTHER EFFECT —
 * "Counter that spell and put a depletion counter on this enchantment"
 * (CR 701.6a, CR 608.2c).
 *
 * CR 608.2c — a spell or ability is followed "in the order written", so
 * "<counter> and <clause>" is two effects in that order, exactly as
 * "<Counter>. <Clause>." is. The rule reads the tail with the SAME sentence
 * grammar a full stop would introduce and hands the two effects to sentence
 * assembly as a list.
 *
 * Only the anaphoric head "counter that spell" opens the connector (CR 603.2:
 * the spell a cast trigger named). An announced "counter target spell and …"
 * is a different shape, and a tail that is not an effect, or is itself a
 * chain, is a line we misread.
 */

import { fail, ok, type RuleResult } from "../../rule";
import type { SentenceIR } from "./effectClause";

const HEAD = "Counter that spell and ";

export function readCounterAndChain(
    span: string,
    readSentence: (sentence: string) => RuleResult<SentenceIR>
): RuleResult<SentenceIR> | null {
    if (!span.startsWith(HEAD)) return null;
    const head = readSentence("Counter that spell");
    if (!head.ok) return head;
    const tailSpan = span.slice(HEAD.length);
    const tail = readSentence(tailSpan[0]!.toUpperCase() + tailSpan.slice(1));
    if (!tail.ok) return tail;
    if (head.value.role !== "effect" || tail.value.role !== "effect")
        return fail('"counter that spell and" continues with an effect', span);
    return ok({
        role: "then-chain" as const,
        effects: [head.value.effect, tail.value.effect],
    });
}
