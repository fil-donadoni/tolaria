// Frontend wiring for horsemanship (CR 702.31b): the board grays out a would-be
// blocker the server's evasion rule refuses, instead of offering a click that
// can only fail. Driven through `projectPublicState` and the real
// `useBattlefieldVisualState`, a granted keyword included (CR 613.1f).
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
import { grizzlyBears } from "../../../convex/cards/sets/lea/green.cards";

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

const RIDER: CardDefinition = {
    id: "test-horsemanship-board-rider",
    name: "Test Horsemanship Board Rider",
    rarity: "common",
    manaCost: { generic: 1, R: 1 },
    types: ["Creature"],
    power: 2,
    toughness: 2,
    staticAbilities: ["horsemanship"],
};

/** "Creatures you control have horsemanship" as the compiler lowers it. */
const LORD: CardDefinition = {
    id: "test-horsemanship-board-lord",
    name: "Test Horsemanship Board Lord",
    rarity: "rare",
    manaCost: { generic: 4, U: 2 },
    types: ["Creature"],
    power: 4,
    toughness: 4,
    compiledStaticEffects: [
        {
            kind: "keyword-grant",
            filter: { types: ["Creature"], controllerRelation: "you" },
            keyword: "horsemanship",
        },
    ],
};

beforeAll(() => preloadDefinitions([RIDER, LORD]));

const body = (defId: string, id: string, controller: string) =>
    makeInstance(defId, {
        id,
        controllerId: controller,
        ownerId: controller,
        isSummoningSick: false,
    });

const BEAR = () => grizzlyBears().id;

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

describe("horsemanship on the block board (CR 702.31b)", () => {
    it("a blocker without it is NOT clickable against an attacker with it", () => {
        expect(
            renderBlocker(
                [body(RIDER.id, "a", "me")],
                [body(BEAR(), "x", "opp")]
            )
        ).toBe(false);
    });

    it("a blocker with it is clickable against an attacker with it", () => {
        expect(
            renderBlocker(
                [body(RIDER.id, "a", "me")],
                [body(RIDER.id, "x", "opp")]
            )
        ).toBe(true);
    });

    it("a blocker with it is clickable against an attacker without it", () => {
        expect(
            renderBlocker(
                [body(BEAR(), "a", "me")],
                [body(RIDER.id, "x", "opp")]
            )
        ).toBe(true);
    });

    it("a second, plain attacker leaves the blocker a legal block", () => {
        expect(
            renderBlocker(
                [body(RIDER.id, "a", "me"), body(BEAR(), "b", "me")],
                [body(BEAR(), "x", "opp")],
                ["a", "b"]
            )
        ).toBe(true);
    });

    it("a keyword GRANTED to the attacker survives the projection (CR 613.1f)", () => {
        expect(
            renderBlocker(
                [body(BEAR(), "a", "me"), body(LORD.id, "lord", "me")],
                [body(BEAR(), "x", "opp")]
            )
        ).toBe(false);
    });

    it("a keyword GRANTED to the blocker survives the projection (CR 613.1f)", () => {
        expect(
            renderBlocker(
                [body(RIDER.id, "a", "me")],
                [body(BEAR(), "x", "opp"), body(LORD.id, "lord", "opp")]
            )
        ).toBe(true);
    });
});
