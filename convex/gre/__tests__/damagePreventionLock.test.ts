// The GAME-scoped anti-prevention lock (CR 615.12, issue #3303) — Stomp's
// "Damage can't be prevented this turn".
//
// The third and bluntest of the engine's three anti-prevention shapes, and the
// tests below are organised around what separates it from the other two:
//
//   - SOURCE-scoped, continuous, combat-only: the
//     `combat-damage-unpreventable` static (Questing Beast, `eld/green.ts`).
//   - TARGET-scoped, turn-scoped: Whippoorwill's `damageLockThisTurn` flag —
//     `damageLock.test.ts` is its suite, and this file deliberately mirrors its
//     per-sink structure so the two can be read side by side.
//   - GAME-scoped, turn-scoped: this one. No source, no recipient, no duration
//     but the turn — so every sink must honour it, and the must-NOT rows are
//     the ones that matter: redirection is NOT prevention (CR 614.9), and an
//     unspent shield stays unspent (CR 615.12's last sentence).

import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup";
import { crawWurm } from "../../cards/sets/lea/green";
import { lightningBolt } from "../../cards/sets/lea/red";
import { harshJudgment } from "../../cards/sets/inv/white";
import { projectPublicState } from "../../gameProjections";
import {
    dealDamageFromPermanentToPlayer,
    resolveTopOfStack,
    type GameState,
} from "../state";
import { applyAllCombatDamage, finalizeCleanup } from "../phases";
import { compactState, expandState } from "../serialize";

/** A bear for p2 and a Bolt-caster for p1, with the game-scoped lock already
 *  up (Stomp resolved earlier this turn). `setup` seeds whatever prevention
 *  effect the case is about. */
function lockedGame(setup: (state: GameState) => void = () => {}): GameState {
    const bear = makeInstance(crawWurm.id, {
        id: "bear",
        controllerId: "p2",
        ownerId: "p2",
    });
    const state = makeState({
        players: [makePlayer("p1"), makePlayer("p2", { battlefield: [bear] })],
    });
    state.damageUnpreventableThisTurn = true;
    setup(state);
    return state;
}

/** Casts Lightning Bolt from p1 at `target` and resolves it. */
function castBolt(
    state: GameState,
    target: { type: "permanent" | "player"; id: string }
): void {
    pushSpell(state, lightningBolt.id, "p1", [target]);
    resolveTopOfStack(state);
}

const bearOf = (state: GameState) =>
    state.players[1].battlefield.find((c) => c.id === "bear")!;

// ---------------------------------------------------------------------------
// The four damage sinks
// ---------------------------------------------------------------------------

describe("game-scoped damage lock — the four sinks (CR 615.12)", () => {
    it("the spell/ability sink: a target prevention shield stops nothing", () => {
        const state = lockedGame((s) => {
            s.targetPreventionShields = [
                {
                    targetType: "permanent",
                    targetId: "bear",
                    remaining: 100,
                    duration: { phase: "end-of-turn" },
                },
            ];
        });
        castBolt(state, { type: "permanent", id: "bear" });
        expect(bearOf(state).damageMarked).toBe(3);
    });

    it("CR 615.12 — the unspent shield is NOT consumed by the unpreventable damage", () => {
        const state = lockedGame((s) => {
            s.targetPreventionShields = [
                {
                    targetType: "permanent",
                    targetId: "bear",
                    remaining: 5,
                    duration: { phase: "end-of-turn" },
                },
            ];
        });
        castBolt(state, { type: "permanent", id: "bear" });
        expect(state.targetPreventionShields?.[0]?.remaining).toBe(5);
    });

    it("the same shield DOES prevent the damage without the lock (the contrast case)", () => {
        const state = lockedGame((s) => {
            s.damageUnpreventableThisTurn = undefined;
            s.targetPreventionShields = [
                {
                    targetType: "permanent",
                    targetId: "bear",
                    remaining: 100,
                    duration: { phase: "end-of-turn" },
                },
            ];
        });
        castBolt(state, { type: "permanent", id: "bear" });
        expect(bearOf(state).damageMarked).toBeUndefined();
    });

    it("the player sink: a player prevention shield stops nothing", () => {
        const state = lockedGame((s) => {
            s.targetPreventionShields = [
                {
                    targetType: "player",
                    targetId: "p2",
                    remaining: 100,
                    duration: { phase: "end-of-turn" },
                },
            ];
        });
        castBolt(state, { type: "player", id: "p2" });
        expect(state.players[1].life).toBe(17);
    });

    it("the permanent-source player sink honours it too (CR 120.1)", () => {
        const state = lockedGame((s) => {
            s.targetPreventionShields = [
                {
                    targetType: "player",
                    targetId: "p2",
                    remaining: 100,
                    duration: { phase: "end-of-turn" },
                },
            ];
        });
        dealDamageFromPermanentToPlayer(state, bearOf(state), "p2", "p2", 2);
        expect(state.players[1].life).toBe(18);
    });

    it("the combat sink: a Fog stops nothing while the lock is up (CR 615)", () => {
        const state = combatBoard((s) => {
            s.preventAllCombatDamageThisTurn = true;
            s.damageUnpreventableThisTurn = true;
        });
        applyAllCombatDamage(state, { atk: { blocker: 3 } });
        expect(
            state.players[1].battlefield.find((c) => c.id === "blocker")!
                .damageMarked
        ).toBe(3);
    });

    it("the same Fog stops that combat damage without the lock (the contrast case)", () => {
        const state = combatBoard((s) => {
            s.preventAllCombatDamageThisTurn = true;
        });
        applyAllCombatDamage(state, { atk: { blocker: 3 } });
        expect(
            state.players[1].battlefield.find((c) => c.id === "blocker")!
                .damageMarked
        ).toBeUndefined();
    });
});

/** An attacker for p1 blocked by a p2 creature, ready for a combat-damage
 *  step. `setup` arms whatever this case is about. */
function combatBoard(setup: (state: GameState) => void): GameState {
    const atk = makeInstance(crawWurm.id, {
        id: "atk",
        controllerId: "p1",
        ownerId: "p1",
        isAttacking: true,
    });
    const blocker = makeInstance(crawWurm.id, {
        id: "blocker",
        controllerId: "p2",
        ownerId: "p2",
        isBlocking: true,
    });
    const state = makeState({
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", { battlefield: [atk] }),
            makePlayer("p2", { battlefield: [blocker] }),
        ],
        combat: {
            attackerIds: ["atk"],
            confirmed: true,
            blockerAssignments: { blocker: ["atk"] },
            blockersConfirmed: true,
        },
    });
    setup(state);
    return state;
}

// ---------------------------------------------------------------------------
// The must-NOT rows
// ---------------------------------------------------------------------------

describe("game-scoped damage lock — what it deliberately does NOT do", () => {
    it("CR 614.9 — a REDIRECTION still redirects: 'can't be prevented' is not 'can't be redirected'", () => {
        // Harsh Judgment (mode: red) under p2 sends a red source's damage back
        // at its controller — the same board `damageLock.test.ts` runs the CR
        // 614 funnel on, cast here through the real spell sink so the GAME flag
        // is read where a card would read it. Whippoorwill's lock would stop
        // this redirect (its Oracle sentence carries the CR 614.9 clause too);
        // Stomp's must not.
        const state = lockedGame((s) => {
            s.players[1].battlefield.push(
                makeInstance(harshJudgment.id, {
                    id: "hj",
                    controllerId: "p2",
                    ownerId: "p2",
                    chosenModeId: "R",
                })
            );
        });
        castBolt(state, { type: "player", id: "p2" });
        expect(state.players[1].life).toBe(20);
        expect(state.players[0].life).toBe(17);
    });
});

// ---------------------------------------------------------------------------
// Lifetime and transport
// ---------------------------------------------------------------------------

describe("game-scoped damage lock lifetime (CR 514.2)", () => {
    it("is cleared at CLEANUP, and the shield works again on the next turn", () => {
        const state = lockedGame((s) => {
            s.targetPreventionShields = [
                {
                    targetType: "permanent",
                    targetId: "bear",
                    remaining: 100,
                    duration: { phase: "end-of-turn" },
                },
            ];
        });
        // The global-flag clear is gated on the CLEANUP step itself (CR 514.2 —
        // `finalizeCleanup` reads the phase, so an END_STEP call must not wipe
        // a flag a Fog cast in that window still owns).
        state.phase = "CLEANUP";
        finalizeCleanup(state);
        expect(state.damageUnpreventableThisTurn).toBeUndefined();
        // Re-arm the shield the CLEANUP boundary also expired, then prove the
        // NEXT turn's damage is preventable again — the lock is a turn effect,
        // not a permanent change to the damage pipeline.
        state.targetPreventionShields = [
            {
                targetType: "permanent",
                targetId: "bear",
                remaining: 100,
                duration: { phase: "end-of-turn" },
            },
        ];
        castBolt(state, { type: "permanent", id: "bear" });
        expect(bearOf(state).damageMarked).toBeUndefined();
    });

    it("survives a compact → expand round-trip (it must outlive a stable point)", () => {
        const state = lockedGame();
        const round = expandState(compactState(state));
        expect(round.damageUnpreventableThisTurn).toBe(true);
    });

    it("the damage it lets through is visible on the wire", () => {
        const state = lockedGame((s) => {
            s.targetPreventionShields = [
                {
                    targetType: "permanent",
                    targetId: "bear",
                    remaining: 100,
                    duration: { phase: "end-of-turn" },
                },
            ];
        });
        castBolt(state, { type: "permanent", id: "bear" });
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[1].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(slim.damageMarked).toBe(3);
    });
});
