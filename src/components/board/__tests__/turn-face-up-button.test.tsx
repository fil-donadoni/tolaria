// Morph turn-face-up affordance (CR 116.2b / 702.37e, issue #2705).
//
// The button is driven by ONE server-derived wire field, `canTurnFaceUp`,
// which `projectBattlefieldCard` (convex/gameProjections.ts) sets only on the
// controller's own projection. This file walks the affordance through the REAL
// reducer — `projectPublicState` — rather than hand-building a view: a
// hand-built `CardInstance` with `canTurnFaceUp: true` would keep passing if
// the projection dropped the field, which is the single most common way a
// correct engine ships a dead UI (.claude/rules/gre-development.md § Frontend
// wiring analysis).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { CardInstance, Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import { projectPublicState } from "@convex/gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup";
import { turnFaceDown } from "@convex/gre/faceDown";
import { getCardByName } from "@convex/cards";

const turnPermanentFaceUp = vi.fn();
vi.mock("convex/react", () => ({
    useMutation: () => turnPermanentFaceUp,
}));
vi.mock("@convex/_generated/api", () => ({
    api: { game: { turnPermanentFaceUp: { _name: "turnPermanentFaceUp" } } },
}));

import TurnFaceUpButton from "../turn-face-up-button";

const ANGEL = getCardByName("Exalted Angel").id;
const PLAINS = getCardByName("Plains").id;

/** Projects a board where p1 controls a face-down Exalted Angel with `lands`
 *  untapped Plains, and returns the projected permanent as the client sees it. */
function projectFaceDownAngel(lands: number, viewerId: string): CardInstance {
    const permanent = makeInstance(ANGEL, {
        id: "morphed",
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
    });
    turnFaceDown(permanent, "morph");
    const state = makeState({
        players: [
            makePlayer("p1", {
                battlefield: [
                    permanent,
                    ...Array.from({ length: lands }, (_, i) =>
                        makeInstance(PLAINS, {
                            id: `plains${i}`,
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "battlefield",
                        })
                    ),
                ],
            }),
            makePlayer("p2"),
        ],
    });
    const projected = projectPublicState(state, 1, viewerId);
    return projected.players[0].battlefield.find(
        (c) => c.id === "morphed"
    ) as unknown as CardInstance;
}

function renderButton(cardInstanceId: string) {
    const value = {
        gameId: "game-id" as never,
        playerId: "p1",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        phase: "PRECOMBAT_MAIN",
        turn: 1,
        engineTurn: 1,
        stackCount: 0,
        stackItems: [],
        allPlayers: [] as Player[],
        showAllCards: false,
        debugAllActions: false,
        onSwitchGame: () => {},
    } as React.ContextType<typeof GameContext>;
    return render(
        <GameContext value={value}>
            <TurnFaceUpButton cardInstanceId={cardInstanceId} />
        </GameContext>
    );
}

describe("turn-face-up affordance through the real projection (CR 702.37e)", () => {
    beforeEach(() => {
        turnPermanentFaceUp.mockClear();
        cleanup();
    });

    it("the controller's projected permanent carries canTurnFaceUp when it is payable", () => {
        expect(projectFaceDownAngel(4, "p1").canTurnFaceUp).toBe(true);
    });

    it("the opponent's projected permanent never carries it", () => {
        expect(projectFaceDownAngel(4, "p2").canTurnFaceUp).toBeUndefined();
    });

    it("it is absent when the morph cost cannot be paid", () => {
        // {2}{W}{W} needs four mana; three Plains cannot cover it.
        expect(projectFaceDownAngel(3, "p1").canTurnFaceUp).toBeUndefined();
    });
});

describe("TurnFaceUpButton (CR 116.2b)", () => {
    beforeEach(() => {
        turnPermanentFaceUp.mockClear();
        cleanup();
    });

    it("dispatches turnPermanentFaceUp for the named permanent", () => {
        renderButton("morphed");
        fireEvent.click(screen.getByRole("button", { name: "Turn face up" }));
        expect(turnPermanentFaceUp).toHaveBeenCalledWith({
            gameId: "game-id",
            playerId: "p1",
            cardInstanceId: "morphed",
        });
    });

    it("does not print the hidden card's morph cost in the DOM (CR 702.37e)", () => {
        const { container } = renderButton("morphed");
        expect(container.textContent).toBe("Turn face up");
    });

    it("disables while the mutation is in flight (project convention)", async () => {
        let release: (() => void) | undefined;
        turnPermanentFaceUp.mockImplementation(
            () =>
                new Promise<void>((resolve) => {
                    release = resolve;
                })
        );
        renderButton("morphed");
        const button = screen.getByRole("button", { name: "Turn face up" });
        fireEvent.click(button);
        expect((button as HTMLButtonElement).disabled).toBe(true);
        release?.();
    });
});
