// mh2 — multicolor behavior tests (ADR 0043 colour split).
//
// Master of Death is a pure-DSL card reusing already-shipped Ops. Both its
// abilities suspend for a live choice the canned smoke generator can't drive
// (the ETB `scryReorder` order-top pick; the upkeep `mayPay` Pay/Skip
// decision), so per the per-Op regime it earns a hand-written test. The
// graveyard-zone upkeep recursion mirrors Squee, Goblin Nabob (mmq/red.ts),
// here gated by a 1-life cost (CR 117.3a).

import { describe, it, expect } from "vitest";
import { masterOfDeath } from "..";
import { resolveTopOfStack, type GameState } from "../../../../gre/state";
import { collectTriggers } from "../../../../gre/triggers";
import { applyMayPaySubmit } from "../../../../gre/pendingChoiceSubmit";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";

describe("Master of Death (CR 701.25 ETB surveil 2; CR 603.6e graveyard-zone upkeep return for 1 life)", () => {
    it("is a {1}{U}{B} Zombie Wizard 3/1", () => {
        expect(masterOfDeath.manaCost).toEqual({ X: 1, U: 1, B: 1 });
        expect(masterOfDeath.types).toEqual(["Creature"]);
        expect(masterOfDeath.subtypes).toEqual(["Zombie", "Wizard"]);
        expect(masterOfDeath.power).toBe(3);
        expect(masterOfDeath.toughness).toBe(1);
    });

    it("has an ETB surveil-2 trigger (scryReorder into the graveyard)", () => {
        const etb = masterOfDeath.triggeredAbilities?.find(
            (a) => a.id === "master-of-death-etb-surveil"
        );
        expect(etb?.event).toBe("PERMANENT_ENTERED");
        expect(etb?.effects?.[0]).toMatchObject({
            op: "scryReorder",
            count: 2,
            destination: "graveyard",
        });
    });

    function gyState(): GameState {
        const mod = makeInstance(masterOfDeath.id, {
            id: "mod",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        return makeState({
            activePlayerId: "p1",
            phase: "UPKEEP",
            players: [makePlayer("p1", { graveyard: [mod] }), makePlayer("p2")],
        });
    }

    const upkeep = {
        type: "PHASE_BEGIN" as const,
        phase: "UPKEEP" as const,
        activePlayerId: "p1",
    };

    it("has a graveyard-zone upkeep return trigger", () => {
        const trig = masterOfDeath.triggeredAbilities?.find(
            (a) => a.id === "master-of-death-upkeep-return"
        );
        expect(trig?.event).toBe("PHASE_BEGIN");
        expect(trig?.zone).toBe("graveyard");
    });

    it("triggers on its controller's upkeep from the graveyard", () => {
        const state = gyState();
        const triggers = collectTriggers(state, [upkeep]);
        expect(triggers).toHaveLength(1);
        expect(triggers[0].triggeredAbilityId).toBe(
            "master-of-death-upkeep-return"
        );
    });

    it("does NOT trigger on the opponent's upkeep (CR 109.5)", () => {
        const state = gyState();
        const oppUpkeep = { ...upkeep, activePlayerId: "p2" };
        expect(collectTriggers(state, [oppUpkeep])).toHaveLength(0);
    });

    it("returns itself to hand and pays 1 life when accepted", () => {
        const state = gyState();
        state.players[0].life = 20;
        state.stack.push(...collectTriggers(state, [upkeep]));
        expect(resolveTopOfStack(state)).toBeNull(); // suspended on may-pay

        const pending = state.pendingChoices![0];
        expect(pending.kind).toBe("may-pay");
        expect(pending.cost).toMatchObject({ life: 1 });

        applyMayPaySubmit(state, { playerId: "p1", accept: true });
        const p1 = state.players[0];
        expect(p1.life).toBe(19);
        expect(p1.hand.some((c) => c.id === "mod")).toBe(true);
        expect(p1.graveyard.some((c) => c.id === "mod")).toBe(false);
    });

    it("stays in the graveyard and pays no life when declined", () => {
        const state = gyState();
        state.players[0].life = 20;
        state.stack.push(...collectTriggers(state, [upkeep]));
        resolveTopOfStack(state);
        applyMayPaySubmit(state, { playerId: "p1", accept: false });
        const p1 = state.players[0];
        expect(p1.life).toBe(20);
        expect(p1.graveyard.some((c) => c.id === "mod")).toBe(true);
        expect(p1.hand.some((c) => c.id === "mod")).toBe(false);
    });
});
