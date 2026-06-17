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
import { tryGetCardById } from "./cards";

/** CardInstanceState with the static card def stripped to { id } only. */
export type SlimCardInstance = Omit<CardInstanceState, "card"> & {
    card: { id: string };
};

/** Hand card in projected state: slim + legalActions attached. */
export type SlimHandCard = SlimCardInstance & { legalActions: CardAction[] };

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
    library: { count: number };
    librarySearch?: SlimCardInstance[];
    libraryPeek?: SlimCardInstance[];
    revealedHand?: SlimCardInstance[];
    graveyard: SlimCardInstance[];
    exile: SlimCardInstance[];
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
    graveyard: SlimCardInstance[];
    exile: SlimCardInstance[];
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
    return { ...instance, card: { id } };
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

/** Hydrate a granted ability instance with its template data for the wire. */
function hydrateGrantedAbility(
    instance: GrantedAbilityInstance
): PublicGrantedAbility {
    const cardDef = tryGetCardById(instance.sourceCardId);
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
    // search-library choice, expose the searched player's library face-up so
    // the UI can render it for selection. The choice always targets the
    // chooser's own library in the current scope (see selectResolutionChoice),
    // so we only expose `viewerId`'s library.
    const head = state.pendingChoices?.[0];
    const exposeLibraryForViewer =
        head?.kind === "search-library" &&
        head.zone === "library" &&
        head.playerId === viewerId;

    // CR 401.4: reorder-library exposes the top N cards of the zone owner's
    // library to the chooser so the UI can render them for reordering;
    // draw-look-keep (Aladdin's Lamp) exposes the looked-at top X so the
    // chooser can pick the one to keep.
    const exposeLibraryPeek =
        (head?.kind === "reorder-library" || head?.kind === "draw-look-keep") &&
        head.zone === "library" &&
        head.playerId === viewerId;
    const peekCount = !exposeLibraryPeek
        ? 0
        : head!.kind === "draw-look-keep"
          ? (head!.candidateIds?.length ?? 0)
          : getPendingChoiceMax(head!.count);
    const peekZoneOwner = exposeLibraryPeek
        ? (head!.zoneOwnerId ?? head!.playerId)
        : undefined;

    // CR 401.4: reveal-hand exposes the zone owner's hand to the chooser.
    const exposeRevealHand =
        head?.kind === "reveal-hand" &&
        head.zone === "hand" &&
        head.playerId === viewerId;
    const revealZoneOwner = exposeRevealHand
        ? (head!.zoneOwnerId ?? head!.playerId)
        : undefined;

    const players = state.players.map((player): PublicPlayer => {
        const librarySearch =
            exposeLibraryForViewer && player.id === viewerId
                ? player.library.map(slimCard)
                : undefined;
        const libraryPeek =
            exposeLibraryPeek && player.id === peekZoneOwner
                ? player.library.slice(0, peekCount).map(slimCard)
                : undefined;
        const revealedHand =
            exposeRevealHand && player.id === revealZoneOwner
                ? player.hand.map(slimCard)
                : undefined;
        const common = {
            ...player,
            graveyard: player.graveyard.map(slimCard),
            exile: player.exile.map(slimCard),
            battlefield: player.battlefield.map((c) =>
                projectBattlefieldCard(c, viewerId)
            ),
            library: { count: player.library.length },
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
                    })
                ),
            };
        }
        return {
            ...common,
            hand: player.hand.map(() => null),
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
    // CR 401.4 / 701.19: an active `search-library` choice exposes the chooser's
    // library face-up via `librarySearch` so the picker pile can open. The full
    // debug view shows every zone, but the library picker still keys off this
    // field — mirror the public projection so search dialogs work in "show all
    // cards" mode too, not only via getPublicState.
    const head = state.pendingChoices?.[0];
    const searchChooserId =
        head?.kind === "search-library" && head.zone === "library"
            ? head.playerId
            : undefined;

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
                player.id === searchChooserId
                    ? player.library.map(slimCard)
                    : undefined,
            graveyard: player.graveyard.map(slimCard),
            exile: player.exile.map(slimCard),
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
