// Anti-prevention / anti-redirection damage locks (CR 615.12 / 614.9 /
// 702.16e, issue #2231).
//
// Two Oracle clauses that always travel together — "damage … can't be prevented
// or dealt instead to another permanent or player" — but under two different CR
// chapters with different override semantics, at two different scopes:
//
//   - SPELL-scoped, one-shot: Lava Burst's rider, conditional on the target
//     being a creature. Two independent `dealDamage` Op fields, because kicked
//     Urza's Rage wants the prevention half WITHOUT the redirection half.
//   - TARGET-scoped, turn-scoped: Whippoorwill's `damageLockThisTurn` flag,
//     source-agnostic (combat damage included) and long-lived.
//
// The tests below are derived from the PRODUCER CENSUS of everything that can
// alter a damage event — one row per class, INCLUDING the must-NOT rows (a
// redirect must still redirect merely-unpreventable damage; an amount rewrite
// that never says "prevent" must survive both locks).

import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup";
import { crawWurm } from "../../cards/sets/lea/green";
import { lightningBolt } from "../../cards/sets/lea/red";
import { lavaBurst } from "../../cards/sets/ice/red";
import { whippoorwill } from "../../cards/sets/drk/green";
import { callousGiant, urzasRage } from "../../cards/sets/inv/red";
import { divinePresence, harshJudgment } from "../../cards/sets/inv/white";
import { lashknifeBarrier } from "../../cards/sets/pls/white";
import { projectPublicState } from "../../gameProjections";
import { runDamageReplacement, resolveTopOfStack } from "../state";
import { applyAllCombatDamage, finalizeCleanup } from "../phases";
import type { GameState } from "../state";
import type { TargetSelection } from "../../cards/types";
import { compactState, expandState } from "../serialize";

/** Casts Lava Burst at `target` with X = `x` and resolves it. */
function castLavaBurst(
    state: GameState,
    x: number,
    target: TargetSelection
): void {
    const item = pushSpell(state, lavaBurst.id, "p1", [target]);
    item.chosenX = x;
    resolveTopOfStack(state);
}

/** Resolves Whippoorwill's activated ability at `targetId`, arming all three of
 *  its turn-scoped flags on that creature. */
function activateWhippoorwill(
    state: GameState,
    whipId: string,
    targetId: string
): void {
    const act = pushSpell(state, whippoorwill.id, "p1", [
        { type: "permanent", id: targetId },
    ]);
    act.abilityId = "whippoorwill-doom";
    act.id = whipId;
    resolveTopOfStack(state);
}

// ---------------------------------------------------------------------------
// Lava Burst — the spell-scoped, creature-conditional lock
// ---------------------------------------------------------------------------

describe("Lava Burst rider (CR 615.12 / 614.9 / 702.16e)", () => {
    it("beats a CR 615.1 target prevention shield on a creature", () => {
        const bear = makeInstance(crawWurm.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
            targetPreventionShields: [
                {
                    targetType: "permanent",
                    targetId: "bear",
                    remaining: 100,
                    duration: { phase: "end-of-turn" },
                },
            ],
        });
        castLavaBurst(state, 3, { type: "permanent", id: "bear" });
        expect(
            state.players[1].battlefield.find((c) => c.id === "bear")!
                .damageMarked
        ).toBe(3);
        // CR 615.12 — "existing damage prevention shields won't be reduced by
        // damage that can't be prevented": the shield is skipped, not spent.
        expect(state.targetPreventionShields?.[0].remaining).toBe(100);
    });

    it("beats protection from red on a creature (CR 702.16e is prevention)", () => {
        const bear = makeInstance(crawWurm.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
            staticAbilities: ["protection from red"],
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        castLavaBurst(state, 3, { type: "permanent", id: "bear" });
        expect(
            state.players[1].battlefield.find((c) => c.id === "bear")!
                .damageMarked
        ).toBe(3);
    });

    it("beats a CR 614.9 transient redirect shield (Mirrorwood Treefolk)", () => {
        const bear = makeInstance(crawWurm.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
            damageRedirections: [
                {
                    kind: "from-source-to-permanent-redirect",
                    targetInstanceId: "bear",
                    redirectTo: { type: "player", id: "p1" },
                    remaining: 1,
                    duration: { phase: "end-of-turn" },
                },
            ],
        });
        castLavaBurst(state, 3, { type: "permanent", id: "bear" });
        expect(
            state.players[1].battlefield.find((c) => c.id === "bear")!
                .damageMarked
        ).toBe(3);
        expect(state.players[0].life).toBe(20); // nothing landed on p1
        // CR 614.9 — the redirect "does nothing"; its charge is not spent.
        const shield = state.damageRedirections?.[0];
        expect(shield?.kind).toBe("from-source-to-permanent-redirect");
        expect(
            shield && "remaining" in shield ? shield.remaining : undefined
        ).toBe(1);
    });

    it("does NOT lock damage aimed at a player — a shield still prevents it", () => {
        const state = makeState({
            targetPreventionShields: [
                {
                    targetType: "player",
                    targetId: "p2",
                    remaining: 100,
                    duration: { phase: "end-of-turn" },
                },
            ],
        });
        castLavaBurst(state, 6, { type: "player", id: "p2" });
        expect(state.players[1].life).toBe(20);
    });

    it("an amount-rewriting replacement that never says 'prevent' still applies", () => {
        // Divine Presence clamps 4+ to 3 (CR 614) — neither prevention nor
        // redirection, so the lock leaves it alone. This is the must-NOT row:
        // a wholesale skip of the CR 614 loop would read as 5 here.
        const dp = makeInstance(divinePresence.id, {
            id: "dp",
            controllerId: "p2",
            ownerId: "p2",
        });
        const bear = makeInstance(crawWurm.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [dp, bear] }),
            ],
        });
        castLavaBurst(state, 5, { type: "permanent", id: "bear" });
        expect(
            state.players[1].battlefield.find((c) => c.id === "bear")!
                .damageMarked
        ).toBe(3);
    });

    it("a permanent-bound PREVENTION replacement is suppressed (Callous Giant)", () => {
        const giant = makeInstance(callousGiant.id, {
            id: "giant",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [giant] }),
            ],
        });
        castLavaBurst(state, 2, { type: "permanent", id: "giant" });
        expect(
            state.players[1].battlefield.find((c) => c.id === "giant")!
                .damageMarked
        ).toBe(2);
    });

    it("a permanent-bound 'other' replacement still applies (Lashknife Barrier)", () => {
        const barrier = makeInstance(lashknifeBarrier.id, {
            id: "barrier",
            controllerId: "p2",
            ownerId: "p2",
        });
        const bear = makeInstance(crawWurm.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [barrier, bear] }),
            ],
        });
        castLavaBurst(state, 3, { type: "permanent", id: "bear" });
        expect(
            state.players[1].battlefield.find((c) => c.id === "bear")!
                .damageMarked
        ).toBe(2); // 3 minus 1, unaffected by the lock
    });
});

// ---------------------------------------------------------------------------
// The two locks are INDEPENDENT — the regression row
// ---------------------------------------------------------------------------

describe("unpreventable vs unredirectable are independent (CR 615.12 vs 614.9)", () => {
    /** Builds a board with Harsh Judgment (chosen: red) under p2, and a red
     *  Sorcery on the stack as the damage source, then runs the CR 614 funnel
     *  directly with the given locks. */
    function runFunnel(locks: {
        unpreventable: boolean;
        unredirectable: boolean;
    }) {
        const hj = makeInstance(harshJudgment.id, {
            id: "hj",
            controllerId: "p2",
            ownerId: "p2",
            chosenModeId: "R",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [hj] }),
            ],
        });
        const src = pushSpell(state, lavaBurst.id, "p1", []);
        return runDamageReplacement(
            state,
            src.id,
            "p1",
            { type: "player", id: "p2" },
            3,
            false,
            locks.unpreventable,
            locks.unredirectable
        );
    }

    it("a redirect fires on ordinary damage", () => {
        const out = runFunnel({ unpreventable: false, unredirectable: false });
        expect(out?.target).toEqual({ type: "player", id: "p1" });
    });

    it("a redirect STILL fires on merely-unpreventable damage (kicked Urza's Rage)", () => {
        // The trap this guards: gating the permanent-bound `replacementEffects[]`
        // loop on `unpreventable` would silently stop Harsh Judgment here, which
        // CR 614.9 does not license — "can't be prevented" says nothing about
        // being dealt instead to someone else.
        const out = runFunnel({ unpreventable: true, unredirectable: false });
        expect(out?.target).toEqual({ type: "player", id: "p1" });
    });

    it("a redirect is suppressed by unredirectable alone", () => {
        const out = runFunnel({ unpreventable: false, unredirectable: true });
        expect(out?.target).toEqual({ type: "player", id: "p2" });
    });
});

describe("Urza's Rage — unpreventable damage vs protection (CR 702.16e)", () => {
    it("kicked damage is dealt through protection from red", () => {
        const bear = makeInstance(crawWurm.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
            staticAbilities: ["protection from red"],
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        const item = pushSpell(state, urzasRage.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        item.kickerPayments = { kicker: 1 };
        resolveTopOfStack(state);
        // 10 damage on a 6/4 is lethal, so the proof is that it DIED — under
        // the old unconditional protection check nothing was marked at all and
        // the Craw Wurm stayed on the battlefield.
        expect(state.players[1].battlefield.some((c) => c.id === "bear")).toBe(
            false
        );
        expect(state.players[1].graveyard.some((c) => c.id === "bear")).toBe(
            true
        );
    });

    it("UNkicked damage is still prevented by protection from red", () => {
        const bear = makeInstance(crawWurm.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
            staticAbilities: ["protection from red"],
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, urzasRage.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "bear")!
                .damageMarked
        ).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// Whippoorwill — the target-bound, turn-scoped lock
// ---------------------------------------------------------------------------

/** Board: Whippoorwill under p1, a Craw Wurm under p2, lock already armed. */
function lockedBoard(extraP2: ReturnType<typeof makeInstance>[] = []) {
    const whip = makeInstance(whippoorwill.id, {
        id: "whip",
        controllerId: "p1",
        ownerId: "p1",
    });
    const bear = makeInstance(crawWurm.id, {
        id: "bear",
        controllerId: "p2",
        ownerId: "p2",
    });
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [whip] }),
            makePlayer("p2", { battlefield: [bear, ...extraP2] }),
        ],
    });
    activateWhippoorwill(state, "whip", "bear");
    return state;
}

describe("Whippoorwill's turn-scoped damage lock (CR 615.12 / 614.9)", () => {
    it("arms the flag alongside exileOnDeath from the same activation", () => {
        const state = lockedBoard();
        const bear = state.players[1].battlefield.find((c) => c.id === "bear")!;
        expect(bear.damageLockThisTurn).toBe(true);
        expect(bear.exileOnDeath).toBe(true);
    });

    it("beats a prevention shield on damage from an unrelated source", () => {
        const state = lockedBoard();
        state.targetPreventionShields = [
            {
                targetType: "permanent",
                targetId: "bear",
                remaining: 100,
                duration: { phase: "end-of-turn" },
            },
        ];
        pushSpell(state, lightningBolt.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "bear")!
                .damageMarked
        ).toBe(3);
    });

    it("beats a transient redirect aimed away from the locked creature", () => {
        const state = lockedBoard();
        state.damageRedirections = [
            {
                kind: "from-source-to-permanent-redirect",
                targetInstanceId: "bear",
                redirectTo: { type: "player", id: "p1" },
                remaining: 1,
                duration: { phase: "end-of-turn" },
            },
        ];
        pushSpell(state, lightningBolt.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "bear")!
                .damageMarked
        ).toBe(3);
        expect(state.players[0].life).toBe(20);
    });

    it("beats protection on damage from an unrelated source (CR 702.16e)", () => {
        const state = lockedBoard();
        const bear = state.players[1].battlefield.find((c) => c.id === "bear")!;
        bear.staticAbilities = ["protection from red"];
        pushSpell(state, lightningBolt.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "bear")!
                .damageMarked
        ).toBe(3);
    });

    it("a Mirrorwood Treefolk shield on the locked creature cannot move the damage", () => {
        const state = lockedBoard();
        state.damageRedirections = [
            {
                kind: "to-self-redirect-to-owner",
                targetInstanceId: "bear",
                remaining: 100,
                duration: { phase: "end-of-turn" },
            },
        ];
        pushSpell(state, lightningBolt.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "bear")!
                .damageMarked
        ).toBe(3);
        expect(state.players[1].life).toBe(20);
    });

    it("wire format: the flag survives projectPublicState", () => {
        const state = lockedBoard();
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[1].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(slim.damageLockThisTurn).toBe(true);
    });

    it("survives a serialize → deserialize round trip", () => {
        const state = lockedBoard();
        const back = expandState(compactState(state));
        expect(
            back.players[1].battlefield.find((c) => c.id === "bear")!
                .damageLockThisTurn
        ).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Combat damage — the sink Whippoorwill's lock exists for
// ---------------------------------------------------------------------------

describe("the target-bound lock reaches COMBAT damage (CR 510)", () => {
    /** Blocker `bear` (locked) blocks attacker `atk`; runs the damage step. */
    function combatBoard(setup: (state: GameState) => void) {
        const whip = makeInstance(whippoorwill.id, {
            id: "whip",
            controllerId: "p2",
            ownerId: "p2",
        });
        const atk = makeInstance(crawWurm.id, {
            id: "atk",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const bear = makeInstance(crawWurm.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
            isBlocking: true,
        });
        const state = makeState({
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            players: [
                makePlayer("p1", { battlefield: [atk] }),
                makePlayer("p2", { battlefield: [whip, bear] }),
            ],
            combat: {
                attackerIds: ["atk"],
                confirmed: true,
                blockerAssignments: { bear: ["atk"] },
                blockersConfirmed: true,
            },
        });
        // Whippoorwill's controller arms the lock on their OWN blocker so the
        // attacker's combat damage can't be Fogged or redirected away.
        const act = pushSpell(state, whippoorwill.id, "p2", [
            { type: "permanent", id: "bear" },
        ]);
        act.abilityId = "whippoorwill-doom";
        act.id = "whip";
        resolveTopOfStack(state);
        setup(state);
        return state;
    }

    it("combat damage to the locked creature ignores a prevention shield", () => {
        const state = combatBoard((s) => {
            s.targetPreventionShields = [
                {
                    targetType: "permanent",
                    targetId: "bear",
                    remaining: 100,
                    duration: { phase: "end-of-turn" },
                },
            ];
        });
        applyAllCombatDamage(state, { atk: { bear: 3 } });
        expect(
            state.players[1].battlefield.find((c) => c.id === "bear")!
                .damageMarked
        ).toBe(3);
    });

    it("combat damage to the locked creature ignores a redirect shield", () => {
        const state = combatBoard((s) => {
            s.damageRedirections = [
                {
                    kind: "from-source-to-permanent-redirect",
                    targetInstanceId: "bear",
                    redirectTo: { type: "player", id: "p2" },
                    remaining: 1,
                    duration: { phase: "end-of-turn" },
                },
            ];
        });
        applyAllCombatDamage(state, { atk: { bear: 3 } });
        expect(
            state.players[1].battlefield.find((c) => c.id === "bear")!
                .damageMarked
        ).toBe(3);
        expect(state.players[1].life).toBe(20);
    });

    it("a Fog still stops combat damage to an UNLOCKED creature on the same board", () => {
        const state = combatBoard((s) => {
            s.preventAllCombatDamageThisTurn = true;
        });
        // Un-arm the lock: the same Fog must now work, proving the previous
        // assertions turn on the flag rather than on the combat wiring.
        const bear = state.players[1].battlefield.find((c) => c.id === "bear")!;
        bear.damageLockThisTurn = undefined;
        applyAllCombatDamage(state, { atk: { bear: 3 } });
        expect(
            state.players[1].battlefield.find((c) => c.id === "bear")!
                .damageMarked
        ).toBeUndefined();
    });

    it("a Fog does NOT stop combat damage to the locked creature", () => {
        const state = combatBoard((s) => {
            s.preventAllCombatDamageThisTurn = true;
        });
        applyAllCombatDamage(state, { atk: { bear: 3 } });
        expect(
            state.players[1].battlefield.find((c) => c.id === "bear")!
                .damageMarked
        ).toBe(3);
    });
});

// ---------------------------------------------------------------------------
// Lifetime
// ---------------------------------------------------------------------------

describe("damage lock lifetime (CR 514.2 / 400.7)", () => {
    it("is cleared at CLEANUP", () => {
        const state = lockedBoard();
        finalizeCleanup(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "bear")!
                .damageLockThisTurn
        ).toBeUndefined();
    });
});
