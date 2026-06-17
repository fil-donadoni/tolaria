export type Zone =
    | "library"
    | "hand"
    | "battlefield"
    | "graveyard"
    | "exile"
    | "stack";

export type CardAction =
    | "play"
    | "cast"
    | "discard"
    | "putToGraveyard"
    | "putToExile"
    | "putToLibrary"
    | "putToHand";

export type Phase =
    | "MULLIGAN"
    | "UNTAP"
    | "UPKEEP"
    | "DRAW"
    | "PRECOMBAT_MAIN"
    | "BEGINNING_OF_COMBAT"
    | "DECLARE_ATTACKERS"
    | "DECLARE_BLOCKERS"
    | "FIRST_STRIKE_DAMAGE"
    | "COMBAT_DAMAGE"
    | "END_OF_COMBAT"
    | "POSTCOMBAT_MAIN"
    | "END_STEP"
    | "CLEANUP";

/** Pending-choice family taxonomy (see `state.ts` `PendingChoice` for the
 *  full doc). Lives here so it can be imported by both `cards/types.ts`
 *  (typing `SpellContext.requestChoice`) and `gre/state.ts` (typing
 *  `PendingChoice.kind`) without forming an import cycle. */
export type ZonePickKind =
    | "keep-permanents"
    | "sacrifice-permanents"
    | "keep-hand"
    | "search-library"
    | "pick-source"
    | "untap-pick"
    | "discard-hand"
    | "reorder-library"
    | "reveal-hand"
    | "choose-permanents"
    | "partition"
    | "choose-hand-card"
    | "choose-damage-target";
/** CR 702.26 — condition under which a phased-out bundle phases back in. A
 *  discriminated union so future phasing variants stay expressible:
 *   - `source-leaves` (Oubliette): phase in when the named source leaves the
 *     battlefield (driven by `removePermanentTo`'s source-leaves hook).
 *   - `untap-cycle` (keyword phasing — Teferi's Veil): the untap-step
 *     phase-in/out loop. Expressible but unused — deferred (PRD #171). */
export type PhaseReturnCondition =
    | { kind: "source-leaves"; sourceId: string }
    | { kind: "untap-cycle" };

/** Per-host adjustments applied when a bundle phases back in. Oubliette taps
 *  the creature "as it phases in this way" (CR 702.26 reminder). */
export type PhaseInRider = { tap?: boolean };

export type YesNoChoiceKind = "may-pay";
export type OrderChoiceKind = "mulligan-bottom";

/** Spend restriction on a unit of mana (CR 106.6). Mana carrying a
 *  restriction can only pay for costs the restriction permits; it still
 *  empties at end of step/phase like any other mana (CR 500.4).
 *  - `creature-spell`: spendable only to cast creature spells
 *    (Metamorphosis — "Spend this mana only to cast creature spells"). */
export type ManaRestriction = "creature-spell";
export type PendingChoiceKind =
    | ZonePickKind
    | YesNoChoiceKind
    | OrderChoiceKind;
