import type {
    CardInstanceState,
    GameState,
    GrantedAbilityInstance,
    PhasedOutBundle,
    PlayerState,
    StackItem,
} from "./gre/state";
import { getPendingChoiceMax, getPlayer } from "./gre/state";
import type { CardAction } from "./gre/types";
import type { ActivatedAbility, ManaCost } from "./cards/types";
import {
    canCastFromGraveyardByPermission,
    canCastPermanentFromGraveyardByPermission,
    canPlayLandsFromGraveyard,
    canCastSpellsFromTopOfLibrary,
    isCastableLibraryTopSpell,
    isPlayableLibraryTopLand,
    getLegalActions,
    phyrexianLifePipOptions,
    flashSurchargeRequired,
} from "./gre/rules";
import { canSummonCompanion } from "./gre/companion";
import { canTurnFaceUp } from "./gre/morph";
import { isHiddenFromKnower } from "./gre/faceDown";
import {
    computeLibraryTopLookedAtPlayers,
    computeLibraryTopRevealedPlayers,
} from "./gre/libraryReveal";
import { flashbackExileEligibleCount, hasFlashback } from "./gre/flashback";
import { hasEscape } from "./gre/escape";
import { hasRetrace } from "./gre/retrace";
import {
    FACE_DOWN_CARD_ID,
    getInstanceManaCost,
    tryGetDefinition,
} from "./cards";

/** CardInstanceState with the static card def stripped to { id } only. */
export type SlimCardInstance = Omit<CardInstanceState, "card"> & {
    card: { id: string };
};

/** Hand card in projected state: slim + legalActions attached. ADR 0026 — own
 *  hand cards carry a derived `seenByOpponent` flag (≥1 non-owner in `knownTo`)
 *  driving the Arena-style eye icon. Raw `knownTo` is stripped before this. */
export type SlimHandCard = SlimCardInstance & {
    legalActions: CardAction[];
    seenByOpponent?: boolean;
    /** CR 107.4f — the affordable mana-vs-life split choices for a castable
     *  Phyrexian-mana card in the viewer's OWN hand, as the distinct `lifePips`
     *  values the caster could pay (0 = all pips with mana … totalPips = all with
     *  2 life). Present ONLY when there are TWO OR MORE affordable options — i.e.
     *  a REAL choice (both mana and life are payable for at least one pip). The
     *  client shows the split picker exactly when this is present, sending the
     *  chosen value as `announceCast`'s `phyrexianLifePips`; a degenerate
     *  zero-branch cost carries no field and the engine auto-resolves it. */
    phyrexianOptions?: number[];
    /** CR 601.3c — true when casting THIS card from the viewer's OWN hand right
     *  now would owe its conditional-flash surcharge ("You may cast this spell
     *  as though it had flash if you pay {2} more to cast it" — the Invasion
     *  cycle, issue #2146). Server-authoritative, from the same
     *  `flashSurchargeRequired` predicate `announceCast` charges on: the client
     *  never re-derives cast timing (it has no `castTimingFlashGrants`, no
     *  stack/priority reasoning), so without this field a card whose ONLY cost
     *  decision is this rider — no X, no kicker, no buyback — would skip the
     *  cast-cost dialog entirely and be surcharged with no warning. Absent
     *  (never `false`) when nothing is owed, so the dialog is not opened to
     *  offer a pointless {2} at sorcery speed. */
    flashSurchargeRequired?: true;
};

/** Exile card in projected state: slim, plus `legalActions` when the viewer may
 *  cast it from exile (CR 601.3 — Ice Cauldron's noted card). The field is
 *  present only on the viewer's own `castableFromExileBy` cards and drives the
 *  Cast affordance's enabled state, exactly as `SlimHandCard.legalActions` gates
 *  a hand card — so an unaffordable exile cast (e.g. noted mana of the wrong
 *  colour) disables the button instead of throwing at the cast mutation. */
export type SlimExileCard = SlimCardInstance & {
    legalActions?: CardAction[];
    /** Instance id of the battlefield permanent this exiled card is associated
     *  with — the permanent that exiled / holds it. Unifies every exile-linkage
     *  mechanism (Banishing Light / Tawnos's Coffin exile-and-return bundles,
     *  Ice Cauldron's noted card, future Dauthi-Voidwalker-style exilers) so the
     *  client can pin the exiled card to that permanent (Arena treatment). Set
     *  for all viewers; present only when the host permanent is on a
     *  battlefield. See {@link buildExileAssociation}. */
    exiledByPermanentId?: string;
};

/** Graveyard card in projected state: slim, plus `legalActions` when the viewer
 *  may cast it from the graveyard via Flashback (CR 702.34), escape (CR
 *  702.138), the BROAD turn-scoped graveyard-cast permission (CR 305.1-analog
 *  / 601, Yawgmoth's Will, issue #1149), a SPECIFIC-CARD graveyard-cast grant
 *  (CR 601.3 / 117.6-analog, Malcolm, Alluring Scoundrel, issue #1344), or
 *  play it as a LAND under an unconditional play-lands-from-graveyard
 *  permission (CR 305.1-analog, Icetill Explorer #1190, or the same BROAD
 *  #1149 permission when its zones cover "land"). Present only on the
 *  viewer's own graveyard cards; drives the Flashback / Escape / Cast / Play
 *  affordance's enabled state, exactly like {@link SlimExileCard.legalActions}
 *  for an exile cast. */
export type SlimGraveyardCard = SlimCardInstance & {
    legalActions?: CardAction[];
    /** CR 702.34 / 702.138 / 702.81 / 305.1-analog / 117.6-analog — which
     *  graveyard-cast mechanism surfaced this card's affordance, so the UI
     *  labels the button "Flashback" / "Escape" / "Retrace" / "Cast". Present
     *  only alongside `legalActions` for a CAST affordance — a land tagged under
     *  a play-from-graveyard permission carries `legalActions` with NO
     *  `castKind` (it's a "play", not a keyword cast).
     *
     *  Widening this union is a FAIL-OPEN change on the client: the label
     *  dispatch in `graveyard-flashback-button.tsx` is an `if`/`===` chain with
     *  a "Flashback" default, so an unhandled new member renders the wrong
     *  label with no type error. Every new member must be handled there in the
     *  same change (and mirrored in `src/types/game.ts`'s re-export). */
    castKind?:
        | "flashback"
        | "escape"
        | "graveyard-permission"
        | "graveyard-grant"
        | "graveyard-permanent-permission"
        | "retrace";
    /** CR 702.34a / 118.5 / 107.3 — the maximum {X} the caster may announce on
     *  THIS flashback cast, bounded by its `flashbackExileFromGraveyard`
     *  additional cost ("Exile X blue cards from your graveyard", Flash of
     *  Insight): the count of eligible cards in the viewer's own graveyard,
     *  excluding the flashback card itself (CR 601.2a). Present ONLY on a
     *  `castKind: "flashback"` card that carries this cost, so the client X
     *  stepper caps at a payable value instead of letting the caster announce
     *  an X the exile cost can't cover (which the server rejects at commit).
     *  Absent for a flashback with no graveyard-exile cost (X uncapped). */
    flashbackExileMaxX?: number;
};

/** Companion slot (CR 702.139, ADR 0064) projected to the wire: `instance`
 *  slimmed like every other card, `used` carried verbatim, revealed to BOTH
 *  players (CR 702.139c — the wire-format equivalent of "carried unchanged
 *  through the projection, never hidden like a hand/library card"). */
export type SlimCompanionSlot = {
    instance: SlimCardInstance;
    used: boolean;
    /** CR 116.2 / 702.139a — true iff the `summon-companion` special action
     *  is legal for the VIEWER right now (`canSummonCompanion`, gre/
     *  companion.ts). Present ONLY on the viewer's own player — mirrors
     *  every other viewer-scoped affordance field (`SlimHandCard.
     *  legalActions`, etc.); the opponent's companion is visible but never
     *  carries an affordance for someone else's special action. */
    canSummon?: boolean;
};

/** A viewer-known library card, optionally carrying the play affordance.
 *  `legalActions` is attached ONLY to the viewer's OWN library top (index 0)
 *  while they hold a play-lands-from-top-of-library permission (Courser of
 *  Kruphix, CR 305.1-analog). Mirrors `SlimGraveyardCard`'s land branch: the
 *  board never sees the GRE, so a playable card must arrive already tagged for
 *  the UI to offer — and gate — the Play button. No `castKind`: this is a
 *  "play", not a keyword cast. Never attached to an opponent's library, whose
 *  top card can legitimately be known (the CR 401.5 reveal is symmetric) but is
 *  never playable by the viewer. */
export type SlimLibraryCard = SlimCardInstance & {
    legalActions?: CardAction[];
    /** CR 118.9-analog / 107.3b / 601.2b (issue #2398) — true when the
     *  cast-from-top permission covering THIS card replaces its mana cost
     *  wholesale (Bolas's Citadel: "pay life equal to its mana value rather
     *  than pay its mana cost"), rather than letting it be cast for the printed
     *  cost (Vizier of the Menagerie's shape).
     *
     *  The client has no view of the permission at all — it sees only this
     *  projected card — and two announcement choices are ILLEGAL on such a
     *  cast, so both must be suppressed where they are OFFERED and not only
     *  rejected at the mutation: an `{X}` value (CR 107.3b — "the only legal
     *  choice for X is 0") and an alternative cost (CR 601.2b — "a player can't
     *  apply two alternative methods of casting … to a single spell"). Derived
     *  from the GRANT's `manaCostReplacement` being present at all, so a future
     *  replacement shape inherits both suppressions without a second field. */
    castManaCostReplaced?: true;
};

/** ADR 0026 / PRD #338 — one viewer-known library card, projected sparsely.
 *  `index` is the position from the top of the library (0 = top). */
export type KnownLibraryCard = { index: number; card: SlimLibraryCard };

/** Projected library wire shape (ADR 0026). `count` is the full size; `known`
 *  carries only the cards the viewer legitimately knows (`viewer ∈ knownTo`),
 *  each at its top-relative `index`. Empty `known` for a fully hidden library. */
export type PublicLibrary = { count: number; known: KnownLibraryCard[] };

/** StackItem slimmed to { id } card ref. `knownCardId` (issue #1735) mirrors
 *  `SlimBattlefieldCard.knownCardId`: present ONLY for the caster's own view
 *  of their own face-down spell, carrying the real definition id, while
 *  `card.card.id` stays the sentinel for every viewer (including the caster)
 *  so id-derived rules reads (e.g. a spell-target mvFilter) never see through
 *  the face-down state. */
export type SlimStackItem = Omit<StackItem, "card"> & {
    card: { id: string };
    knownCardId?: string;
};

/** Granted ability hydrated with its template data so clients can render
 *  oracle text and cost without loading the backend card registry. */
export type PublicGrantedAbility = {
    id: string;
    sourceCardId: string;
    abilityId: string;
    oracleText: string;
    cost: ActivatedAbility["cost"];
    useStack: boolean;
    manaProduced?: ManaCost;
    duration: GrantedAbilityInstance["duration"];
};

/** PlayerState as seen through the public projection (library hidden, opponent hand nulled).
 *  `library` is always `{ count }` on the wire. When the viewer is the chooser
 *  of an active `search-library` pending choice (CR 401.4 / 701.23), the
 *  searched library is additionally exposed as `librarySearch` — a slim card
 *  list rendered face-up to the searcher. The flag does not alter the
 *  library shape so existing consumers (and tests asserting `library.count`)
 *  are unaffected. */
export type PublicPlayer = Omit<
    PlayerState,
    | "hand"
    | "library"
    | "graveyard"
    | "exile"
    | "battlefield"
    | "grantedAbilities"
    | "companion"
> & {
    hand: (SlimHandCard | null)[];
    library: PublicLibrary;
    librarySearch?: SlimCardInstance[];
    libraryPeek?: SlimCardInstance[];
    revealedHand?: SlimCardInstance[];
    graveyard: SlimGraveyardCard[];
    exile: SlimExileCard[];
    battlefield: SlimBattlefieldCard[];
    grantedAbilities?: PublicGrantedAbility[];
    companion?: SlimCompanionSlot;
};

/** PlayerState in the full debug projection (everything visible, card defs slimmed). */
export type FullPlayer = Omit<
    PlayerState,
    | "hand"
    | "library"
    | "graveyard"
    | "exile"
    | "battlefield"
    | "grantedAbilities"
    | "companion"
> & {
    hand: SlimHandCard[];
    library: SlimCardInstance[];
    /** Set only on the chooser's player while a `search-library` choice is
     *  active (CR 401.4 / 701.23) — the library exposed face-up for the picker.
     *  Mirrors `PublicPlayer.librarySearch` so the same UI gate works in the
     *  full debug view. */
    librarySearch?: SlimCardInstance[];
    /** Mirrors `PublicPlayer.libraryPeek` — the looked-at top N cards of the
     *  zone owner's library during an active `reorder-library` /
     *  `draw-look-keep` choice (CR 401.4), so the picker pile opens in the
     *  full debug view too (#262). */
    libraryPeek?: SlimCardInstance[];
    /** Mirrors `PublicPlayer.revealedHand` — the zone owner's hand during an
     *  active `reveal-hand` choice (CR 401.4), for the full debug view (#262). */
    revealedHand?: SlimCardInstance[];
    graveyard: SlimGraveyardCard[];
    exile: SlimExileCard[];
    battlefield: SlimBattlefieldCard[];
    grantedAbilities?: PublicGrantedAbility[];
    companion?: SlimCompanionSlot;
};

/** CR 702.26 — a phased-out bundle projected to the wire: host + attachments
 *  slimmed. Phasing is public information (the set-aside permanents stay
 *  face-up), so identity is not hidden beyond the normal face-down rule that
 *  `projectBattlefieldCard` already applies per card. */
export type SlimPhasedOutBundle = Omit<PhasedOutBundle, "cards"> & {
    cards: SlimBattlefieldCard[];
};

/** A battlefield permanent on the wire. Adds the ONE server-derived affordance
 *  the client cannot compute for itself: whether its controller may take the
 *  CR 116.2b / 702.37e turn-face-up special action on it right now. Absent
 *  (rather than `false`) whenever the action is unavailable, so the flag costs
 *  nothing on the overwhelming majority of permanents, which are face up.
 *
 *  `knownCardId` (issue #1735) is the controller's face-down identification
 *  affordance: present ONLY on the controller's own view of their own
 *  face-down permanent, carrying the REAL definition id. `card.card.id`
 *  itself stays the face-down sentinel for EVERY viewer — every id-derived
 *  rules read (colour, mana value, supertypes, activated abilities) must see
 *  the CR 708.2 vanilla 2/2, never the real card, even for the controller. */
export type SlimBattlefieldCard = SlimCardInstance & {
    canTurnFaceUp?: boolean;
    knownCardId?: string;
};

export type PublicGameState = Omit<
    GameState,
    "players" | "stack" | "phasedOut" | "pendingTriggerBatch"
> & {
    seq: number;
    players: PublicPlayer[];
    stack: SlimStackItem[];
    phasedOut?: SlimPhasedOutBundle[];
    // CR 603.3b / ADR 0058 — off-stack simultaneous-trigger batch, slimmed.
    pendingTriggerBatch?: SlimStackItem[];
};

export type FullGameState = Omit<
    GameState,
    "players" | "stack" | "phasedOut" | "pendingTriggerBatch"
> & {
    seq: number;
    players: FullPlayer[];
    stack: SlimStackItem[];
    phasedOut?: SlimPhasedOutBundle[];
    // CR 603.3b / ADR 0058 — off-stack simultaneous-trigger batch, slimmed.
    pendingTriggerBatch?: SlimStackItem[];
};

function slimCard<
    T extends { card: { id?: string } | Record<string, unknown> },
>(instance: T): Omit<T, "card"> & { card: { id: string } } {
    const id = (instance.card as { id?: string }).id ?? "";
    const slimmed = { ...instance, card: { id } };
    // ADR 0026 — the raw per-viewer knowledge set must NEVER cross the wire;
    // identity is gated upstream and the eye flag is derived separately.
    delete (slimmed as { knownTo?: string[] }).knownTo;
    // Storm (CR 702.40, ADR 0052) — `stormSnapshot` is a resolution-time
    // engine artifact (a full nested StackItem with its OWN fat `card`
    // field) the client has no use for; ship the trigger item itself (and
    // `stormCopiesRemaining`, useful for a "N copies left" hint) but drop
    // the snapshot rather than doubling the payload with a duplicate,
    // un-slimmed card.
    delete (slimmed as { stormSnapshot?: unknown }).stormSnapshot;
    // CR 608.2h / 113.7a (issue #2042) — `sourceLki`, the departure-time
    // snapshot of a trigger's source permanent, is the same shape hazard as
    // `stormSnapshot` directly above and gets the same treatment: it is a
    // resolution-time engine artifact (a full nested `CardInstanceState` with
    // its OWN fat `card` field and its own `knownTo`) that no client renders,
    // so it is stripped rather than shipped. Everything it holds WAS public
    // battlefield state, so this is payload and drift hygiene rather than a
    // privacy boundary — but stripping is the fail-closed default: a field
    // that never crosses the wire cannot leak a future non-public one
    // (#1977/#1982), and the engine reads it server-side only.
    delete (slimmed as { sourceLki?: unknown }).sourceLki;
    // CR 608.2h / 400.7 (issue #2384) — `capturedBindings`, the cross-ability
    // binding memory one of this permanent's abilities left for a later one, is
    // the third field of exactly the `sourceLki` shape and gets the same
    // treatment. No client reads it; the engine reads it server-side only, at
    // `recallCapturedBinding`. Everything Skyclave Apparition puts there is
    // already-public exile-zone information, so this is payload hygiene TODAY —
    // but a future card capturing a binding to a card in a HIDDEN zone (a hand
    // card snapshot carries its id, name and mana value) would leak it to the
    // opponent through a field nothing renders, and stripping is the
    // fail-closed default that makes that impossible (#1977/#1982).
    delete (slimmed as { capturedBindings?: unknown }).capturedBindings;
    return slimmed;
}

/** ADR 0026 — true iff a non-owner currently knows this card's identity. Drives
 *  the own-hand eye icon (`seenByOpponent`). */
function hasNonOwnerKnower(card: CardInstanceState): boolean {
    return (card.knownTo ?? []).some((id) => id !== card.ownerId);
}

/** ADR 0026 / PRD #338 — projects a library to the sparse wire shape for one
 *  viewer: `count` is the full size, `known` carries only the cards where
 *  `viewer ∈ knownTo`, each at its top-relative `index` (0 = top). The owner
 *  does NOT auto-know their own order; gating is purely by `knownTo`. Raw
 *  `knownTo` never crosses the wire (each card is slimmed).
 *
 *  Only the two CONTIGUOUS known runs from each END are exposed — the run from
 *  the TOP (scry/Brainstorm kept on top) and the run from the BOTTOM (scry /
 *  Impulse / Stock Up cards the controller looked at and PLACED at the bottom in
 *  a chosen order, so their position is certain). Iteration from each end stops
 *  at the first position the viewer doesn't know. A card whose `knownTo`
 *  survived on the instance but which a later reorder/bottoming buried BETWEEN
 *  unknown cards (e.g. a scry-known top card pushed down by a subsequent Stock
 *  Up) is contiguous with NEITHER end, so it reads as a face-down back again —
 *  position certainty is lost once an unknown card straddles it, and the flag
 *  effectively disappears in the UI without mutating the instance. Cards kept on
 *  top and merely reordered (Diabolic Vision) stay in the top run and stay
 *  known; cards ordered onto the bottom (CR 701.22 "in any order") stay in the
 *  bottom run and stay known. The two runs never overlap: the bottom scan stops
 *  at the top run's boundary, so an all-known library is emitted exactly once.
 *
 *  CR 401.5 (issue #1095) — `topRevealed` is the continuous
 *  "play with the top card of your library revealed" static (Goblin Spy,
 *  `CardDefinition.revealsLibraryTop`, derived live by
 *  `computeLibraryTopRevealedPlayers`). It makes index 0 — and ONLY index 0 —
 *  known to EVERY viewer, independently of `knownTo`: a symmetric, both-seats
 *  reveal riding the SAME sparse `known[]` channel a scry-to-top already uses,
 *  so no new wire field and no new client rendering path is needed. It is a
 *  second SOURCE of knowledge, not a second shape. Because it is recomputed on
 *  every projection it cannot go stale: after a draw / shuffle / mill / put-on-
 *  top the new index 0 is the revealed card (CR 401.6, CR 701.20d), and when
 *  the source leaves the battlefield the flag is simply false again. An EMPTY
 *  library reveals nothing (the loop never runs) — `known` stays `[]`.
 *
 *  CR 401.5 (issue #2398) — the same `topRevealed` channel also carries the
 *  ASYMMETRIC "you may look at the top card of your library" permission
 *  (Bolas's Citadel, `CardDefinition.looksAtLibraryTop`): the caller ORs it in
 *  only when the library belongs to the VIEWER, so a looked-at top card
 *  reaches its own controller and nobody else. This function stays
 *  viewer-independent — it is told whether index 0 is known to THIS viewer,
 *  never why.
 *
 *  CR 305.1-analog / 601.3 — `topLegalActions`, when supplied, is attached to the
 *  index-0 entry as its `legalActions`: the viewer's OWN library top is a
 *  playable land under a play-lands-from-top-of-library permission (Courser of
 *  Kruphix). Computed by the caller (which alone knows whether this library
 *  belongs to the viewer) and re-derived every projection, so the affordance
 *  disappears the instant the granting source leaves play, the land drop is
 *  spent, or a draw/shuffle moves a different card to the top. It rides the
 *  card object rather than a new wire field, exactly as the graveyard land
 *  affordance does (`SlimGraveyardCard`), so the client's per-card action
 *  overlay needs no new plumbing. It carries "cast" instead of "play" when the
 *  top card is a nonland spell the viewer may cast from there (issue #2398,
 *  Bolas's Citadel) — one field, whichever action the permission grants. Only emitted when index 0 is ALSO known —
 *  which is why it never leaks identity: it is an affordance on a card the
 *  viewer can already see, never a signal about a hidden one. */
function projectLibrary(
    library: CardInstanceState[],
    viewerId: string,
    topRevealed: boolean = false,
    /** The whole index-0 affordance bundle (`legalActions` plus the CR
     *  118.9-analog cost-replacement flag), or `undefined` when the top card
     *  carries no affordance for this viewer. Spread verbatim onto the
     *  projected top card so a new affordance field never needs a new
     *  positional parameter here. */
    topAffordance?: Omit<SlimLibraryCard, keyof SlimCardInstance>
): PublicLibrary {
    // CR 401.5 — the continuous reveal is viewer-INDEPENDENT and covers exactly
    // index 0; every other position stays gated by per-viewer `knownTo`.
    const knows = (card: CardInstanceState, index: number) =>
        (topRevealed && index === 0) ||
        (card.knownTo?.includes(viewerId) ?? false);
    const known: KnownLibraryCard[] = [];
    // Top run: [0, topEnd).
    let topEnd = 0;
    while (topEnd < library.length && knows(library[topEnd], topEnd)) {
        const slim = slimCard(library[topEnd]);
        known.push({
            index: topEnd,
            card:
                topEnd === 0 && topAffordance !== undefined
                    ? { ...slim, ...topAffordance }
                    : slim,
        });
        topEnd++;
    }
    // Bottom run: (bottomStart, length), scanning up but never crossing topEnd
    // so an all-known library is not double-counted.
    for (let index = library.length - 1; index >= topEnd; index--) {
        if (!knows(library[index], index)) break;
        known.push({ index, card: slimCard(library[index]) });
    }
    return { count: library.length, known };
}

/** Projects one battlefield permanent for a given viewer. The battlefield is
 *  public EXCEPT for the identity of a face-down permanent (CR 708.2,
 *  ADR 0013): `card.card.id` stays the face-down sentinel for EVERY viewer,
 *  controller included — issue #1735. Every id-derived characteristic
 *  (`supertypeFilter`, `colorFilter`, `mvFilter`, `getEffectiveActivatedAbilities`,
 *  …) resolves off this id, and the underlying game OBJECT genuinely has none
 *  of the real card's characteristics while face down; restoring the real id
 *  for the controller used to make those reads see the face-up card while the
 *  engine still enforced the face-down 2/2, the exact Karakas-style divergence
 *  the issue fixes. The controller's identification affordance (they may look
 *  at their own face-down card) rides the SEPARATE `knownCardId` field
 *  instead, which no id-derived filter reads — `faceDownOf` ALSO still rides
 *  the wire for the controller (unchanged, pre-existing behaviour) carrying
 *  the same real id, so nothing downstream that already reads it regresses.
 *  Every other viewer gets neither field, so the real identity never crosses
 *  the wire to them. */
function projectBattlefieldCard(
    card: CardInstanceState,
    viewerId: string,
    state?: GameState
): SlimBattlefieldCard {
    // CR 116.2b / 702.37e (issue #2705) — the turn-face-up affordance. Derived
    // server-side and carried on the wire for the same reason the companion's
    // `canSummon` is: the board never runs the GRE, so it cannot ask whether
    // this face-down permanent has a morph cost (it does not even know which
    // card it is when the viewer is the opponent) nor whether that cost is
    // affordable. Only ever true for the CONTROLLER — `canTurnFaceUp` checks
    // control — so it leaks nothing: an opponent already knows the permanent is
    // face down, and the flag says nothing about which card it is.
    //
    // `state` is optional and absent for PHASED-OUT bundles, which is deliberate
    // rather than an oversight: a phased-out permanent is treated as though it
    // does not exist (CR 702.26b), so no special action may be taken on it and
    // the affordance must not appear.
    const turnUp =
        state !== undefined &&
        card.faceDown === true &&
        canTurnFaceUp(state, getPlayer(state, card.controllerId), card);
    const decorate = (slim: SlimBattlefieldCard): SlimBattlefieldCard =>
        turnUp && viewerId === card.controllerId
            ? { ...slim, canTurnFaceUp: true }
            : slim;
    if (!card.faceDown) return slimCard(card);
    // slimCard returns a fresh object, so deleting the marker below never
    // mutates live state. `card.card.id` is ALREADY the sentinel in raw state
    // (turnFaceDown swaps it there, not per-viewer) — it needs no
    // special-casing here at all, only `faceDownOf` is viewer-gated.
    const slimmed = slimCard(card);
    if (viewerId === card.controllerId && card.faceDownOf) {
        // The controller knows what they cast — `faceDownOf` keeps carrying
        // the real id (pre-existing wire shape, unchanged), and `knownCardId`
        // is the SAME value under the name every id-derived filter is
        // guaranteed never to read, so a future filter reusing the "obvious"
        // field name can't reintroduce this bug.
        return decorate({ ...slimmed, knownCardId: card.faceDownOf });
    }
    // Opponents/spectators: hide the true identity entirely.
    delete (slimmed as { faceDownOf?: string }).faceDownOf;
    return decorate(slimmed);
}

/** Projects one STACK item for a given viewer (CR 702.37c / 708.2, issues
 *  #2705 / #1735). Exactly the battlefield rule, applied to the zone that had
 *  no rule at all: a face-down morph spell sits on the stack for a whole
 *  priority round before it resolves, and `state.stack.map(slimCard)` was
 *  viewer-blind — the sentinel `card.card.id` is correct for everyone (it is
 *  mutated in place at `turnFaceDown` time, not derived per viewer) and MUST
 *  stay that way for every viewer, caster included: `mvOfStackItem` and the
 *  spell-target filter registry resolve characteristics off this id, and a
 *  restored real id there reproduces the same Karakas-style divergence #1735
 *  fixed on the battlefield, one zone over. The caster's identification
 *  affordance rides `knownCardId` (a new field, alongside the pre-existing
 *  `faceDownOf`, both carrying the same real id) instead, exactly like the
 *  battlefield.
 *
 *  Also applied to `pendingTriggerBatch` (the off-stack CR 603.3b ordering
 *  batch). A triggered ability is not itself a face-down OBJECT, but its
 *  StackItem is built by `buildTriggerItem` spreading `...self` from the
 *  source permanent, so it inherits that permanent's `faceDown` /
 *  `faceDownOf`. A face-down permanent CAN have a trigger: a granted one
 *  (`grantedTriggeredAbilities`, layer 6 — leg/white.ts, ice/blue.ts,
 *  m12/blue.ts) survives the layer replay `turnFaceDown` performs, so the
 *  source's identity is NOT public and must be gated per viewer here too.
 *  `castById` is the source's controller (`buildTriggerItem`), so the
 *  controller keeps seeing their own card and the opponent does not. */
function projectStackItem(item: StackItem, viewerId: string): SlimStackItem {
    if (!item.faceDown) return slimCard(item);
    const slimmed = slimCard(item);
    if (viewerId === item.castById && item.faceDownOf) {
        // The caster knows what they cast — `faceDownOf` keeps carrying the
        // real id (pre-existing wire shape, unchanged) and `knownCardId` is
        // the same value under the name id-derived filters never read.
        return { ...slimmed, knownCardId: item.faceDownOf };
    }
    delete (slimmed as { faceDownOf?: string }).faceDownOf;
    return slimmed;
}

/** ADR 0026 / PRD #338 (slice 6) — projects one exile card for a given viewer.
 *  Exile is normally a public, open zone (CR 406): every viewer sees the real
 *  identity, so `knownTo` is stripped on a face-up exile move and this returns
 *  the card unchanged. The exception is a FACE-DOWN exile (impulse-draw,
 *  CR 406.3): the impulse primitive leaves a non-empty `knownTo` on the
 *  instance, marking it secret. For those, identity is gated per-viewer exactly
 *  like a hidden zone — a viewer in `knownTo` sees the real id; everyone else
 *  sees the face-down sentinel with the true id (and `faceDownOf`, defensively)
 *  stripped, so it never crosses the wire. */
/** Maps each exiled card instance id → the battlefield permanent it is visually
 *  associated with (the permanent that exiled / holds it). Unifies every
 *  exile-linkage mechanism so the UI can pin the exiled card to that permanent
 *  (Arena / Banishing Light treatment), independent of WHY it is linked:
 *   - exile-and-return bundles (ADR 0028 — Tawnos's Coffin, Banishing Light
 *     style), keyed by the holding permanent's `sourceId`;
 *   - noted-mana batteries (Ice Cauldron), via `notedMana.castableCardId`.
 *  Only associations whose host permanent is currently on a battlefield are
 *  emitted (otherwise there is nothing to pin to). New exilers reuse this by
 *  contributing their own linkage here — the projected field and the client
 *  rendering stay mechanism-agnostic. */
function buildExileAssociation(state: GameState): Map<string, string> {
    const onBattlefield = new Set<string>();
    for (const p of state.players)
        for (const c of p.battlefield) onBattlefield.add(c.id);
    const map = new Map<string, string>();
    for (const bundle of state.exileHeld ?? []) {
        if (!onBattlefield.has(bundle.sourceId)) continue;
        map.set(bundle.hostId, bundle.sourceId);
        for (const a of bundle.attached) map.set(a.id, bundle.sourceId);
    }
    for (const p of state.players) {
        for (const c of p.battlefield) {
            const linked = c.notedMana?.castableCardId;
            if (linked) map.set(linked, c.id);
        }
    }
    // issue #791 — per-source exile provenance (`exiledBySourceId`, Currency
    // Converter). A card exiled "with" a battlefield permanent pins to it,
    // exactly like the exile-and-return bundles above. Only emit when the
    // source is still on a battlefield (nothing to pin to otherwise).
    for (const p of state.players) {
        for (const c of p.exile) {
            const src = c.exiledBySourceId;
            if (src && onBattlefield.has(src)) map.set(c.id, src);
        }
    }
    return map;
}

function projectExileCard(
    card: CardInstanceState,
    viewerId: string,
    opts?: {
        legalActionsFor?: () => CardAction[];
        exiledByPermanentId?: string;
    }
): SlimExileCard {
    // CR 601.3 — the viewer's own card it may cast from exile carries
    // `legalActions` so the Cast affordance gates on real legality (timing,
    // affordability incl. noted/restricted mana), exactly like a hand card. The
    // flag rides the controller's view only; opponents never get it. The
    // `exiledByPermanentId` link is visible to ALL viewers (both sides see the
    // exiled card pinned to its permanent — face-down for the opponent).
    const decorate = (slim: SlimExileCard): SlimExileCard => {
        let out = slim;
        if (opts?.exiledByPermanentId !== undefined) {
            out = { ...out, exiledByPermanentId: opts.exiledByPermanentId };
        }
        if (opts?.legalActionsFor && card.castableFromExileBy === viewerId) {
            out = { ...out, legalActions: opts.legalActionsFor() };
        }
        return out;
    };
    // No knowledge stamped → ordinary face-up exile, public to all.
    if (!card.knownTo || card.knownTo.length === 0)
        return decorate(slimCard(card));
    // A viewer allowed to look sees the real card. Since issue #2904 they are
    // also TOLD it is face down — but ONLY when it genuinely is face down TO
    // THEM. `knownTo` on an exiled card is overloaded (ADR 0026): it backs both
    // the CR 406.3 cards whose oracle says "face down" AND the impulse idiom,
    // whose paper card lies FACE UP in front of its controller and is routed
    // through the same primitive purely to hide it from the opponent. Painting
    // a Ragavan/Laelia exile as a card back to its own controller would widen
    // that one-sided divergence into a two-sided one, so the marker is gated on
    // the producer (`isHiddenFromKnower`) rather than on `knownTo` alone.
    //
    // `faceDown` is the same marker the battlefield leg carries; the exile
    // instance never sets it in raw state (CR 406.3 hides a CARD, it does not
    // make a 2/2 permanent), so it is added here, on the wire. It is what lets
    // the client branch on a projected field instead of inferring face-down-ness
    // from the ABSENCE of a sentinel id.
    if (card.knownTo.includes(viewerId)) {
        const slimmedKnown = slimCard(card);
        return decorate(
            isHiddenFromKnower(card.faceDownBy)
                ? { ...slimmedKnown, faceDown: true }
                : slimmedKnown
        );
    }
    // Everyone else sees a face-down card with the identity hidden — but still
    // pinned to its permanent (the association is public; the identity is not).
    // issue #2092 — characteristics live on the INSTANCE, not the definition
    // (`convex/gre/state.ts`), so masking only `card.id` is half the job: a
    // face-down exile card deliberately keeps its real `types`/`subtypes`/
    // `power`/`toughness`/`staticAbilities` in state (the knower must see the
    // real card), unlike a face-down PERMANENT whose 2/2 colourless body is
    // already overwritten in state by `turnFaceDown` (CR 708.2). CR 406.3 — a
    // face-down card in exile is "a card" with no characteristics to show.
    const slimmed = slimCard({
        ...card,
        card: { id: FACE_DOWN_CARD_ID },
        types: [],
        subtypes: [],
        staticAbilities: [],
    });
    delete (slimmed as { faceDownOf?: string }).faceDownOf;
    delete (slimmed as { power?: number }).power;
    delete (slimmed as { toughness?: number }).toughness;
    // issue #2904 — the same explicit marker the entitled leg gets, so ONE
    // client predicate covers both viewers. `faceDownBy` (which mechanic hid
    // it) rides through `slimCard` for both: it names the MECHANIC, never the
    // card, so it leaks nothing an opponent watching the exile did not see.
    slimmed.faceDown = true;
    return opts?.exiledByPermanentId !== undefined
        ? { ...slimmed, exiledByPermanentId: opts.exiledByPermanentId }
        : slimmed;
}

/** CR 702.34 flashback / 702.138 escape / 305.1-analog — projects a graveyard card, attaching
 *  `legalActions` when the card is the viewer's own and currently has a
 *  Flashback cost (printed or granted), an Escape cost, OR is a LAND while the
 *  controller holds an unconditional play-lands-from-graveyard permission
 *  (Icetill Explorer, issue #1190 — `canPlayLandsFromGraveyard`). This is what
 *  carries the affordance to the client: the board never sees the GRE, so a
 *  graveyard card must arrive already tagged `legalActions` for the UI to
 *  offer (and gate) the Flashback/Escape cast or the graveyard land Play —
 *  mirroring the `castableFromExileBy` exile-cast affordance. Every other
 *  graveyard card (and every opponent's graveyard) gets a plain slim card (no
 *  affordance). */
function projectGraveyardCard(
    state: GameState,
    player: PlayerState,
    card: CardInstanceState,
    isOwnGraveyard: boolean,
    legalActionsFor: () => CardAction[],
    graveyardLandPlayable: boolean
): SlimGraveyardCard {
    const slim = slimCard(card);
    // CR 702.34a — tag any flashback-castable card, including a purely non-mana
    // flashback (Lava Dart) whose mana portion is absent. CR 702.138 escape — likewise
    // tag any escape-castable card (Uro/Phlage/Nethergoyf, or a card granted
    // escape by Underworld Breach) so the client can offer + gate the escape
    // cast (the board never sees the GRE).
    if (isOwnGraveyard && hasFlashback(card)) {
        // CR 702.34a / 118.5 / 107.3 — cap the announceable X to the payable
        // `flashbackExileFromGraveyard` cost (Flash of Insight: "Exile X blue
        // cards from your graveyard"), so the client stepper can't offer an X
        // the exile cost can't cover. Only attached when the card carries that
        // cost; a plain flashback leaves X uncapped.
        const fbExile = tryGetDefinition(
            (card.card as { id?: string }).id ?? ""
        )?.additionalCosts?.flashbackExileFromGraveyard;
        return {
            ...slim,
            legalActions: legalActionsFor(),
            castKind: "flashback",
            ...(fbExile
                ? {
                      flashbackExileMaxX: flashbackExileEligibleCount(
                          player,
                          fbExile.color,
                          card.id
                      ),
                  }
                : {}),
        };
    }
    if (isOwnGraveyard && hasEscape(state, card)) {
        return { ...slim, legalActions: legalActionsFor(), castKind: "escape" };
    }
    // CR 305.1-analog / 601 (issue #1149) — a NON-LAND card sitting in the
    // viewer's own graveyard while the BROAD, turn-scoped graveyard-cast
    // permission (Yawgmoth's Will) covers it — re-derived live every
    // projection, so the affordance disappears the instant the permission
    // expires (CLEANUP), no stale flag. Only reached when the card has
    // NEITHER Flashback nor Escape (those branches above return first).
    if (
        isOwnGraveyard &&
        canCastFromGraveyardByPermission(state, player, card)
    ) {
        return {
            ...slim,
            legalActions: legalActionsFor(),
            castKind: "graveyard-permission",
        };
    }
    // CR 601.3 / 117.6-analog (issue #1344) — a NON-LAND card sitting in the
    // viewer's own graveyard tagged with a per-card cast grant (Malcolm,
    // Alluring Scoundrel — `castableFromGraveyardBy`), reached only when the
    // card has neither Flashback, Escape, nor the broad permission above
    // (those branches return first). Distinct `castKind` from
    // `"graveyard-permission"` so the client could label it differently
    // later, though both currently render the same "Cast" affordance.
    if (isOwnGraveyard && card.castableFromGraveyardBy === player.id) {
        return {
            ...slim,
            legalActions: legalActionsFor(),
            castKind: "graveyard-grant",
        };
    }
    // CR 702.139 (issue #1392, Lurrus of the Dream-Den) — a PERMANENT card
    // sitting in the viewer's own graveyard while a STATIC,
    // battlefield-derived, once-per-turn permission covers it
    // (`canCastPermanentFromGraveyardByPermission`) — re-derived live every
    // projection, so the affordance disappears the instant the granting
    // source leaves play, OR the permission is used up this turn, OR it
    // isn't `player`'s turn (CR 702.139a "Once during each of YOUR TURNS" —
    // enforced INSIDE `canCastPermanentFromGraveyardByPermission` itself via
    // `state.activePlayerId === player.id`, so this call site and the
    // `gre/rules.ts` legality branch always agree, including for a FLASH
    // permanent that would otherwise read as castable on the opponent's
    // turn). Only reached when the card has none of Flashback, Escape, the
    // broad permission, or a per-card grant (those branches above return
    // first). Distinct `castKind` from `"graveyard-permission"` (both
    // currently render the same "Cast" affordance, `graveyard-flashback-
    // button.tsx`) so the client could label it differently later.
    if (
        isOwnGraveyard &&
        canCastPermanentFromGraveyardByPermission(state, player, card)
    ) {
        return {
            ...slim,
            legalActions: legalActionsFor(),
            castKind: "graveyard-permanent-permission",
        };
    }
    // CR 702.81a (issue #2358) — a NONLAND card in the viewer's own graveyard
    // that currently has RETRACE, printed or granted (Wrenn and Six's emblem):
    // castable for its printed mana cost PLUS discarding a land card. Re-derived
    // live every projection, so a "during your turn" grant's affordance appears
    // and disappears with the turn, no stale flag.
    //
    // LAST among the cast branches, matching `locateCastSource`'s own ordering
    // (convex/game.ts): retrace costs the caster strictly more than any
    // mechanism above (they replace or waive the mana cost; retrace ADDS a
    // discarded land), so a card qualifying for two of them must surface the
    // cheaper one. Projection order and cast-source order agreeing is what keeps
    // the label the client shows equal to the mechanism the server actually
    // charges for.
    if (isOwnGraveyard && hasRetrace(state, card)) {
        return {
            ...slim,
            legalActions: legalActionsFor(),
            castKind: "retrace",
        };
    }
    // CR 305.1-analog — a LAND sitting in the viewer's own graveyard while
    // `canPlayLandsFromGraveyard` holds (re-derived live from the battlefield
    // every projection, so the affordance disappears the instant the granting
    // source leaves play, no stale flag). No `castKind`: this is a "play", not
    // a keyword cast.
    if (
        isOwnGraveyard &&
        graveyardLandPlayable &&
        card.types.includes("Land")
    ) {
        return { ...slim, legalActions: legalActionsFor() };
    }
    return slim;
}

/** CR 305.1-analog (Courser of Kruphix) — the affordance bundle to attach to
 *  the viewer's OWN library top when they currently hold a play/cast-from-top
 *  permission covering it, or `undefined` when the affordance doesn't apply at
 *  all. `legalActions` is returned even when it is EMPTY: that still tells the
 *  client "this card is playable in principle, just not right now" (no land
 *  drop left, not your main phase), which is what renders the Play/Cast button
 *  DISABLED rather than absent — the same present-but-empty convention the
 *  graveyard land affordance uses.
 *
 *  Gated on `player.id === viewerId`: an opponent's library top can legitimately
 *  be known (the CR 401.5 reveal is symmetric — both seats see it) but is never
 *  playable by the viewer, so it must never carry an affordance. */
function libraryTopAffordance(
    state: GameState,
    player: PlayerState,
    viewerId: string,
    allActions: boolean
): Omit<SlimLibraryCard, keyof SlimCardInstance> | undefined {
    if (player.id !== viewerId) return undefined;
    const top = player.library[0];
    if (!top) return undefined;
    // CR 305.1-analog / 601.3 (issue #2398) — the two halves of a
    // top-of-library permission are orthogonal fields on different cards
    // (Courser of Kruphix plays lands; Vizier of the Menagerie casts spells;
    // Bolas's Citadel does both), so the affordance exists when EITHER covers
    // the top card. `getLegalActions` then decides which action it actually
    // is — the two branches are mutually exclusive by card type (CR 305.9: a
    // land is played, never cast).
    const castable = isCastableLibraryTopSpell(state, player, top.id);
    if (!isPlayableLibraryTopLand(state, player, top.id) && !castable) {
        return undefined;
    }
    // CR 118.9-analog / 107.3b / 601.2b (issue #2398) — tell the client when
    // THIS cast's mana cost is replaced wholesale by the permission, so the
    // affordance suppresses the X dialog and the alternative-cost picker
    // instead of offering choices `announceCast` then rejects. Read live off
    // the grant, like every other field here — the flag disappears with the
    // granting permanent. Never set on the LAND half (a land is played, not
    // cast, CR 305.9), hence the `castable` gate.
    const replaced =
        castable &&
        canCastSpellsFromTopOfLibrary(state, player)?.manaCostReplacement !==
            undefined;
    return {
        legalActions: getLegalActions(state, player, top, allActions),
        ...(replaced ? { castManaCostReplaced: true as const } : {}),
    };
}

/** Hydrate a granted ability instance with its template data for the wire. */
function hydrateGrantedAbility(
    instance: GrantedAbilityInstance
): PublicGrantedAbility {
    const cardDef = tryGetDefinition(instance.sourceCardId);
    const ability = cardDef?.activatedAbilities?.find(
        (a) => a.id === instance.abilityId
    );
    return {
        id: instance.id,
        sourceCardId: instance.sourceCardId,
        abilityId: instance.abilityId,
        oracleText: ability?.oracleText ?? "",
        cost: ability?.cost ?? {},
        useStack: ability?.useStack ?? false,
        manaProduced: ability?.manaProduced,
        duration: instance.duration,
    };
}

function hydrateGrantedAbilities(
    grants: GrantedAbilityInstance[] | undefined
): PublicGrantedAbility[] | undefined {
    if (!grants || grants.length === 0) return undefined;
    return grants.map(hydrateGrantedAbility);
}

/** Resolved peek/reveal exposure derived from the head pending choice, scoped
 *  to a single chooser. Shared by the public and full projections so both views
 *  open the same picker piles (CR 401.4 / 701.23). All fields are `undefined`
 *  when the chooser is not the head choice's player. */
interface ChoiceExposure {
    /** `search-library`: expose THIS player's whole library face-up (the
     *  searched zone's owner — `zoneOwnerId ?? playerId`, which is the chooser
     *  for a normal search and the controlled opponent for a Word of Command
     *  controlled cast, ADR 0037 / #580). */
    searchZoneOwner: string | undefined;
    /** `reorder-library` / `draw-look-keep`: library owner whose top N is shown. */
    peekZoneOwner: string | undefined;
    /** Number of top cards to expose for the peek (0 when no peek). */
    peekCount: number;
    /** `reorder-library` only: the EXACT cards to reorder (the choice's
     *  `candidateIds`), when the card pins them. The reorder picker must show
     *  precisely these — a card may reorder cards that aren't the current top N
     *  (Drafna's Restoration moves cards graveyard → library bottom, then lets
     *  the player put them on top), so a blind top-N slice would surface the
     *  wrong cards. `undefined` for count-only reorders (Natural Selection) and
     *  every other peek kind, which fall back to the top-N slice. */
    peekCandidateIds: string[] | undefined;
    /** `reveal-hand`: hand owner whose hand is shown to the chooser. */
    revealZoneOwner: string | undefined;
    /** ANY cross-player hand-zone pick (issue #1698, widened by #1719 review
     *  finding 1): hand owner whose hand is exposed, face-up, on the
     *  ORDINARY `hand` wire field (not `revealedHand` — that's
     *  `reveal-hand`'s dedicated look-only view field) to the chooser alone,
     *  for as long as this pick is head-of-queue. The discriminator is
     *  `zoneOwnerId !== playerId` (chooser ≠ hand owner) — NOT `kind`.
     *  "Look at target player's hand and choose a card from it"
     *  (`choose-hand-card`, Seer's Vision / Thoughtseize) and "look at that
     *  player's hand and choose N cards from it, that player discards them"
     *  (`discard-hand`, Mind Warp / Leshrac's Sigil — the CASTER, not the
     *  hand's owner, is the chooser) are the exact same "chooser must see a
     *  foreign zone" shape as search-library / reorder-library / pick-pile /
     *  reveal-hand above; gating on `kind` alone missed `discard-hand`
     *  entirely (both cards hung with no reachable UI). `reveal-hand` is
     *  deliberately EXCLUDED here — it already has its own dedicated
     *  exposure (`revealZoneOwner` → `revealedHand`) and its own modal
     *  (`RevealHandView`); folding it into this field too would double-expose
     *  it. This exposure is scoped independently of any OTHER visibility
     *  mechanism (an explicit `reveal` Op, or a continuous `revealsHand`
     *  static), which are incidental and, for a self-sacrificing source,
     *  provably gone by the time this exact choice is raised (`convex/game.ts`
     *  pays activation costs before the ability ever reaches the stack).
     *  NOTE (known narrowing, out of scope): this exposes the ZONE OWNER'S
     *  WHOLE hand even when the pick's `candidateIds`/`filter` narrows
     *  eligibility to a subset (e.g. Thoughtseize's nonland-only filter) —
     *  correct for every card shipped today (each looks at/reveals the
     *  entire hand before narrowing which cards are pickable), but would be
     *  wrong for a hypothetical future card whose Oracle text only reveals a
     *  FILTERED subset of the hand (e.g. "reveal the creature cards in their
     *  hand"). No behavior change here — flagged for whoever builds that
     *  card. */
    handPickZoneOwner: string | undefined;
}

/** The looked-at cards a peek/reorder picker renders: the pinned `candidateIds`
 *  (in their chosen order, wherever they sit in the library) when the choice
 *  supplies them, else the top `peekCount` cards. Shared by both projections so
 *  the picker pile is identical in the public and full views. */
function projectLibraryPeek(
    library: CardInstanceState[],
    peekCount: number,
    candidateIds: string[] | undefined
): SlimCardInstance[] {
    if (candidateIds) {
        const byId = new Map(library.map((c) => [c.id, c]));
        return candidateIds
            .map((id) => byId.get(id))
            .filter((c): c is CardInstanceState => c !== undefined)
            .map(slimCard);
    }
    return library.slice(0, peekCount).map(slimCard);
}

/** Computes the peek/reveal exposure for the chooser `chooserId` from the head
 *  pending choice. Returns all-`undefined` when `chooserId` is not the chooser
 *  of an exposing choice. Centralizes the head-inspection so the public and
 *  full projections stay in lockstep (#239, #262). */
function computeChoiceExposure(
    state: GameState,
    chooserId: string | undefined
): ChoiceExposure {
    const head = state.pendingChoices?.[0];
    const isChooser = head !== undefined && head.playerId === chooserId;

    // CR 401.4 / 701.23: search-library exposes the SEARCHED library to the
    // chooser. The searched zone's owner is `zoneOwnerId ?? playerId` — for a
    // normal Demonic Tutor that's the chooser's own library, but for a
    // controlled cast (Word of Command, ADR 0037 / #580) the chooser is the
    // Acting Player while the library belongs to the controlled opponent, so the
    // exposed pile must follow `zoneOwnerId`, NOT `playerId`.
    const searchZoneOwner =
        isChooser && head.kind === "search-library" && head.zone === "library"
            ? (head.zoneOwnerId ?? head.playerId)
            : undefined;

    // CR 401.4: reorder-library exposes the top N cards of the zone owner's
    // library to the chooser so the UI can render them for reordering;
    // draw-look-keep (Aladdin's Lamp) exposes the looked-at top X so the
    // chooser can pick the one to keep; look-top (Stock Up / Preordain, #942)
    // exposes exactly the looked-at top N (`candidateIds`) — never the whole
    // library, never nothing.
    const exposeLibraryPeek =
        isChooser &&
        (head.kind === "reorder-library" ||
            head.kind === "draw-look-keep" ||
            head.kind === "look-top" ||
            // order-top (scry/surveil/ponder drag picker, #942) — exposes the
            // looked-at top N (`candidateIds`) so the picker can render them.
            head.kind === "order-top" ||
            // look-distribute (Impulse / Stock Up / Thassa's Oracle) — same
            // top-N peek, rendered by the unified KEEP/BOTTOM drag picker
            // (KEEP lands in hand or on the library top per
            // `PendingChoice.keepTo`, issue #2070 — the peek itself doesn't
            // care which).
            head.kind === "look-distribute" ||
            // divide-piles (Fact or Fiction, ADR 0053) — the DIVIDER separates
            // the revealed cards of the library owner's library into two piles.
            // Only the LIBRARY-zone divide is hidden (battlefield / graveyard
            // divides are already public); expose exactly the divided
            // `candidateIds` face-up so the pile picker can render them.
            head.kind === "divide-piles") &&
        head.zone === "library";
    // reorder-library shows `count` cards; draw-look-keep, look-top and
    // order-top show all the looked-at cards named in `candidateIds`.
    const peekCount = !exposeLibraryPeek
        ? 0
        : head.kind === "reorder-library"
          ? getPendingChoiceMax(head.count)
          : (head.candidateIds?.length ?? 0);
    const peekZoneOwner = exposeLibraryPeek
        ? (head.zoneOwnerId ?? head.playerId)
        : undefined;
    // A pinned `reorder-library` / `divide-piles` exposes exactly its
    // `candidateIds` (they may sit anywhere in the library), not a blind top-N
    // slice.
    const peekCandidateIds =
        exposeLibraryPeek &&
        (head.kind === "reorder-library" || head.kind === "divide-piles")
            ? head.candidateIds
            : undefined;

    // pick-pile (Fact or Fiction step 2, ADR 0053) — the CHOOSER sees both
    // completed piles face-up before picking. The pile cards still sit in the
    // library owner's library (the zone moves run only after the pick), so
    // expose exactly pileA∪pileB from whichever library holds them. When the
    // piles are public (battlefield / graveyard divides) no library holds them
    // and no exposure is needed.
    let pickPeekOwner: string | undefined;
    let pickPeekIds: string[] | undefined;
    if (isChooser && head.kind === "pick-pile") {
        const ids = [...(head.pileA ?? []), ...(head.pileB ?? [])];
        if (ids.length > 0) {
            const owner = state.players.find((p) =>
                p.library.some((c) => c.id === ids[0])
            );
            if (owner) {
                pickPeekOwner = owner.id;
                pickPeekIds = ids;
            }
        }
    }

    // CR 401.4: reveal-hand exposes the zone owner's hand to the chooser.
    const exposeRevealHand =
        isChooser && head.kind === "reveal-hand" && head.zone === "hand";
    const revealZoneOwner = exposeRevealHand
        ? (head.zoneOwnerId ?? head.playerId)
        : undefined;

    // CR 401.4 (issue #1698, generalized by #1719 review finding 1) — ANY
    // hand-zone pick whose chooser differs from the hand's owner exposes that
    // owner's hand on the ordinary `hand` field (see `handPickZoneOwner` doc
    // above). Deliberately its OWN check, not folded into
    // `exposeRevealHand`/`revealZoneOwner`: those feed the `revealedHand`
    // field, which `RevealHandView` gates strictly on `kind === "reveal-hand"`
    // — reusing them here would leak an unused-but-populated field into the
    // wire for every cross-player hand pick without helping `HandCardPick`,
    // which reads `hand`, not `revealedHand`. The discriminator is
    // "chooser ≠ zone owner", NOT `kind` — the original #1698 fix keyed on
    // `kind === "choose-hand-card"` and missed the identical `discard-hand`
    // shape (Mind Warp, Leshrac's Sigil: the caster picks which of the
    // TARGET's cards get discarded). `reveal-hand` is excluded on purpose —
    // it already owns its own dedicated exposure/modal (see doc above).
    const exposeHandPick =
        isChooser &&
        head.kind !== "reveal-hand" &&
        head.zone === "hand" &&
        head.zoneOwnerId !== undefined &&
        head.zoneOwnerId !== head.playerId;
    const handPickZoneOwner = exposeHandPick ? head.zoneOwnerId : undefined;

    return {
        searchZoneOwner,
        peekZoneOwner: pickPeekOwner ?? peekZoneOwner,
        peekCount: pickPeekIds ? pickPeekIds.length : peekCount,
        peekCandidateIds: pickPeekIds ?? peekCandidateIds,
        revealZoneOwner,
        handPickZoneOwner,
    };
}

/** Player ids whose hand is projected face-up to their opponents by a
 *  continuous "plays with hand revealed" static (CR 702-adjacent — Zur's
 *  Weirding, Enduring Renewal; issue #735). Scans every battlefield permanent
 *  for a `revealsHand` flag: `"controller"` reveals that permanent's
 *  controller's hand (permanents live in their controller's battlefield array,
 *  so the array owner IS the controller); `"all-players"` reveals every
 *  player's hand; `"opponents"` (issue #1104, Seer's Vision) reveals every
 *  OTHER player's hand — the flipped-polarity mirror of `"controller"`, not a
 *  new mechanism (2-player games have exactly one "other" player, so this
 *  reveals precisely the controller's one opponent). Read live from the
 *  battlefield so the reveal ends the instant the source leaves play — no
 *  stale flag, no `GameState` field. */
function computeHandRevealedPlayers(state: GameState): Set<string> {
    const revealed = new Set<string>();
    for (const player of state.players) {
        for (const card of player.battlefield) {
            const cardId = (card.card as { id?: string }).id;
            const scope = cardId
                ? tryGetDefinition(cardId)?.revealsHand
                : undefined;
            if (!scope) continue;
            if (scope === "all-players") {
                // Maximal reveal — every hand is exposed; nothing more to add.
                for (const p of state.players) revealed.add(p.id);
                return revealed;
            }
            if (scope === "opponents") {
                for (const p of state.players) {
                    if (p.id !== player.id) revealed.add(p.id);
                }
                continue;
            }
            revealed.add(player.id);
        }
    }
    return revealed;
}

/**
 * Projects GameState into the public view: viewer's own hand has slim cards + legalActions,
 * opponent's hand is an array of nulls of equal length, libraries are reduced to { count }.
 */
export function projectPublicState(
    state: GameState,
    seq: number,
    viewerId: string,
    allActions: boolean = false
): PublicGameState {
    // CR 401.4 / 701.23: while the viewer is the chooser of an active
    // search-library / reorder-library / draw-look-keep / look-top / reveal-hand
    // choice, expose the looked-at zone face-up so the UI can render its picker
    // pile.
    const {
        searchZoneOwner,
        peekZoneOwner,
        peekCount,
        peekCandidateIds,
        revealZoneOwner,
        handPickZoneOwner,
    } = computeChoiceExposure(state, viewerId);
    // Exiled-card → holding-permanent links (mechanism-agnostic), so the client
    // pins each exiled card to its permanent (Arena treatment).
    const exileAssoc = buildExileAssociation(state);

    // CR 702-adjacent (issue #735) — players forced to play with their hands
    // revealed; their hand identities cross the wire to opponents (below).
    const handRevealedPlayers = computeHandRevealedPlayers(state);

    // CR 401.5 (issue #1095) — players playing with the top card of their
    // library revealed (Goblin Spy). Derived live off the battlefield, once per
    // projection; the top card then crosses the wire to BOTH seats (below).
    const libraryTopRevealedPlayers = computeLibraryTopRevealedPlayers(state);
    // CR 401.5 (issue #2398) — players who may LOOK at their own library top
    // (Bolas's Citadel). Same live battlefield derivation as the reveal above,
    // but ASYMMETRIC: the card crosses the wire only to its own controller, so
    // this set is intersected with the viewer below rather than merged into
    // the reveal set. A player in both is simply revealed.
    const libraryTopLookedAtPlayers = computeLibraryTopLookedAtPlayers(state);

    const players = state.players.map((player): PublicPlayer => {
        const librarySearch =
            player.id === searchZoneOwner
                ? player.library.map(slimCard)
                : undefined;
        const libraryPeek =
            peekZoneOwner !== undefined && player.id === peekZoneOwner
                ? projectLibraryPeek(
                      player.library,
                      peekCount,
                      peekCandidateIds
                  )
                : undefined;
        const revealedHand =
            revealZoneOwner !== undefined && player.id === revealZoneOwner
                ? player.hand.map(slimCard)
                : undefined;
        // CR 305.1-analog — read live off THIS player's battlefield once per
        // projection (Icetill Explorer, issue #1190); passed into every
        // graveyard card below instead of re-scanning per card.
        const graveyardLandPlayable = canPlayLandsFromGraveyard(state, player);
        const common = {
            ...player,
            // CR 702.34 / 702.138 / 305.1-analog — the viewer's own graveyard
            // cards carry `legalActions` when they have a Flashback cost, an
            // Escape cost, or (for a LAND) an active play-from-graveyard
            // permission, so the client can offer + gate the affordance (the
            // board never sees the GRE).
            graveyard: player.graveyard.map((c) =>
                projectGraveyardCard(
                    state,
                    player,
                    c,
                    player.id === viewerId,
                    () => getLegalActions(state, player, c, allActions),
                    graveyardLandPlayable
                )
            ),
            // ADR 0026 — face-down exile (impulse-draw) is gated per-viewer by
            // `knownTo`; ordinary face-up exile is public to all.
            exile: player.exile.map((c) =>
                projectExileCard(c, viewerId, {
                    // CR 601.3 (issue #1156) — `casterId` disambiguates a
                    // CROSS-PLAYER grant (Robber of the Rich, Dauthi
                    // Voidwalker): the card lives in `player`'s exile, but
                    // `c.castableFromExileBy` may name a DIFFERENT player as
                    // the caster, whose priority/mana/targets must gate the
                    // "cast" affordance, not this zone owner's. Defaults to
                    // `player.id` for every same-player grant (Ice Cauldron),
                    // so this is a no-op there.
                    legalActionsFor: () =>
                        getLegalActions(
                            state,
                            player,
                            c,
                            allActions,
                            c.castableFromExileBy
                        ),
                    exiledByPermanentId: exileAssoc.get(c.id),
                })
            ),
            battlefield: player.battlefield.map((c) =>
                projectBattlefieldCard(c, viewerId, state)
            ),
            // ADR 0026 — sparse library: only cards the viewer knows
            // (`viewer ∈ knownTo`) cross the wire, each at its top-relative
            // index. Raw `knownTo` is never emitted. The owner does NOT
            // auto-know their own order — gating is purely by `knownTo`,
            // PLUS the CR 401.5 continuous top reveal (issue #1095), which is
            // symmetric: every viewer sees the top card, nobody sees more.
            library: projectLibrary(
                player.library,
                viewerId,
                libraryTopRevealedPlayers.has(player.id) ||
                    (player.id === viewerId &&
                        libraryTopLookedAtPlayers.has(player.id)),
                libraryTopAffordance(state, player, viewerId, allActions)
            ),
            librarySearch,
            libraryPeek,
            revealedHand,
            grantedAbilities: hydrateGrantedAbilities(player.grantedAbilities),
            // CR 702.139c (ADR 0064) — the companion slot is revealed to BOTH
            // players; only the viewer's own slot carries the `canSummon`
            // affordance (mirrors every other viewer-scoped legality field).
            companion: player.companion
                ? {
                      instance: slimCard(player.companion.instance),
                      used: player.companion.used,
                      ...(player.id === viewerId
                          ? {
                                canSummon: canSummonCompanion(state, player),
                            }
                          : {}),
                  }
                : undefined,
        };
        if (player.id === viewerId) {
            return {
                ...common,
                hand: player.hand.map((card): SlimHandCard => {
                    const legalActions = getLegalActions(
                        state,
                        player,
                        card,
                        allActions
                    );
                    // CR 107.4f — surface the Phyrexian mana-vs-life split
                    // choices to the caster's own client, but only for a
                    // castable card with a REAL branch (≥ 2 affordable
                    // `lifePips` values). A degenerate zero-branch cost carries
                    // no field (the engine auto-resolves it, no prompt).
                    const rawCost = legalActions.includes("cast")
                        ? getInstanceManaCost(card)
                        : undefined;
                    // `phyrexianLifePipOptions` self-guards (returns [] for a
                    // non-Phyrexian cost), so this is O(1) for ordinary cards.
                    // `state` is forwarded (issue #1757) so a board-dependent
                    // mana source (Mox Opal's Metalcraft) is visible to this
                    // picker exactly like it is to `solvePhyrexianSplit`'s
                    // auto-resolve — otherwise the picker could under-offer a
                    // life-pip branch the real board actually affords.
                    const phyrexianOptions = rawCost
                        ? phyrexianLifePipOptions(
                              player,
                              card,
                              rawCost,
                              undefined,
                              state
                          )
                        : [];
                    return {
                        ...slimCard(card),
                        legalActions,
                        // ADR 0026 — eye icon: any non-owner knows this card.
                        ...(hasNonOwnerKnower(card)
                            ? { seenByOpponent: true }
                            : {}),
                        ...(phyrexianOptions.length >= 2
                            ? { phyrexianOptions }
                            : {}),
                        // CR 601.3c — surface the MANDATORY conditional-flash
                        // surcharge to the caster's own client, and only when
                        // the cast is actually castable and actually owes it.
                        // Gated on `legalActions.includes("cast")` for the
                        // same reason `phyrexianOptions` is: a cost hint on an
                        // uncastable card is noise.
                        //
                        // HAND ONLY — the graveyard/exile `legalActions`
                        // callbacks below carry no equivalent, so a
                        // flashback/escape/madness cast of a rider card would
                        // be surcharged with no client warning. No shipped card
                        // combines the two; deliberately left.
                        // tracked-by: #2505
                        ...(legalActions.includes("cast") &&
                        flashSurchargeRequired(state, player.id, card)
                            ? { flashSurchargeRequired: true as const }
                            : {}),
                    };
                }),
            };
        }
        // ADR 0026 — opponent hand: known slots carry identity, the rest stay
        // null. Length is preserved so the back-count is unchanged. Issue #735 —
        // a player forced to play with their hand revealed exposes EVERY hand
        // card's identity to opponents (a maximal, continuous form of the
        // per-card `knownTo` reveal).
        const handRevealed = handRevealedPlayers.has(player.id);
        // issue #1698 — a hand pick of ANY kind (`choose-hand-card`,
        // `discard-hand`, …) anchored on THIS player's hand exposes it
        // face-up to the chooser ALONE for exactly as long as the choice is
        // head-of-queue (`handPickZoneOwner`, gated above on `viewerId`
        // already being that choice's chooser). The gate keys on
        // chooser≠owner, NOT on `kind` — keying on kind is what let Mind Warp
        // and Leshrac's Sigil (`discard-hand`) hang. `reveal-hand` is the one
        // deliberate exclusion: it has its own `revealedHand` path — independent of
        // `handRevealed`/`knownTo`, which stay whatever incidental mechanism
        // (a continuous static, an explicit prior `reveal`) put them there.
        const handPickExposed = player.id === handPickZoneOwner;
        return {
            ...common,
            hand: player.hand.map((card): SlimHandCard | null =>
                handRevealed ||
                handPickExposed ||
                card.knownTo?.includes(viewerId)
                    ? { ...slimCard(card), legalActions: [] }
                    : null
            ),
        };
    });

    return {
        ...state,
        seq,
        players,
        stack: state.stack.map((item) => projectStackItem(item, viewerId)),
        // CR 603.3b / ADR 0058 — the off-stack simultaneous-trigger batch is
        // public (the triggers are going on the stack); slim it like `stack` so
        // the ordering picker can render card art without the raw `...state`
        // spread leaking fat card defs.
        //
        // CR 708.2 (issue #2705) — projected through `projectStackItem`, not
        // `slimCard`, because a trigger CAN be a face-down object: a granted
        // trigger (`grantedTriggeredAbilities`, layer 6) survives
        // `turnFaceDown`'s layer replay, and `buildTriggerItem` spreads
        // `...self`, so a batch item inherits `faceDown` / `faceDownOf` from
        // the face-down permanent that is its source. A bare `slimCard` sent
        // that permanent's real card id straight to the opponent.
        pendingTriggerBatch: state.pendingTriggerBatch?.map((i) =>
            projectStackItem(i, viewerId)
        ),
        // CR 702.26 — phased-out permanents are public (set aside face-up), so
        // project them for the wire (the raw `...state` spread would leak the
        // fat card defs). Per-card face-down hiding still applies via
        // `projectBattlefieldCard`.
        phasedOut: state.phasedOut?.map((b) => ({
            ...b,
            cards: b.cards.map((c) => projectBattlefieldCard(c, viewerId)),
        })),
        // Reveal dialog — each viewer sees only the notifications addressed to
        // them (a private look never leaks to the other seat). Dropped entirely
        // when none apply so the field stays absent on the wire.
        pendingReveals: state.pendingReveals?.filter((r) =>
            r.audience.includes(viewerId)
        ),
    };
}

/** Projects GameState into the full debug view: every zone is visible, card defs are slimmed. */
export function projectFullState(
    state: GameState,
    seq: number,
    allActions: boolean = false
): FullGameState {
    // CR 401.4 / 701.23: an active search-library / reorder-library /
    // draw-look-keep / look-top / reveal-hand choice exposes the looked-at zone
    // face-up so the picker pile can open. The full debug view shows every zone,
    // but the
    // pickers still key off these fields — mirror the public projection so the
    // dialogs work in "show all cards" mode too, not only via getPublicState
    // (#239, #262). There is no single viewer here, so the chooser is the head
    // choice's own player.
    const head = state.pendingChoices?.[0];
    const {
        searchZoneOwner,
        peekZoneOwner,
        peekCount,
        peekCandidateIds,
        revealZoneOwner,
    } = computeChoiceExposure(state, head?.playerId);
    const exileAssoc = buildExileAssociation(state);

    const players = state.players.map(
        (player): FullPlayer => ({
            ...player,
            hand: player.hand.map(
                (card): SlimHandCard => ({
                    ...slimCard(card),
                    legalActions: getLegalActions(
                        state,
                        player,
                        card,
                        allActions
                    ),
                })
            ),
            library: player.library.map(slimCard),
            librarySearch:
                player.id === searchZoneOwner
                    ? player.library.map(slimCard)
                    : undefined,
            libraryPeek:
                peekZoneOwner !== undefined && player.id === peekZoneOwner
                    ? projectLibraryPeek(
                          player.library,
                          peekCount,
                          peekCandidateIds
                      )
                    : undefined,
            revealedHand:
                revealZoneOwner !== undefined && player.id === revealZoneOwner
                    ? player.hand.map(slimCard)
                    : undefined,
            // Full debug view has no single viewer — attach Flashback / Escape
            // / graveyard-land-Play legalActions for the graveyard owner so
            // every affordance gates the same way as the public projection
            // (CR 702.34 / 702.138 / 305.1-analog, issue #1190).
            graveyard: player.graveyard.map((c) =>
                projectGraveyardCard(
                    state,
                    player,
                    c,
                    true,
                    () => getLegalActions(state, player, c, allActions),
                    canPlayLandsFromGraveyard(state, player)
                )
            ),
            // Full debug view has no single viewer — attach exile legalActions
            // for the card's own controller so the Cast affordance gates the
            // same way it does in the public projection (CR 601.3), and stamp
            // the mechanism-agnostic permanent association for pinning.
            exile: player.exile.map((c) => {
                // CR 601.3 (issue #1156) — same `casterId` disambiguation as
                // the public projection above (cross-player grants).
                const out: SlimExileCard = c.castableFromExileBy
                    ? {
                          ...slimCard(c),
                          legalActions: getLegalActions(
                              state,
                              player,
                              c,
                              allActions,
                              c.castableFromExileBy
                          ),
                      }
                    : slimCard(c);
                const host = exileAssoc.get(c.id);
                return host !== undefined
                    ? { ...out, exiledByPermanentId: host }
                    : out;
            }),
            battlefield: player.battlefield.map(slimCard),
            grantedAbilities: hydrateGrantedAbilities(player.grantedAbilities),
            // CR 702.139c (ADR 0064) — full debug view has no single viewer,
            // so every player's own companion carries its `canSummon`
            // affordance (mirrors the graveyard/exile treatment above).
            companion: player.companion
                ? {
                      instance: slimCard(player.companion.instance),
                      used: player.companion.used,
                      canSummon: canSummonCompanion(state, player),
                  }
                : undefined,
        })
    );

    return {
        ...state,
        seq,
        players,
        stack: state.stack.map(slimCard),
        // CR 603.3b / ADR 0058 — slim the off-stack simultaneous-trigger batch so
        // the raw `...state` spread never leaks fat card defs (mirror of the
        // public projection).
        pendingTriggerBatch: state.pendingTriggerBatch?.map(slimCard),
        // CR 702.26 phasing — full debug view reveals everything; slim the phased-out
        // bundle cards to match the battlefield treatment (line above).
        phasedOut: state.phasedOut?.map((b) => ({
            ...b,
            cards: b.cards.map(slimCard),
        })),
    };
}
