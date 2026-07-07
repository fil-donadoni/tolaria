import type {
    CardInstanceState,
    GameState,
    GrantedAbilityInstance,
    PlayerState,
    StackItem,
} from "./gre/state";
import { getPendingChoiceMax } from "./gre/state";
import type { CardAction } from "./gre/types";
import type { ActivatedAbility, ManaCost } from "./cards/types";
import { getLegalActions } from "./gre/rules";
import { FACE_DOWN_CARD_ID, tryGetDefinition } from "./cards";

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
> & {
    hand: (SlimHandCard | null)[];
    library: PublicLibrary;
    librarySearch?: SlimCardInstance[];
    libraryPeek?: SlimCardInstance[];
    revealedHand?: SlimCardInstance[];
    graveyard: SlimCardInstance[];
    exile: SlimExileCard[];
    battlefield: SlimCardInstance[];
    grantedAbilities?: PublicGrantedAbility[];
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
    graveyard: SlimCardInstance[];
    exile: SlimExileCard[];
    battlefield: SlimCardInstance[];
    grantedAbilities?: PublicGrantedAbility[];
};

export type PublicGameState = Omit<GameState, "players" | "stack"> & {
    seq: number;
    players: PublicPlayer[];
    stack: SlimStackItem[];
};

export type FullGameState = Omit<GameState, "players" | "stack"> & {
    seq: number;
    players: FullPlayer[];
    stack: SlimStackItem[];
};

function slimCard<
    T extends { card: { id?: string } | Record<string, unknown> },
>(instance: T): Omit<T, "card"> & { card: { id: string } } {
    const id = (instance.card as { id?: string }).id ?? "";
    const slimmed = { ...instance, card: { id } };
    // ADR 0026 — the raw per-viewer knowledge set must NEVER cross the wire;
    // identity is gated upstream and the eye flag is derived separately.
    delete (slimmed as { knownTo?: string[] }).knownTo;
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
 *  `knownTo` never crosses the wire (each card is slimmed). */
function projectLibrary(
    library: CardInstanceState[],
    viewerId: string
): PublicLibrary {
    const known: KnownLibraryCard[] = [];
    for (let index = 0; index < library.length; index++) {
        const card = library[index];
        if (card.knownTo?.includes(viewerId)) {
            known.push({ index, card: slimCard(card) });
        }
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
    /** `reveal-hand`: hand owner whose hand is shown to the chooser. */
    revealZoneOwner: string | undefined;
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
            head.kind === "look-top") &&
        head.zone === "library";
    // reorder-library shows `count` cards; draw-look-keep and look-top show all
    // the looked-at cards named in `candidateIds`.
    const peekCount = !exposeLibraryPeek
        ? 0
        : head.kind === "reorder-library"
          ? getPendingChoiceMax(head.count)
          : (head.candidateIds?.length ?? 0);
    const peekZoneOwner = exposeLibraryPeek
        ? (head.zoneOwnerId ?? head.playerId)
        : undefined;

    // CR 401.4: reveal-hand exposes the zone owner's hand to the chooser.
    const exposeRevealHand =
        isChooser && head.kind === "reveal-hand" && head.zone === "hand";
    const revealZoneOwner = exposeRevealHand
        ? (head.zoneOwnerId ?? head.playerId)
        : undefined;

    return { searchZoneOwner, peekZoneOwner, peekCount, revealZoneOwner };
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
    const { searchZoneOwner, peekZoneOwner, peekCount, revealZoneOwner } =
        computeChoiceExposure(state, viewerId);
    // Exiled-card → holding-permanent links (mechanism-agnostic), so the client
    // pins each exiled card to its permanent (Arena treatment).
    const exileAssoc = buildExileAssociation(state);

    const players = state.players.map((player): PublicPlayer => {
        const librarySearch =
            player.id === searchZoneOwner
                ? player.library.map(slimCard)
                : undefined;
        const libraryPeek =
            peekZoneOwner !== undefined && player.id === peekZoneOwner
                ? player.library.slice(0, peekCount).map(slimCard)
                : undefined;
        const revealedHand =
            revealZoneOwner !== undefined && player.id === revealZoneOwner
                ? player.hand.map(slimCard)
                : undefined;
        const common = {
            ...player,
            graveyard: player.graveyard.map(slimCard),
            // ADR 0026 — face-down exile (impulse-draw) is gated per-viewer by
            // `knownTo`; ordinary face-up exile is public to all.
            exile: player.exile.map((c) =>
                projectExileCard(c, viewerId, {
                    legalActionsFor: () =>
                        getLegalActions(state, player, c, allActions),
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
        };
        if (player.id === viewerId) {
            return {
                ...common,
                hand: player.hand.map(
                    (card): SlimHandCard => ({
                        ...slimCard(card),
                        legalActions: getLegalActions(
                            state,
                            player,
                            card,
                            allActions
                        ),
                        // ADR 0026 — eye icon: any non-owner knows this card.
                        ...(hasNonOwnerKnower(card)
                            ? { seenByOpponent: true }
                            : {}),
                    })
                ),
            };
        }
        // ADR 0026 — opponent hand: known slots carry identity, the rest stay
        // null. Length is preserved so the back-count is unchanged.
        return {
            ...common,
            hand: player.hand.map((card): SlimHandCard | null =>
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
    const { searchZoneOwner, peekZoneOwner, peekCount, revealZoneOwner } =
        computeChoiceExposure(state, head?.playerId);
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
                    ? player.library.slice(0, peekCount).map(slimCard)
                    : undefined,
            revealedHand:
                revealZoneOwner !== undefined && player.id === revealZoneOwner
                    ? player.hand.map(slimCard)
                    : undefined,
            graveyard: player.graveyard.map(slimCard),
            // Full debug view has no single viewer — attach exile legalActions
            // for the card's own controller so the Cast affordance gates the
            // same way it does in the public projection (CR 601.3e), and stamp
            // the mechanism-agnostic permanent association for pinning.
            exile: player.exile.map((c) => {
                const out: SlimExileCard = c.castableFromExileBy
                    ? {
                          ...slimCard(c),
                          legalActions: getLegalActions(
                              state,
                              player,
                              c,
                              allActions
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
        })
    );

    return {
        ...state,
        seq,
        players,
        stack: state.stack.map(slimCard),
    };
}
