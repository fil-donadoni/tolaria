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
    | "choose-damage-target"
    // Aladdin's Lamp (#189): the chooser looks at the top X library cards
    // (`candidateIds`) and keeps one to draw; the rest are bottomed in a
    // random order. A phase-level choice (stackItemId === "") raised by the
    // draw step's replacement, committed by `finalizeDrawLookKeep`.
    | "draw-look-keep"
    // Legend rule (CR 704.5j, #378): when a controller has 2+ legendary
    // permanents that share a name, they keep exactly one (`candidateIds` are
    // the same-name duplicates) and the rest go to their owners' graveyards.
    // An SBA-level choice (stackItemId === "") raised by `checkLegendRuleSBA`,
    // committed by `finalizeLegendKeep`.
    | "legend-keep";
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
/** Pick exactly one abstract option from a precomputed list (CR 614.12 /
 *  701.x "as it enters, choose …" body selection). Unlike `ZonePickKind` the
 *  candidates are NOT zone members — they are author-supplied `{id,label}`
 *  options carried on `PendingChoice.options`. Validates against that
 *  allow-list (like `choose-damage-target` validates against
 *  `candidatePlayerIds`) rather than zone membership, then writes the chosen
 *  option id verbatim into `collectedChoices`. Used by the Antiquities
 *  choose-body-on-entry creatures: Primal Clay (3/3 vs 2/2 flyer vs 1/6 Wall)
 *  and Shapeshifter (a number 0–7 fixing power = N, toughness = 7 − N). Flows
 *  through the same `selectResolutionChoice` submit path — no dedicated
 *  mutation. */
export type OptionChoiceKind = "option-pick";

/** Random-reveal family (CR 705, ADR 0023). Unlike every other pending-choice
 *  family the chooser makes NO decision: the *engine* draws the outcome from
 *  the seeded PRNG, persists it on the choice, and suspends resolution BEFORE
 *  the consequence is applied so both clients can animate the spin and land on
 *  a WIN/LOSE face. The chooser's client auto-acknowledges when the animation
 *  ends (`submitRandomRevealAck`); no button, no data submitted. A single
 *  member today (`random-reveal`) because the resume path is identical for a
 *  coin and a future die — only the widget and `sides` differ. */
export type RandomRevealKind = "random-reveal";

/** Which random device produced the outcome — drives the overlay widget.
 *  `coin` ships now (2 sides); `die` is reserved for a future card and reuses
 *  the same envelope, kind, and acknowledge mutation (ADR 0023, scope). */
export type RandomKind = "coin" | "die";

/** The realized outcome descriptor carried on a `random-reveal` pending choice.
 *  `face` is the label the coin/die lands on — defaults to `WIN`/`LOSE` for a
 *  win/lose flip, overridable for future non-win/lose flips (Puppet's Verdict
 *  HEADS/TAILS). `consequence` is the one-line preview the overlay shows
 *  ("Create a 5/5 Djinn"). Both are public (CR 705) and survive projection. */
export type RealizedOutcome = {
    face: string;
    consequence: string;
};

/** Spend restriction on a unit of mana (CR 106.6). Mana carrying a
 *  restriction can only pay for costs the restriction permits; it still
 *  empties at end of step/phase like any other mana (CR 500.4).
 *  - `creature-spell`: spendable only to cast creature spells
 *    (Metamorphosis — "Spend this mana only to cast creature spells").
 *  - `artifact-spell`: spendable only to cast artifact spells
 *    (Mishra's Workshop — "Spend this mana only to cast artifact spells"). */
export type ManaRestriction = "creature-spell" | "artifact-spell";
export type PendingChoiceKind =
    | ZonePickKind
    | YesNoChoiceKind
    | OrderChoiceKind
    | OptionChoiceKind
    | RandomRevealKind;
