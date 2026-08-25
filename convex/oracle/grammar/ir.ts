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
import type { ActivationCostIR } from "./shared/cost";
import type { EffectSentenceIR, RestrictionIR } from "./shared/effectClause";

/** One keyword ability named on a keyword line (CR 702.1). */
export interface KeywordIR {
    /** Mechanics Registry row id — the single name authority. */
    readonly registryId: string;
    /** The string the engine reads out of `staticAbilities[]`. */
    readonly ability: string;
    /** Registry status; `planned` is a quarantine reason, never a silent pass. */
    readonly status: "implemented" | "planned" | "out-of-scope";
}

/** What a mana ability adds (CR 605.1a). */
export type ManaProductionIR =
    | { readonly kind: "fixed"; readonly mana: ManaCost }
    | { readonly kind: "choice"; readonly options: readonly ManaCost[] };

export type SlotIR =
    | { readonly kind: "keywords"; readonly keywords: readonly KeywordIR[] }
    | {
          readonly kind: "mana-ability";
          readonly cost: ActivationCostIR;
          readonly produces: ManaProductionIR;
      }
    /**
     * CR 113.3b — an activated ability that uses the stack. Its cost is the
     * SAME `ActivationCostIR` a mana ability carries (CR 602.1a makes no
     * distinction), and the split between the two IR nodes is only about how
     * they lower: a mana ability's effect is a mana descriptor and
     * `useStack: false` (CR 605.3a), everything else is an Effect Script.
     */
    | {
          readonly kind: "activated";
          readonly cost: ActivationCostIR;
          readonly effects: readonly EffectSentenceIR[];
          readonly restrictions: readonly RestrictionIR[];
      };

/** A line, the slot that consumed it, and what it means. */
export interface LineParse {
    readonly line: string;
    readonly slot: string;
    readonly ir: SlotIR;
}

export type { Color };
