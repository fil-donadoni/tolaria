// Frontend wiring for the battlefield-wide declared-attacker / declared-blocker
// COUNT CAP (CR 508.1a / 509.1a — Dueling Grounds, Caverns of Despair; issue
// #1127).
//
// The GRE and the mutations refuse the over-cap declaration, but a rule the
// server enforces and the board still offers is a bug: the player keeps
// clicking creatures that silently do nothing. `canInteract` must gray them
// out, and it must do so off the SAME battlefield scan the server gates on
// (`combatDeclarationCap`, `convex/cards/attackRestrictions.ts`) so the two can
// never drift.
//
// The assertion is driven THROUGH the real reducers: a real GRE `GameState`
// projected by `projectPublicState` (the actual wire boundary, which strips
// `card.card` to `{ id }` — the cap scanner has to re-hydrate the definition
// from the registry), fed into the real `useBattlefieldVisualState`. A
// hand-built `CardInstance` would not exercise either
// (`.claude/rules/gre-development.md` § Frontend wiring analysis).
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import type { CardInstance, Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import { useBattlefieldVisualState } from "../useBattlefieldVisualState";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../../convex/cards/__tests__/setup";
import { projectPublicState } from "../../../convex/gameProjections";
import { grizzlyBears } from "../../../convex/cards/sets/lea/green";
import { duelingGrounds } from "../../../convex/cards/sets/inv/multicolor";
import { cavernsOfDespair } from "../../../convex/cards/sets/leg/red";
import { twoHeadedGiantOfForiys } from "../../../convex/cards/sets/lea/red";

vi.mock("~/hooks/usePendingChoiceBuffer", () => ({
    usePendingChoiceBuffer: () => ({
        buffer: [],
        toggle: vi.fn(),
        clear: vi.fn(),
        submit: vi.fn(),
        isPending: false,
        lastError: null,
        dismissError: vi.fn(),
    }),
}));

type Ctx = React.ContextType<typeof GameContext>;

interface Projected {
    me: Player;
    opp: Player;
}

/** Builds a real GameState — `me` with two ready creatures, `opp` with two of
 *  their own plus (optionally) a Dueling Grounds — and returns both boards as
 *  the client actually receives them, through `projectPublicState`. */
function projectBoards(
    withCap: boolean,
    capDefId: string = duelingGrounds.id,
    firstDefenderDefId: string = grizzlyBears.id
): Projected {
    const mine = [
        makeInstance(grizzlyBears.id, {
            id: "a",
            controllerId: "me",
            ownerId: "me",
            isSummoningSick: false,
        }),
        makeInstance(grizzlyBears.id, {
            id: "b",
            controllerId: "me",
            ownerId: "me",
            isSummoningSick: false,
        }),
    ];
    const theirs = [
        makeInstance(firstDefenderDefId, {
            id: "x",
            controllerId: "opp",
            ownerId: "opp",
            isSummoningSick: false,
        }),
        makeInstance(grizzlyBears.id, {
            id: "y",
            controllerId: "opp",
            ownerId: "opp",
            isSummoningSick: false,
        }),
    ];
    if (withCap) {
        theirs.push(makeInstance(capDefId, { id: "dg", controllerId: "opp" }));
    }
    const state = makeState({
        activePlayerId: "me",
        players: [
            makePlayer("me", { battlefield: mine }),
            makePlayer("opp", { battlefield: theirs }),
        ],
    });
    const projected = projectPublicState(state, 1, "me");
    return {
        me: projected.players[0] as unknown as Player,
        opp: projected.players[1] as unknown as Player,
    };
}

function renderBoard(
    boards: Projected,
    ctxOverrides: Record<string, unknown>,
    board: "me" | "opp" = "me"
) {
    const ctx = {
        gameId: "game-id" as never,
        playerId: "me",
        activePlayerId: "me",
        priorityPlayerId: "me",
        turn: 1,
        engineTurn: 1,
        stackCount: 0,
        allPlayers: [boards.me, boards.opp],
        showAllCards: false,
        debugAllActions: false,
        ...ctxOverrides,
    } as unknown as NonNullable<Ctx>;
    const wrapper = ({ children }: { children: ReactNode }) => (
        <GameContext value={ctx}>{children}</GameContext>
    );
    return renderHook(
        () =>
            useBattlefieldVisualState(board === "me" ? boards.me : boards.opp),
        { wrapper }
    );
}

const attackerCtx = (attackerIds: string[]) => ({
    phase: "DECLARE_ATTACKERS",
    combat: {
        attackerIds,
        confirmed: false,
        blockerAssignments: {},
        blockersConfirmed: false,
    },
});

const blockerCtx = (blockerAssignments: Record<string, string[]>) => ({
    phase: "DECLARE_BLOCKERS",
    playerId: "opp",
    priorityPlayerId: "opp",
    combat: {
        attackerIds: ["a", "b"],
        confirmed: true,
        blockerAssignments,
        blockersConfirmed: false,
    },
});

describe("declared-attacker cap on the board (CR 508.1a, issue #1127)", () => {
    it("with the cap spent, a further creature is NOT clickable — and the declared one still is (to free the slot)", () => {
        const boards = projectBoards(true);
        const { result } = renderBoard(boards, attackerCtx(["a"]));
        const [a, b] = boards.me.battlefield as CardInstance[];

        expect(result.current.canInteract(a)).toBe(true);
        expect(result.current.canInteract(b)).toBe(false);
        // `enabled` is the click gate; `dimmed` is the visible reason — the
        // same treatment a tapped / summoning-sick creature gets, so the board
        // shows WHY the click does nothing instead of swallowing it.
        expect(result.current.getVisualState(b).enabled).toBe(false);
        expect(result.current.getVisualState(b).dimmed).toBe(true);
        expect(result.current.getVisualState(a).dimmed).toBe(false);
    });

    it("with no cap in play the SAME second creature is clickable (the cap is what grays it)", () => {
        const boards = projectBoards(false);
        const { result } = renderBoard(boards, attackerCtx(["a"]));
        const b = boards.me.battlefield[1] as CardInstance;

        expect(result.current.canInteract(b)).toBe(true);
    });

    it("before any attacker is declared the cap is not yet spent, so creatures stay clickable", () => {
        const boards = projectBoards(true);
        const { result } = renderBoard(boards, attackerCtx([]));
        const [a, b] = boards.me.battlefield as CardInstance[];

        expect(result.current.canInteract(a)).toBe(true);
        expect(result.current.canInteract(b)).toBe(true);
    });
});

describe("declared-blocker cap on the board (CR 509.1a, issue #1127)", () => {
    it("with one creature already blocking, a SECOND blocker is not clickable; the blocking one stays clickable", () => {
        const boards = projectBoards(true);
        const { result } = renderBoard(boards, blockerCtx({ x: ["a"] }), "opp");
        const [x, y] = boards.opp.battlefield as CardInstance[];

        expect(result.current.canInteract(x)).toBe(true);
        expect(result.current.canInteract(y)).toBe(false);
        expect(result.current.getVisualState(y).dimmed).toBe(true);
    });

    it("with no cap in play the SAME second blocker is clickable", () => {
        const boards = projectBoards(false);
        const { result } = renderBoard(boards, blockerCtx({ x: ["a"] }), "opp");
        const y = boards.opp.battlefield[1] as CardInstance;

        expect(result.current.canInteract(y)).toBe(true);
    });
});

describe("the declared-blocker cap counts CREATURES, not assignments (CR 509.1a, issue #1127)", () => {
    it("under a cap of two, a creature blocking TWO attackers leaves the second slot open", () => {
        // The discriminating case for the client's cap arithmetic. Caverns of
        // Despair caps distinct blockers at two; `x` (Two-Headed Giant of
        // Foriys) is blocking BOTH attackers, which is one creature and one
        // slot. Counting ASSIGNMENTS instead of creatures reads 2 >= 2 and
        // grays out `y` — a creature the server would happily accept, which is
        // exactly the client/server drift the shared scanner exists to prevent.
        const boards = projectBoards(
            true,
            cavernsOfDespair.id,
            twoHeadedGiantOfForiys.id
        );
        const { result } = renderBoard(
            boards,
            blockerCtx({ x: ["a", "b"] }),
            "opp"
        );
        const y = boards.opp.battlefield[1] as CardInstance;

        expect(result.current.canInteract(y)).toBe(true);
        expect(result.current.getVisualState(y).dimmed).toBe(false);
    });

    it("two DISTINCT creatures blocking under the same cap of two do close it", () => {
        const boards = projectBoards(
            true,
            cavernsOfDespair.id,
            twoHeadedGiantOfForiys.id
        );
        const three = {
            ...boards,
            opp: {
                ...boards.opp,
                battlefield: [
                    ...boards.opp.battlefield,
                    {
                        ...(boards.opp.battlefield[1] as CardInstance),
                        id: "z",
                    } as CardInstance,
                ],
            },
        };
        const { result } = renderBoard(
            three,
            blockerCtx({ x: ["a"], y: ["b"] }),
            "opp"
        );
        const z = three.opp.battlefield.find(
            (c) => c.id === "z"
        ) as CardInstance;

        expect(result.current.canInteract(z)).toBe(false);
    });
});
