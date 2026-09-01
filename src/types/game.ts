import type { Color } from "./cards";
import type { Zone, CardAction } from "@convex/gre/types";
import type { RestrictedMana, AttackManaTaxPayment } from "@convex/gre/state";
import type { ManaCost, TargetSelection } from "@convex/cards/types";

export type { AttackManaTaxPayment };
import type { SacrificeSelection } from "@convex/gre/sacrificeChoice";
import type { FaceDownProducer } from "@convex/gre/faceDown";
import type {
    PublicGrantedAbility,
    SlimCompanionSlot,
} from "@convex/gameProjections";

// Re-export from convex (single source of truth)
export type { Zone, CardAction };
export type GrantedAbility = PublicGrantedAbility;
export type CompanionSlot = SlimCompanionSlot;

/** ADR 0026 / PRD #338 — one viewer-known library card and its top-relative
 *  position (0 = top). */
export interface KnownLibraryCard {
    index: number;
    card: CardInstance;
}

/** ADR 0026 / PRD #338 — sparse projected library: `count` is the full size,
 *  `known` carries only the cards the viewer legitimately knows, each at its
 *  top-relative `index`. The server always emits `known` (possibly empty); it
 *  is optional here so a `{ count }`-only fixture is still a valid library. */
export interface PublicLibrary {
    count: number;
    known?: KnownLibraryCard[];
}

export interface Player {
    id: string;
    name: string;
    bgColor: string;
    life: number;
    /** Own hand has full cards; opponent's hand is a list of nulls when viewed via getPublicState. */
    hand: (CardInstance | null)[];
    /** Full array when the viewer has full-state access (full debug view).
     *  Via getPublicState it is the sparse ADR 0026 shape (`PublicLibrary`):
     *  `count` plus the cards the viewer knows (`known[]`) at their
     *  top-relative `index` (0 = top). */
    library: CardInstance[] | PublicLibrary;
    /** Set only on the searcher's own player while a `search-library` choice
     *  is active (CR 401.4 / 701.23) — slim card list rendered face-up so the
     *  player can pick one. Independent of `library` to keep the wire shape
     *  stable for all other consumers. */
    librarySearch?: CardInstance[];
    /** Set only on the chooser's own player while a library-peek choice is
     *  active (CR 401.4) — the looked-at top cards rendered face-up. Used by
     *  reorder-library and by Aladdin's Lamp's `draw-look-keep` (keep one). */
    libraryPeek?: CardInstance[];
    /** Set only on the hand owner's player while a `reveal-hand` look choice is
     *  active (CR 401.4 / 400.2 — Gitaxian Probe's private look) — the owner's
     *  hand rendered face-up to the single chooser. Independent of `hand` (which
     *  stays the sparse ADR 0026 shape) so the wire shape is stable for all other
     *  consumers; the `RevealHandView` pile reads it. */
    revealedHand?: CardInstance[];
    graveyard: CardInstance[];
    exile: CardInstance[];
    battlefield: CardInstance[];
    manaPool: ManaPool;
    /** Restricted mana floating in the pool (CR 106.6, ADR 0022 / 0042) —
     *  mana spendable only on costs its restriction permits (e.g.
     *  `"cumulative-upkeep"` mana from Adarkar Unicorn / Snowfall). Emptied with
     *  `manaPool` at end of step/phase. Absent means none. */
    restrictedMana?: RestrictedMana[];
    /** Number of turns this player has taken so far (CR 500.1). Extra turns
     *  (CR 500.7) increment this normally. */
    turnsTaken?: number;
    /** Instance id of the last card this player drew this turn (Jandor's
     *  Ring discard cost). Cleared at the start of each turn. */
    lastDrawnCardId?: string;
    /** Abilities granted to this player by an effect (e.g. Channel). */
    grantedAbilities?: GrantedAbility[];
    /** Poison counters on this player (CR 122). Absent means zero. A player
     *  with ten or more loses the game (CR 704.5c). Rides the public
     *  projection via the `...player` spread (ADR 0032). */
    poisonCounters?: number;
    /** Energy counters on this player (CR 122.1 — a player-owned resource).
     *  Absent means zero. Rides the public projection via the `...player`
     *  spread, like `poisonCounters` (issue #697). */
    energyCounters?: number;
    /** Experience counters on this player (CR 122.1 — a player-owned counter).
     *  Absent means zero. Public information for BOTH players. Rides the public
     *  projection via the `...player` spread, like `poisonCounters` (issue
     *  #1969). No rule removes one, and CR 122.2's zone-change loss is
     *  OBJECT-scoped, so the total survives its source leaving the
     *  battlefield. */
    experienceCounters?: number;
    /** Companion (CR 702.139, ADR 0064) — revealed to BOTH players; only the
     *  slot's own controller's view carries `canSummon` (mirrors every other
     *  viewer-scoped affordance field, e.g. `CardInstance.legalActions`).
     *  Absent when this player declared no companion. */
    companion?: CompanionSlot;
}

/** Mana pool carried by the player. All six color slots may be missing from the server payload. */
export type ManaPool = Partial<Record<Color, number>> & Record<string, number>;

export const emptyManaPool: ManaPool = {
    W: 0,
    U: 0,
    B: 0,
    R: 0,
    G: 0,
    C: 0,
};

export interface Deck {
    id: string;
    name: string;
    cards: DeckCard[];
    format: string;
}

export type DeckCard = {
    cardId: string;
    cardName: string;
};

/**
 * A Maindeck/Sideboard entry that remembers WHICH PHYSICAL COPY it is (ADR
 * 0075 §4, issue #1626).
 *
 * `pinKey` is the stable per-copy identity a deckbuilder zone records a Card
 * Pin under, and it travels ON THE ENTRY — it is never re-derived by counting
 * a card's occurrences in a zone, because the zone arrays renumber on every
 * Maindeck⇄Sideboard move, which silently re-associates every surviving copy's
 * Pin with a different physical card (PR #2318 review B1).
 *
 * Absent = the Constructed rule: every copy shares the `cardId`, so pinning
 * one Lightning Bolt files all four. The Limited builder mints
 * `String(poolIndex)` from the seat's Pool (`poolCopyPinKey`), because the Pool
 * already distinguishes two physical copies of one card and the two must stay
 * individually placeable.
 *
 * A pure widening of {@link DeckCard} (the extra field is optional), so a
 * plain `DeckCard` flows in wherever a `ZoneCard` is expected and back out
 * again — no call site has to know which kind it holds.
 */
export type ZoneCard = DeckCard & {
    pinKey?: string;
};

export interface CardInstance {
    id: string;
    /** Static definition reference. Resolve via getDefinition(card.id). */
    card: { id: string };
    controllerId: string;
    ownerId: string;
    zone: Zone;
    types?: string[];
    subtypes?: string[];
    isTapped: boolean;
    manaCommitted?: boolean;
    power?: number;
    toughness?: number;
    staticAbilities?: string[];
    isSummoningSick?: boolean;
    isAttacking?: boolean;
    isBlocking?: boolean;
    /** Set once this creature has been declared as an attacker this turn
     *  (CR 506.2). Persists through CLEANUP. Read by the UI to gate "target
     *  player who attacked this turn" clickability (Fire and Brimstone). */
    hasAttackedThisTurn?: boolean;
    /** Damage marked on this creature this turn (CR 120.3). Cleared at CLEANUP. */
    damageMarked?: number;
    /** CR 606.3 — set once a loyalty ability of this planeswalker has been
     *  activated this turn. Drives the frontend loyalty-ability affordability
     *  hint (`getStackAbilities` hides a second loyalty ability). Cleared at the
     *  start of each turn. */
    loyaltyActivatedThisTurn?: boolean;
    /** Id of the permanent this card is attached to (CR 303.4b). Only set
     *  on auras that ETB attached to a host. */
    attachedTo?: string;
    /** CR 307.1 / 117.1a — true iff the spell that became this permanent was
     *  cast at a moment a sorcery couldn't have been cast (issue #2473).
     *  Stamped server-side at cast commit and inherited by the permanent; it
     *  crosses the wire untouched (`slimCard` only strips `card`/`knownTo`).
     *  Read by `buildTriggerStateView` so a CR 603.4 check-time condition on a
     *  permanent's own ETB trigger (Necromancy, issue #2392) answers the same
     *  client-side as it does on the engine. */
    castOffSorceryTiming?: boolean;
    /** Activated abilities granted to this permanent by another card
     *  (CR 113.1, e.g. Zombie Master granting "{B}: Regenerate ~", or Touch of
     *  Vitae's until-EOT "{0}: Untap this creature"). Exactly one keyed field is
     *  set: `auraId` for a continuous lord-style grant, `duration` for a
     *  one-shot until-end-of-turn grant. The template lives on the granting
     *  card's def — UI resolves via `getDefinition(grant.sourceCardId)`. */
    grantedActivatedAbilities?: {
        sourceCardId: string;
        abilityId: string;
        auraId?: string;
        duration?: unknown;
        /** CR 613.7 layer timestamp of the grant. Read against
         *  `abilitiesSuppressedBy[].seq` so the client marks exactly the
         *  abilities the engine drops (see `abilityLossTimestamp`). */
        seq?: number;
    }[];
    /** Static keywords granted to this permanent by another card (CR 113.1,
     *  611 — landwalk via a granting permanent, etc.). Each entry is also
     *  pushed into `staticAbilities` for read-time lookups, so this carries
     *  the GRANT PROVENANCE (which source / duration) rather than driving the
     *  keyword diff itself. Aligned with the wire projection, which forwards
     *  this field via `slimCard` (it only strips `card`/`knownTo`). */
    grantedStaticAbilities?: {
        ability: string;
        duration?: unknown;
        auraId?: string;
    }[];
    /** Triggered abilities granted to this permanent by an anthem-style static
     *  effect (CR 113.1, e.g. Energy Flux granting an upkeep sacrifice trigger
     *  to every artifact) or by a one-shot until-end-of-turn grant (CR 611.2a,
     *  Rapid Fire's "gains rampage 2 until end of turn"). The template lives on
     *  the granting card's `triggeredGrantTemplates` — UI resolves the oracle
     *  text via `getDefinition(grant.sourceCardId)`. Exactly one of `auraId`
     *  (continuous, aura-keyed) / `duration` (until-end-of-turn) is set. */
    grantedTriggeredAbilities?: {
        sourceCardId: string;
        abilityId: string;
        auraId?: string;
        duration?: unknown;
        /** CR 613.7 layer timestamp — see `grantedActivatedAbilities`. */
        seq?: number;
    }[];
    /** "Loses all abilities" statics currently applying to this permanent
     *  (CR 613.1f — Blood Moon on a nonbasic land, Humility, Titania's Song),
     *  each with the source's layer timestamp. The preview marks a printed or
     *  earlier-granted ability LOST from this; without it the zoom panel keeps
     *  printing a Moon'd land's oracle text as if it still functioned. */
    abilitiesSuppressedBy?: { sourceId: string; seq: number }[];
    /** Counters on this permanent (CR 122). Map of counter type → count.
     *  Layer 7d folds P/T-modifying types into effective stats; non-PT types
     *  (corpse, mire, vitality, ...) are inert to layers and read by
     *  card-specific abilities. */
    counters?: Record<string, number>;
    /** One-shot P/T modifications scoped to a phase boundary (CR 611.1).
     *  Each entry adds to effective P/T at read time. */
    temporaryPTMods?: ReadonlyArray<{ power: number; toughness: number }>;
    legalActions?: CardAction[];
    /** CR 118.9-analog / 107.3b / 601.2b (issue #2398) — true when the
     *  cast-from-top-of-library permission covering this card replaces its mana
     *  cost wholesale (Bolas's Citadel), rather than letting it be cast for its
     *  printed cost. Present only on the viewer's OWN library top alongside
     *  `legalActions`. Mirrors `SlimLibraryCard.castManaCostReplaced` in
     *  `convex/gameProjections.ts` — read that field's doc for why the client
     *  cannot re-derive it, and `useHandCardCommit` for the two announcement
     *  choices it suppresses ({X} and the alternative-cost picker). */
    castManaCostReplaced?: true;
    /** CR 702.34 / 702.138 / 702.81 / 305.1-analog / 117.6-analog / 702.139 —
     *  which graveyard-cast mechanism surfaced this card's cast affordance, so
     *  the graveyard button labels "Flashback" / "Escape" / "Retrace" / "Cast".
     *  Present only on the viewer's own graveyard cards alongside
     *  `legalActions`.
     *  `"graveyard-grant"` (issue #1344) is a SPECIFIC-CARD grant (Malcolm,
     *  Alluring Scoundrel), distinct from the BROAD `"graveyard-permission"`
     *  (Yawgmoth's Will) — both currently render the same "Cast" label.
     *  `"graveyard-permanent-permission"` (issue #1392) is Lurrus's STATIC,
     *  once-per-turn, permanent-cards-only permission — also renders "Cast".
     *  `"retrace"` (CR 702.81a, issue #2358) pays the printed mana cost PLUS a
     *  discarded land card, so it labels and explains itself separately.
     *  MIRROR of the union in `convex/gameProjections.ts` — keep both in step. */
    castKind?:
        | "flashback"
        | "escape"
        | "graveyard-permission"
        | "graveyard-grant"
        | "graveyard-permanent-permission"
        | "retrace";
    /** CR 702.34a / 118.5 / 107.3 — max {X} announceable on this flashback
     *  cast, bounded by its `flashbackExileFromGraveyard` cost (Flash of
     *  Insight). Present only on a `castKind: "flashback"` card carrying that
     *  cost; the cast cost dialog caps its X stepper at this value. Mirrors
     *  `SlimGraveyardCard.flashbackExileMaxX` in `convex/gameProjections.ts`. */
    flashbackExileMaxX?: number;
    /** ADR 0026 — derived eye-icon flag on the viewer's OWN hand cards: true
     *  when at least one opponent currently knows this card's identity. Only
     *  present on own-hand projected cards; raw `knownTo` never reaches the
     *  client. */
    seenByOpponent?: boolean;
    /** CR 107.4f — affordable Phyrexian mana-vs-life split choices (as distinct
     *  `lifePips` values, 0 = all mana … totalPips = all life) for a castable
     *  `{C/P}` card in the viewer's OWN hand. Present only when there are ≥ 2
     *  affordable options (a real choice); the client shows the split picker and
     *  sends the pick as `announceCast`'s `phyrexianLifePips`. Mirrors
     *  `SlimHandCard.phyrexianOptions` in `convex/gameProjections.ts`. */
    phyrexianOptions?: number[];
    /** CR 601.3c — true when casting this own-hand card RIGHT NOW owes its
     *  conditional-flash surcharge ("You may cast this spell as though it had
     *  flash if you pay {2} more to cast it" — Rout, Ghitu Fire, …). Derived
     *  server-side by `flashSurchargeRequired`, the same predicate that charges
     *  it; absent (never `false`) when nothing is owed. The cast-cost dialog
     *  opens on this alone — four of the five cards carrying the rider have no
     *  X, no kicker and no buyback. Mirrors
     *  `SlimHandCard.flashSurchargeRequired` in `convex/gameProjections.ts`. */
    flashSurchargeRequired?: true;
    /** Two basic land types chosen as a permanent entered and stored for the
     *  rest of the game (CR 603.6b / 614.12 — Illusionary Terrain). Forwarded by
     *  `slimCard` (the projection only strips `card`/`knownTo`); read by the
     *  card preview to render the chosen-subtype text. Mirrors
     *  `CardInstanceState.chosenSubtypes` in `convex/gre/state.ts`. */
    chosenSubtypes?: string[];
    /** CR 700.2c — the mode this PERMANENT locked in as it entered, and keeps
     *  for the rest of its time on the battlefield (Prismatic Ward / Chromatic
     *  Armor: "As this Aura enters, choose a color"). Forwarded by `slimCard`
     *  (the projection only strips `card`/`knownTo`); read by the card preview
     *  so the live oracle text names the colour actually chosen. Mirrors
     *  `CardInstanceState.chosenModeId` in `convex/gre/state.ts`. */
    chosenModeId?: string;
    /** CR 302.6 / 502.1 — a one-shot flag: this permanent doesn't untap during
     *  its controller's NEXT untap step (Tangle, Barl's Cage, Goblin Rock
     *  Sled). Cleared by the engine the instant that untap step consumes it,
     *  so it is only ever true for the window between the effect being
     *  applied and the next untap step. Forwarded by `slimCard` like
     *  `chosenModeId`; read by the card preview so the player always sees the
     *  pending restriction, since the printed oracle text alone doesn't say
     *  whether it's CURRENTLY armed. Mirrors
     *  `CardInstanceState.skipNextUntap` in `convex/gre/state.ts`. */
    skipNextUntap?: boolean;
    /** CR 614.12 as-enters NAME choice (Meddling Mage: "As this creature
     *  enters, choose a nonland card name"). Forwarded by `slimCard` like
     *  `chosenModeId`; read by `resolveChosenName` in `src/lib/preview-body.ts`
     *  so the permanent's rules box reads "… the chosen name (Lightning Bolt)"
     *  instead of the printed wording alone. Mirrors
     *  `CardInstanceState.chosenName` in `convex/gre/state.ts`. */
    chosenName?: string;
    /** Layer 5 color override (CR 305.7, 613.1d). Set by lace instants. */
    colorOverride?: string[];
    /** CR 707.2 / 202.3 — instance-level mana-cost override, set by a copy
     *  effect's "except it has no mana cost" clause (an Eternalize / Embalm
     *  token: `{}`). Forwarded by `slimCard` and read through the single
     *  mana-cost authority `getInstanceManaCost` (`convex/cards/registry.ts`),
     *  so the client's mana value and cost-derived colours agree with the
     *  server. Mirrors `CardInstanceState.manaCostOverride`. */
    manaCostOverride?: Record<string, unknown>;
    /** CR 111 — instance-level Scryfall print id for ART. Cosmetic only; set by
     *  a copy effect whose result has its OWN printed card (an Eternalize token
     *  renders its printed token frame, not the copied creature's printing).
     *  Preferred by `<CardImage>` over the definition-derived art. Mirrors
     *  `CardInstanceState.imagePrintId`. */
    imagePrintId?: string;
    /** Layer 5 color GRANT (CR 613.1d) — a colour ADDED by another permanent's
     *  static effect (Dralnu's Crusade "All Goblins are black", Sinister
     *  Strength), unioned with the printed cost's colours rather than replacing
     *  them like `colorOverride`. Forwarded by `slimCard` (the projection only
     *  strips `card`/`knownTo`), and read through the single colour authority
     *  `getEffectiveColors` (`convex/cards/effectiveColors.ts`) so colour
     *  filters / target highlighting on the board agree with the server.
     *  Mirrors `CardInstanceState.grantedColors` in `convex/gre/state.ts`. */
    grantedColors?: { color: string; sourceId: string }[];
    /** CR 205.4a — supertype(s) ADDED to this permanent by a `supertype-set`
     *  static effect or indefinite mutation (Melting / Arcum's Weathervane
     *  making a land snow). Forwarded by `slimCard` (the projection only
     *  strips `card`/`knownTo`); read through the single supertype authority
     *  `liveSupertypesOf` (`convex/cards/snowReads.ts`) so a client-side
     *  `sacrificeFilter`/`PermanentFilter` `supertypes` clause (Whiteout /
     *  Sunstone / Glacial Crevasses "sacrifice a snow land") matches the
     *  server's live status instead of only the PRINTED supertypes — a
     *  Weathervane'd land was a dead affordance without this (issue #2235
     *  review). Mirrors `CardInstanceState.grantedSupertypes` in
     *  `convex/gre/state.ts`. */
    grantedSupertypes?: { supertype: string; sourceId: string }[];
    /** CR 205.4a — supertype(s) REMOVED from this permanent by the same
     *  mutation mechanism (a Melting'd land losing "Snow"). See
     *  `grantedSupertypes` above; mirrors
     *  `CardInstanceState.removedSupertypes` in `convex/gre/state.ts`. */
    removedSupertypes?: { supertype: string; sourceId: string }[];
    /** Copy effect anchor (CR 707.2). When set, this permanent is a copy and
     *  `card.id` carries the copied object's def id; `copiedFrom` holds the
     *  printed identity restored when the copy leaves the battlefield. */
    copiedFrom?: string;
    /** CR 707.2's "except its base power and toughness are N/N" clause stamped
     *  on this copy, so a copy OF it inherits the exception (CR 707.3). Mirrors
     *  `CardInstanceState.copyExcept` in `convex/gre/state.ts`; forwarded by
     *  `slimCard` because the client-side Brain re-runs the copy path over
     *  projected state (ADR 0074). */
    copyExcept?: { basePower?: number; baseToughness?: number };
    /** Noted mana banked on a mana-battery permanent (CR 106.10 — Jeweled
     *  Amulet, Ice Cauldron). Per-colour amounts the artifact will add when its
     *  "remove a charge counter" ability resolves. Forwarded by `slimCard` (the
     *  projection only strips `card`/`knownTo`), so the client can surface which
     *  color is banked. `castableCardId` is set for Ice Cauldron's
     *  instance-restricted note. */
    notedMana?: { mana: Record<string, number>; castableCardId?: string };
    /** Cast-from-exile permission (CR 601.3e — Ice Cauldron: "You may cast that
     *  card for as long as it remains exiled"). Set on a card in the exile zone
     *  to the id of the player who may cast it from exile as if it were in hand.
     *  Crosses the wire for the owning viewer (`slimCard` only strips
     *  `card`/`knownTo`), so the client can offer a cast affordance from Exile.
     *  The exiled card may be face-down to the opponent (impulse-style), but the
     *  controller — who is in `knownTo` — sees the real identity and this flag,
     *  and may cast it. */
    castableFromExileBy?: string;
    /** CR 305.9 (issue #1689) — rides alongside `castableFromExileBy`; true iff
     *  the granting effect's Oracle text explicitly says "play" (not merely
     *  "cast") that card (Headliner Scarlett, Expressive Iteration, Dauthi
     *  Voidwalker). ONLY then is a LAND sitting in exile under the grant a
     *  legal play — a cast-only grant (Ice Cauldron, Robber of the Rich,
     *  Ragavan) never sets this, so a land under it is unusable (no play, no
     *  cast). Meaningless for a non-land card. Crosses the wire via
     *  `slimCard` (only strips `card`/`knownTo`). Mirrors
     *  `CardInstanceState.castableFromExileIncludesLand` in
     *  `convex/gre/state.ts`. */
    castableFromExileIncludesLand?: boolean;
    /** Turn-scoped expiry marker for `castableFromExileBy` (CR 514.2 / 608.2g).
     *  Present on an impulse "play that card this turn" grant (Headliner
     *  Scarlett, Expressive Iteration); the grant is revoked at that turn's
     *  cleanup. Absent for open-ended grants (Ice Cauldron, Robber). Crosses the
     *  wire via `slimCard`; not read by the client (the projection drops
     *  `castableFromExileBy` once the grant expires), kept for type parity. */
    castableFromExileUntilTurn?: number;
    /** CR 601.2f (issue #2383) — an OBJECT-SCOPED cost increase riding
     *  `castableFromExileBy`: "A spell cast this way costs {2} more to cast"
     *  (Elite Spellbinder). Crosses the wire via `slimCard` (which strips only
     *  `card`/`knownTo`); not read by the client, which gates its Exile Cast
     *  button on the projected `legalActions` instead — that flag is computed
     *  server-side by `getLegalActions`, which folds this tax through
     *  `getCostModifiers` like every other CR 601.2f increase, so the button is
     *  already priced correctly with nothing to recompute here. Kept for type
     *  parity with `CardInstanceState.castFromExileCostIncrease`
     *  (`convex/gre/state.ts`), exactly like `castableFromExileUntilTurn`
     *  above. */
    castFromExileCostIncrease?: ManaCost;
    /** Instance id of the battlefield permanent this exiled card is associated
     *  with (the permanent that exiled / holds it). Mechanism-agnostic — set by
     *  the projection for exile-and-return bundles (Banishing Light / Tawnos's
     *  Coffin), noted-mana batteries (Ice Cauldron), and any future exiler — so
     *  the board can pin the exiled card to that permanent (Arena treatment).
     *  Present for all viewers when the host permanent is on a battlefield. */
    exiledByPermanentId?: string;
    /** Per-ability-id activation tally for this turn (CR 602.5 — `oncePerTurn`
     *  activated abilities like Gate to Phyrexia's "Activate only once each
     *  turn"). Mirrors `CardInstanceState.activationsThisTurn`
     *  (`convex/gre/state.ts`); forwarded by `slimCard` (the projection only
     *  strips `card`/`knownTo`), so the client can hide a used-up activation
     *  identically to the server's `assertActivationTimingLegal` (issue #1694). */
    activationsThisTurn?: Readonly<Record<string, number>>;
    /** CR 111.5 / 701.21 — true iff this permanent is a token (not backed by a
     *  card). Mirrors `CardInstanceState.isToken` (`convex/gre/state.ts`);
     *  forwarded by `slimCard` (the projection only strips `card`/`knownTo`).
     *  Read by `toMatchablePermanent` (`~/lib/card-utils.ts`) so a client-side
     *  `may-pay` sacrifice affordability check (`PermanentFilter.isToken`,
     *  "sacrifice a nontoken permanent") matches the server instead of
     *  silently treating every permanent as non-token (issue #1938 fixup 2). */
    isToken?: boolean;
    /** CR 111 / 707.1 — instance id of the permanent that created this token
     *  (token provenance, e.g. Tetravus). Mirrors `CardInstanceState.createdBy`
     *  (`convex/gre/state.ts`); forwarded by `slimCard` (the projection only
     *  strips `card`/`knownTo`). Read by `toMatchablePermanent` so a client-side
     *  `may-pay` sacrifice filter's `createdBy` clause matches the server
     *  (issue #1938 fixup 2). */
    createdBy?: string;
    /** CR 400.7 — the turn this permanent entered the battlefield (the
     *  `markEnteredThisTurn` stamp). Mirrors `CardInstanceState.enteredOnTurn`
     *  (`convex/gre/state.ts`); forwarded by `slimCard` (the projection only
     *  strips `card`/`knownTo`). Read by `toMatchablePermanent` and by the
     *  client mirror of `controlledSinceTurnStart` so the sacrifice picker
     *  highlights exactly the permanents the server will accept. */
    enteredOnTurn?: number;
    /** CR 708.2 / ADR 0013 — this object is FACE DOWN. On the battlefield and
     *  the stack that means a 2/2 colourless nameless vanilla creature whatever
     *  the real card is, with `card.id` swapped to the `FACE_DOWN_CARD_ID`
     *  sentinel (mirrors `CardInstanceState.faceDown`). In EXILE (CR 406.3) it
     *  is projection-only, added by `projectExileCard` for BOTH viewers (issue
     *  #2904): the entitled viewer's exile card keeps its REAL `card.id` —
     *  they may cast it, so the client needs the real cost — and this flag is
     *  what tells the renderer to show a face-down face anyway.
     *
     *  This flag, NOT the sentinel id, is the client's face-down predicate
     *  (`isFaceDownCard`, `~/lib/face-down.ts`). */
    faceDown?: boolean;
    /** CR 708.2 / CR 406.3 (issue #2904) — WHICH mechanic put this object face
     *  down (`FaceDownProducer`, `convex/gre/faceDown.ts`). Public information
     *  and the ONLY input to the rendered face-down face, so the face never
     *  depends on the hidden card. Absent → the generic card back. */
    faceDownBy?: FaceDownProducer;
    /** CR 708.2 — the REAL definition id behind a face-down object. Present
     *  ONLY in the controller's / caster's own projection: `projectBattlefieldCard`
     *  and `projectStackItem` (`convex/gameProjections.ts`) keep it (pre-existing
     *  wire shape, unchanged by issue #1735) for them and delete it for every
     *  other viewer, so a client that reads it can never be reading an
     *  opponent's secret. Superseded by `knownCardId` below for any NEW
     *  identification read — kept on the wire only so existing consumers of
     *  this field don't regress. */
    faceDownOf?: string;
    /** CR 708.2 (issue #1735) — the REAL definition id behind a face-down
     *  object, present ONLY on the controller's / caster's own projection of
     *  their own face-down permanent or spell (the SAME value as `faceDownOf`
     *  above, under a name no rules computation has ever read). `card.card.id`
     *  itself is ALWAYS the `FACE_DOWN_CARD_ID` sentinel, for every viewer
     *  including the controller — every id-derived rules read (colour/MV/
     *  supertype filters, activated-ability affordance) must resolve off that
     *  honest sentinel, or the engine's own 2/2 vanilla creature diverges from
     *  what the client offers as a legal target/ability. `knownCardId` exists
     *  SOLELY for the identification affordance (rendering the controller's
     *  own card's real art/name) — read it ONLY for display, never for a
     *  rules computation. */
    knownCardId?: string;
    /** CR 116.2b / 702.37e (issue #2705) — the controller may take the morph
     *  turn-face-up special action on this permanent right now. Server-derived
     *  (`canTurnFaceUp`, `convex/gre/morph.ts`) because the board never runs the
     *  GRE: it cannot know whether the hidden card has a morph cost, let alone
     *  whether that cost is affordable. Only ever set on the controller's own
     *  projection. */
    canTurnFaceUp?: boolean;
}

export interface Combat {
    attackerIds: string[];
    /** CR 508.1a — per-attacker attack target: attackerId → planeswalkerId.
     *  Absence = the attacker is attacking the defending player. An entry means
     *  the attacker is attacking that planeswalker (combat damage → loyalty,
     *  issue #1220). Mirrors the GRE `combat.attackTargets`. */
    attackTargets?: Record<string, string>;
    confirmed: boolean;
    blockerAssignments: Record<string, string[]>;
    pendingBlockerId?: string;
    /** Parked land-sacrifice attack tax awaiting the attacking player's choice
     *  (CR 508.1c/1g, 701.21a — Flooded Woodlands). */
    pendingAttackSacrifice?: SacrificeSelection;
    /** Parked mana attack tax awaiting the attacking player's payment
     *  (CR 508.1c/1g — Propaganda, Ghostly Prison, Collective Restraint). */
    pendingAttackManaTax?: AttackManaTaxPayment;
    blockersConfirmed: boolean;
    damageAssignments?: Record<string, Record<string, number>>;
    damageConfirmed?: boolean;
    /** Attacking bands declared this combat (CR 702.22c). */
    bands?: { bandId: string; memberIds: string[] }[];
    /** sourceId → playerId responsible for assigning that source's damage. */
    damageAssignerIds?: Record<string, string>;
    /** Players that have confirmed their portion of damage assignment. */
    damageAssignmentConfirmedBy?: string[];
}

// Zone re-exported from @convex/gre/types above

export interface StackItem extends CardInstance {
    castById: string;
    targets?: TargetSelection[];
    /** If set, this stack item is a copy of a spell (CR 707.10 — Fork,
     *  storm copies). A spell copy has no distinct printed identity, so the
     *  preview shows a `Copy` badge rather than a second (original) face.
     *  Survives the wire projection via `slimCard`; declared here so the
     *  client can read it. */
    isCopy?: boolean;
    /** If set, this stack item is an activated ability (not a spell). */
    abilityId?: string;
    /** If set, this stack item is a triggered ability (CR 603). */
    triggeredAbilityId?: string;
    /** Instance id of the permanent that produced this trigger — the id on the
     *  battlefield, NOT this synthetic stack item's id. Survives the wire
     *  projection via `slimCard`; declared here so target arrows can originate
     *  at the source permanent rather than the stack row
     *  (`target-arrow-geometry.ts`). Undefined for spells and for triggers with
     *  no permanent source. */
    triggerSourceId?: string;
    /** Storm (CR 702.40, ADR 0052) — present only on the synthesized storm
     *  cast-trigger stack item (`triggeredAbilityId === "storm"`): copies
     *  still to be created as this trigger resolves. Useful for a "N copies
     *  left" hint; the engine-internal `stormSnapshot` field is intentionally
     *  NOT sent over the wire (see `slimCard`, gameProjections.ts). */
    stormCopiesRemaining?: number;
    /** If set, this stack item is a delayed triggered ability (CR 603.7a)
     *  queued by an earlier spell/ability's resolution (e.g. Mishra's
     *  Bauble's "draw a card at the beginning of the next turn's upkeep").
     *  Oracle text lives on `cardDef.delayedTriggers`, looked up by this id. */
    delayedTriggerId?: string;
    /** ADR 0048 — oracle text of a fired INLINE delayed trigger (DSL
     *  `delayedTrigger` Op). Such a trigger has NO `cardDef.delayedTriggers[]`
     *  row (its id is the constant `INLINE_DELAYED_TRIGGER_ID`), so its text is
     *  carried on the stack item and survives the wire projection. The stack
     *  view reads it to render the ability tile instead of a full-card image
     *  (Sneak Attack, Forth Eorlingas). Undefined for the template path. */
    delayedOracleText?: string;
    /** CR 725 (issue #1305) — a source-less inherent DESIGNATION triggered
     *  ability (the Monarch's end-step draw). Keys a state designation
     *  (`convex/cards/designations.ts`) so the stack tile shows the marker-card
     *  art + name instead of the empty tile a card-less inline trigger would
     *  render. Undefined for every normal stack item. */
    designationId?: string;
    /** Per-source marker-art override (issue #1305) — themes the designation
     *  tile to the granting card's own printing (Forth Eorlingas → the LTR
     *  "The Monarch"). Undefined ⇒ the client uses the designation's global
     *  `imagePrintId`. Cosmetic. */
    designationImagePrintId?: string;
    /** CR 700.2c (issue #1274) — the mode a modal spell locked in at cast
     *  (`SpellMode.id`). Survives the wire projection via `slimCard`
     *  (`SlimStackItem` keeps every StackItem field but `card`); declared here
     *  so the stack view can highlight the chosen mode's oracle line for BOTH
     *  players. Undefined for non-modal spells and abilities. */
    chosenModeId?: string;
}

export type {
    GenericSpendAmbiguity,
    MulliganState,
    PendingActivation,
    PendingCast,
    PendingChoice,
    PendingChoiceKind,
    PendingTarget,
    RevealNotification,
} from "@convex/gre/state";
export type { RestrictedMana };
export type {
    SacrificeSelection,
    SacrificeRequirement,
} from "@convex/gre/sacrificeChoice";

export interface GameOver {
    winnerId: string;
    loserId: string;
    /** "alternate-win" (issue #1066, CR 104.2a) — a spell/ability designates
     *  the winner directly (Coalition Victory). */
    reason: "life" | "decked" | "concede" | "draw" | "poison" | "alternate-win";
    /** True when the game ended in a draw (CR 104.4a — Divine Intervention). */
    isDraw?: boolean;
}

// CardAction re-exported from @convex/gre/types above
