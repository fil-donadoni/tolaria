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
    | "discard-hand";
export type YesNoChoiceKind = "may-pay";
export type OrderChoiceKind = "mulligan-bottom";
export type PendingChoiceKind =
    | ZonePickKind
    | YesNoChoiceKind
    | OrderChoiceKind;
