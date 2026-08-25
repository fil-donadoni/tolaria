/**
 * Shared sub-grammar: PLAYER REFERENCE — "you", "each opponent", "target
 * player", "that player" (CR 102.1, CR 109.5).
 *
 * STUB until #2697. Anaphora ("that player") must lower to an explicit
 * `bind`/`ref` pair (ADR 0045) so the referent is visible in the output and
 * checked by the static ref-check, never resolved by proximity.
 */

import { notYetImplemented, type Rule } from "../../rule";

export const PLAYER_REF = "player reference";

/** Placeholder result type; #2697 replaces it with the real shape. */
export type PlayerRefIR = never;

export const playerRefRule: Rule<PlayerRefIR> = notYetImplemented<PlayerRefIR>(
    PLAYER_REF,
    "#2697"
);
