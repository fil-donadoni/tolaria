// The Monarch designation UI (CR 725, issue #1199 / #1305). The monarch moved
// off the nameplate crown badge to an emblem-style marker-card tile beside the
// piles. These tests drive it THROUGH the real reducer (useGameContext) per the
// frontend wiring rule: `monarchId` is provided via GameContext exactly as
// board.tsx threads it, so a dropped field would surface here.
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import type { Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import { MONARCH_DESIGNATION } from "@convex/cards/designations";
import PlayerMonarchTile from "../player-monarch-tile";

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

function renderTile(player: Player, monarchId?: string) {
    const value = {
        gameId: "game-id" as never,
        playerId: "me",
        activePlayerId: "me",
        priorityPlayerId: "me",
        phase: "PRECOMBAT_MAIN",
        turn: 1,
        engineTurn: 1,
        stackCount: 0,
        allPlayers: [player],
        monarchId,
        showAllCards: false,
        debugAllActions: false,
        onSwitchGame: () => {},
    } as React.ContextType<typeof GameContext>;
    return render(
        <GameContext value={value}>
            <PlayerMonarchTile player={player} />
        </GameContext>
    );
}

beforeEach(() => cleanup());

describe("PlayerMonarchTile (state-designation UI, CR 725, issue #1305)", () => {
    it("renders the Monarch marker art for the player who holds the designation", () => {
        const me = makePlayer("me");
        renderTile(me, "me");

        const tile = screen.getByTestId("monarch-tile-me");
        const img = within(tile).getByRole("img");
        // Src built from the canonical marker print id (shared image helper).
        expect(img.getAttribute("src")).toContain(
            MONARCH_DESIGNATION.imagePrintId
        );
        expect(img.getAttribute("alt")).toBe(MONARCH_DESIGNATION.name);
    });

    it("renders nothing for a player who is not the monarch", () => {
        const other = makePlayer("me");
        renderTile(other, "opp");
        expect(screen.queryByTestId("monarch-tile-me")).toBeNull();
    });

    it("renders nothing when there is no monarch", () => {
        const me = makePlayer("me");
        renderTile(me, undefined);
        expect(screen.queryByTestId("monarch-tile-me")).toBeNull();
    });
});
