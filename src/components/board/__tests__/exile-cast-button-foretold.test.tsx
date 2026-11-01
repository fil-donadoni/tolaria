// CR 702.143a (issue #2096) — a FORETOLD card's exile Cast button explains
// why it is closed: the turn gate, or the foretell cost. SURFACE test: every case pushes
// a real GameState through `applyForetell` and `projectPublicState`, the
// exact wire shape `<ExileCastButton>` reads.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import {
    PendingChoiceBufferContext,
    type PendingChoiceBuffer,
} from "~/hooks/usePendingChoiceBuffer";
import { projectPublicState } from "@convex/gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup.helper";
import { getCardByName } from "@convex/cards";
import { applyForetell } from "@convex/gre/foretell";

const BEHOLD = getCardByName("Behold the Multiverse").id;
const ISLAND = getCardByName("Island").id;

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

import ExileCastButton from "../exile-cast-button";

const noopBuffer: PendingChoiceBuffer = {
    buffer: [],
    toggle: () => {},
    clear: () => {},
    submit: () => Promise.resolve(),
    isPending: false,
    lastError: null,
    reportError: () => {},
    dismissError: () => {},
};

/** Behold the Multiverse foretold on turn 3 by p1 with two Islands, projected
 *  for its owner at `turn` with `untapped` Islands untapped. */
function projectedForetold(turn: number, untapped: number) {
    const state = makeState({
        players: [
            makePlayer("p1", {
                hand: [
                    makeInstance(BEHOLD, {
                        id: "omen",
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "hand",
                    }),
                ],
                battlefield: [0, 1].map((i) =>
                    makeInstance(ISLAND, {
                        id: `land${i}`,
                        controllerId: "p1",
                        ownerId: "p1",
                    })
                ),
            }),
            makePlayer("p2"),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        turn: 3,
    });
    applyForetell(state, "p1", "omen");
    state.turn = turn;
    state.players[0].battlefield.forEach((l, i) => {
        l.isTapped = i >= untapped;
    });
    const projected = projectPublicState(state, 1, "p1");
    return projected.players[0].exile.find((c) => c.id === "omen")!;
}

function renderButton(
    card: ReturnType<typeof projectedForetold>,
    engineTurn: number
) {
    const value = {
        gameId: "game-id" as never,
        playerId: "p1",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        phase: "PRECOMBAT_MAIN",
        turn: engineTurn,
        engineTurn,
        stackCount: 0,
        stackItems: [],
        allPlayers: [] as Player[],
        showAllCards: false,
        debugAllActions: false,
        onSwitchGame: () => {},
    } as React.ContextType<typeof GameContext>;
    return render(
        <GameContext value={value}>
            <PendingChoiceBufferContext value={noopBuffer}>
                <ExileCastButton card={card as never} />
            </PendingChoiceBufferContext>
        </GameContext>
    );
}

describe("ExileCastButton on a FORETOLD card (CR 702.143a, issue #2096)", () => {
    beforeEach(() => {
        announceCast.mockClear();
        playCard.mockClear();
        cleanup();
    });

    it("reads Cast (the card is already foretold), and names the turn gate while the window is closed", () => {
        const card = projectedForetold(3, 2);
        expect(card.foretold).toBe(true);
        renderButton(card, 3);
        const button = screen.getByRole("button", { name: "Cast" });
        expect(button.hasAttribute("disabled")).toBe(true);
        expect(button.getAttribute("title")).toBe(
            "Can't cast yet — not available from exile until turn 4."
        );
    });

    it("is enabled on a later turn with the foretell cost {1}{U} open", () => {
        const card = projectedForetold(5, 2);
        expect(card.legalActions).toContain("cast");
        renderButton(card, 5);
        const button = screen.getByRole("button", { name: "Cast" });
        expect(button.hasAttribute("disabled")).toBe(false);
    });

    it("blames the foretell cost, not the noted mana, when it is not covered", () => {
        const card = projectedForetold(5, 0);
        expect(card.legalActions ?? []).not.toContain("cast");
        renderButton(card, 5);
        expect(
            screen.getByRole("button", { name: "Cast" }).getAttribute("title")
        ).toBe(
            "Can't cast now — its foretell cost isn't covered, or it's not a time you could cast it."
        );
    });
});
