/**
 * Shared sub-grammar: PLAYER REFERENCE — "you", "each opponent", "target
 * player", "that player" (CR 102.1, CR 109.5).
 *
 * Anaphora ("that player") lowers to an explicit reference, never to a
 * proximity guess — but grammar v0 refuses it outright rather than binding it,
 * because a binding needs the sentence that introduced the referent and that
 * sentence lives in a different slot (#2698). Refusing is the fail-closed half
 * of the same rule.
 */

import { fail, ok, rule, type Rule } from "../../rule";
import type { TargetRequirement } from "../../../cards/types";

export const PLAYER_REF = "player reference";

export type PlayerRefIR =
    /** CR 109.5 — "you" is the ability's controller. */
    | { readonly kind: "you" }
    /** CR 102.1 — the single opponent (this engine is two-player, ADR 0010). */
    | { readonly kind: "each-opponent" }
    /** CR 101.4 — every player, in APNAP order. */
    | { readonly kind: "each-player" }
    /** CR 115.1 — an announced target. `opponent` narrows the legal set. */
    | { readonly kind: "target"; readonly opponent: boolean };

const PHRASES: ReadonlyMap<string, PlayerRefIR> = new Map<string, PlayerRefIR>([
    ["you", { kind: "you" }],
    ["each opponent", { kind: "each-opponent" }],
    ["each other player", { kind: "each-opponent" }],
    ["each player", { kind: "each-player" }],
    ["target player", { kind: "target", opponent: false }],
    ["target opponent", { kind: "target", opponent: true }],
]);

export const playerRefRule: Rule<PlayerRefIR> = rule(PLAYER_REF, (span) => {
    const hit = PHRASES.get(span.toLowerCase());
    return hit === undefined
        ? fail("not a player reference this grammar knows", span)
        : ok(hit);
});

/** The target requirement a `target` player reference announces (CR 115.1). */
export function playerTargetRequirement(
    ref: PlayerRefIR
): TargetRequirement | null {
    if (ref.kind !== "target") return null;
    return ref.opponent
        ? { type: "player", count: 1, controller: "opponent" }
        : { type: "player", count: 1 };
}
