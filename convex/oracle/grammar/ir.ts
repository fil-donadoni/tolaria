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

import type { Color, ManaCost, PermanentFilter } from "../../cards/types";
import type { ActivationCostIR } from "./shared/cost";
import type { ConditionIR } from "./shared/condition";
import type { EffectSentenceIR, RestrictionIR } from "./shared/effectClause";
import type { StaticClauseIR } from "./shared/staticClause";
import type { TriggerHeadIR } from "./shared/triggerHead";

/** One keyword ability named on a keyword line (CR 702.1). */
export interface KeywordIR {
    /** Mechanics Registry row id — the single name authority. */
    readonly registryId: string;
    /** The string the engine reads out of `staticAbilities[]`. */
    readonly ability: string;
    /** Registry status; `planned` is a quarantine reason, never a silent pass. */
    readonly status: "implemented" | "planned" | "out-of-scope";
}

/**
 * CR 700.2 — one bullet of a modal spell.
 *
 * The bullet's own text is kept beside its sentences because a mode has a
 * DISPLAY identity the engine shows in the picker (`SpellMode.label` /
 * `oracleText`) as well as a resolution body, and neither is derivable from
 * the other.
 */
export interface SpellModeIR {
    /** The bullet, without its marker and without its full stop. */
    readonly text: string;
    readonly effects: readonly EffectSentenceIR[];
}

/** CR 702.34a — the cost of casting the card from a graveyard. */
export interface FlashbackCostIR {
    readonly mana?: ManaCost;
    /** CR 701.21a — the non-mana half, e.g. Lava Dart's "Sacrifice a Mountain". */
    readonly sacrifice?: PermanentFilter;
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
      }
    /**
     * CR 113.3c — a triggered ability: a trigger EVENT, an optional CR 603.4
     * intervening-if, and one or more effect sentences. The head is kept in
     * the sentence's vocabulary (`self-enters`) rather than the engine's
     * (`PERMANENT_ENTERED` + `scope: "self"`) for the reason this file's
     * header gives: a lowering bug must not read as a parse bug.
     */
    | {
          readonly kind: "triggered";
          readonly head: TriggerHeadIR;
          readonly condition?: ConditionIR;
          readonly effects: readonly EffectSentenceIR[];
      }
    /**
     * CR 113.3d — a continuous static ability written as a sentence rather
     * than as a keyword. Unlike every other member this one carries no
     * effects: a static ability never resolves, so there is nothing for the
     * Effect Script interpreter to run and the whole meaning is in the clause.
     */
    | { readonly kind: "static"; readonly clause: StaticClauseIR }
    /**
     * CR 113.3a — the rules text of an instant or sorcery: an instruction
     * carried out on resolution and then gone (CR 608.2n), with no permanent
     * to hang an ability on. Its body is the SAME sentence list an activated
     * or triggered ability's is, which is the whole reason the effect-sentence
     * sub-grammar is shared: "Destroy target creature." means one thing, and
     * where it is printed changes only where the resulting Effect Script hangs.
     */
    | { readonly kind: "spell"; readonly effects: readonly EffectSentenceIR[] }
    /**
     * CR 700.2 — a modal spell. Its modes are the ONE place a card carries
     * several independent bodies with several independent target requirements,
     * so they cannot collapse into the `spell` member above: folding them into
     * one effect list would compile a spell that does one of N things into a
     * spell that does all N.
     */
    | {
          readonly kind: "spell-modal";
          readonly modes: readonly SpellModeIR[];
      }
    /**
     * CR 601.2f / 118.8 — "As an additional cost to cast this spell, …". Its
     * own printed line, and not an effect at all: it is paid as the spell is
     * CAST (CR 601.2h), so a grammar that read it as a resolution instruction
     * would make an unpayable spell castable and then do the cost's work to
     * the wrong player at the wrong time.
     */
    | { readonly kind: "additional-cost"; readonly cost: ActivationCostIR }
    /** CR 702.34a — a "Flashback [cost]" line (a graveyard-cast permission). */
    | { readonly kind: "flashback"; readonly cost: FlashbackCostIR };

/** A line, the slot that consumed it, and what it means. */
export interface LineParse {
    readonly line: string;
    readonly slot: string;
    readonly ir: SlotIR;
}

export type { Color };
export type { StaticClauseIR } from "./shared/staticClause";
