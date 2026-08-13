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
    // Dauthi Voidwalker (MH2, issue #1156): mid-resolution pick of ONE card
    // from an EXILE zone, filtered to those bearing a specific counter type
    // ("an exiled card an opponent owns with a void counter on it"). The
    // first exile-zone requestChoice kind — generalizes `choose-graveyard-
    // card`'s public-zone-with-candidateIds-allow-list shape (ADR 0045
    // "generalize an existing shape before adding a new one") to the exile
    // zone; `candidateIds` are precomputed from `EffectCardFilter.hasCounter`
    // (a filter dimension every zone-choice's `choice` Op shares), exactly
    // like a graveyard/library card-type filter precomputes its allow-list.
    | "choose-exile-card"
    | "choose-damage-target"
    // Trigger-time PLAYER target (CR 115.1a — a player is a legal target),
    // chosen mid-resolution when a `TriggeredAbility` (which carries no
    // announcement-time `targetRequirement`, ADR 0002) must pick a player.
    // "Up to one" is expressed with `count: { min: 0, max: 1 }` — an empty
    // submission means "none". Players aren't in a zone, so the pick validates
    // against `candidatePlayerIds` (like `choose-damage-target`), not a zone
    // membership check. Endurance (mh2/green.ts, #1207): "up to one target
    // player puts all the cards from their graveyard on the bottom of their
    // library in a random order."
    | "choose-player"
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
    // Per-category choice from an ALREADY-VISIBLE set (CR 601.2b / 701.9,
    // issue #1945) — the chooser's OWN hand (already known to them; pair
    // with a preceding `reveal` Op when the Oracle text also makes it public
    // — Noxious Vapors) or OWN battlefield (already public — Planar Overlay).
    // Reuses the SAME bipartite-matching legality `look-distribute` uses
    // (`gre/categorizedPick.ts`, `PendingChoice.categories`), but is its own
    // kind rather than a `look-distribute` reuse: that kind's zone-branch
    // validation (`pendingChoiceSubmit.ts`) and wire exposure
    // (`gameProjections.ts`'s `exposeLibraryPeek`) are both hard-wired to
    // `zone: "library"`'s reveal/peek framing, which does not apply here —
    // the domain is already visible, so no peek/reveal exposure is needed at
    // all, only the categorized-legality check (extended to the `hand`/
    // `battlefield` zone branches for this kind). Noxious Vapors keeps the
    // picks IN PLACE and discards the (separately, more broadly filtered)
    // rest; Planar Overlay returns the picks to hand and leaves the rest
    // untouched — opposite actions on the picked/unpicked halves, driven by
    // the `chooseCategorized` Op's `onPicked`/`sweep` fields, not by this
    // kind (which only carries the offer + submitted picks).
    | "choose-categorized"
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

/** Announce the mode of a MODAL TRIGGERED ability (CR 603.3c, issue #2461) —
 *  "When this creature enters, choose one — …". Its own family rather than an
 *  `option-pick` member because the two answer different questions at different
 *  times: `option-pick` is a RESOLUTION-time pick (CR 614.12) whose answer is
 *  written into the resolving stack item's `collectedChoices` for a resolve step
 *  to read back, whereas this is an ANNOUNCEMENT-time pick (CR 700.2a applied to
 *  a trigger via 603.3c) whose answer is written onto the stack item's
 *  `chosenModeId` — locked before targets are chosen and before any player gets
 *  priority, exactly like a modal spell's or activated ability's mode.
 *
 *  Every other modal announcement in the engine rides an argument on the
 *  mutation the player initiated (`announceCast`, `activateAbility`); a trigger
 *  has no such mutation, so the engine raises this choice itself as the ability
 *  goes on the stack. `PendingChoice.options` carries the CHOOSABLE modes only
 *  — a mode whose required targets have no legal candidates is filtered out
 *  before the prompt (CR 603.3c), and a trigger with no choosable mode never
 *  raises this at all: it is removed from the stack. The submission is the
 *  chosen mode's id, validated against `options`, through the ordinary
 *  `submitResolutionChoice` mutation (no dedicated mutation, like
 *  `option-pick`). */
export type TriggerModeChoiceKind = "trigger-mode";

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
 *    tags its mana leg with this restriction.
 *  - `artifact-ability`: spendable only to activate abilities of artifacts
 *    (Soldevi Machinist — "Spend this mana only to activate abilities of
 *    artifacts", issue #728). The first restriction keyed on the ACTIVATION
 *    payment path rather than the spell-cast one: like `cumulative-upkeep` it
 *    is never eligible at a spell-cast site, and it is consumed only when the
 *    ability being activated belongs to a source permanent whose effective
 *    types include `Artifact` (`restrictionAllowsAbility`).
 *  - `legendary-spell`: spendable only to cast a spell with the SUPERTYPE
 *    "Legendary" (Delighted Halfling — "Spend this mana only to cast a
 *    legendary spell", issue #1559). The first restriction keyed on a
 *    supertype rather than a card TYPE: `restrictionAllowsSpell` takes a
 *    parallel `spellSupertypes` channel alongside `spellTypes` for exactly
 *    this member (every other member ignores it). Like the type-keyed
 *    restrictions it IS eligible at a spell-cast site (never at an
 *    activation, `restrictionAllowsAbility` returns false). Orthogonal to
 *    the "can't be countered" rider Delighted Halfling's mana ALSO carries
 *    (`RestrictedMana.cantBeCounteredRider`) — the restriction decides WHICH
 *    spells the mana may pay for, the rider decides what happens to the
 *    spell once mana carrying it is actually spent; a unit can carry either,
 *    both, or neither. */
export type ManaRestriction =
    | "creature-spell"
    | "artifact-spell"
    | "cumulative-upkeep"
    | "artifact-ability"
    | "legendary-spell";
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

/** Reflexive Madness cast-choice (CR 702.35a). A yes/no-shaped decision — "cast
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

/** Reflexive Rebound cast-choice (CR 702.88a). A yes/no-shaped decision —
 *  "cast this spell again from exile without paying its mana cost, or leave
 *  it exiled" — raised when the rebound reflexive trigger resolves
 *  (`openReboundCastWindow`, gre/rebound.ts). A PARALLEL family to
 *  `MadnessCastChoiceKind` (same stackless shape, same Cast/Decline UI, same
 *  Model A plumbing) — kept as its own kind rather than folded into
 *  `madness-cast` to avoid renaming shipped code (gre-development.md §
 *  DSL-first authoring). Unlike Madness's decline (→ graveyard), Rebound's
 *  decline leaves the card exiled (CR 702.88c) — no zone change. */
export type ReboundCastChoiceKind = "rebound-cast";

/** Draw-replacement pay-choice (CR 614, ADR 0061 — Zur's Weirding). When an
 *  affected player would draw under an interactive draw replacement, the
 *  would-be-drawn card is revealed and any OTHER player may pay life to put it
 *  into its owner's graveyard instead. This is the paying player's yes/no
 *  decision. Its own STACKLESS family (like `land-entry-tapped` / `madness-cast`)
 *  because it is raised by the phase-level DRAW STEP, which has no stack item to
 *  commit an answer into; it flows through its own `submitDrawReplacementPay`
 *  mutation. The paying player is `PendingChoice.playerId` (holds priority); the
 *  drawing player (who draws on decline) rides `zoneOwnerId`; the revealed top
 *  card rides `cardInstanceId` (marked known to the payer so their client can
 *  render it); the life cost rides `cost` (`{ life: N }`). The DSL `draw` Op's
 *  effect-draw interactive path instead uses `requestMayPay` (stack-coupled), so
 *  this family covers only the turn-based draw. */
export type DrawReplacementChoiceKind = "draw-replacement";

export type PendingChoiceKind =
    | ZonePickKind
    | YesNoChoiceKind
    | LandEntryChoiceKind
    | OrderChoiceKind
    | OptionChoiceKind
    | TriggerModeChoiceKind
    | NameCardChoiceKind
    | RandomRevealKind
    | DividePilesKind
    | MadnessCastChoiceKind
    | ReboundCastChoiceKind
    | DrawReplacementChoiceKind;
