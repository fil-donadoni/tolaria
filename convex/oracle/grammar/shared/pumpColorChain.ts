/**
 * Shared sub-grammar: A PUMP THAT ALSO RECOLOURS — "This creature gets +1/+1
 * and becomes the color of your choice until end of turn" (CR 613.4c, CR 613.1e,
 * CR 608.2c).
 *
 * One Oracle sentence, two effects that share a subject and a duration. CR
 * 608.2c reads them in the order written, exactly as "<Clause>. <Clause>."
 * would, so the rule splits the "and", rebuilds each half as the full sentence
 * the clause grammar already reads and hands the two to sentence assembly as a
 * list (the `then-chain` role) — lowering never learns the join was an "and".
 *
 * Fail-closed:
 *  - only the SOURCE's own pump ("This creature") opens it: a "Target
 *    creature gets … and becomes …" would announce the target twice when the
 *    second half is rebuilt, which is not what the sentence says;
 *  - the duration is spelled in the pattern, so a half that carries none (or
 *    the colour pick with a different duration) is not read;
 *  - each half must read as the effect it is — a halves-check, not a trust in
 *    the regex.
 */

import { fail, ok, type RuleResult } from "../../rule";
import type { SentenceIR } from "./effectClause";

const PUMP_THEN_COLOR =
    /^(.+?) (gets?) ([+-]\d+\/[+-]\d+) and becomes the color of your choice (until .+)$/;

export function readPumpThenColor(
    span: string,
    readHalf: (half: string) => RuleResult<SentenceIR>
): RuleResult<SentenceIR> | null {
    const m = span.match(PUMP_THEN_COLOR);
    if (m === null) return null;
    const [, subject, verb, step, duration] = m;
    const pump = readHalf(`${subject} ${verb} ${step} ${duration}`);
    if (!pump.ok) return pump;
    const recolour = readHalf(
        `${subject} becomes the color of your choice ${duration}`
    );
    if (!recolour.ok) return recolour;
    if (
        pump.value.role !== "effect" ||
        pump.value.effect.kind !== "pump" ||
        pump.value.effect.subject.kind !== "self"
    )
        return fail(
            `"${subject} ${verb} ${step}" is not the source's own pump`,
            span
        );
    if (
        recolour.value.role !== "effect" ||
        recolour.value.effect.kind !== "set-color-choice"
    )
        return fail(
            `"becomes the color of your choice" is not a recolour`,
            span
        );
    return ok({
        role: "then-chain" as const,
        effects: [pump.value.effect, recolour.value.effect],
    });
}
