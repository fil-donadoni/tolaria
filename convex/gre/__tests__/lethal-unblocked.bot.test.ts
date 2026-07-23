/**
 * `lethalUnblockedDelta` — the narrow-support lethal-on-the-table term
 * (issue #1489, ADR 0070 §5).
 *
 * ADR 0070 §5 admits a new evaluation term only when its SUPPORT is narrow
 * enough to be EXACTLY ZERO off-pattern, so it cannot degrade a position it
 * does not touch — and the proof obligation is that this is testable in
 * isolation. That is what this file is: pattern present → non-zero; pattern
 * absent → `toBe(0)`, exactly, in every way the pattern can be absent.
 *
 * CR references: 508.1 (attack declaration), 508.1a (a planeswalker as the
 * attack target), 509.1 (block declaration), 510.1c (combat damage to the
 * defending player), 704.5a (a player at 0 or less life loses).
 */

import { describe, it, expect } from "vitest";
import {
    WIN_SCORE,
    evaluate,
    lethalUnblockedDelta,
    declaredBlockDelta,
} from "../evaluate";
import type { GameState } from "../state";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { getCardByName } from "../../cards";

const ATTACKER = "p1";
const DEFENDER = "p2";
/** Any vanilla creature — every assertion below overrides its P/T explicitly,
 *  so the printed body never matters. */
const VANILLA = getCardByName("Grizzly Bears").id;

type Combat = NonNullable<GameState["combat"]>;

/** A declared combat: `attackers` are `power/toughness` pairs controlled by the
 *  active player, `blocks` maps a blocker index to the attacker index it
 *  blocks. Defender life is explicit — the whole term turns on it. */
function position(opts: {
    attackers: { power: number; toughness: number }[];
    blockers?: { power: number; toughness: number }[];
    blocks?: Record<number, number>;
    defenderLife: number;
    confirmed?: boolean;
    blockersConfirmed?: boolean;
    /** attacker index → true: that attacker is aimed at a planeswalker. */
    atPlaneswalker?: Record<number, boolean>;
}): GameState {
    const attackers = opts.attackers.map((a, i) =>
        makeInstance(VANILLA, {
            id: `a${i}`,
            controllerId: ATTACKER,
            power: a.power,
            toughness: a.toughness,
            isAttacking: true,
        })
    );
    const blockers = (opts.blockers ?? []).map((b, i) =>
        makeInstance(VANILLA, {
            id: `b${i}`,
            controllerId: DEFENDER,
            power: b.power,
            toughness: b.toughness,
        })
    );

    const state = makeState({
        players: [
            makePlayer(ATTACKER, { battlefield: attackers }),
            makePlayer(DEFENDER, {
                battlefield: blockers,
                life: opts.defenderLife,
            }),
        ],
        activePlayerId: ATTACKER,
    });

    const blockerAssignments: Record<string, string[]> = {};
    for (const [blockerIdx, attackerIdx] of Object.entries(opts.blocks ?? {})) {
        blockerAssignments[`b${blockerIdx}`] = [`a${attackerIdx}`];
    }
    const combat: Combat = {
        attackerIds: attackers.map((a) => a.id),
        confirmed: opts.confirmed ?? true,
        blockerAssignments,
        blockersConfirmed: opts.blockersConfirmed ?? true,
    };
    if (opts.atPlaneswalker) {
        combat.attackTargets = Object.fromEntries(
            Object.entries(opts.atPlaneswalker)
                .filter(([, on]) => on)
                .map(([i]) => [`a${i}`, "pw1"])
        );
    }
    state.combat = combat;
    state.phase = "DECLARE_BLOCKERS";
    return state;
}

describe("lethalUnblockedDelta — ON-PATTERN (CR 510.1c / 704.5a)", () => {
    it("is non-zero when a confirmed block leaves exactly lethal damage", () => {
        // 4 x 6/4 unblocked = 24 into 20 life.
        const state = position({
            attackers: Array.from({ length: 4 }, () => ({
                power: 6,
                toughness: 4,
            })),
            blockers: [{ power: 2, toughness: 2 }],
            defenderLife: 20,
        });
        expect(lethalUnblockedDelta(state, DEFENDER)).toBe(-WIN_SCORE);
        // Symmetric: the attacker's view of the same fact.
        expect(lethalUnblockedDelta(state, ATTACKER)).toBe(WIN_SCORE);
    });

    it("fires at exactly life (damage === life), the CR 704.5a boundary", () => {
        const state = position({
            attackers: [{ power: 3, toughness: 3 }],
            defenderLife: 3,
        });
        expect(lethalUnblockedDelta(state, DEFENDER)).toBe(-WIN_SCORE);
    });

    it("is zero once ONE chump block drops the damage below lethal", () => {
        const lethal = position({
            attackers: Array.from({ length: 4 }, () => ({
                power: 6,
                toughness: 4,
            })),
            blockers: [{ power: 2, toughness: 2 }],
            defenderLife: 20,
        });
        const chumped = position({
            attackers: Array.from({ length: 4 }, () => ({
                power: 6,
                toughness: 4,
            })),
            blockers: [{ power: 2, toughness: 2 }],
            blocks: { 0: 0 },
            defenderLife: 20,
        });
        expect(lethalUnblockedDelta(lethal, DEFENDER)).toBe(-WIN_SCORE);
        expect(lethalUnblockedDelta(chumped, DEFENDER)).toBe(0);
    });
});

describe("lethalUnblockedDelta — EXACTLY ZERO off-pattern (ADR 0070 §5)", () => {
    it("is zero with no combat at all", () => {
        const state = position({
            attackers: [{ power: 6, toughness: 4 }],
            defenderLife: 3,
        });
        state.combat = undefined;
        expect(lethalUnblockedDelta(state, DEFENDER)).toBe(0);
        expect(lethalUnblockedDelta(state, ATTACKER)).toBe(0);
    });

    it("is zero before blockers are confirmed (CR 509.1 — the defender has not answered yet)", () => {
        const state = position({
            attackers: Array.from({ length: 4 }, () => ({
                power: 6,
                toughness: 4,
            })),
            defenderLife: 20,
            blockersConfirmed: false,
        });
        expect(lethalUnblockedDelta(state, DEFENDER)).toBe(0);
    });

    it("is zero on an unconfirmed attack", () => {
        const state = position({
            attackers: [{ power: 6, toughness: 4 }],
            defenderLife: 3,
            confirmed: false,
        });
        expect(lethalUnblockedDelta(state, DEFENDER)).toBe(0);
    });

    it("is zero when the damage is survivable, however heavy", () => {
        const state = position({
            attackers: Array.from({ length: 3 }, () => ({
                power: 6,
                toughness: 4,
            })),
            defenderLife: 20,
        });
        expect(lethalUnblockedDelta(state, DEFENDER)).toBe(0);
    });

    it("is zero when every attacker is blocked", () => {
        const state = position({
            attackers: [{ power: 6, toughness: 4 }],
            blockers: [{ power: 1, toughness: 1 }],
            blocks: { 0: 0 },
            defenderLife: 3,
        });
        expect(lethalUnblockedDelta(state, DEFENDER)).toBe(0);
    });

    it("is zero for an attacker aimed at a planeswalker (CR 508.1a) — its damage never reaches the player's life", () => {
        const state = position({
            attackers: [{ power: 6, toughness: 4 }],
            defenderLife: 3,
            atPlaneswalker: { 0: true },
        });
        expect(lethalUnblockedDelta(state, DEFENDER)).toBe(0);
    });

    it("is zero for a viewer who is neither the attacker nor the defender", () => {
        const state = position({
            attackers: [{ power: 6, toughness: 4 }],
            defenderLife: 3,
        });
        expect(lethalUnblockedDelta(state, "spectator")).toBe(0);
    });
});

describe("the term's effect on its two call sites (issue #1489)", () => {
    it("evaluate: identical before, WIN_SCORE apart after", () => {
        const noBlock = position({
            attackers: Array.from({ length: 4 }, () => ({
                power: 6,
                toughness: 4,
            })),
            blockers: [{ power: 2, toughness: 2 }],
            defenderLife: 20,
        });
        const chump = position({
            attackers: Array.from({ length: 4 }, () => ({
                power: 6,
                toughness: 4,
            })),
            blockers: [{ power: 2, toughness: 2 }],
            blocks: { 0: 0 },
            defenderLife: 20,
        });
        // The measured defect: everything EXCEPT the new term scores the two
        // moves identically, so the difference is exactly the term.
        expect(evaluate(chump, DEFENDER) - evaluate(noBlock, DEFENDER)).toBe(
            WIN_SCORE
        );
    });

    it("declaredBlockDelta: the block-quality tie-break now prefers surviving", () => {
        const noBlock = position({
            attackers: Array.from({ length: 4 }, () => ({
                power: 6,
                toughness: 4,
            })),
            blockers: [{ power: 2, toughness: 2 }],
            defenderLife: 20,
        });
        const chump = position({
            attackers: Array.from({ length: 4 }, () => ({
                power: 6,
                toughness: 4,
            })),
            blockers: [{ power: 2, toughness: 2 }],
            blocks: { 0: 0 },
            defenderLife: 20,
        });
        // Pre-fix these were −192 (die) vs −312 (live): the lethality-blind,
        // linear life clause rated dying HIGHER.
        expect(declaredBlockDelta(chump, DEFENDER)).toBeGreaterThan(
            declaredBlockDelta(noBlock, DEFENDER)
        );
    });

    it("leaves a non-lethal block's valuation untouched", () => {
        // Same shape, but the defender is at 40: nothing is lethal, so the
        // term contributes exactly zero at both call sites.
        const noBlock = position({
            attackers: Array.from({ length: 4 }, () => ({
                power: 6,
                toughness: 4,
            })),
            blockers: [{ power: 2, toughness: 2 }],
            defenderLife: 40,
        });
        expect(lethalUnblockedDelta(noBlock, DEFENDER)).toBe(0);
        // −24 face damage x W_LIFE(8), no creature dies: the pre-fix value.
        expect(declaredBlockDelta(noBlock, DEFENDER)).toBe(-192);
    });
});
