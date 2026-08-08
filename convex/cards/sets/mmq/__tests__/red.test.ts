// Per-card test for mmq/red.ts. Squee, Goblin Nabob's graveyard-zone upkeep
// trigger uses a cost-free `mayPay` Op — the catalogue-wide auto-generated
// smoke test (`effectScriptSmoke.test.ts`) explicitly SKIPS it ("Op 'mayPay'
// suspends for a Pay/Skip decision — covered by the card's own
// suspension/resume tests"), so per `.claude/rules/gre-development.md` §
// DSL-first authoring this card earns a hand-written test.
import { describe, it, expect } from "vitest";
import { squeeGoblinNabob } from "..";
import { resolveTopOfStack, type GameState } from "../../../../gre/state";
import { collectTriggers } from "../../../../gre/triggers";
import { applyMayPaySubmit } from "../../../../gre/pendingChoiceSubmit";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";

describe("Squee, Goblin Nabob (CR 603.6e graveyard-zone upkeep trigger, CR 117.3a optional cost-free return)", () => {
    function gyState(): GameState {
        const squee = makeInstance(squeeGoblinNabob.id, {
            id: "squee",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        return makeState({
            activePlayerId: "p1",
            phase: "UPKEEP",
            players: [
                makePlayer("p1", { graveyard: [squee] }),
                makePlayer("p2"),
            ],
        });
    }

    const upkeep = {
        type: "PHASE_BEGIN" as const,
        phase: "UPKEEP" as const,
        activePlayerId: "p1",
    };

    it("triggers on its controller's upkeep from the graveyard", () => {
        const state = gyState();
        const triggers = collectTriggers(state, [upkeep]);
        expect(triggers).toHaveLength(1);
        expect(triggers[0].triggeredAbilityId).toBe(
            "squee-goblin-nabob-upkeep-return"
        );
    });

    it("does NOT trigger on the opponent's upkeep (CR 109.5)", () => {
        const state = gyState();
        const oppUpkeep = { ...upkeep, activePlayerId: "p2" };
        expect(collectTriggers(state, [oppUpkeep])).toHaveLength(0);
    });

    it("suspends on a cost-free may-pay, then returns itself to hand when accepted", () => {
        const state = gyState();
        state.stack.push(...collectTriggers(state, [upkeep]));
        expect(resolveTopOfStack(state)).toBeNull();
        const pending = state.pendingChoices![0];
        expect(pending.kind).toBe("may-pay");
        expect(pending.cost).toBeUndefined(); // cost-free — nothing to pay
        applyMayPaySubmit(state, { playerId: "p1", accept: true });
        const p1 = state.players[0];
        expect(p1.hand.some((c) => c.id === "squee")).toBe(true);
        expect(p1.graveyard.some((c) => c.id === "squee")).toBe(false);
    });

    it("stays in the graveyard when the player declines", () => {
        const state = gyState();
        state.stack.push(...collectTriggers(state, [upkeep]));
        resolveTopOfStack(state);
        applyMayPaySubmit(state, { playerId: "p1", accept: false });
        const p1 = state.players[0];
        expect(p1.graveyard.some((c) => c.id === "squee")).toBe(true);
        expect(p1.hand.some((c) => c.id === "squee")).toBe(false);
    });
});
