// A compiled "exchange control of this creature and up to one target creature
// an opponent controls. If you don't or can't make an exchange, sacrifice this
// creature. This ability still resolves if its target becomes illegal."
// reaches the engine as a REAL trigger (CR 701.12a, CR 701.21a, CR 608.2b).
//
// `oracle/__tests__/exchangeControl.test.ts` proves the text lowers to the
// right descriptor. It cannot prove the rebuilt ability resolves when its only
// target went illegal — that is the engine's fizzle gate — nor that the
// exchange is all-or-nothing. So each test drives the real entry event, trigger
// scan, stack and resolution.

import { describe, expect, it } from "vitest";
import { registerTokenDefinition } from "../../cards";
import type { CardDefinition } from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { compileCard } from "../../oracle/compile";
import { oracleCard } from "../../oracle/__tests__/oracle.fixture";
import {
    emitPermanentEntered,
    getPlayer,
    processPendingActionTriggers,
    resolveTopOfStack,
    type GameState,
} from "../state";

const DRAKE_ID = "test-5708-gilded-drake";
const ORACLE =
    "Flying\nWhen this creature enters, exchange control of this creature and up to one target creature an opponent controls. If you don't or can't make an exchange, sacrifice this creature. This ability still resolves if its target becomes illegal.";

const outcome = compileCard(
    oracleCard({
        name: "Gilded Drake",
        manaCost: "{1}{U}",
        typeLine: "Creature — Drake",
        oracleText: ORACLE,
        power: "3",
        toughness: "3",
    })
);
if (outcome.state === "unparsed") throw new Error("Gilded Drake unparsed");
registerTokenDefinition({
    ...outcome.definition,
    id: DRAKE_ID,
    rarity: "common",
} as CardDefinition);

const BEAR_ID = "test-5708-bear";
registerTokenDefinition({
    id: BEAR_ID,
    name: "Test Bear",
    rarity: "common",
    manaCost: { G: 1 },
    types: ["Creature"],
    subtypes: ["Bear"],
    power: 2,
    toughness: 2,
} satisfies CardDefinition);

const onBattlefield = (state: GameState, playerId: string, id: string) =>
    getPlayer(state, playerId).battlefield.some((c) => c.id === id);

/** p1 controls the entering Drake; p2 controls a Bear. The Drake's trigger is
 *  on the stack with `targets` as the test announces them. */
function drakeEnters(targets: { type: "permanent"; id: string }[]): GameState {
    const drake = makeInstance(DRAKE_ID, {
        id: "drake",
        controllerId: "p1",
        ownerId: "p1",
    });
    const bear = makeInstance(BEAR_ID, {
        id: "bear",
        controllerId: "p2",
        ownerId: "p2",
    });
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [drake] }),
            makePlayer("p2", { battlefield: [bear] }),
        ],
    });
    emitPermanentEntered(state, drake);
    processPendingActionTriggers(state);
    expect(state.stack.map((s) => s.triggeredAbilityId)).toEqual([
        "gilded-drake-trigger",
    ]);
    state.stack[0]!.targets = targets;
    return state;
}

describe("exchange control with a sacrifice fallback (CR 701.12a)", () => {
    it("swaps the Drake and the announced creature", () => {
        const state = drakeEnters([{ type: "permanent", id: "bear" }]);
        resolveTopOfStack(state);
        expect(onBattlefield(state, "p2", "drake")).toBe(true);
        expect(onBattlefield(state, "p1", "bear")).toBe(true);
        expect(onBattlefield(state, "p1", "drake")).toBe(false);
        expect(onBattlefield(state, "p2", "bear")).toBe(false);
    });

    it("sacrifices the Drake when no target was announced (CR 701.21a)", () => {
        const state = drakeEnters([]);
        resolveTopOfStack(state);
        expect(onBattlefield(state, "p1", "drake")).toBe(false);
        expect(onBattlefield(state, "p2", "drake")).toBe(false);
        expect(getPlayer(state, "p1").graveyard.map((c) => c.id)).toContain(
            "drake"
        );
        expect(onBattlefield(state, "p2", "bear")).toBe(true);
    });

    it("steals nothing when the Drake left in response (all or nothing)", () => {
        const state = drakeEnters([{ type: "permanent", id: "bear" }]);
        const p1 = getPlayer(state, "p1");
        p1.battlefield = p1.battlefield.filter((c) => c.id !== "drake");
        resolveTopOfStack(state);
        expect(onBattlefield(state, "p2", "bear")).toBe(true);
        expect(onBattlefield(state, "p1", "bear")).toBe(false);
    });
});

describe("the Drake changed hands before the trigger resolved (CR 701.12a, CR 701.21a)", () => {
    function stolenInResponse(targets: { type: "permanent"; id: string }[]) {
        const state = drakeEnters(targets);
        const p1 = getPlayer(state, "p1");
        const drake = p1.battlefield.find((c) => c.id === "drake")!;
        p1.battlefield = p1.battlefield.filter((c) => c.id !== "drake");
        drake.controllerId = "p2";
        getPlayer(state, "p2").battlefield.push(drake);
        return state;
    }

    it("steals nothing: the exchange cannot be made", () => {
        const state = stolenInResponse([{ type: "permanent", id: "bear" }]);
        resolveTopOfStack(state);
        expect(onBattlefield(state, "p2", "bear")).toBe(true);
        expect(onBattlefield(state, "p1", "bear")).toBe(false);
    });

    it("does not sacrifice a Drake its ability's controller no longer controls", () => {
        const state = stolenInResponse([]);
        resolveTopOfStack(state);
        expect(onBattlefield(state, "p2", "drake")).toBe(true);
    });
});

describe("'This ability still resolves if its target becomes illegal' (CR 608.2b)", () => {
    it("sacrifices the Drake when the only target is gone — the ability does not fizzle", () => {
        const state = drakeEnters([{ type: "permanent", id: "bear" }]);
        const p2 = getPlayer(state, "p2");
        p2.battlefield = p2.battlefield.filter((c) => c.id !== "bear");
        resolveTopOfStack(state);
        expect(state.stack).toHaveLength(0);
        expect(onBattlefield(state, "p1", "drake")).toBe(false);
        expect(getPlayer(state, "p1").graveyard.map((c) => c.id)).toContain(
            "drake"
        );
    });
});
