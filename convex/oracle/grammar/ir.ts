/**
 * The intermediate form — what a slot grammar produces and `lower.ts` consumes.
 *
 * The IR exists so that "did we understand the line?" and "how does the engine
 * encode it?" are separate questions with separate failure modes, and so the
 * Card Zoom engine view (PRD #2693) has something to render that is closer to
 * the sentence than a `CardDefinition` is.
 *
 * It is a CLOSED discriminated union, and `lower.ts` switches on `kind` with an
 * exhaustiveness check. Adding a slot without lowering it is a type error, not
 * a card that compiles to a definition missing an ability.
 */

import type { Color, ManaCost } from "../../cards/types";

/** One keyword ability named on a keyword line (CR 702.1). */
export interface KeywordIR {
    /** Mechanics Registry row id — the single name authority. */
    readonly registryId: string;
    /** The string the engine reads out of `staticAbilities[]`. */
    readonly ability: string;
    /** Registry status; `planned` is a quarantine reason, never a silent pass. */
    readonly status: "implemented" | "planned" | "out-of-scope";
}

/** The activation cost of a mana ability, restricted to grammar v0's atoms. */
export interface ManaAbilityCostIR {
    readonly tap: boolean;
    readonly mana?: ManaCost;
}

/** What a mana ability adds (CR 605.1a). */
export type ManaProductionIR =
    | { readonly kind: "fixed"; readonly mana: ManaCost }
    | { readonly kind: "choice"; readonly options: readonly ManaCost[] };

export type SlotIR =
    | { readonly kind: "keywords"; readonly keywords: readonly KeywordIR[] }
    | {
          readonly kind: "mana-ability";
          readonly cost: ManaAbilityCostIR;
          readonly produces: ManaProductionIR;
      };

/** A line, the slot that consumed it, and what it means. */
export interface LineParse {
    readonly line: string;
    readonly slot: string;
    readonly ir: SlotIR;
}

export type { Color };
