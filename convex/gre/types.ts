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
    // Recall (LEG): mid-resolution pick of N cards from the chooser's OWN
    // graveyard to return to hand (CR 400.7). The first graveyard-zone
    // requestChoice kind; `candidateIds` carry the eligible graveyard ids
    // (cards present at the moment the choice is raised, after any earlier
    // discard step in the same resolution).
    | "choose-graveyard-card"
    | "choose-damage-target"
    // Aladdin's Lamp (#189): the chooser looks at the top X library cards
    // (`candidateIds`) and keeps one to draw; the rest are bottomed in a
    // random order. A phase-level choice (stackItemId === "") raised by the
    // draw step's replacement, committed by `finalizeDrawLookKeep`.
    | "draw-look-keep"
    // "Look at the top N cards of your library, then pick a subset" (CR 401.4 /
    // 701.42 scry, #942). A mid-resolution stack-coupled choice: `candidateIds`
    // are exactly the looked-at top N (from `peekLibraryTop`), and the wire
    // projection exposes ONLY those N face-up as `libraryPeek` — never the whole
    // library (that is `search-library`) and never nothing (the gap `partition`
    // left). `count` is the pickable range; the card's resolve step interprets
    // the picked subset (Stock Up: the 2 to keep; Preordain: the ones to
    // bottom). The single shared top-N look path — a third such card wires no
    // new projection/UI. Validated + committed by the generic mid-resolution
    // path in `applyPendingChoiceSubmit` (library-zone allow-list on
    // `candidateIds`).
    | "look-top"
    // Ordered top-of-library placement (CR 701.22 Scry / 701.44 Surveil /
    // "look at the top N, put them back in any order" — Ponder). The drag
    // picker's kind: `candidateIds` are the looked-at top N (from
    // `peekLibraryTop`), exposed face-up as `libraryPeek` exactly like
    // `look-top`. Unlike `look-top` the submit carries TWO ordered lists — the
    // kept top order (`cardInstanceIds`, topmost first) and the cards sent to
    // the second zone (`secondZoneIds`) — and `PendingChoice.destination` names
    // that second zone (`library-bottom` scry, `graveyard` surveil, or `none`
    // for order-only Ponder). Applied by `SpellContext.orderTop`, which reorders
    // the kept cards on top, sends the rest to the destination, and marks the
    // kept cards known to the controller (ADR 0026 — you know your top cards
    // after a scry).
    | "order-top"
    // "Look at the top N, put K into your HAND and the rest on the BOTTOM in
    // any order" (CR 401.4 — Impulse, Stock Up). The unified HAND/BOTTOM drag
    // picker's kind. Like `order-top` the submit carries TWO ordered lists that
    // PARTITION the looked-at `candidateIds` — the cards taken to hand
    // (`cardInstanceIds`, exactly `count.min === count.max === keep`) and the
    // cards ordered onto the bottom (`secondZoneIds`) — but unlike `order-top`
    // the FIRST list goes to the HAND, not back on top, and
    // `PendingChoice.destination` is always `library-bottom`. Applied by
    // `SpellContext.digToHand`, which moves the kept cards to hand, bottoms the
    // rest in the chosen order, and marks THOSE bottom cards known to the
    // controller (ADR 0026 — you looked at and placed them, so their position
    // is certain until a shuffle). Shares `order-top`'s submit validation and
    // `:second` storage in `applyPendingChoiceSubmit`.
    | "look-distribute"
    // Legend rule (CR 704.5j, #378): when a controller has 2+ legendary
    // permanents that share a name, they keep exactly one (`candidateIds` are
    // the same-name duplicates) and the rest go to their owners' graveyards.
    // An SBA-level choice (stackItemId === "") raised by `checkLegendRuleSBA`,
    // committed by `finalizeLegendKeep`.
    | "legend-keep"
    // Aura host on non-cast entry (CR 303.4f): when an Aura enters the
    // battlefield by any means OTHER than resolving as an Aura spell
    // (reanimation — Replenish, Living Death; exile-return; put-onto-battlefield)
    // and the effect doesn't name what it enchants, its controller chooses a
    // legal host "as it enters". A stackless choice (stackItemId === "") raised
    // during the reanimation staging path; `candidateIds` are the legal hosts
    // (`findAllLegalAuraHosts`), the awaiting Aura is held off-battlefield in
    // `GameState.stagedAuraEntries` until the pick, and `finalizeAuraHost`
    // attaches it and finishes the entry. Auto-resolved (no prompt) when exactly
    // one legal host exists; a zero-host Aura never enters (CR 303.4g). NOT a
    // target — bypasses hexproof/shroud (CR 303.4f). `count` is always 1.
    | "choose-aura-host";

/** Where the un-kept cards of an `order-top` choice go (the SECOND zone of the
 *  drag picker). `library-bottom` = scry (CR 701.22), `graveyard` = surveil
 *  (CR 701.44), `none` = order-only (Ponder / Index — every card stays on top,
 *  only the order changes). The kept cards always return to the TOP of the
 *  library in the chosen order. */
export type LibraryDestination = "library-bottom" | "graveyard" | "none";
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
/** Land-entry pay-choice (CR 614.12, ADR 0051). A yes/no answer — "pay the
 *  cost to enter untapped, or decline and enter tapped" — enqueued by
 *  `applyPlayLand` for a land carrying `entersTappedUnlessPay` (shock lands).
 *  Its own family (not a `may-pay` member) because it is STACKLESS: a land is
 *  played, never cast, so there is no stack item to commit the answer into.
 *  Flows through its own `submitLandEntryChoice` mutation (like `name-card` →
 *  `submitNameCard`); the entering land's instance id rides on
 *  `PendingChoice.landInstanceId`. */
export type LandEntryChoiceKind = "land-entry-tapped";
/** Order family — the chooser determines an ORDER over a set (no zone move, no
 *  subset selection: every candidate is placed, only the sequence is chosen).
 *  Two members today:
 *   - `mulligan-bottom` (CR 103.5): order the N cards bottomed after a London
 *     mulligan (first picked → topmost of the bottomed group).
 *   - `trigger-order` (CR 603.3b, ADR 0058): when a player controls two or more
 *     triggered abilities that triggered from the SAME game event, they choose
 *     the order those triggers go on the stack. The candidate triggers are held
 *     off-stack in `GameState.pendingTriggerBatch` while the choice is pending;
 *     `candidateIds` carries this player's slice (collection / bottom-first
 *     order). The submission is a permutation of that slice, TOPMOST-first
 *     (index 0 = top of stack = resolves first). Auto-ordered (no prompt) when a
 *     slice is ≥2 copies of the same printed target-less ability — swapping
 *     outcome-identical instances has one meaningful result (ADR 0003). */
export type OrderChoiceKind = "mulligan-bottom" | "trigger-order";
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

/** Open name-a-card choice (CR 202.3 / 701.x "chooses a card name"). The
 *  chooser names ANY card — the candidate set is the whole card registry, not
 *  a zone or an author-supplied allow-list. Unlike every other family the
 *  submission is a STRING (the chosen card name), not a list of instance ids;
 *  the value is validated server-side against the registry and carried on
 *  `PendingChoice.chosenName` (echoed for display) + written into
 *  `collectedChoices` so the resolve step reads it back. Flows through its own
 *  `submitNameCard` mutation (like `may-pay` → `submitMayPay`). Used by Petra
 *  Sphinx ("Target player chooses a card name …") and unblocks Nebuchadnezzar. */
export type NameCardChoiceKind = "name-card";

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
 *    (Mishra's Workshop — "Spend this mana only to cast artifact spells").
 *  - `cumulative-upkeep`: spendable only to pay cumulative-upkeep costs
 *    (CR 702.24 — Adarkar Unicorn / Snowfall, ADR 0042). Unlike the two
 *    spell-cast restrictions this one is NOT eligible at any spell-cast site;
 *    it is consumed only by the cumulative-upkeep `may-pay` payment, which
 *    tags its mana leg with this restriction. */
export type ManaRestriction =
    | "creature-spell"
    | "artifact-spell"
    | "cumulative-upkeep";
/** Pile-division divide-then-choose family (ADR 0053, CR-generic "separate
 *  into two piles" cycle — Fact or Fiction, Do or Die, …). Two ordered
 *  members driven by ONE `divideIntoPiles` Effect Script Op:
 *  - `divide-piles` — raised for the DIVIDER: a total 2-way partition of the
 *    object set (reuses the `ZonePickKind` "partition" submission shape —
 *    zone + candidateIds + a `{min:0,max:N}` subset pick — so it rides the
 *    existing generic zone-pick validation/enumeration/bot paths with no
 *    special-casing).
 *  - `pick-pile` — raised for the CHOOSER once the divider has submitted: an
 *    abstract "A" or "B" pick over the two now-completed piles (mirrors
 *    `option-pick`'s shape, carrying the actual piles as `pileA`/`pileB` so
 *    the chooser's UI can render pile contents before deciding).
 *  The two decisions are by DISTINCT players and the chooser must see the
 *  completed piles, so they are two separate pending-choice entries, never a
 *  combined submission (ADR 0053 "alternative rejected"). */
export type DividePilesKind = "divide-piles" | "pick-pile";

/** Reflexive Madness cast-choice (CR 702.35d). A yes/no-shaped decision — "cast
 *  the discarded-and-exiled card for its madness cost, or put it into your
 *  graveyard" — raised when the madness reflexive trigger resolves
 *  (`openMadnessCastWindow`). Its own STACKLESS family (like `land-entry-tapped`)
 *  because the trigger has already left the stack, so there is no stack item to
 *  commit an answer into. Unlike every other family the ACCEPT ("Cast") is NOT a
 *  submit mutation: the client fires the ordinary `announceCast` on the exiled
 *  card (`PendingChoice.cardInstanceId`), which consumes this choice and runs the
 *  normal cast flow (targets / mana). Only the DECLINE routes through a dedicated
 *  `submitMadnessDecline` mutation (like `land-entry` → `submitLandEntryChoice`),
 *  binning the card. Holds priority while pending, so the owner can never lose the
 *  cast by accidentally passing priority. */
export type MadnessCastChoiceKind = "madness-cast";

export type PendingChoiceKind =
    | ZonePickKind
    | YesNoChoiceKind
    | LandEntryChoiceKind
    | OrderChoiceKind
    | OptionChoiceKind
    | NameCardChoiceKind
    | RandomRevealKind
    | DividePilesKind
    | MadnessCastChoiceKind;
