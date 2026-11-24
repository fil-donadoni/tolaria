// Multi-select blockers (issue #10373, CR 509.1a/509.1b) — click routing.
//
// During DECLARE_BLOCKERS a click on an eligible creature only marks it
// awaiting (client-only); one attacker click then sends every awaiting
// creature at that attacker as chained selectBlocker + assignBlockerTarget
// pairs. Drives the real `useBattlefieldInteraction` hook's `handleClick`.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { CardInstance, Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import { makeAttackSequence } from "./attack-sequence.fixture";

type MutArgs = Record<string, unknown>;
type MutFn = (args?: MutArgs) => Promise<void>;
const selectBlocker = vi.fn<MutFn>(() => Promise.resolve());
const assignBlockerTarget = vi.fn<MutFn>(() => Promise.resolve());
const reportError = vi.hoisted(() => vi.fn());
const noop = vi.fn<MutFn>(() => Promise.resolve());
const MUTATIONS: Record<string, ReturnType<typeof vi.fn>> = {
    selectBlocker,
    assignBlockerTarget,
};

vi.mock("convex/react", () => ({
    useMutation: (ref: { _name: string }) => MUTATIONS[ref._name] ?? noop,
    useQuery: () => undefined,
}));

vi.mock("@convex/_generated/api", () => {
    const names = [
        "tapUntap",
        "tapForPayment",
        "untapForPayment",
        "tapForActivationPayment",
        "untapForActivationPayment",
        "tapArtifactForImprovise",
        "untapArtifactForImprovise",
        "tapForAttackTax",
        "untapForAttackTax",
        "toggleAttacker",
        "selectBlocker",
        "assignBlockerTarget",
        "selectTarget",
        "selectAdditionalCost",
        "selectActivationCost",
        "selectSacrifice",
        "activateAbility",
        "activateManaAbility",
        "getFullState",
    ];
    const game: Record<string, { _name: string }> = {};
    for (const n of names) game[n] = { _name: n };
    return { api: { game } };
});

const PLAIN_DEF = { id: "plain-def", name: "Test", staticEffects: [] };
import {
    mockInstanceManaCost,
    type ManaCostSource,
} from "~/lib/testing/convex-cards-mock";
vi.mock("@convex/cards", () => ({
    getInstanceManaCost: (c: ManaCostSource) =>
        mockInstanceManaCost(c, () => PLAIN_DEF),
    getDefinition: () => PLAIN_DEF,
    tryGetDefinition: () => PLAIN_DEF,
}));

vi.mock("~/hooks/usePendingChoiceBuffer", () => ({
    usePendingChoiceBuffer: () => ({
        buffer: [],
        toggle: vi.fn(),
        clear: vi.fn(),
        submit: vi.fn(),
        isPending: false,
        lastError: null,
        reportError,
        dismissError: vi.fn(),
    }),
}));

// Import AFTER mocks are registered.
import { useBattlefieldInteraction } from "../useBattlefieldInteraction";
import {
    AttackSequenceContext,
    type AttackSequence,
} from "~/hooks/useAttackSequence";
import { resetPendingGameIntents } from "~/lib/pending-intent-store";

function creature(
    id: string,
    overrides: Partial<CardInstance> = {}
): CardInstance {
    return {
        id,
        card: { id: "plain-def" },
        controllerId: "me",
        ownerId: "me",
        zone: "battlefield",
        isTapped: false,
        isSummoningSick: false,
        types: ["Creature"],
        subtypes: [],
        staticAbilities: [],
        ...overrides,
    } as CardInstance;
}

function player(id: string, battlefield: CardInstance[]): Player {
    return {
        id,
        name: id,
        bgColor: "#000",
        life: 20,
        hand: [],
        library: { count: 0 },
        graveyard: [],
        exile: [],
        battlefield,
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    } as Player;
}

type Ctx = React.ContextType<typeof GameContext>;

const blockers = [creature("b1"), creature("b2"), creature("b3")];
const attacker = creature("atk1", {
    controllerId: "opp",
    ownerId: "opp",
    isAttacking: true,
});
const me = player("me", blockers);
const opp = player("opp", [attacker]);

function render(
    s: AttackSequence,
    boardOf: Player,
    combatOverrides: Record<string, unknown> = {},
    ctxOverrides: Record<string, unknown> = {}
) {
    const ctx = {
        gameId: "game-id" as never,
        playerId: "me",
        activePlayerId: "opp",
        priorityPlayerId: "opp",
        phase: "DECLARE_BLOCKERS",
        turn: 1,
        engineTurn: 1,
        stackCount: 0,
        stackItems: [],
        allPlayers: [me, opp],
        showAllCards: false,
        debugAllActions: false,
        combat: {
            attackerIds: ["atk1"],
            confirmed: true,
            blockerAssignments: {},
            blockersConfirmed: false,
            ...combatOverrides,
        },
        ...ctxOverrides,
    } as unknown as NonNullable<Ctx>;
    const wrapper = ({ children }: { children: ReactNode }) => (
        <GameContext value={ctx}>
            <AttackSequenceContext value={s}>{children}</AttackSequenceContext>
        </GameContext>
    );
    return renderHook(() => useBattlefieldInteraction(boardOf), { wrapper });
}

describe("useBattlefieldInteraction — multi-select blockers (issue #10373)", () => {
    beforeEach(() => {
        selectBlocker.mockClear();
        assignBlockerTarget.mockClear();
        reportError.mockClear();
        resetPendingGameIntents();
    });

    it("a creature click only toggles it awaiting: no mutation", () => {
        const s = makeAttackSequence();
        const { result } = render(s, me);

        result.current.handleClick(blockers[0]);

        expect(s.toggleAwaitingBlocker).toHaveBeenCalledWith("b1");
        expect(selectBlocker).not.toHaveBeenCalled();
    });

    it("an already-assigned blocker keeps its unassign click and is not awaited", () => {
        const s = makeAttackSequence();
        const { result } = render(s, me, {
            blockerAssignments: { b1: ["atk1"] },
        });

        result.current.handleClick(blockers[0]);

        expect(selectBlocker).toHaveBeenCalledWith({
            gameId: "game-id",
            playerId: "me",
            cardInstanceId: "b1",
        });
        expect(s.toggleAwaitingBlocker).not.toHaveBeenCalled();
    });

    it("one attacker click assigns every awaiting blocker, select then assign, in order", async () => {
        const order: string[] = [];
        selectBlocker.mockImplementation((a) => {
            order.push(`select:${a?.cardInstanceId}`);
            return Promise.resolve();
        });
        assignBlockerTarget.mockImplementation((a) => {
            order.push(`assign:${a?.attackerId}`);
            return Promise.resolve();
        });
        const s = makeAttackSequence({ awaitingBlockers: ["b1", "b2", "b3"] });
        const { result } = render(s, opp);

        result.current.handleClick(attacker);

        await waitFor(() =>
            expect(s.resolveAwaitingBlockers).toHaveBeenCalledTimes(3)
        );
        expect(order).toEqual([
            "select:b1",
            "assign:atk1",
            "select:b2",
            "assign:atk1",
            "select:b3",
            "assign:atk1",
        ]);
        selectBlocker.mockImplementation(() => Promise.resolve());
        assignBlockerTarget.mockImplementation(() => Promise.resolve());
    });

    it("a refused blocker stays awaiting with an error; the others are assigned", async () => {
        assignBlockerTarget.mockImplementationOnce(() =>
            Promise.reject(new Error("cannot block flying"))
        );
        const s = makeAttackSequence({ awaitingBlockers: ["b1", "b2"] });
        const { result } = render(s, opp);

        result.current.handleClick(attacker);

        await waitFor(() =>
            expect(s.resolveAwaitingBlockers).toHaveBeenCalledWith(["b2"])
        );
        expect(s.resolveAwaitingBlockers).not.toHaveBeenCalledWith(["b1"]);
        expect(reportError).toHaveBeenCalledTimes(1);
        // b1's select landed before its refusal: undone so a retry re-selects.
        expect(
            selectBlocker.mock.calls.map((c) => c[0]?.cardInstanceId)
        ).toEqual(["b1", "b1", "b2"]);
    });

    it("a second attacker click inside the first batch's round trip sends nothing", async () => {
        let release: () => void = () => {};
        selectBlocker.mockImplementationOnce(
            () => new Promise<void>((r) => (release = r))
        );
        const s = makeAttackSequence({ awaitingBlockers: ["b1"] });
        const { result } = render(s, opp);

        result.current.handleClick(attacker);
        result.current.handleClick(attacker);
        expect(selectBlocker).toHaveBeenCalledTimes(1);
        release();
        await waitFor(() =>
            expect(s.resolveAwaitingBlockers).toHaveBeenCalledTimes(1)
        );
        expect(assignBlockerTarget).toHaveBeenCalledTimes(1);
    });

    it("with nothing awaiting and a server-pending blocker the attacker click assigns it as today", () => {
        const s = makeAttackSequence();
        const { result } = render(s, opp, { pendingBlockerId: "b1" });

        result.current.handleClick(attacker);

        expect(assignBlockerTarget).toHaveBeenCalledWith({
            gameId: "game-id",
            playerId: "me",
            attackerId: "atk1",
        });
        expect(selectBlocker).not.toHaveBeenCalled();
    });

    it("Melee: the attacking declarer awaits the DEFENDER's creatures", () => {
        const s = makeAttackSequence();
        const { result } = render(
            s,
            me,
            {},
            { playerId: "opp", blocksDeclaredByAttacker: true }
        );

        result.current.handleClick(blockers[1]);

        expect(s.toggleAwaitingBlocker).toHaveBeenCalledWith("b2");
    });
});
