// The one gate every lobby start/join action shares (issue #2726).
//
// It used to live inside `DashboardPlayBox`, where every action that could be
// gated was also rendered. The v4 lobby splits those actions across two
// surfaces — the Loadout's primary action + "Join by code", and the open-table
// rows under the Mode Tiles — and a gate computed twice is a gate that drifts:
// the failure mode is an action offered under a condition its sibling refuses,
// which the server then rejects with a message the lobby never predicted.
//
// Pure, so it is unit-testable without a DOM and readable as one list of
// reasons rather than five booleans spread over two components.
import type { LobbyDeck } from "./deckTypes";
import type { PlayMode } from "./session";

export interface LobbyGateInputs {
    deck: LobbyDeck | null;
    mode: PlayMode;
    /** Another lobby action is already in flight. */
    busy: boolean;
    /** #155: a user holds at most one active game. While one exists, creating
     *  or joining is blocked client-side (the server rejects it anyway). */
    hasActiveGame: boolean;
}

export interface LobbyGate {
    isCockatrice: boolean;
    /** Derived deck legality for the deck's own Format (ADR 0036, issue #512).
     *  True with no deck selected — "no deck" is a separate reason, and
     *  conflating them makes the hint text lie. */
    deckLegal: boolean;
    /** Manual Decks and the real engine are mutually exclusive by construction
     *  (ADR 0080): `createGame`/`joinGame`/`createSoloGame` reject a manual
     *  deck and `createManualSoloGame` rejects a real one. The lobby filters
     *  the shelves so a mismatch should not normally arise, but a stale
     *  selection (mode toggled, persisted from before) is handled fail-closed
     *  here rather than dispatched. */
    deckMatchesMode: boolean;
    /** The manual Format deliberately validates nothing (ADR 0080), so an
     *  empty deck is "legal" — but a Manual Game with no cards is not a game. */
    manualDeckHasCards: boolean;
    /** Every start/join action in the current mode is offered iff this holds. */
    canAct: boolean;
}

export function lobbyActionGate({
    deck,
    mode,
    busy,
    hasActiveGame,
}: LobbyGateInputs): LobbyGate {
    const isCockatrice = mode === "cockatrice";
    const deckLegal = !deck || deck.isLegal;
    const deckMatchesMode = !deck
        ? true
        : isCockatrice
          ? deck.format === "manual"
          : deck.format !== "manual";
    const manualDeckHasCards = (deck?.cards.length ?? 0) > 0;
    const emptyManualDeck = isCockatrice && !manualDeckHasCards;
    return {
        isCockatrice,
        deckLegal,
        deckMatchesMode,
        manualDeckHasCards,
        canAct:
            !!deck &&
            deckLegal &&
            deckMatchesMode &&
            !emptyManualDeck &&
            !busy &&
            !hasActiveGame,
    };
}
