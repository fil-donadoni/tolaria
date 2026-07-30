// #1689 (CR 305.9 / 116.2a) — a land sitting in exile under a CAST-ONLY
// grant (Ice Cauldron, Robber of the Rich, Ragavan) must expose NO action:
// `castableFromExileBy` alone never authorizes playing a land (a land is
// never cast). Only a grant whose Oracle text explicitly says "play"
// (`castableFromExileIncludesLand`, Headliner Scarlett / Expressive
// Iteration / Dauthi Voidwalker) makes the land a legal play source.
//
// SURFACE test per `.claude/rules/gre-development.md` § Frontend wiring
// analysis: both real GameStates are pushed through `projectPublicState` —
// the exact wire shape `<ExileCastButton>` reads — so a dropped
// `castableFromExileIncludesLand` field would show up here. A hand-built
// `CardInstance` would mask that class of bug and does not count.
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
} from "@convex/cards/__tests__/setup";

const MOUNTAIN = "eace2c85-976c-425e-9800-5a6ccbd91b56"; // Mountain (real Land def)

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

/** Builds a real GameState with ONE exiled Mountain carrying the given grant
 *  shape, projects it for the controller ("p1"), and returns the slim exile
 *  card exactly as the board would receive it. */
function projectedExiledLand(includesLand: boolean | undefined) {
    const exiled = makeInstance(MOUNTAIN, {
        id: "exiled-mountain",
        controllerId: "p1",
        ownerId: "p1",
        zone: "exile",
        knownTo: ["p1"],
        castableFromExileBy: "p1",
        ...(includesLand !== undefined
            ? { castableFromExileIncludesLand: includesLand }
            : {}),
    });
    const state = makeState({
        players: [makePlayer("p1", { exile: [exiled] }), makePlayer("p2")],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        turn: 1,
    });
    const projected = projectPublicState(state, 1, "p1");
    return projected.players[0].exile.find((c) => c.id === "exiled-mountain")!;
}

function renderButton(card: ReturnType<typeof projectedExiledLand>) {
    const value = {
        gameId: "game-id" as never,
        playerId: "p1",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        phase: "PRECOMBAT_MAIN",
        turn: 1,
        engineTurn: 1,
        stackCount: 0,
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

describe("ExileCastButton land gate (issue #1689, CR 305.9)", () => {
    beforeEach(() => {
        playCard.mockClear();
        announceCast.mockClear();
        cleanup();
    });

    it("renders NOTHING for a land under a cast-only grant (Ice Cauldron / Robber / Ragavan shape)", () => {
        const card = projectedExiledLand(undefined);
        expect(card.castableFromExileIncludesLand).toBeUndefined();
        const { container } = renderButton(card);
        expect(screen.queryByRole("button")).toBeNull();
        expect(container.textContent).toBe("");
    });

    it("still renders the Play affordance for a land-inclusive grant (Headliner Scarlett / Elkin Bottle shape)", () => {
        const card = projectedExiledLand(true);
        expect(card.castableFromExileIncludesLand).toBe(true);
        renderButton(card);
        expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
    });
});
