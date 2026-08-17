// Mirage (MIR) — colorless behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import { lionsEyeDiamond, phyrexianDreadnought } from "../colorless";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { tapSourceIntoPayment } from "../../../../game";
import { projectPublicState } from "../../../../gameProjections";
import {
    resolveTopOfStack,
    canPayMayPayCost,
    payMayPayCost,
    mayPaySacrificeChoiceRequired,
    type CardInstanceState,
    type GameState,
    type StackItem,
} from "../../../../gre/state";
import type { MayPayCost } from "../../../types";
import { applyMayPaySubmit } from "../../../../gre/pendingChoiceSubmit";

const GRIZZLY_BEARS_ID = "ce2d603a-3231-4a8c-bf39-1617586ea870";

// Lion's Eye Diamond — "Discard your hand, Sacrifice this artifact: Add
// three mana of any one color. Activate only as an instant." "Discard your
// hand" is expressed via the existing `discardAtRandom` cost primitive with
// a count comfortably above any reachable hand size — clamped to the actual
// hand size (CR 118.3), so every card discards regardless of hand size.
describe("Lion's Eye Diamond ({T}, Sacrifice, discard hand: 3 of one color, CR 118.3 / 605.1a)", () => {
    // Full path through the real tap-for-mana entry point
    // (`tapSourceIntoPayment` — the choice branch, since LED has no {T} cost
    // but a `manaChoices`-shaped mana ability). Exercises the discard-at-
    // random cost (`payDiscardAtRandomCost`, wired for tap mana abilities via
    // the new `applyManaAbilityDiscardCost` rider) together with the
    // sacrifice and the mana production, from ONE activation.
    it("discards the whole hand, sacrifices the diamond, and adds 3 mana of one color (CR 118.3 / 605.1a / 701.21)", () => {
        const led = makeInstance(lionsEyeDiamond.id, {
            id: "led",
            controllerId: "p1",
            ownerId: "p1",
        });
        const hand = [
            makeInstance(GRIZZLY_BEARS_ID, { zone: "hand" }),
            makeInstance(GRIZZLY_BEARS_ID, { zone: "hand" }),
            makeInstance(GRIZZLY_BEARS_ID, { zone: "hand" }),
            makeInstance(GRIZZLY_BEARS_ID, { zone: "hand" }),
        ];
        const player = makePlayer("p1", { battlefield: [led], hand });
        const state = makeState({
            players: [player, makePlayer("p2")],
        });
        state.activePlayerId = "p1";
        // Index 2 = {B}: 3 mana of one color.
        tapSourceIntoPayment(state, player, led, 2, []);
        expect(player.manaPool.B).toBe(3);
        // Whole hand discarded — the `discardAtRandom: 99` primitive clamps
        // to the actual hand size (4), so the hand ends empty, not partially
        // discarded.
        expect(player.hand).toHaveLength(0);
        expect(player.graveyard).toHaveLength(4 + 1); // 4 discarded + LED itself
        // Sacrificed: off the battlefield.
        expect(player.battlefield.find((c) => c.id === "led")).toBeUndefined();
        expect(player.graveyard.find((c) => c.id === "led")).toBeDefined();
    });

    it("with a smaller hand, discards exactly what's there (clamped, not an error)", () => {
        const led = makeInstance(lionsEyeDiamond.id, {
            id: "led",
            controllerId: "p1",
            ownerId: "p1",
        });
        const hand = [makeInstance(GRIZZLY_BEARS_ID, { zone: "hand" })];
        const player = makePlayer("p1", { battlefield: [led], hand });
        const state = makeState({
            players: [player, makePlayer("p2")],
        });
        state.activePlayerId = "p1";
        tapSourceIntoPayment(state, player, led, 0, []); // index 0 = {W}
        expect(player.manaPool.W).toBe(3);
        expect(player.hand).toHaveLength(0);
    });

    it("the emptied hand and the produced mana survive the wire-format projection (PublicGameState)", () => {
        const led = makeInstance(lionsEyeDiamond.id, {
            id: "led",
            controllerId: "p1",
            ownerId: "p1",
        });
        const hand = [
            makeInstance(GRIZZLY_BEARS_ID, { zone: "hand" }),
            makeInstance(GRIZZLY_BEARS_ID, { zone: "hand" }),
        ];
        const player = makePlayer("p1", { battlefield: [led], hand });
        const state = makeState({
            players: [player, makePlayer("p2")],
        });
        state.activePlayerId = "p1";
        tapSourceIntoPayment(state, player, led, 4, []); // index 4 = {G}
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[0].manaPool.G).toBe(3);
        expect(projected.players[0].hand).toHaveLength(0);
        expect(
            projected.players[0].battlefield.find((c) => c.id === "led")
        ).toBeUndefined();
    });
});

// Phyrexian Dreadnought — summed-power THRESHOLD sacrifice cost (issue #977).
// The self-ETB (CR 603.6a) offers a `mayPay` whose sacrifice leg is
// `count: { minTotalPower: 12 }` (CR 118 / 701.21 — "sacrifice any number of
// creatures with total power 12 or greater"); an `if !$paid` sacrifices the
// source (CR 608.2b).

/** A creature body with an explicit power (base P/T is read from the instance,
 *  CR 208.2 → layers `basePower`). Backed by the Grizzly Bears definition so it
 *  registers as a Creature the "you control" sacrifice filter matches. */
function creature(id: string, power: number): CardInstanceState {
    return makeInstance(GRIZZLY_BEARS_ID, {
        id,
        controllerId: "p1",
        ownerId: "p1",
        power,
        toughness: power,
    });
}

/** Fire Phyrexian Dreadnought's self-ETB trigger via the stack, suspending at
 *  the may-pay (mirrors the engine putting the trigger on the stack). */
function fireDreadnoughtEtb(
    state: GameState,
    dreadnought: CardInstanceState
): void {
    state.stack.push({
        ...dreadnought,
        zone: "stack",
        castById: dreadnought.controllerId,
        triggeredAbilityId: "phyrexian-dreadnought-etb-sacrifice",
        triggerSourceId: dreadnought.id,
        triggerEvent: {
            type: "PERMANENT_ENTERED",
            instanceId: dreadnought.id,
            controllerId: "p1",
            types: ["Artifact", "Creature"],
        } as StackItem["triggerEvent"],
        targets: [],
    });
    resolveTopOfStack(state);
}

/** The ETB may-pay's cost (the threshold sacrifice leg). */
function dreadnoughtCost(): MayPayCost {
    const op = phyrexianDreadnought.triggeredAbilities![0].effects![0] as {
        cost: MayPayCost;
    };
    return op.cost;
}

describe("Phyrexian Dreadnought (threshold sacrifice cost, CR 118 / 701.21 / 603.6a)", () => {
    it("decline: the ETB sacrifices the Dreadnought itself (CR 608.2b)", () => {
        const dread = makeInstance(phyrexianDreadnought.id, {
            id: "dread",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [dread, creature("b1", 2), creature("b2", 2)],
                }),
                makePlayer("p2"),
            ],
        });
        fireDreadnoughtEtb(state, dread);
        expect(state.pendingChoices?.[0]?.kind).toBe("may-pay");
        applyMayPaySubmit(state, { playerId: "p1", accept: false });
        // Dreadnought gone; the two bears untouched on decline.
        expect(
            state.players[0].battlefield.find((c) => c.id === "dread")
        ).toBeUndefined();
        expect(state.players[0].graveyard.some((c) => c.id === "dread")).toBe(
            true
        );
        expect(
            state.players[0].battlefield.filter((c) => c.id.startsWith("b"))
        ).toHaveLength(2);
    });

    it("pay: sacrificing creatures with total power 12 keeps the Dreadnought", () => {
        const dread = makeInstance(phyrexianDreadnought.id, {
            id: "dread",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        dread,
                        creature("six-a", 6),
                        creature("six-b", 6),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        fireDreadnoughtEtb(state, dread);
        // A real variable-size victim choice is owed (candidates exist).
        expect(
            mayPaySacrificeChoiceRequired(
                state,
                "p1",
                state.pendingChoices![0].cost!
            )
        ).toBe(true);
        applyMayPaySubmit(state, {
            playerId: "p1",
            accept: true,
            sacrificeIds: ["six-a", "six-b"],
        });
        // Dreadnought kept; both 6/6s sacrificed.
        expect(state.players[0].battlefield.some((c) => c.id === "dread")).toBe(
            true
        );
        for (const id of ["six-a", "six-b"]) {
            expect(
                state.players[0].battlefield.find((c) => c.id === id)
            ).toBeUndefined();
            expect(state.players[0].graveyard.some((c) => c.id === id)).toBe(
                true
            );
        }
    });

    it("wire format: the sacrificed creature is gone in the projected state", () => {
        const dread = makeInstance(phyrexianDreadnought.id, {
            id: "dread",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [dread, creature("big", 12)],
                }),
                makePlayer("p2"),
            ],
        });
        fireDreadnoughtEtb(state, dread);
        applyMayPaySubmit(state, {
            playerId: "p1",
            accept: true,
            sacrificeIds: ["big"],
        });
        const projected = projectPublicState(state, 1, "p1");
        const bf = projected.players[0].battlefield;
        expect(bf.some((c) => c.id === "dread")).toBe(true);
        expect(bf.some((c) => c.id === "big")).toBe(false);
    });

    it("submit validation: a pick below the threshold is rejected (CR 118), over-pay allowed", () => {
        const dread = makeInstance(phyrexianDreadnought.id, {
            id: "dread",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        dread,
                        creature("five", 5),
                        creature("six", 6),
                        creature("eight", 8),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        fireDreadnoughtEtb(state, dread);
        // 6 alone is < 12 → rejected (leaves the choice in place to retry).
        expect(() =>
            applyMayPaySubmit(state, {
                playerId: "p1",
                accept: true,
                sacrificeIds: ["six"],
            })
        ).toThrow();
        // 5 + 8 = 13 ≥ 12 → accepted; over-payment is legal.
        applyMayPaySubmit(state, {
            playerId: "p1",
            accept: true,
            sacrificeIds: ["five", "eight"],
        });
        expect(state.players[0].battlefield.some((c) => c.id === "dread")).toBe(
            true
        );
        expect(
            state.players[0].battlefield.find((c) => c.id === "five")
        ).toBeUndefined();
        expect(
            state.players[0].battlefield.find((c) => c.id === "eight")
        ).toBeUndefined();
        // The unpicked 6-power creature survives.
        expect(state.players[0].battlefield.some((c) => c.id === "six")).toBe(
            true
        );
    });

    it("canPay / payMayPayCost primitives honour the summed-power threshold (bot greedy default)", () => {
        const dread = makeInstance(phyrexianDreadnought.id, {
            id: "dread",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [dread, creature("p8", 8), creature("p5", 5)],
                }),
                makePlayer("p2"),
            ],
        });
        const cost = dreadnoughtCost();
        // 8 + 5 = 13 among the non-self bodies (plus the Dreadnought's own 12).
        expect(canPayMayPayCost(state, "p1", cost)).toBe(true);
        // No sacrificeIds → bot minimal default: greedy highest-power-first
        // takes the 12-power Dreadnought alone (reaches 12 in one), leaving
        // p8/p5 on the battlefield.
        payMayPayCost(state, "p1", cost);
        expect(
            state.players[0].battlefield.find((c) => c.id === "dread")
        ).toBeUndefined();
        expect(state.players[0].battlefield.some((c) => c.id === "p8")).toBe(
            true
        );
        expect(state.players[0].battlefield.some((c) => c.id === "p5")).toBe(
            true
        );
    });

    it("canPayMayPayCost is false when matching creatures can't reach the threshold", () => {
        // Only two 2/2s (self excluded by removing the Dreadnought here): 4 < 12.
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [creature("t1", 2), creature("t2", 2)],
                }),
                makePlayer("p2"),
            ],
        });
        expect(canPayMayPayCost(state, "p1", dreadnoughtCost())).toBe(false);
    });
});
