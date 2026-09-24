/**
 * Shared sub-grammar: PLAYER REFERENCE — "you", "each opponent", "target
 * player", "that player" (CR 102.1, CR 109.5).
 *
 * Anaphora ("that player") lowers to an explicit reference, never to a
 * proximity guess. The phrase is READ here, but the referent is not: the
 * sentence that introduced it may live in a different part of the line (a
 * trigger head, #2698), so the lowering site supplies it — and a site that
 * supplies none refuses the line, the fail-closed half of the same rule.
 */

import { fail, ok, rule, type Rule, subGrammar } from "../../rule";
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
    | { readonly kind: "target"; readonly opponent: boolean }
    /**
     * "that player": anaphora. The grammar reads the words; WHO
     * they name is the lowering site's to say (a trigger head that names a
     * player, issue #4127), and a site that names no one refuses the line.
     */
    | { readonly kind: "that-player" }
    /**
     * "that opponent": the same anaphora, narrowed to a head that names an
     * OPPONENT ("whenever this creature deals damage to an opponent, … that
     * opponent …", CR 102.2). A head naming "each player's upkeep" gives
     * "that player" a referent and "that opponent" none — the words assert a
     * fact the head must have printed.
     */
    | { readonly kind: "that-opponent" }
    /**
     * CR 110.2 + CR 608.2h — "that creature's controller": the controller of
     * the ONE creature the spell announced as its target. Never in `PHRASES`:
     * only the damage recipient reads it (`effectClause.ts` — the corpus
     * prints no other verb under it that a fixture pins), so every other verb
     * keeps refusing the phrase. The lowering resolves the referent.
     */
    | { readonly kind: "that-creature-controller" };

const PHRASES: ReadonlyMap<string, PlayerRefIR> = new Map<string, PlayerRefIR>([
    ["you", { kind: "you" }],
    ["each opponent", { kind: "each-opponent" }],
    ["each other player", { kind: "each-opponent" }],
    ["each player", { kind: "each-player" }],
    ["target player", { kind: "target", opponent: false }],
    ["target opponent", { kind: "target", opponent: true }],
    ["that player", { kind: "that-player" }],
    ["that opponent", { kind: "that-opponent" }],
]);

export const playerRefRule: Rule<PlayerRefIR> = subGrammar(
    PLAYER_REF,
    rule(PLAYER_REF, (span) => {
        const hit = PHRASES.get(span.toLowerCase());
        return hit === undefined
            ? fail("not a player reference this grammar knows", span)
            : ok(hit);
    })
);

/** The target requirement a `target` player reference announces (CR 115.1). */
export function playerTargetRequirement(
    ref: PlayerRefIR
): TargetRequirement | null {
    if (ref.kind !== "target") return null;
    return ref.opponent
        ? { type: "player", count: 1, controller: "opponent" }
        : { type: "player", count: 1 };
}
