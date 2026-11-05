// Frontend wiring for skulk (CR 702.118b): the board grays out a would-be blocker
// the server's evasion rule refuses, instead of offering a click that can only
// fail. Driven through `projectPublicState` and the real
// `useBattlefieldVisualState`: the comparison reads EFFECTIVE power (CR 613.4), a
// granted keyword included (CR 613.1f).
import { beforeAll, describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import type { CardInstance, Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import { useBattlefieldVisualState } from "../useBattlefieldVisualState";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../../convex/cards/__tests__/setup.helper";
import { projectPublicState } from "../../../convex/gameProjections";
import {
    beginApplyingStaticEffects,
    recomputeContinuousEffects,
} from "../../../convex/gre/state";
import { preloadDefinitions } from "../../../convex/cards/registry";
import type { CardDefinition } from "../../../convex/cards/types";

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

const creature = (slug: string, power: number): CardDefinition => ({
    id: `test-skulk-board-${slug}`,
    name: `Test Skulk Board ${slug}`,
    rarity: "common",
    manaCost: { generic: 1, B: 1 },
    types: ["Creature"],
    power,
    toughness: 4,
});

const SKULKER: CardDefinition = {
    ...creature("skulker", 2),
    staticAbilities: ["skulk"],
};
const TWO = creature("two", 2);
const THREE = creature("three", 3);

/** "Creatures you control have skulk" as the compiler lowers it. */
const LORD: CardDefinition = {
    ...creature("lord", 0),
    compiledStaticEffects: [
        {
            kind: "keyword-grant",
            filter: { types: ["Creature"], controllerRelation: "you" },
            keyword: "skulk",
        },
    ],
};

beforeAll(() => preloadDefinitions([SKULKER, TWO, THREE, LORD]));

const body = (
    def: CardDefinition,
    id: string,
    controller: string,
    plusOneCounters = 0
) =>
    makeInstance(def.id, {
        id,
        controllerId: controller,
        ownerId: controller,
        isSummoningSick: false,
        ...(plusOneCounters > 0
            ? { counters: { "+1/+1": plusOneCounters } }
            : {}),
    });

/** `me` attacks with every id in `attackerIds`; the blocker under test is `x`
 *  on `opp`'s board, read the way the client receives it. */
function renderBlocker(
    myBoard: ReturnType<typeof body>[],
    oppBoard: ReturnType<typeof body>[],
    attackerIds: string[] = ["a"]
) {
    const state = makeState({
        activePlayerId: "me",
        priorityPlayerId: "me",
        players: [
            makePlayer("me", { battlefield: myBoard }),
            makePlayer("opp", { battlefield: oppBoard }),
        ],
    });
    for (const permanent of [...myBoard, ...oppBoard]) {
        beginApplyingStaticEffects(state, permanent);
    }
    recomputeContinuousEffects(state);
    const projected = projectPublicState(state, 1, "opp");
    const me = projected.players[0] as unknown as Player;
    const opp = projected.players[1] as unknown as Player;
    const ctx = {
        gameId: "game-id" as never,
        playerId: "opp",
        activePlayerId: "me",
        priorityPlayerId: "opp",
        turn: 1,
        engineTurn: 1,
        stackCount: 0,
        allPlayers: [me, opp],
        showAllCards: false,
        debugAllActions: false,
        phase: "DECLARE_BLOCKERS",
        combat: {
            attackerIds,
            confirmed: true,
            blockerAssignments: {},
            blockersConfirmed: false,
        },
    } as unknown as NonNullable<Ctx>;
    const wrapper = ({ children }: { children: ReactNode }) => (
        <GameContext value={ctx}>{children}</GameContext>
    );
    const { result } = renderHook(() => useBattlefieldVisualState(opp), {
        wrapper,
    });
    const blocker = opp.battlefield.find((c) => c.id === "x") as CardInstance;
    return result.current.canInteract(blocker);
}

describe("skulk on the block board (CR 702.118b)", () => {
    it("a blocker with greater power is NOT clickable", () => {
        expect(
            renderBlocker([body(SKULKER, "a", "me")], [body(THREE, "x", "opp")])
        ).toBe(false);
    });

    it("a blocker with equal power is clickable", () => {
        expect(
            renderBlocker([body(SKULKER, "a", "me")], [body(TWO, "x", "opp")])
        ).toBe(true);
    });

    it("a creature with skulk is clickable against a stronger attacker", () => {
        expect(
            renderBlocker([body(THREE, "a", "me")], [body(SKULKER, "x", "opp")])
        ).toBe(true);
    });

    it("a counter on the attacker makes the block legal (CR 613.4c)", () => {
        expect(
            renderBlocker(
                [body(SKULKER, "a", "me", 1)],
                [body(THREE, "x", "opp")]
            )
        ).toBe(true);
    });

    it("a counter on the blocker makes the block illegal (CR 613.4c)", () => {
        expect(
            renderBlocker(
                [body(SKULKER, "a", "me")],
                [body(TWO, "x", "opp", 1)]
            )
        ).toBe(false);
    });

    it("a second, stronger attacker leaves the blocker a legal block", () => {
        expect(
            renderBlocker(
                [body(SKULKER, "a", "me"), body(THREE, "b", "me")],
                [body(THREE, "x", "opp")],
                ["a", "b"]
            )
        ).toBe(true);
    });

    it("a keyword GRANTED to the attacker survives the projection (CR 613.1f)", () => {
        expect(
            renderBlocker(
                [body(TWO, "a", "me"), body(LORD, "lord", "me")],
                [body(THREE, "x", "opp")]
            )
        ).toBe(false);
    });
});
