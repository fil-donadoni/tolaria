import { describe, it, expect } from "vitest";
import {
    computeHasPriority,
    computeAutoPassBlocked,
    type HasPriorityCtx,
    type AutoPassBlockedCtx,
} from "../priority";
import type { Combat } from "~/types/game";

function makePriorityCtx(
    overrides: Partial<HasPriorityCtx> = {}
): HasPriorityCtx {
    return {
        playerId: "p1",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        phase: "PRECOMBAT_MAIN",
        ...overrides,
    };
}

function makeAutoPassCtx(
    overrides: Partial<AutoPassBlockedCtx> = {}
): AutoPassBlockedCtx {
    return {
        ...makePriorityCtx(),
        stackCount: 0,
        ...overrides,
    };
}

const combatAttackersOpen: Combat = {
    attackerIds: [],
    confirmed: false,
    blockerAssignments: {},
    blockersConfirmed: false,
};

describe("computeHasPriority", () => {
    it("true when priority is ours and nothing is pending", () => {
        expect(computeHasPriority(makePriorityCtx())).toBe(true);
    });

    it("false when priority belongs to opponent", () => {
        expect(
            computeHasPriority(makePriorityCtx({ priorityPlayerId: "p2" }))
        ).toBe(false);
    });

    it("false when a cast is in progress (any player)", () => {
        expect(
            computeHasPriority(
                makePriorityCtx({
                    pendingCast: {
                        playerId: "p2",
                        cardInstanceId: "c",
                        manaCost: {},
                        tappedLandIds: [],
                    },
                })
            )
        ).toBe(false);
    });

    it("false when target selection is pending", () => {
        expect(
            computeHasPriority(
                makePriorityCtx({
                    pendingTarget: {
                        playerId: "p1",
                        cardInstanceId: "c",
                        targetType: "any",
                        count: 1,
                        selected: [],
                    },
                })
            )
        ).toBe(false);
    });

    it("false during attacker declaration (active player)", () => {
        expect(
            computeHasPriority(
                makePriorityCtx({
                    phase: "DECLARE_ATTACKERS",
                    combat: combatAttackersOpen,
                })
            )
        ).toBe(false);
    });

    it("false when waiting on opponent to declare attackers", () => {
        expect(
            computeHasPriority(
                makePriorityCtx({
                    phase: "DECLARE_ATTACKERS",
                    playerId: "p1",
                    activePlayerId: "p2",
                    priorityPlayerId: "p1",
                    combat: combatAttackersOpen,
                })
            )
        ).toBe(false);
    });
});

describe("computeAutoPassBlocked", () => {
    it("false when everything is clean", () => {
        expect(computeAutoPassBlocked(makeAutoPassCtx())).toBe(false);
    });

    it("true when stack is non-empty", () => {
        expect(computeAutoPassBlocked(makeAutoPassCtx({ stackCount: 1 }))).toBe(
            true
        );
    });

    it("true when we are in autoPassPlayers list", () => {
        expect(
            computeAutoPassBlocked(makeAutoPassCtx({ autoPassPlayers: ["p1"] }))
        ).toBe(true);
    });

    it("true when an undo is available to us", () => {
        expect(
            computeAutoPassBlocked(makeAutoPassCtx({ undoableBy: "p1" }))
        ).toBe(true);
    });

    it("false when opponent has an undo but we don't", () => {
        expect(
            computeAutoPassBlocked(makeAutoPassCtx({ undoableBy: "p2" }))
        ).toBe(false);
    });

    it("true when game is over", () => {
        expect(
            computeAutoPassBlocked(
                makeAutoPassCtx({
                    gameOver: {
                        winnerId: "p1",
                        loserId: "p2",
                        reason: "life",
                    },
                })
            )
        ).toBe(true);
    });

    it("true when we don't have priority", () => {
        expect(
            computeAutoPassBlocked(makeAutoPassCtx({ priorityPlayerId: "p2" }))
        ).toBe(true);
    });
});
