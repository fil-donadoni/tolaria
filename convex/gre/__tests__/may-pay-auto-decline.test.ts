// May-pay auto-decline (CR 118.3, CR 117.1d / 605.3a — issue #2242).
//
// A `mayPay` whose non-mana leg (energy / life / permanent / hand) is short
// cannot become payable while the prompt is open: mana abilities only add
// mana and shrink the battlefield and hand. The engine answers "declined"
// inline at the enqueue point — no Pending Choice, same state as a Skip.
// An uncovered MANA leg must still prompt: the chooser may tap lands.

import { describe, it, expect } from "vitest";
import { registerTokenDefinition } from "../../cards";
import type { CardDefinition, EffectOp } from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import { resolveTopOfStack, type GameState } from "../state";
import { applyMayPaySubmit } from "../pendingChoiceSubmit";
import { enumerateMoves } from "../moves";
import type { MayPayCost } from "../../cards/types";

const GRIZZLY_BEARS_ID = "ce2d603a-3231-4a8c-bf39-1617586ea870";

function register(id: string, cost: MayPayCost): string {
    const effects: EffectOp[] = [
        {
            op: "mayPay",
            player: "controller",
            cost,
            prompt: "Pay?",
            bind: "$paid",
        },
        {
            op: "if",
            predicate: { binding: "$paid" },
            then: [{ op: "gainLife", player: "controller", amount: 7 }],
            else: [{ op: "loseLife", player: "controller", amount: 3 }],
        },
    ];
    const def: CardDefinition = {
        id,
        name: id,
        rarity: "common",
        manaCost: { R: 1 },
        types: ["Sorcery"],
        effects,
    };
    registerTokenDefinition(def);
    return id;
}

function run(id: string, state: GameState) {
    pushSpell(state, id, "p1");
    return resolveTopOfStack(state);
}

describe("may-pay auto-decline (CR 118.3, issue #2242)", () => {
    it("energy short: no prompt, not-paid branch applies, counters untouched", () => {
        const id = register("test-autodecline-energy", { energy: 3 });
        const state = makeState({
            players: [
                makePlayer("p1", { energyCounters: 2 }),
                makePlayer("p2"),
            ],
        });
        run(id, state);
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(state.players[0].life).toBe(17);
        expect(state.players[0].energyCounters).toBe(2);
        expect(state.stack).toHaveLength(0);
    });

    it("energy covered: still prompts", () => {
        const id = register("test-autodecline-energy-ok", { energy: 3 });
        const state = makeState({
            players: [
                makePlayer("p1", { energyCounters: 3 }),
                makePlayer("p2"),
            ],
        });
        expect(run(id, state)).toBeNull();
        expect(state.pendingChoices![0].kind).toBe("may-pay");
    });

    it("life short: auto-declines", () => {
        const id = register("test-autodecline-life", { life: 5 });
        const state = makeState({
            players: [makePlayer("p1", { life: 4 }), makePlayer("p2")],
        });
        run(id, state);
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(state.players[0].life).toBe(1);
    });

    it("permanent (sacrifice) short: auto-declines", () => {
        const id = register("test-autodecline-permanent", {
            permanent: { action: "sacrifice", filter: {}, count: 1 },
        });
        const state = makeState();
        run(id, state);
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(state.players[0].life).toBe(17);
    });

    it("hand (discard) short: auto-declines", () => {
        const id = register("test-autodecline-hand", {
            hand: {
                action: "discard",
                requirements: [{ filter: {}, count: 1 }],
            },
        });
        const state = makeState();
        run(id, state);
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(state.players[0].life).toBe(17);
    });

    it("uncovered MANA leg still prompts (mana-ability window)", () => {
        const id = register("test-autodecline-mana", { R: 2 });
        const state = makeState();
        expect(run(id, state)).toBeNull();
        expect(state.pendingChoices![0].kind).toBe("may-pay");
    });

    it("mana leg uncovered + covered non-mana leg: still prompts", () => {
        const id = register("test-autodecline-mana-energy", {
            mana: { R: 2 },
            energy: 1,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { energyCounters: 1 }),
                makePlayer("p2"),
            ],
        });
        expect(run(id, state)).toBeNull();
        expect(state.pendingChoices![0].kind).toBe("may-pay");
    });

    it("covered mana leg + short non-mana leg: auto-declines", () => {
        const id = register("test-autodecline-mana-covered-energy-short", {
            mana: { R: 1 },
            energy: 2,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { manaPool: { R: 1 }, energyCounters: 1 }),
                makePlayer("p2"),
            ],
        });
        run(id, state);
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(state.players[0].manaPool.R).toBe(1); // no partial payment
        expect(state.players[0].energyCounters).toBe(1);
        expect(state.players[0].life).toBe(17);
    });

    it("is observationally identical to a submitted Skip", () => {
        const id = register("test-autodecline-vs-skip", { energy: 3 });
        const mk = (energy: number) =>
            makeState({
                players: [
                    makePlayer("p1", { energyCounters: energy }),
                    makePlayer("p2"),
                ],
            });
        // Auto path: 2 energy, short.
        const auto = mk(2);
        run(id, auto);
        // Skip path: same script, affordable (prompts), then Skip.
        const skip = mk(3);
        run(id, skip);
        applyMayPaySubmit(skip, { playerId: "p1", accept: false });
        expect(auto.players[0].life).toBe(skip.players[0].life);
        expect(auto.stack).toEqual(skip.stack);
        expect(auto.pendingChoices ?? []).toEqual(skip.pendingChoices ?? []);
    });

    it("enumerateMoves offers no phantom may-pay move after an auto-decline", () => {
        const id = register("test-autodecline-moves", { energy: 3 });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [makeInstance(GRIZZLY_BEARS_ID)],
                }),
                makePlayer("p2"),
            ],
        });
        run(id, state);
        expect(state.pendingChoices ?? []).toHaveLength(0);
        const moves = enumerateMoves(state, "p1");
        expect(moves.some((m) => JSON.stringify(m).includes("may-pay"))).toBe(
            false
        );
        expect(moves.length).toBeGreaterThan(0);
    });
});
