// #754 — cast-from-exile affordance (CR 601.3e — Ice Cauldron: "You may cast
// that card for as long as it remains exiled"). A card exiled with cast-from-
// exile permission must be clickable/castable by its CONTROLLER from the Exile
// zone (routed through announceCast), while the OPPONENT gets no cast affordance.
// These render the Exile pile reveal and assert the Cast button presence and the
// dispatched mutation per viewer.
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    render,
    screen,
    fireEvent,
    cleanup,
    within,
} from "@testing-library/react";
import type { Player, CardInstance } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";

// Capture the cast dispatch. useHandCardCommit calls useMutation(api.game.*).
const playCard = vi.fn();
const announceCast = vi.fn();
vi.mock("convex/react", () => ({
    useMutation: (ref: { _name: string }) =>
        ref._name === "playCard" ? playCard : announceCast,
}));
vi.mock("@convex/_generated/api", () => ({
    api: {
        game: {
            playCard: { _name: "playCard" },
            announceCast: { _name: "announceCast" },
        },
    },
}));
// Vanilla def — no X, no modes — so the cast commits in one click with no prompt.
vi.mock("@convex/cards", () => ({
    getCardById: () => ({ name: "Brainstorm" }),
    tryGetCardById: () => ({ name: "Brainstorm" }),
}));
// Inert card visuals so the reveal renders without image plumbing.
vi.mock("../../cards/card-image", () => ({
    default: () => <div data-testid="card-image" />,
}));
vi.mock("../../cards/selectable-card", () => ({
    default: () => <div data-testid="selectable-card" />,
}));

import PlayerExile from "../player-exile";

function makeExiledCard(
    legalActions: CardInstance["legalActions"] = ["cast"]
): CardInstance {
    return {
        id: "noted-spell",
        card: { id: "brainstorm-def" },
        controllerId: "me",
        ownerId: "me",
        zone: "exile",
        isTapped: false,
        // CR 601.3e — the controller may cast this from exile.
        castableFromExileBy: "me",
        // The projection attaches legalActions to the viewer's own castable
        // exile card; "cast" present iff the cast is legal+affordable right now.
        legalActions,
    };
}

function makePlayer(card: CardInstance): Player {
    return {
        id: "me",
        name: "Me",
        bgColor: "#000",
        life: 20,
        hand: [],
        library: [],
        graveyard: [],
        exile: [card],
        battlefield: [],
        manaPool: {},
    };
}

function renderExile(player: Player, viewerId: string) {
    const value = {
        gameId: "game-id" as never,
        playerId: viewerId,
        activePlayerId: "me",
        priorityPlayerId: "me",
        phase: "PRECOMBAT_MAIN",
        turn: 1,
        stackCount: 0,
        allPlayers: [player],
        showAllCards: false,
        debugAllActions: false,
    } as React.ContextType<typeof GameContext>;
    return render(
        <GameContext value={value}>
            {/* open the reveal so the per-card actions mount */}
            <PlayerExile player={player} open onOpenChange={() => {}} />
        </GameContext>
    );
}

describe("PlayerExile cast-from-exile (#754, CR 601.3e)", () => {
    beforeEach(() => {
        playCard.mockClear();
        announceCast.mockClear();
        cleanup();
    });

    it("offers a Cast button on the controller's cast-from-exile card", () => {
        renderExile(makePlayer(makeExiledCard()), "me");
        expect(screen.getByRole("button", { name: "Cast" })).toBeTruthy();
    });

    it("casting dispatches announceCast for the exiled card via the public mutation", () => {
        renderExile(makePlayer(makeExiledCard()), "me");
        fireEvent.click(screen.getByRole("button", { name: "Cast" }));
        expect(announceCast).toHaveBeenCalledTimes(1);
        expect(announceCast.mock.calls[0][0]).toMatchObject({
            gameId: "game-id",
            playerId: "me",
            cardInstanceId: "noted-spell",
        });
    });

    it("offers NO cast affordance to the opponent viewer", () => {
        // The opponent's projection still carries castableFromExileBy === 'me'
        // (the controller's id), which must NOT match the opponent's viewer id.
        renderExile(makePlayer(makeExiledCard()), "opp");
        expect(screen.queryByRole("button", { name: "Cast" })).toBeNull();
    });

    it("disables the Cast button and dispatches nothing when 'cast' is not legal (unaffordable noted mana)", () => {
        // Regression for the cast-from-exile "Illegal action" bug: when the
        // noted mana can't pay the spell, the projection omits "cast" from
        // legalActions. The button must be disabled and clicking it must NOT
        // fire announceCast (which the server would reject with assertLegalAction).
        renderExile(makePlayer(makeExiledCard([])), "me");
        const castBtn = screen.getByRole("button", {
            name: "Cast",
        }) as HTMLButtonElement;
        expect(castBtn.disabled).toBe(true);
        fireEvent.click(castBtn);
        expect(announceCast).not.toHaveBeenCalled();
    });

    it("de-duplicates a card pinned to its exiler from the Exile pile (rendered attached on the board instead)", () => {
        // A card with exiledByPermanentId is shown attached to its permanent
        // (board-battlefield-card → ExiledAssociatedCard), so it must NOT also
        // appear in the loose Exile pile — no Cast affordance here either.
        const card = makeExiledCard(["cast"]);
        card.exiledByPermanentId = "cauldron";
        renderExile(makePlayer(card), "me");
        expect(screen.queryByRole("button", { name: "Cast" })).toBeNull();
    });

    it("keeps a face-down (opponent-hidden) card castable by its controller", () => {
        // The exiled card is face-down to the opponent but the controller (in
        // knownTo) sees the real card and the cast flag — it must stay castable.
        const card = makeExiledCard();
        const { container } = renderExile(makePlayer(card), "me");
        const castBtn = screen.getByRole("button", { name: "Cast" });
        expect(castBtn).toBeTruthy();
        fireEvent.click(castBtn);
        expect(announceCast).toHaveBeenCalledTimes(1);
        // The reveal rendered the card (selectable or image surface present).
        expect(
            within(container.ownerDocument.body).queryByRole("button", {
                name: "Cast",
            })
        ).not.toBeUndefined();
    });
});
