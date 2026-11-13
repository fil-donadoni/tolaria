// Issue #9500 — the player nameplate publishes a hover seed: pointing at a
// player lights every arrow into them (each attacker, each spell targeting
// them), the same fan-in a planeswalker gets. It published none, so hovering
// the most common attack target lit nothing.
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { ArrowHighlightProvider } from "~/hooks/ArrowHighlightProvider";
import { useArrowHighlight } from "~/hooks/arrowHighlightContext";
import type { PlayerInteraction } from "~/hooks/usePlayerInteraction";
import type { Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import PlayerNameplate from "../player-nameplate";

afterEach(cleanup);

function SeedProbe() {
    const seed = useArrowHighlight()?.seed;
    return (
        <output data-testid="seed">
            {seed && "nodeId" in seed ? seed.nodeId : "none"}
        </output>
    );
}

const player = {
    id: "p2",
    name: "Urza",
    bgColor: "#000",
    life: 20,
    hand: [],
    library: { count: 0 },
    graveyard: [],
    exile: [],
    battlefield: [],
    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
} as unknown as Player;

const interaction: PlayerInteraction = {
    isMe: false,
    hasPriority: false,
    isTargetable: false,
    isDamageTargetPickable: false,
    isPlayerPicked: false,
    isDivideTarget: false,
    divideAssigned: 0,
    divideCanPlus: false,
    incDivide: () => {},
    decDivide: () => {},
    handleClick: () => {},
};

const ctx = {
    gameId: "game-id" as never,
    playerId: "p1",
    activePlayerId: "p1",
    priorityPlayerId: "p1",
    phase: "DECLARE_ATTACKERS",
    turn: 1,
    engineTurn: 1,
    stackCount: 0,
    stackItems: [],
    allPlayers: [player],
    showAllCards: false,
    debugAllActions: false,
} as unknown as React.ContextType<typeof GameContext>;

describe("PlayerNameplate hover seed (issue #9500)", () => {
    it("pointer enter seeds the player's node, leave clears it", () => {
        const { container, getByTestId } = render(
            <GameContext value={ctx}>
                <ArrowHighlightProvider>
                    <PlayerNameplate
                        player={player}
                        interaction={interaction}
                    />
                    <SeedProbe />
                </ArrowHighlightProvider>
            </GameContext>
        );
        const plate = container.querySelector(
            '[data-arrow-anchor-player="p2"]'
        )!;
        fireEvent.pointerEnter(plate);
        expect(getByTestId("seed").textContent).toBe("p2");
        fireEvent.pointerLeave(plate);
        expect(getByTestId("seed").textContent).toBe("none");
    });

    it("renders without the board's highlight provider (classic chrome)", () => {
        const { container } = render(
            <GameContext value={ctx}>
                <PlayerNameplate player={player} interaction={interaction} />
            </GameContext>
        );
        expect(
            container.querySelector('[data-arrow-anchor-player="p2"]')
        ).toBeTruthy();
    });
});
