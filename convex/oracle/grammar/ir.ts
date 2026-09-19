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

import type {
    Color,
    ManaCost,
    PermanentFilter,
    TargetRequirement,
} from "../../cards/types";
import type { ActivationCostIR } from "./shared/cost";
import type { TriggerConditionIR } from "./shared/condition";
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

/**
 * CR 702.33a — ONE Kicker cost, as printed on a "Kicker …" line.
 *
 * Carries the cost in the engine's own leg vocabulary (`CostLegs`, ADR 0079)
 * rather than as cost atoms: every leg below is a field a `KickerCost` already
 * declares, and an atom with no such field was refused by the grammar, so
 * there is nothing left for lowering to narrow. The `id` is NOT here — it is a
 * fact about the card's whole kicker list (a lone Kicker is `"kicker"`, an
 * "and/or" pair names each one by its colour), assigned in `lower.ts`.
 */
export interface KickerIR {
    /** The cast-dialog text, as the catalogue writes it ("Kicker {2}{U}",
     *  "Kicker—Sacrifice a land") — the printed cost without its stop. */
    readonly description: string;
    readonly mana?: ManaCost;
    /** CR 119.4 — "Pay N life". */
    readonly life?: number;
    /** CR 701.21a — "Sacrifice <N> <permanents>". */
    readonly sacrifice?: {
        readonly filter: PermanentFilter;
        readonly count: number;
    };
    /** CR 702.33c — Multikicker: payable any number of times. */
    readonly multi: boolean;
}

/** What a mana ability adds (CR 605.1a). */
export type ManaProductionIR =
    | { readonly kind: "fixed"; readonly mana: ManaCost }
    | {
          readonly kind: "choice";
          readonly options: readonly ManaCost[];
          /**
           * CR 605.1a — the painland rider: "This land deals N damage to
           * you" on a CHOICE production, gated on the coloured pick (`cards/
           * types.ts`'s `dealsDamageToControllerOnColoredTap`, Adarkar
           * Wastes). Absent on a plain choice ("{T}: Add {B} or {R}."). The
           * SAME sentence after a FIXED production is the unconditional
           * `dealsDamageToControllerOnTap` rider (Ancient Tomb) — a
           * different field, a different grammar rule, not carried here.
           */
          readonly dealsDamageToControllerOnColoredTap?: number;
      };

export type SlotIR =
    | { readonly kind: "keywords"; readonly keywords: readonly KeywordIR[] }
    /**
     * CR 702.5a — "Enchant [object]": what an Aura spell can target and what
     * the Aura can enchant. Kept as the `TargetRequirement` the engine reads
     * it from (`resolveEnchantRestriction`), because the descriptor's two
     * sites — cast-time target and attachment legality — are one field there.
     * The two READ different subsets of it, though: attachment legality keeps
     * only the card types (docs/findings/3825-aura-attachment-legality-reads-
     * only-card-types.md).
     */
    | {
          readonly kind: "enchant";
          readonly requirement: TargetRequirement;
      }
    /**
     * CR 702.33a / 702.33c / 702.33f — a "Kicker [cost]", "Kicker [cost 1]
     * and/or [cost 2]" or "Multikicker [cost]" line: one or two independently
     * payable additional costs, lowered onto `CardDefinition.kickers`.
     */
    | { readonly kind: "kicker"; readonly kickers: readonly KickerIR[] }
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
          readonly condition?: TriggerConditionIR;
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
