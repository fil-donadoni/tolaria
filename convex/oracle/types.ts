/**
 * Oracle compiler — shared types.
 *
 * PURE MODULE: no Convex, no `node:fs`, no network. Scripts and the client both
 * import it (ADR 0074 — the frontend may share engine modules; it never gains
 * authority). Everything here is JSON-shaped so the output can be a lockfile.
 */

import type { CardDefinition, CardSupertype, CardType } from "../cards/types";

/** A card as the compiler receives it: Scryfall's oracle row, nothing more. */
export interface OracleCard {
    readonly oracleId: string;
    readonly name: string;
    /** Printed mana cost string, e.g. `"{1}{G}"`. Empty for lands. */
    readonly manaCost: string;
    /** Printed type line, e.g. `"Creature — Bear"`. */
    readonly typeLine: string;
    /** Printed rules text, newline-separated, reminder text included. */
    readonly oracleText: string;
    readonly power?: string;
    readonly toughness?: string;
    readonly loyalty?: string;
    readonly layout?: string;
}

/**
 * The compiler's output definition. `id` and `rarity` are printing/catalogue
 * metadata that no amount of grammar can derive from rules text, so they are
 * not the compiler's to emit; everything else is.
 *
 * The type excludes every function-valued escape hatch on `CardDefinition`
 * (`resolve`, `resolveSteps`, `effect`, `entersTappedUnless`) — not as a policy
 * that is checked later, but so that a compiler that tried to emit a closure
 * would not type-check. A compiled card is JSON by construction (ADR 0045).
 */
export type CompiledDefinition = Omit<
    CardDefinition,
    | "id"
    | "rarity"
    | "resolve"
    | "resolveSteps"
    | "effect"
    | "entersTappedUnless"
>;

/** The three lockfile states. Computed, never assigned by hand (PRD #2693). */
export type CompileState = "ready" | "quarantine" | "unparsed";

/** A fragment the grammar could not consume. This is the ONLY failure payload. */
export interface Gap {
    /** The normalised line the fragment came from. */
    readonly line: string;
    /** The exact span that was not consumed (equal to `line` at slot level). */
    readonly fragment: string;
    /** Why it was not consumed, in one clause. */
    readonly reason: string;
    /** The slot that came closest, when exactly one slot was even attempted. */
    readonly slot?: string;
}

/** Why a fully-parsed card did not reach `ready`. */
export interface QuarantineReason {
    readonly kind:
        | "planned-op"
        | "planned-mechanic"
        | "validate-effect-script"
        | "smoke-scenario"
        | "wire-projection"
        | "not-json";
    readonly detail: string;
}

/**
 * The result of compiling one card.
 *
 * Note what is NOT representable: there is no `definition` on `unparsed`, and
 * no `gaps` on `ready`. A partially-compiled card has no shape in this union,
 * so no consumer can accidentally read a half-built definition. That is the
 * fail-closed invariant expressed as a type rather than as a check.
 */
export type CompileOutcome =
    | {
          readonly state: "ready";
          readonly definition: CompiledDefinition;
          readonly opsUsed: readonly string[];
          readonly slots: readonly string[];
      }
    | {
          readonly state: "quarantine";
          readonly definition: CompiledDefinition;
          readonly opsUsed: readonly string[];
          readonly slots: readonly string[];
          readonly reasons: readonly QuarantineReason[];
      }
    | { readonly state: "unparsed"; readonly gaps: readonly Gap[] };

/** The parsed type line (CR 205.1) — structured data, not grammar. */
export interface ParsedTypeLine {
    readonly types: readonly CardType[];
    readonly supertypes: readonly CardSupertype[];
    readonly subtypes: readonly string[];
}

/**
 * What a grammar rule may consult beyond its own span. Deliberately tiny: a
 * rule that needs more context than this is reaching across a seam.
 */
export interface ParseContext {
    readonly card: OracleCard;
    readonly typeLine: ParsedTypeLine;
    /** Canonical marker that `normalize` substituted for the card's own name. */
    readonly selfMarker: string;
}
