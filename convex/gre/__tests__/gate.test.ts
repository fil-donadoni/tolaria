// The single Expected Input gate (ADR 0047, issue #799). `assertExpectedInput`
// is the exact function every public game mutation in `convex/game.ts` calls
// — once, before its action-specific validation — to answer "is this the right
// moment, from the right player, for this kind of input?". The project has no
// convex-test harness (ADR 0001), so these tests drive that shared gate
// function directly: it is the seam the mutations delegate to, so exercising it
// is equivalent to exercising the rejection through every mutation that routes
// through it. Each Expected Input variant is checked for a legal pass, a
// wrong-state rejection, and a wrong-player rejection.

import { describe, expect, it } from "vitest";
import { assertExpectedInput, refreshExpectedInput } from "../expectedInput";
import { makeState } from "../../cards/__tests__/setup";
import { projectPublicState } from "../../gameProjections";
import type { GameState, PendingChoice } from "../state";

/** Builds a minimal combat block that has declared attackers. */
function combatWithAttackers(
    overrides: Partial<NonNullable<GameState["combat"]>> = {}
): NonNullable<GameState["combat"]> {
    return {
        attackerIds: ["atk1"],
        confirmed: true,
        blockerAssignments: {},
        blockersConfirmed: false,
        ...overrides,
    };
}

const mayPayChoice: PendingChoice = {
    stackItemId: "s1",
    step: 0,
    choiceId: "p2",
    playerId: "p2",
    kind: "may-pay",
    count: 1,
    prompt: "Pay?",
};

describe("assertExpectedInput — priority variant (CR 117)", () => {
    it("admits the priority holder", () => {
        const state = makeState({ priorityPlayerId: "p1" });
        expect(() =>
            assertExpectedInput(state, {
                playerId: "p1",
                expect: "priority",
            })
        ).not.toThrow();
    });

    it("wrong player: rejects a non-priority player acting", () => {
        const state = makeState({ priorityPlayerId: "p1" });
        expect(() =>
            assertExpectedInput(state, {
                playerId: "p2",
                expect: "priority",
            })
        ).toThrow(/waiting for priority input from another player/i);
    });

    it("wrong state: rejects a priority action while a choice is open (casting into a Pending Choice)", () => {
        const state = makeState({
            priorityPlayerId: "p1",
            pendingChoices: [mayPayChoice],
        });
        expect(() =>
            assertExpectedInput(state, {
                playerId: "p1",
                expect: "priority",
            })
        ).toThrow(/waiting for choice input, not priority/i);
    });
});

describe("assertExpectedInput — choice variant (CR 608.2)", () => {
    it("admits the awaited chooser", () => {
        const state = makeState({ pendingChoices: [mayPayChoice] });
        expect(() =>
            assertExpectedInput(state, { playerId: "p2", expect: "choice" })
        ).not.toThrow();
    });

    it("wrong player: rejects a choice submitted by the other player", () => {
        const state = makeState({ pendingChoices: [mayPayChoice] });
        expect(() =>
            assertExpectedInput(state, { playerId: "p1", expect: "choice" })
        ).toThrow(/waiting for choice input from another player/i);
    });

    it("wrong state: rejects a choice submission when no choice is open", () => {
        const state = makeState({ priorityPlayerId: "p1" });
        expect(() =>
            assertExpectedInput(state, { playerId: "p1", expect: "choice" })
        ).toThrow(/waiting for priority input, not choice/i);
    });
});

describe("assertExpectedInput — target variant (CR 601.2c)", () => {
    const withTarget = () =>
        makeState({
            priorityPlayerId: "p1",
            pendingTarget: {
                playerId: "p1",
                cardInstanceId: "bolt-1",
                targetType: "Creature",
                count: 1,
                selected: [],
            },
        });

    it("admits the player selecting targets", () => {
        expect(() =>
            assertExpectedInput(withTarget(), {
                playerId: "p1",
                expect: "target",
            })
        ).not.toThrow();
    });

    it("wrong player: rejects target selection from the other player", () => {
        expect(() =>
            assertExpectedInput(withTarget(), {
                playerId: "p2",
                expect: "target",
            })
        ).toThrow(/waiting for target input from another player/i);
    });

    it("wrong state: rejects target selection when none is in progress", () => {
        const state = makeState({ priorityPlayerId: "p1" });
        expect(() =>
            assertExpectedInput(state, { playerId: "p1", expect: "target" })
        ).toThrow(/waiting for priority input, not target/i);
    });
});

describe("assertExpectedInput — blockers variant (CR 509.1)", () => {
    const inDeclareBlockers = () =>
        makeState({
            phase: "DECLARE_BLOCKERS",
            activePlayerId: "p1",
            combat: combatWithAttackers(),
        });

    it("admits the defending player (the declarer)", () => {
        expect(() =>
            assertExpectedInput(inDeclareBlockers(), {
                playerId: "p2",
                expect: "blockers",
            })
        ).not.toThrow();
    });

    it("wrong player: rejects the attacking player declaring blockers (no Melee)", () => {
        expect(() =>
            assertExpectedInput(inDeclareBlockers(), {
                playerId: "p1",
                expect: "blockers",
            })
        ).toThrow(/waiting for blockers input from another player/i);
    });

    it("wrong state: rejects blocker declaration outside a blocker wait", () => {
        const state = makeState({ priorityPlayerId: "p1" });
        expect(() =>
            assertExpectedInput(state, { playerId: "p1", expect: "blockers" })
        ).toThrow(/waiting for priority input, not blockers/i);
    });
});

describe("assertExpectedInput — sacrifice variant (CR 508.1c/1g, attack tax)", () => {
    // Flooded Woodlands parks the attacking player's land sacrifice mid
    // declare-attackers. Driving the shared gate here is equivalent to driving
    // it through every mutation that routes through it: passPriority,
    // announceCast, and selectSacrifice's attack branch. The regression — a
    // parked sacrifice being silently bypassed (endTurn / Pass Turn resolving
    // the attack with no land sacrificed) — is exactly a `priority` action
    // being admitted while the game waits for `sacrifice`; the third case below
    // pins that it is now REJECTED.
    const parked = () =>
        makeState({
            phase: "DECLARE_ATTACKERS",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            combat: combatWithAttackers({
                confirmed: false,
                pendingAttackSacrifice: {
                    playerId: "p1",
                    reason: "Flooded Woodlands",
                    requirements: [{ filter: { types: ["Land"] }, count: 1 }],
                    picked: [],
                },
            }),
        });

    it("admits the attacking player's sacrifice pick", () => {
        expect(() =>
            assertExpectedInput(parked(), {
                playerId: "p1",
                expect: "sacrifice",
            })
        ).not.toThrow();
    });

    it("wrong player: rejects the non-attacking player", () => {
        expect(() =>
            assertExpectedInput(parked(), {
                playerId: "p2",
                expect: "sacrifice",
            })
        ).toThrow(/waiting for sacrifice input from another player/i);
    });

    it("blocks a competing priority action (endTurn / passPriority / cast) while parked", () => {
        expect(() =>
            assertExpectedInput(parked(), {
                playerId: "p1",
                expect: "priority",
            })
        ).toThrow(/waiting for sacrifice input, not priority/i);
    });
});

describe("assertExpectedInput — game over (CR 104.2a)", () => {
    it("rejects any action once the game is over", () => {
        const state = makeState({
            gameOver: { winnerId: "p1", loserId: "p2", reason: "life" },
        });
        expect(() =>
            assertExpectedInput(state, { playerId: "p1", expect: "priority" })
        ).toThrow(/game is over/i);
    });
});

describe("assertExpectedInput — mana-ability may-pay window (CR 608.2g / 605.3b)", () => {
    it("admits the paying player's mana ability during their own may-pay window", () => {
        const state = makeState({ pendingChoices: [mayPayChoice] });
        expect(() =>
            assertExpectedInput(state, {
                playerId: "p2",
                expect: "priority",
                allowManaForMayPay: true,
            })
        ).not.toThrow();
    });

    it("still rejects the other player's mana ability during someone else's may-pay window", () => {
        const state = makeState({ pendingChoices: [mayPayChoice] });
        expect(() =>
            assertExpectedInput(state, {
                playerId: "p1",
                expect: "priority",
                allowManaForMayPay: true,
            })
        ).toThrow(/waiting for choice input, not priority/i);
    });

    it("does not open the window for a non-may-pay choice (keep-permanents freezes priority)", () => {
        const keepChoice: PendingChoice = {
            stackItemId: "s2",
            step: 0,
            choiceId: "p2",
            playerId: "p2",
            kind: "keep-permanents",
            count: 1,
            prompt: "Keep?",
        };
        const state = makeState({ pendingChoices: [keepChoice] });
        expect(() =>
            assertExpectedInput(state, {
                playerId: "p2",
                expect: "priority",
                allowManaForMayPay: true,
            })
        ).toThrow(/waiting for choice input, not priority/i);
    });
});

describe("assertExpectedInput — combat-damage sub-flow (anyPlayer, CR 510)", () => {
    it("skips the player check so a non-priority assigner (banding) may act", () => {
        const state = makeState({
            phase: "COMBAT_DAMAGE",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });
        // The defending player assigns banded damage without holding priority.
        expect(() =>
            assertExpectedInput(state, {
                playerId: "p2",
                expect: "priority",
                anyPlayer: true,
            })
        ).not.toThrow();
    });

    it("without anyPlayer the same submission is a wrong-player rejection", () => {
        const state = makeState({
            phase: "COMBAT_DAMAGE",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });
        expect(() =>
            assertExpectedInput(state, { playerId: "p2", expect: "priority" })
        ).toThrow(/from another player/i);
    });

    it("still refuses combat-damage assignment once the game is over", () => {
        const state = makeState({
            gameOver: { winnerId: "p1", loserId: "p2", reason: "life" },
        });
        expect(() =>
            assertExpectedInput(state, {
                playerId: "p2",
                expect: "priority",
                anyPlayer: true,
            })
        ).toThrow(/game is over/i);
    });
});

// AC #3 — a full-path legal flow (GRE mutation of state → the gate → projected
// wire state) is unaffected: the gate admits the legal action and the resulting
// Expected Input survives the public projection the client reads.
describe("assertExpectedInput — legal flow is unaffected end-to-end (ADR 0047)", () => {
    it("passes priority: gate admits p1, priority hands to p2, projection reflects it", () => {
        const state = makeState({ priorityPlayerId: "p1" });

        // 1. The mutation gate admits the priority holder's pass.
        expect(() =>
            assertExpectedInput(state, { playerId: "p1", expect: "priority" })
        ).not.toThrow();

        // 2. The mutation performs its action-specific effect: hand priority
        //    to the opponent and re-derive the authoritative field.
        state.priorityPlayerId = "p2";
        refreshExpectedInput(state);
        expect(state.expectedInput).toEqual({
            kind: "priority",
            playerId: "p2",
        });

        // 3. The next actor (p2) is now admitted; p1 is not.
        expect(() =>
            assertExpectedInput(state, { playerId: "p2", expect: "priority" })
        ).not.toThrow();
        expect(() =>
            assertExpectedInput(state, { playerId: "p1", expect: "priority" })
        ).toThrow(/from another player/i);

        // 4. The Expected Input the client reads on the wire matches the engine.
        const projected = projectPublicState(state, 5, "p2");
        expect(projected.expectedInput).toEqual({
            kind: "priority",
            playerId: "p2",
        });
    });
});
