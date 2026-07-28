import type {
    CardInstanceState,
    GameState,
    GrantedAbilityInstance,
    PhasedOutBundle,
    PlayerState,
    StackItem,
} from "./gre/state";
import { getPendingChoiceMax } from "./gre/state";
import type { CardAction } from "./gre/types";
import type { ActivatedAbility, ManaCost } from "./cards/types";
import {
    canCastFromGraveyardByPermission,
    canCastPermanentFromGraveyardByPermission,
    canPlayLandsFromGraveyard,
    getLegalActions,
    phyrexianLifePipOptions,
} from "./gre/rules";
import { canSummonCompanion } from "./gre/companion";
import { flashbackExileEligibleCount, hasFlashback } from "./gre/flashback";
import { hasEscape } from "./gre/escape";
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
};

/** Exile card in projected state: slim, plus `legalActions` when the viewer may
 *  cast it from exile (CR 601.3e — Ice Cauldron's noted card). The field is
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
 *  (CR 601.3e / 117.6-analog, Malcolm, Alluring Scoundrel, issue #1344), or
 *  play it as a LAND under an unconditional play-lands-from-graveyard
 *  permission (CR 305.1-analog, Icetill Explorer #1190, or the same BROAD
 *  #1149 permission when its zones cover "land"). Present only on the
 *  viewer's own graveyard cards; drives the Flashback / Escape / Cast / Play
 *  affordance's enabled state, exactly like {@link SlimExileCard.legalActions}
 *  for an exile cast. */
export type SlimGraveyardCard = SlimCardInstance & {
    legalActions?: CardAction[];
    /** CR 702.34 / 702.138 / 305.1-analog / 117.6-analog — which
     *  graveyard-cast mechanism surfaced this card's affordance, so the UI
     *  labels the button "Flashback" / "Escape" / "Cast". Present only
     *  alongside `legalActions` for a CAST affordance — a land tagged under
     *  a play-from-graveyard permission carries `legalActions` with NO
     *  `castKind` (it's a "play", not a keyword cast). */
    castKind?:
        | "flashback"
        | "escape"
        | "graveyard-permission"
        | "graveyard-grant"
        | "graveyard-permanent-permission";
    /** CR 702.34a / 118.5 / 107.3 — the maximum {X} the caster may announce on
     *  THIS flashback cast, bounded by its `flashbackExileFromGraveyard`
     *  additional cost ("Exile X blue cards from your graveyard", Flash of
     *  Insight): the count of eligible cards in the viewer's own graveyard,
     *  excluding the flashback card itself (CR 702.34e). Present ONLY on a
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
    /** CR 116.2 / 702.139f — true iff the `summon-companion` special action
     *  is legal for the VIEWER right now (`canSummonCompanion`, gre/
     *  companion.ts). Present ONLY on the viewer's own player — mirrors
     *  every other viewer-scoped affordance field (`SlimHandCard.
     *  legalActions`, etc.); the opponent's companion is visible but never
     *  carries an affordance for someone else's special action. */
    canSummon?: boolean;
};

/** ADR 0026 / PRD #338 — one viewer-known library card, projected sparsely.
 *  `index` is the position from the top of the library (0 = top). */
export type KnownLibraryCard = { index: number; card: SlimCardInstance };

/** Projected library wire shape (ADR 0026). `count` is the full size; `known`
 *  carries only the cards the viewer legitimately knows (`viewer ∈ knownTo`),
 *  each at its top-relative `index`. Empty `known` for a fully hidden library. */
export type PublicLibrary = { count: number; known: KnownLibraryCard[] };

/** StackItem slimmed to { id } card ref. */
export type SlimStackItem = Omit<StackItem, "card"> & { card: { id: string } };

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
 *  of an active `search-library` pending choice (CR 401.4 / 701.19), the
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
    battlefield: SlimCardInstance[];
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
     *  active (CR 401.4 / 701.19) — the library exposed face-up for the picker.
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
    battlefield: SlimCardInstance[];
    grantedAbilities?: PublicGrantedAbility[];
    companion?: SlimCompanionSlot;
};

/** CR 702.26 — a phased-out bundle projected to the wire: host + attachments
 *  slimmed. Phasing is public information (the set-aside permanents stay
 *  face-up), so identity is not hidden beyond the normal face-down rule that
 *  `projectBattlefieldCard` already applies per card. */
export type SlimPhasedOutBundle = Omit<PhasedOutBundle, "cards"> & {
    cards: SlimCardInstance[];
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
 *  at the top run's boundary, so an all-known library is emitted exactly once. */
function projectLibrary(
    library: CardInstanceState[],
    viewerId: string
): PublicLibrary {
    const knows = (card: CardInstanceState) =>
        card.knownTo?.includes(viewerId) ?? false;
    const known: KnownLibraryCard[] = [];
    // Top run: [0, topEnd).
    let topEnd = 0;
    while (topEnd < library.length && knows(library[topEnd])) {
        known.push({ index: topEnd, card: slimCard(library[topEnd]) });
        topEnd++;
    }
    // Bottom run: (bottomStart, length), scanning up but never crossing topEnd
    // so an all-known library is not double-counted.
    for (let index = library.length - 1; index >= topEnd; index--) {
        if (!knows(library[index])) break;
        known.push({ index, card: slimCard(library[index]) });
    }
    return { count: library.length, known };
}

/** Projects one battlefield permanent for a given viewer. The battlefield is
 *  public EXCEPT for the identity of a face-down permanent (CR 708.2,
 *  ADR 0013): its controller's view restores the real definition id
 *  (`faceDownOf`); every other viewer keeps the face-down sentinel id and the
 *  real id is stripped so it never crosses the wire. All other characteristics
 *  (the vanilla 2/2) are already identical for both viewers, so nothing else
 *  is hidden. */
function projectBattlefieldCard(
    card: CardInstanceState,
    viewerId: string
): SlimCardInstance {
    if (!card.faceDown) return slimCard(card);
    if (viewerId === card.controllerId && card.faceDownOf) {
        // The controller knows what they cast — expose the real id.
        return slimCard({ ...card, card: { id: card.faceDownOf } });
    }
    // Opponents/spectators: hide the true identity entirely. slimCard returns
    // a fresh object, so deleting the leaked id doesn't mutate live state.
    const slimmed = slimCard(card);
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
    // CR 601.3e — the viewer's own card it may cast from exile carries
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
    // Face-down exile: a viewer who is allowed to look sees the real card.
    if (card.knownTo.includes(viewerId)) return decorate(slimCard(card));
    // Everyone else sees a face-down card with the identity hidden — but still
    // pinned to its permanent (the association is public; the identity is not).
    const slimmed = slimCard({ ...card, card: { id: FACE_DOWN_CARD_ID } });
    delete (slimmed as { faceDownOf?: string }).faceDownOf;
    return opts?.exiledByPermanentId !== undefined
        ? { ...slimmed, exiledByPermanentId: opts.exiledByPermanentId }
        : slimmed;
}

/** CR 702.34 / 702.138 / 305.1-analog — projects a graveyard card, attaching
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
    // flashback (Lava Dart) whose mana portion is absent. CR 702.138 — likewise
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
    // CR 601.3e / 117.6-analog (issue #1344) — a NON-LAND card sitting in the
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
 *  open the same picker piles (CR 401.4 / 701.19). All fields are `undefined`
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

    // CR 401.4 / 701.19: search-library exposes the SEARCHED library to the
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
            // look-distribute (Impulse / Stock Up) — same top-N peek, rendered
            // by the unified HAND/BOTTOM drag picker.
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
    // CR 401.4 / 701.19: while the viewer is the chooser of an active
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
                    // CR 601.3e (issue #1156) — `casterId` disambiguates a
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
                projectBattlefieldCard(c, viewerId)
            ),
            // ADR 0026 — sparse library: only cards the viewer knows
            // (`viewer ∈ knownTo`) cross the wire, each at its top-relative
            // index. Raw `knownTo` is never emitted. The owner does NOT
            // auto-know their own order — gating is purely by `knownTo`.
            library: projectLibrary(player.library, viewerId),
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
                    const phyrexianOptions = rawCost
                        ? phyrexianLifePipOptions(player, card, rawCost)
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
        // issue #1698 — a `choose-hand-card` pick anchored on THIS player's
        // hand exposes it face-up to the chooser ALONE for exactly as long
        // as the choice is head-of-queue (`handPickZoneOwner`, gated above on
        // `viewerId` already being that choice's chooser) — independent of
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
        stack: state.stack.map(slimCard),
        // CR 603.3b / ADR 0058 — the off-stack simultaneous-trigger batch is
        // public (the triggers are going on the stack); slim it like `stack` so
        // the ordering picker can render card art without the raw `...state`
        // spread leaking fat card defs.
        pendingTriggerBatch: state.pendingTriggerBatch?.map(slimCard),
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
    // CR 401.4 / 701.19: an active search-library / reorder-library /
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
            // same way it does in the public projection (CR 601.3e), and stamp
            // the mechanism-agnostic permanent association for pinning.
            exile: player.exile.map((c) => {
                // CR 601.3e (issue #1156) — same `casterId` disambiguation as
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
        // CR 702.26 — full debug view reveals everything; slim the phased-out
        // bundle cards to match the battlefield treatment (line above).
        phasedOut: state.phasedOut?.map((b) => ({
            ...b,
            cards: b.cards.map(slimCard),
        })),
    };
}
