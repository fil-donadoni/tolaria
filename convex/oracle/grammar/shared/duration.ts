/**
 * Shared sub-grammar: DURATION — "until end of turn", "until end of combat",
 * "until your next turn" (CR 611.2b).
 *
 * A missing duration silently promotes a temporary effect to a permanent one —
 * a +3/+3 that never wears off is a different card — so this sub-grammar fails
 * rather than defaulting, and the effect grammar asks for it explicitly at
 * every site where Oracle text can carry one.
 *
 * `DurationIR` is deliberately not `DurationSpec` (`cards/types.ts`): the
 * engine's spec is a phase boundary plus a skip count plus a player scope, and
 * three of the phrases below map onto the same phase with different scopes.
 * Keeping the IR in the sentence's own vocabulary is what lets the lowering be
 * read against the CR rule rather than against another table.
 */

import type { DurationSpec } from "../../../cards/types";
import { fail, ok, rule, type Rule } from "../../rule";

export const DURATION = "duration";

export type DurationIR =
    /** CR 514.2 — ends during the cleanup step of this turn. */
    | { readonly kind: "end-of-turn" }
    /** CR 511.3 — ends at the end-of-combat step. */
    | { readonly kind: "end-of-combat" }
    /** CR 500.2 — ends as the controller's next turn begins. */
    | { readonly kind: "your-next-turn" };

const PHRASES: ReadonlyMap<string, DurationIR> = new Map<string, DurationIR>([
    ["until end of turn", { kind: "end-of-turn" }],
    ["until end of combat", { kind: "end-of-combat" }],
    ["this turn", { kind: "end-of-turn" }],
    ["until your next turn", { kind: "your-next-turn" }],
]);

export const durationRule: Rule<DurationIR> = rule(DURATION, (span) => {
    const hit = PHRASES.get(span.toLowerCase());
    return hit === undefined
        ? fail("not a duration this grammar knows", span)
        : ok(hit);
});

/** Duration → the engine's `DurationSpec` (CR 611.2b). */
export function durationSpec(duration: DurationIR): DurationSpec {
    switch (duration.kind) {
        case "end-of-turn":
            return { phase: "end-of-turn" };
        case "end-of-combat":
            return { phase: "end-of-combat" };
        case "your-next-turn":
            // CR 500.2 — "until your next turn" expires as that turn's untap
            // step begins, scoped to the effect's controller.
            return { phase: "untap", player: "controller" };
    }
}
