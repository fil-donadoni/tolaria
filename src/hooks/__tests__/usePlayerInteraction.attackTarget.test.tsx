// Issue #8178 (CR 508.1b) — while creatures await their attack target, the
// DEFENDING player's nameplate is a candidate and a click declares them
// against the player. Real hook, real GameContext; mutation calls recorded.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { makePlayer } from "@convex/cards/__tests__/setup.helper";
import { GameContext } from "~/hooks/useGameContext";
import { AttackSequenceContext } from "~/hooks/useAttackSequence";
import { usePlayerInteraction } from "../usePlayerInteraction";
import { makeAttackSequence } from "./attack-sequence.fixture";

const toggleAttacker = vi.fn<(args?: Record<string, unknown>) => Promise<void>>(
    () => Promise.resolve()
);
vi.mock("convex/react", () => ({
    useMutation: (ref: { _name: string }) =>
        ref._name === "toggleAttacker" ? toggleAttacker : async () => {},
}));
vi.mock("@convex/_generated/api", () => ({
    api: new Proxy(
        {},
        {
            get: () =>
                new Proxy({}, { get: (_t, name) => ({ _name: String(name) }) }),
        }
    ),
}));
vi.mock("~/hooks/usePendingChoiceBuffer", () => ({
    usePendingChoiceBuffer: () => ({
        buffer: [],
        toggle: vi.fn(),
        reportError: vi.fn(),
    }),
}));
vi.mock("~/hooks/useDivideBuffer", () => ({
    useDivideBuffer: () => ({
        active: false,
        remaining: 0,
        get: () => 0,
        inc: vi.fn(),
        dec: vi.fn(),
    }),
}));

type Ctx = NonNullable<React.ContextType<typeof GameContext>>;

function render(
    forPlayerId: string,
    awaiting: string[],
    combatOverrides: Record<string, unknown> = {}
) {
    const me = makePlayer("me");
    const opp = makePlayer("opp");
    const ctx = {
        gameId: "game-id",
        playerId: "me",
        activePlayerId: "me",
        priorityPlayerId: "me",
        phase: "DECLARE_ATTACKERS",
        allPlayers: [me, opp],
        combat: {
            attackerIds: [],
            confirmed: false,
            blockerAssignments: {},
            blockersConfirmed: false,
            ...combatOverrides,
        },
    } as unknown as Ctx;
    const seq = makeAttackSequence({ awaiting });
    const wrapper = ({ children }: { children: ReactNode }) => (
        <GameContext value={ctx}>
            <AttackSequenceContext value={seq}>
                {children}
            </AttackSequenceContext>
        </GameContext>
    );
    const player = forPlayerId === "me" ? me : opp;
    return {
        seq,
        ...renderHook(() => usePlayerInteraction(player as never), { wrapper }),
    };
}

describe("usePlayerInteraction — attack target (issue #8178, CR 508.1b)", () => {
    beforeEach(() => toggleAttacker.mockClear());

    it("the defending nameplate is a candidate while a creature awaits; click declares it vs the player", async () => {
        const { result, seq } = render("opp", ["a1"]);
        expect(result.current.isTargetable).toBe(true);

        result.current.handleClick();

        expect(toggleAttacker).toHaveBeenCalledWith({
            gameId: "game-id",
            playerId: "me",
            cardInstanceId: "a1",
        });
        await waitFor(() =>
            expect(seq.resolveAwaiting).toHaveBeenCalledWith(["a1"])
        );
    });

    it("nothing awaiting: the nameplate is not a candidate and a click does nothing", () => {
        const { result } = render("opp", []);
        expect(result.current.isTargetable).toBe(false);
        result.current.handleClick();
        expect(toggleAttacker).not.toHaveBeenCalled();
    });

    it("the viewer's own nameplate is never an attack-target candidate", () => {
        const { result } = render("me", ["a1"]);
        expect(result.current.isTargetable).toBe(false);
    });

    it("a must-attack creature declared on a planeswalker is sent back to the player by repeating that planeswalker", async () => {
        const { result } = render("opp", ["a1"], {
            attackerIds: ["a1"],
            attackTargets: { a1: "pw1" },
        });
        result.current.handleClick();
        expect(toggleAttacker).toHaveBeenCalledWith({
            gameId: "game-id",
            playerId: "me",
            cardInstanceId: "a1",
            planeswalkerId: "pw1",
        });
    });
});
