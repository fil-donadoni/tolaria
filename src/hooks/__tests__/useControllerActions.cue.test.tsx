// Controller cue (issue #9980): target selection (CR 601.2c) and the Keep /
// Mulligan declaration (CR 103.5) are inputs the viewer owes — the pill reads
// "mine", never "Opponent to act".
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { GameContext } from "~/hooks/useGameContext";

const calls: { ref: string; args: unknown }[] = [];
vi.mock("convex/react", () => ({
    useMutation: (ref: string) => (args: unknown) => {
        calls.push({ ref, args });
        return Promise.resolve(null);
    },
}));
vi.mock("@convex/_generated/api", () => {
    const names = [
        "cancelCast",
        "cancelActivation",
        "confirmAttackers",
        "toggleAttacker",
        "confirmBlockers",
        "confirmDamage",
        "passPriority",
        "autoTapForPayment",
        "autoTapForAttackTax",
        "cancelAttackTax",
        "endTurn",
        "cancelAutoPass",
    ];
    const game: Record<string, string> = {};
    for (const n of names) game[n] = n;
    return { api: { game } };
});
const PLAIN_DEF = { id: "plain", name: "T", staticEffects: [] };
import {
    mockInstanceManaCost,
    type ManaCostSource,
} from "~/lib/testing/convex-cards-mock";
vi.mock("@convex/cards", () => ({
    getInstanceManaCost: (c: ManaCostSource) => mockInstanceManaCost(c),
    getDefinition: () => PLAIN_DEF,
    tryGetDefinition: () => PLAIN_DEF,
}));
vi.mock("@convex/cards/attackRestrictions", () => ({
    globalAttackProhibitionReason: () => undefined,
}));
vi.mock("~/hooks/usePendingChoiceBuffer", () => ({
    usePendingChoiceBuffer: () => ({
        buffer: [],
        toggle: vi.fn(),
        clear: vi.fn(),
        submit: vi.fn(),
        isPending: false,
        lastError: null,
        reportError: vi.fn(),
        dismissError: vi.fn(),
    }),
}));

import { useControllerActions } from "../useControllerActions";

function renderCue(overrides: Record<string, unknown>) {
    const ctx = {
        gameId: "game-id",
        playerId: "me",
        activePlayerId: "me",
        priorityPlayerId: "me",
        phase: "PRECOMBAT_MAIN",
        turn: 1,
        engineTurn: 1,
        stackCount: 0,
        stackItems: [],
        allPlayers: [],
        showAllCards: false,
        debugAllActions: false,
        ...overrides,
    } as unknown as NonNullable<React.ContextType<typeof GameContext>>;
    const wrapper = ({ children }: { children: ReactNode }) => (
        <GameContext value={ctx}>{children}</GameContext>
    );
    return renderHook(() => useControllerActions(), { wrapper });
}

describe("useControllerActions — cue for owed input (#9980)", () => {
    it("reads 'mine' while the viewer chooses targets", () => {
        const { result } = renderCue({
            priorityPlayerId: "opp",
            pendingTarget: { playerId: "me", selectedTargets: [] },
        });
        expect(result.current.cue).toBe("mine");
    });

    it("reads 'opponent' while the opponent chooses targets", () => {
        const { result } = renderCue({
            priorityPlayerId: "me",
            pendingTarget: { playerId: "opp", selectedTargets: [] },
        });
        expect(result.current.cue).toBe("opponent");
    });

    it("reads 'mine' on the viewer's own mulligan declaration", () => {
        const { result } = renderCue({
            phase: "MULLIGAN",
            priorityPlayerId: "opp",
            mulligan: { declaringPlayerId: "me", mulligansTaken: [0, 0] },
        });
        expect(result.current.cue).toBe("mine");
    });

    it("reads 'opponent' while the opponent declares their mulligan", () => {
        const { result } = renderCue({
            phase: "MULLIGAN",
            priorityPlayerId: "me",
            mulligan: { declaringPlayerId: "opp", mulligansTaken: [0, 0] },
        });
        expect(result.current.cue).toBe("opponent");
    });
});
