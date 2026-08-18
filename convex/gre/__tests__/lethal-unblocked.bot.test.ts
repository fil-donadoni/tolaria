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
 * defending player), CR 615 (prevention), CR 615.12 (unpreventable damage),
 * 704.5a (a player at 0 or less life loses).
 */

import { describe, it, expect } from "vitest";
import {
    WIN_SCORE,
    evaluate,
    lethalUnblockedDelta,
    declaredBlockDelta,
} from "../evaluate";
import { blockDeltaOf } from "../search";
import { applyAllCombatDamage } from "../phases";
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

    // --- Review regressions (PR #1498). Each of these FIRED at ∓WIN_SCORE
    // before the guards, i.e. each was a live violation of the ADR 0070 §5
    // "exactly zero off-pattern" property the term's admission rests on.

    it("is zero after the damage step — `state.combat` survives it, so the term must not re-count damage already dealt", () => {
        // 4 x 6/4 unblocked into 30: the attack is NOT lethal (30 − 24 = 6).
        // `state.combat` (confirmed + blockersConfirmed + attackerIds) is torn
        // down only as END_OF_COMBAT ends (`endCombatStep`, CR 511.3), so at
        // both post-damage priority windows the pre-guard term compared the
        // same 24 damage against the ALREADY-REDUCED life of 6 and returned
        // −WIN_SCORE for a defender that is comfortably alive.
        const state = position({
            attackers: Array.from({ length: 4 }, () => ({
                power: 6,
                toughness: 4,
            })),
            defenderLife: 30,
        });
        expect(lethalUnblockedDelta(state, DEFENDER)).toBe(0); // pre-damage: survivable
        // Damage applied: life drops, combat state persists.
        state.players[1].life = 6;
        for (const phase of ["COMBAT_DAMAGE", "END_OF_COMBAT"] as const) {
            state.phase = phase;
            expect(lethalUnblockedDelta(state, DEFENDER)).toBe(0);
            expect(lethalUnblockedDelta(state, ATTACKER)).toBe(0);
        }
    });

    it("is zero outside DECLARE_BLOCKERS generally — the term's whole support window", () => {
        const state = position({
            attackers: [{ power: 6, toughness: 4 }],
            defenderLife: 3,
        });
        for (const phase of [
            "DECLARE_ATTACKERS",
            "FIRST_STRIKE_DAMAGE",
            "COMBAT_DAMAGE",
            "END_OF_COMBAT",
            "POSTCOMBAT_MAIN",
            "END_STEP",
        ] as const) {
            state.phase = phase;
            expect(lethalUnblockedDelta(state, DEFENDER)).toBe(0);
        }
    });

    it("is zero for an attacker recorded in `blockedAttackerIds` whose blocker has since left (CR 509.1h)", () => {
        // Blocks were locked in, then the blocker was removed. The attacker is
        // STILL blocked and deals nothing to the player — the damage step reads
        // exactly this list. Reading `blockerAssignments` alone counted its
        // full 6 power into 3 life → false −WIN_SCORE.
        const state = position({
            attackers: [{ power: 6, toughness: 4 }],
            defenderLife: 3,
        });
        state.combat!.blockedAttackerIds = ["a0"];
        expect(lethalUnblockedDelta(state, DEFENDER)).toBe(0);
        expect(lethalUnblockedDelta(state, ATTACKER)).toBe(0);
    });

    it("is zero under a resolved Fog — `preventAllCombatDamageThisTurn` (CR 615)", () => {
        const state = position({
            attackers: Array.from({ length: 4 }, () => ({
                power: 6,
                toughness: 4,
            })),
            defenderLife: 20,
        });
        expect(lethalUnblockedDelta(state, DEFENDER)).toBe(-WIN_SCORE);
        state.preventAllCombatDamageThisTurn = true;
        expect(lethalUnblockedDelta(state, DEFENDER)).toBe(0);
        expect(lethalUnblockedDelta(state, ATTACKER)).toBe(0);
    });

    it("skips attackers covered by a source-scoped prevention shield (CR 510.1c / 615)", () => {
        const state = position({
            attackers: Array.from({ length: 4 }, () => ({
                power: 6,
                toughness: 4,
            })),
            defenderLife: 20,
        });
        // One of the four assigns nothing → 18 into 20, no longer lethal.
        state.sourcePreventionShields = [
            { sourceIds: ["a0"], combatOnly: true },
        ];
        expect(lethalUnblockedDelta(state, DEFENDER)).toBe(0);
        // Silenced down to two attackers is likewise nothing (12 into 20).
        state.sourcePreventionShields = [
            { sourceIds: ["a0", "a1"], combatOnly: true },
        ];
        expect(lethalUnblockedDelta(state, DEFENDER)).toBe(0);
    });

    it("skips attackers shielded by `combatDamageImmunity` (CR 615, Ebony Horse)", () => {
        const state = position({
            attackers: Array.from({ length: 4 }, () => ({
                power: 6,
                toughness: 4,
            })),
            defenderLife: 20,
        });
        state.combatDamageImmunity = [
            { instanceId: "a0", duration: { phase: "end-of-turn" } },
        ];
        expect(lethalUnblockedDelta(state, DEFENDER)).toBe(0);
    });

    it("declines to claim lethality while an unspent per-player prevention shield is live (CR 615.1)", () => {
        const state = position({
            attackers: Array.from({ length: 4 }, () => ({
                power: 6,
                toughness: 4,
            })),
            defenderLife: 20,
        });
        state.playerDamagePrevention = [
            {
                playerId: DEFENDER,
                match: {},
                mode: "all",
                remaining: 1,
                duration: { phase: "end-of-turn" },
            },
        ];
        expect(lethalUnblockedDelta(state, DEFENDER)).toBe(0);
        // A shield belonging to the OTHER player is irrelevant — still on-pattern.
        state.playerDamagePrevention = [
            {
                playerId: ATTACKER,
                match: {},
                mode: "all",
                remaining: 1,
                duration: { phase: "end-of-turn" },
            },
        ];
        expect(lethalUnblockedDelta(state, DEFENDER)).toBe(-WIN_SCORE);
    });
});

describe("the term's TWO wiring seams, counted once each (issue #1489)", () => {
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

    it("blockDeltaOf: the ROOT block-quality tie-break now prefers surviving", () => {
        // `blockDeltaOf` (search.ts) is the lens `selectRootMove` ranks
        // candidate blocks by. It is where the term is folded for the tie-break
        // — NOT inside `declaredBlockDelta`, see the double-count guard below.
        const pre = () =>
            position({
                attackers: Array.from({ length: 4 }, () => ({
                    power: 6,
                    toughness: 4,
                })),
                blockers: [{ power: 2, toughness: 2 }],
                defenderLife: 20,
                blockersConfirmed: false,
            });
        const noBlock = blockDeltaOf(
            pre(),
            { kind: "declare-blockers", assignments: [] },
            DEFENDER
        );
        const chump = blockDeltaOf(
            pre(),
            {
                kind: "declare-blockers",
                assignments: [{ blockerId: "b0", attackerId: "a0" }],
            },
            DEFENDER
        );
        // Pre-fix these were −192 (die) vs −312 (live): the lethality-blind,
        // linear life clause rated dying HIGHER.
        expect(chump).toBeGreaterThan(noBlock);
        expect(noBlock).toBeLessThan(-WIN_SCORE / 2);
    });

    it("declaredBlockDelta is term-FREE, so `policyValue`'s evaluate + declaredBlockDelta sum cannot double it", () => {
        // The third, undeclared consumer: `policyValue` (search.ts) returns
        // `evaluate(probe) + declaredBlockDelta(probe)`. With the term inside
        // BOTH the rollout default policy saw ±2·WIN_SCORE. It now lives in
        // `evaluate` and in `blockDeltaOf`, never in `declaredBlockDelta`.
        const lethal = position({
            attackers: Array.from({ length: 4 }, () => ({
                power: 6,
                toughness: 4,
            })),
            blockers: [{ power: 2, toughness: 2 }],
            defenderLife: 20,
        });
        expect(lethalUnblockedDelta(lethal, DEFENDER)).toBe(-WIN_SCORE);
        // −24 face damage x W_LIFE(8), no creature dies — the pre-term value.
        expect(declaredBlockDelta(lethal, DEFENDER)).toBe(-192);
        // The policy sum therefore carries exactly ONE WIN_SCORE, not two.
        const policySum =
            evaluate(lethal, DEFENDER) + declaredBlockDelta(lethal, DEFENDER);
        expect(policySum).toBeGreaterThan(-2 * WIN_SCORE);
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

// ---------------------------------------------------------------------------
// The Fog x source-side unpreventable combat damage (CR 615 / 615.12, #2395)
// ---------------------------------------------------------------------------
//
// `declaredFaceDamage` skips its blanket `preventAllCombatDamageThisTurn`
// return whenever `anyCombatDamageUnpreventableStatic` is true — and that
// helper is BOARD-WIDE, so an OPPONENT's Questing Beast disables it just as
// the term's own controller's does. The engine has no such hole: it re-asks
// per damage event (`applyOneCombatDamage`, phases.ts). Each case below pins
// the mirror against the engine's own answer for the same position.
describe("declaredFaceDamage mirrors the engine's per-attacker Fog (CR 615.12)", () => {
    /** p1 attacks unblocked; `beastController` seats a Questing Beast (never
     *  attacking — it only has to be on a battlefield for the board-wide
     *  static scan to see it). A Fog is up. */
    function fogAndABeast(beastController: string) {
        const state = position({
            attackers: [{ power: 2, toughness: 2 }],
            defenderLife: 2,
        });
        const beast = makeInstance(getCardByName("Questing Beast").id, {
            id: "qb",
            controllerId: beastController,
            ownerId: beastController,
        });
        const seat = state.players.find((p) => p.id === beastController)!;
        seat.battlefield.push(beast);
        state.preventAllCombatDamageThisTurn = true;
        return state;
    }

    const lifeOf = (s: GameState, id: string) =>
        s.players.find((p) => p.id === id)!.life;

    it("stays EXACTLY ZERO when the Beast belongs to the DEFENDER", () => {
        // The Fog still stops p1's 2/2 — the Beast grants "can't be prevented"
        // only to creatures ITS controller controls, and p2 is not attacking.
        const state = fogAndABeast(DEFENDER);
        expect(lethalUnblockedDelta(state, ATTACKER)).toBe(0);
        expect(lethalUnblockedDelta(state, DEFENDER)).toBe(0);
        // ...and that is what the engine does with the identical position.
        applyAllCombatDamage(state, {});
        expect(lifeOf(state, DEFENDER)).toBe(2);
    });

    it("still sees lethal when the Beast belongs to the ATTACKER", () => {
        // Same Fog, same 2/2 — but now its controller has the immunity, so the
        // damage connects and the defender dies. The term must NOT be zeroed.
        const state = fogAndABeast(ATTACKER);
        expect(lethalUnblockedDelta(state, ATTACKER)).toBe(WIN_SCORE);
        expect(lethalUnblockedDelta(state, DEFENDER)).toBe(-WIN_SCORE);
        applyAllCombatDamage(state, {});
        expect(lifeOf(state, DEFENDER)).toBe(0);
    });
});
