// The City's Blessing designation UI (Ascend, CR 702.131 — issue #1460,
// ADR 0071). The sibling of the Monarch tile: an emblem-style marker-card tile
// beside the piles. These tests drive it THROUGH the real reducer
// (useGameContext) per the frontend wiring rule — `cityBlessingIds` is provided
// via GameContext exactly as board.tsx threads it off the projected state, so a
// dropped field would surface here rather than only in the browser.
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import type { Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import { CITY_BLESSING_DESIGNATION } from "@convex/cards/designations";
import PlayerCityBlessingTile from "../player-city-blessing-tile";

function makePlayer(id: string): Player {
    return {
        id,
        name: id,
        bgColor: "#000",
        life: 20,
        hand: [],
        library: { count: 0 },
        graveyard: [],
        exile: [],
        battlefield: [],
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    };
}

function renderTile(player: Player, cityBlessingIds?: string[]) {
    const value = {
        gameId: "game-id" as never,
        playerId: "me",
        activePlayerId: "me",
        priorityPlayerId: "me",
        phase: "PRECOMBAT_MAIN",
        turn: 1,
        engineTurn: 1,
        stackCount: 0,
        stackItems: [],
        allPlayers: [player],
        cityBlessingIds,
        showAllCards: false,
        debugAllActions: false,
        onSwitchGame: () => {},
    } as React.ContextType<typeof GameContext>;
    return render(
        <GameContext value={value}>
            <PlayerCityBlessingTile player={player} />
        </GameContext>
    );
}

beforeEach(() => cleanup());

describe("PlayerCityBlessingTile (state-designation UI, CR 702.131)", () => {
    it("renders the City's Blessing marker art for a player who holds it", () => {
        const me = makePlayer("me");
        renderTile(me, ["me"]);

        const tile = screen.getByTestId("city-blessing-tile-me");
        const img = within(tile).getByRole("img");
        // Src built from the already-registered marker print id (designations.ts).
        expect(img.getAttribute("src")).toContain(
            CITY_BLESSING_DESIGNATION.imagePrintId
        );
        expect(img.getAttribute("alt")).toBe(CITY_BLESSING_DESIGNATION.name);
    });

    it("renders nothing for a player who does not hold the designation", () => {
        const me = makePlayer("me");
        renderTile(me, ["opp"]);
        expect(screen.queryByTestId("city-blessing-tile-me")).toBeNull();
    });

    it("renders nothing when no one has the city's blessing", () => {
        const me = makePlayer("me");
        renderTile(me, undefined);
        expect(screen.queryByTestId("city-blessing-tile-me")).toBeNull();
    });

    it("renders for BOTH players — the designation is non-exclusive", () => {
        // Unlike the monarch (a single scalar), two players can hold the
        // blessing simultaneously (CR 702.131b).
        const me = makePlayer("me");
        renderTile(me, ["me", "opp"]);
        expect(screen.getByTestId("city-blessing-tile-me")).toBeTruthy();
        cleanup();
        const opp = makePlayer("opp");
        renderTile(opp, ["me", "opp"]);
        expect(screen.getByTestId("city-blessing-tile-opp")).toBeTruthy();
    });
});
