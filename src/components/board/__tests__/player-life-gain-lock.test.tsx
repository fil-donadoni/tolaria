// The "can't gain life" nameplate badge (CR 119.7 / 611.2a, issue #3239). The
// lock is a player-scoped game-state entry no permanent carries, so this badge
// is the only place a player can see it. Driven THROUGH the real reducers per
// the frontend wiring rule: the engine state is projected by
// `projectPublicState`, and its `playerRestrictions` reaches the badge via
// GameContext exactly as board.tsx threads it — a field the projection dropped
// would surface here rather than only in the browser.
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { GameContext } from "~/hooks/useGameContext";
import { projectPublicState } from "@convex/gameProjections";
import { makePlayer, makeState } from "@convex/cards/__tests__/setup.helper";
import PlayerLifeGainLock from "../player-life-gain-lock";

function renderBadges(locked: string[]) {
    const state = makeState({
        players: [makePlayer("me"), makePlayer("opp")],
    });
    state.playerRestrictions = locked.map((playerId) => ({
        playerId,
        kind: "cantGainLife" as const,
    }));
    const projected = projectPublicState(state, 1, "me");
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
        allPlayers: [],
        playerRestrictions: projected.playerRestrictions,
        showAllCards: false,
        debugAllActions: false,
        onSwitchGame: () => {},
    } as React.ContextType<typeof GameContext>;
    return render(
        <GameContext value={value}>
            <PlayerLifeGainLock playerId="me" />
            <PlayerLifeGainLock playerId="opp" compact />
        </GameContext>
    );
}

beforeEach(() => cleanup());

describe("PlayerLifeGainLock (CR 119.7 can't-gain-life badge)", () => {
    it("badges only the locked player", () => {
        renderBadges(["opp"]);
        const badge = screen.getByTestId("life-gain-lock-opp");
        expect(badge.getAttribute("aria-label")).toBe("Can't gain life");
        expect(screen.queryByTestId("life-gain-lock-me")).toBeNull();
    });

    it("renders nothing when no one is locked", () => {
        renderBadges([]);
        expect(screen.queryByTestId("life-gain-lock-me")).toBeNull();
        expect(screen.queryByTestId("life-gain-lock-opp")).toBeNull();
    });
});
