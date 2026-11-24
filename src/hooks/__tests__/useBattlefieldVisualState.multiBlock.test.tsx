// Multi-select blockers — visual state (issue #10373, CR 509.1a).
//
// A clicked creature awaiting its attacker wears the heavy awaiting ring, and
// the attackers become candidates while the set is non-empty (no server
// `pendingBlockerId`). Under Melee (#669) the ATTACKING declarer picks from the
// defender's board.
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import type { CardInstance, Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import {
    AttackSequenceContext,
    type AttackSequence,
} from "~/hooks/useAttackSequence";
import { makeAttackSequence } from "./attack-sequence.fixture";
import { useBattlefieldVisualState } from "../useBattlefieldVisualState";

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

const blocker = creature("b1");
const attacker = creature("atk1", {
    controllerId: "opp",
    ownerId: "opp",
    isAttacking: true,
});
const me = player("me", [blocker]);
const opp = player("opp", [attacker]);

function renderFor(
    board: Player,
    sequence: AttackSequence,
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
        },
        ...ctxOverrides,
    } as unknown as NonNullable<Ctx>;
    const wrapper = ({ children }: { children: ReactNode }) => (
        <GameContext value={ctx}>
            <AttackSequenceContext value={sequence}>
                {children}
            </AttackSequenceContext>
        </GameContext>
    );
    return renderHook(() => useBattlefieldVisualState(board), { wrapper });
}

describe("useBattlefieldVisualState — awaiting blockers (issue #10373)", () => {
    it("an awaiting blocker wears the heavy awaiting ring; an idle one does not", () => {
        const idle = renderFor(me, makeAttackSequence());
        expect(
            idle.result.current.getVisualState(blocker).ringClass
        ).not.toContain("card-ring-current");
        const waiting = renderFor(
            me,
            makeAttackSequence({ awaitingBlockers: ["b1"] })
        );
        expect(
            waiting.result.current.getVisualState(blocker).ringClass
        ).toContain("card-ring-current");
    });

    it("an attacker is a candidate only while a blocker awaits (no server pending blocker)", () => {
        const idle = renderFor(opp, makeAttackSequence());
        expect(idle.result.current.canInteract(attacker)).toBe(false);
        const waiting = renderFor(
            opp,
            makeAttackSequence({ awaitingBlockers: ["b1"] })
        );
        expect(waiting.result.current.canInteract(attacker)).toBe(true);
    });

    it("Melee: the attacking declarer can click the defender's creature and then an attacker", () => {
        const melee = { playerId: "opp", blocksDeclaredByAttacker: true };
        const s = makeAttackSequence({ awaitingBlockers: ["b1"] });
        expect(
            renderFor(me, s, melee).result.current.canInteract(blocker)
        ).toBe(true);
        expect(
            renderFor(opp, s, melee).result.current.canInteract(attacker)
        ).toBe(true);
    });
});
