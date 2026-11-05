// `Board` forwards split second's activation lock through GameContext (CR 702.61a,
// issue #4007). `split-second-hint.test.ts` covers the menus reading the lock; this
// is the one line between them and the wire, so it mounts the real `Board` with its
// data layer and chrome mocked out and reads what the context hands a child.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { Player } from "~/types/game";
import { useGameContext } from "~/hooks/useGameContext";

const h = vi.hoisted(() => ({
    state: undefined as unknown,
    lock: undefined as string[] | undefined,
}));
vi.mock("convex/react", async () => {
    const { mockUseQueries } =
        await import("~/lib/testing/convex-react-query-mock");
    const resolve = () => h.state;
    return {
        useQuery: resolve,
        useQueries: mockUseQueries(resolve),
        useMutation: () => async () => {},
        useAction: () => async () => {},
    };
});
vi.mock("~/lib/image-preload", () => ({ preloadCardImages: () => {} }));
vi.mock("../controller", () => ({ default: () => null }));
vi.mock("../auto-pass-controller", () => ({ default: () => null }));
vi.mock("../pause-menu-dialog", () => ({ default: () => null }));
vi.mock("../error-toast", () => ({ default: () => null }));
vi.mock("../board-background", () => ({ default: () => null }));
vi.mock("../vs-ai-driver", () => ({ default: () => null }));
vi.mock("../game-stack", () => ({ default: () => null }));
vi.mock("../priority-indicator", () => ({ default: () => null }));
vi.mock("../board-arrows", () => ({ default: () => null }));
vi.mock("../board-piles", () => ({ default: () => null }));
vi.mock("../board-card", () => ({ default: () => null }));
vi.mock("../board-battlefield", () => ({ default: () => null }));
vi.mock("../board-hand-card", () => ({ default: () => null }));
// The seat is a context consumer the board always mounts: the probe.
vi.mock("../board-player", () => ({
    default: function ProbeSeat() {
        h.lock = useGameContext()?.cannotActivateAbilitiesThisTurn;
        return null;
    },
}));

import Board from "../board";

function seat(id: string): Player {
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
    } as unknown as Player;
}

function lockFor(staticAbilities: string[]): string[] | undefined {
    h.state = {
        players: [seat("opp"), seat("me")],
        activePlayerId: "me",
        priorityPlayerId: "me",
        phase: "PRECOMBAT_MAIN",
        turn: 1,
        stack: [{ id: "spell", card: { id: "s" }, staticAbilities }],
    };
    render(
        <Board
            gameId={"game-id" as never}
            playerId="me"
            solo={false}
            vsAi={false}
            showAllCards={false}
            debugAllActions={false}
            onSwitchGame={() => {}}
        />
    );
    return h.lock;
}

beforeEach(() => {
    cleanup();
    h.lock = undefined;
});

describe("Board forwards split second's activation lock (CR 702.61a)", () => {
    it("locks every player while the spell is on the stack", () => {
        expect(lockFor(["split second"])).toEqual(["opp", "me"]);
    });

    it("locks nobody over a spell without the keyword", () => {
        expect(lockFor([])).toBeUndefined();
    });
});
