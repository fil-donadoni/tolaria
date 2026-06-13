import { describe, it, expect } from "vitest";
import {
    computeHasPriority,
    computeAutoPassBlocked,
    computeSoloViewerId,
    type HasPriorityCtx,
    type AutoPassBlockedCtx,
    type SoloViewerCtx,
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

function makeSoloCtx(overrides: Partial<SoloViewerCtx> = {}): SoloViewerCtx {
    return {
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        phase: "PRECOMBAT_MAIN",
        playerIds: ["p1", "p2"],
        ...overrides,
    };
}

describe("computeSoloViewerId", () => {
    it("returns priority player by default", () => {
        expect(computeSoloViewerId(makeSoloCtx())).toBe("p1");
    });

    it("follows priority when it switches mid-phase", () => {
        expect(
            computeSoloViewerId(makeSoloCtx({ priorityPlayerId: "p2" }))
        ).toBe("p2");
    });

    it("switches to defender when blockers must be declared", () => {
        // CR 509.1 — defender declares blockers as a turn-based action before
        // the active player gets priority. priorityPlayerId still reads as
        // active during this window.
        expect(
            computeSoloViewerId(
                makeSoloCtx({
                    phase: "DECLARE_BLOCKERS",
                    activePlayerId: "p1",
                    priorityPlayerId: "p1",
                    combat: {
                        attackerIds: ["a"],
                        confirmed: true,
                        blockerAssignments: {},
                        blockersConfirmed: false,
                    },
                })
            )
        ).toBe("p2");
    });

    it("returns to active player after blockers confirmed", () => {
        expect(
            computeSoloViewerId(
                makeSoloCtx({
                    phase: "DECLARE_BLOCKERS",
                    activePlayerId: "p1",
                    priorityPlayerId: "p1",
                    combat: {
                        attackerIds: ["a"],
                        confirmed: true,
                        blockerAssignments: {},
                        blockersConfirmed: true,
                    },
                })
            )
        ).toBe("p1");
    });

    it("pending choice owner wins over priority and combat", () => {
        expect(
            computeSoloViewerId(
                makeSoloCtx({
                    phase: "DECLARE_BLOCKERS",
                    priorityPlayerId: "p1",
                    activePlayerId: "p1",
                    combat: {
                        attackerIds: ["a"],
                        confirmed: true,
                        blockerAssignments: {},
                        blockersConfirmed: false,
                    },
                    pendingChoices: [
                        {
                            stackItemId: "s",
                            step: 0,
                            choiceId: "c",
                            playerId: "p1",
                            kind: "keep-permanents",
                            zone: "battlefield",
                            count: 1,
                            prompt: "",
                        },
                    ],
                })
            )
        ).toBe("p1");
    });

    it("pending target owner wins over priority", () => {
        expect(
            computeSoloViewerId(
                makeSoloCtx({
                    priorityPlayerId: "p1",
                    pendingTarget: {
                        playerId: "p2",
                        cardInstanceId: "c",
                        targetType: "any",
                        count: 1,
                        selected: [],
                    },
                })
            )
        ).toBe("p2");
    });

    it("pending cast owner wins over priority", () => {
        expect(
            computeSoloViewerId(
                makeSoloCtx({
                    priorityPlayerId: "p1",
                    pendingCast: {
                        playerId: "p2",
                        cardInstanceId: "c",
                        manaCost: {},
                        tappedLandIds: [],
                    },
                })
            )
        ).toBe("p2");
    });
});

describe("damage-assignment authority (CR 702.21j-k)", () => {
    const bandedDamageCombat: Combat = {
        attackerIds: ["hero", "bear"],
        confirmed: true,
        blockerAssignments: { blk: ["hero"] },
        blockersConfirmed: true,
        bands: [{ bandId: "b1", memberIds: ["hero", "bear"] }],
        damageConfirmed: false,
        // Banding hands the blocker's damage assignment to the attacker (p1).
        damageAssignerIds: { blk: "p1" },
        damageAssignmentConfirmedBy: [],
    };

    it("no player has priority while a damage step is open", () => {
        expect(
            computeHasPriority(
                makePriorityCtx({
                    phase: "COMBAT_DAMAGE",
                    playerId: "p1",
                    priorityPlayerId: "p1",
                    combat: bandedDamageCombat,
                })
            )
        ).toBe(false);
    });

    it("solo viewer steers to the outstanding assigner (defender)", () => {
        const combat: Combat = {
            attackerIds: ["atk"],
            confirmed: true,
            blockerAssignments: { guard: ["atk"], decoy: ["atk"] },
            blockersConfirmed: true,
            damageConfirmed: false,
            damageAssignerIds: { atk: "p2" },
            damageAssignmentConfirmedBy: [],
        };
        expect(
            computeSoloViewerId(
                makeSoloCtx({
                    phase: "COMBAT_DAMAGE",
                    activePlayerId: "p1",
                    priorityPlayerId: "p1",
                    combat,
                })
            )
        ).toBe("p2");
    });

    it("solo viewer ignores an assigner who already confirmed", () => {
        const combat: Combat = {
            attackerIds: ["atk"],
            confirmed: true,
            blockerAssignments: { guard: ["atk"], decoy: ["atk"] },
            blockersConfirmed: true,
            damageConfirmed: false,
            damageAssignerIds: { atk: "p2" },
            damageAssignmentConfirmedBy: ["p2"],
        };
        // p2 done → falls back to priority player.
        expect(
            computeSoloViewerId(
                makeSoloCtx({
                    phase: "COMBAT_DAMAGE",
                    activePlayerId: "p1",
                    priorityPlayerId: "p1",
                    combat,
                })
            )
        ).toBe("p1");
    });
});
