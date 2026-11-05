// The "can't cast spells" nameplate badge (CR 702.50b). The lock is a
// player-scoped game-state entry no permanent carries, so this badge is the only
// place a player can see it. Driven through `projectPublicState`, and its
// `playerRestrictions` reaches the badge via GameContext as board.tsx threads it.
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { GameContext } from "~/hooks/useGameContext";
import { projectPublicState } from "@convex/gameProjections";
import { makePlayer, makeState } from "@convex/cards/__tests__/setup.helper";
import PlayerCastLock from "../player-cast-lock";

function renderBadges(
    locked: string[],
    kind: "cantCastSpells" | "cantGainLife"
) {
    const state = makeState({
        players: [makePlayer("me"), makePlayer("opp")],
    });
    state.playerRestrictions = locked.map((playerId) => ({ playerId, kind }));
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
            <PlayerCastLock playerId="me" />
            <PlayerCastLock playerId="opp" compact />
        </GameContext>
    );
}

beforeEach(() => cleanup());

describe("PlayerCastLock (CR 702.50b can't-cast-spells badge)", () => {
    it("badges only the locked player", () => {
        renderBadges(["opp"], "cantCastSpells");
        const badge = screen.getByTestId("cast-lock-opp");
        expect(badge.getAttribute("aria-label")).toBe("Can't cast spells");
        expect(screen.queryByTestId("cast-lock-me")).toBeNull();
    });

    it("is not raised by another kind of lock", () => {
        renderBadges(["me", "opp"], "cantGainLife");
        expect(screen.queryByTestId("cast-lock-me")).toBeNull();
        expect(screen.queryByTestId("cast-lock-opp")).toBeNull();
    });
});
