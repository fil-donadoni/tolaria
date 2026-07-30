// PLS (Planeshift) — colorless card behavior tests (ADR 0043 colour split).
//
// The Lair cycle (CR 117.3a / 701.16 / 701.24, issue #1938): each land's ETB
// offers a may-pay PERMANENT return leg (ADR 0079 `CostLegs`, issue #1933)
// with a "not $paid" sacrifice fallback (CR 118 "unless"). The `mayPay` +
// `if` + `sacrifice` Op combination is already exercised at the interpreter
// level by `convex/gre/__tests__/may-pay-return-leg.test.ts` (the
// `mayPayReturnLegProbe` fixture carries this exact Oracle shape) — this
// suite is the CARD-level proof the auto-generated smoke test explicitly
// skips (`scenarioGenerator` treats `mayPay`/`sacrifice` as "covered by the
// card's own suspension/resume tests").

import { describe, it, expect } from "vitest";
import {
    crosissCatacombs,
    darigaazsCaldera,
    dromarsCavern,
    rithsGrove,
    trevasRuins,
} from "../colorless";
import { forest } from "../../lea/colorless";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import type { CardDefinition } from "../../../types";
import {
    canPayMayPayCost,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
    type StackItem,
} from "../../../../gre/state";
import { applyMayPaySubmit } from "../../../../gre/pendingChoiceSubmit";
import { tapSourceIntoPayment } from "../../../../game";
import { projectPublicState } from "../../../../gameProjections";

function lairInstance(def: CardDefinition, id: string): CardInstanceState {
    return makeInstance(def.id, { id, controllerId: "p1", ownerId: "p1" });
}

function nonLairLand(id: string): CardInstanceState {
    return makeInstance(forest.id, { id, controllerId: "p1", ownerId: "p1" });
}

/** Puts a Lair's self-ETB trigger on the stack with its `triggerSourceId` set,
 *  mirroring `fireReturnLegEtb` (`gre/__tests__/fixtures/mayPayReturnLegProbe.ts`). */
function fireLairEtb(
    state: GameState,
    lair: CardInstanceState,
    triggerId: string
): void {
    state.stack.push({
        ...lair,
        zone: "stack",
        castById: lair.controllerId,
        triggeredAbilityId: triggerId,
        triggerSourceId: lair.id,
        triggerEvent: {
            type: "PERMANENT_ENTERED",
            instanceId: lair.id,
            controllerId: lair.controllerId,
            types: ["Land"],
        } as StackItem["triggerEvent"],
        targets: [],
    });
    resolveTopOfStack(state);
}

const LAIR_CYCLE = [
    {
        def: crosissCatacombs,
        triggerId: "crosiss-catacombs-etb",
        colors: ["U", "B", "R"] as const,
    },
    {
        def: darigaazsCaldera,
        triggerId: "darigaazs-caldera-etb",
        colors: ["B", "R", "G"] as const,
    },
    {
        def: dromarsCavern,
        triggerId: "dromars-cavern-etb",
        colors: ["W", "U", "B"] as const,
    },
    {
        def: rithsGrove,
        triggerId: "riths-grove-etb",
        colors: ["R", "G", "W"] as const,
    },
    {
        def: trevasRuins,
        triggerId: "trevas-ruins-etb",
        colors: ["G", "W", "U"] as const,
    },
];

describe("Planeshift Lair cycle (CR 117.3a / 701.16 / 701.24, issue #1938)", () => {
    for (const { def, triggerId, colors } of LAIR_CYCLE) {
        describe(def.name, () => {
            it("is a Land — Lair with one ETB trigger and one {T} tri-colour mana ability", () => {
                expect(def.types).toEqual(["Land"]);
                expect(def.subtypes).toEqual(["Lair"]);
                expect(def.triggeredAbilities).toHaveLength(1);
                expect(def.triggeredAbilities![0].id).toBe(triggerId);
                const mana = def.activatedAbilities?.[0];
                expect(mana?.cost).toEqual({ tap: true });
                expect(mana?.useStack).toBe(false);
                expect(mana?.manaChoices).toEqual([
                    { [colors[0]]: 1 },
                    { [colors[1]]: 1 },
                    { [colors[2]]: 1 },
                ]);
            });

            it("taps for each of its three colours (CR 605.1a)", () => {
                for (const [index, color] of colors.entries()) {
                    const land = lairInstance(def, "land");
                    const player = makePlayer("p1", { battlefield: [land] });
                    const state = makeState({
                        players: [player, makePlayer("p2")],
                    });
                    state.activePlayerId = "p1";
                    tapSourceIntoPayment(state, player, land, index, []);
                    expect(player.manaPool[color]).toBe(1);
                }
            });

            it("accept: returns the chosen non-Lair land and the Lair survives (CR 118 'unless')", () => {
                const lair = lairInstance(def, "lair");
                const keep = nonLairLand("keep");
                const bounce = nonLairLand("bounce");
                const state = makeState({
                    players: [
                        makePlayer("p1", { battlefield: [lair, keep, bounce] }),
                        makePlayer("p2"),
                    ],
                });
                fireLairEtb(state, lair, triggerId);
                applyMayPaySubmit(state, {
                    playerId: "p1",
                    accept: true,
                    sacrificeIds: ["bounce"],
                });
                const p1 = state.players[0];
                expect(p1.hand.map((c) => c.id)).toEqual(["bounce"]);
                expect(p1.battlefield.map((c) => c.id)).toEqual([
                    "lair",
                    "keep",
                ]);
                expect(p1.graveyard).toHaveLength(0);
            });

            it("decline: sacrifices the Lair with no further prompt (CR 118 'unless')", () => {
                const lair = lairInstance(def, "lair");
                const other = nonLairLand("other");
                const state = makeState({
                    players: [
                        makePlayer("p1", { battlefield: [lair, other] }),
                        makePlayer("p2"),
                    ],
                });
                fireLairEtb(state, lair, triggerId);
                applyMayPaySubmit(state, { playerId: "p1", accept: false });
                const p1 = state.players[0];
                expect(p1.battlefield.map((c) => c.id)).toEqual(["other"]);
                expect(p1.graveyard.some((c) => c.id === "lair")).toBe(true);
                expect(p1.hand).toHaveLength(0);
                expect(state.pendingChoices ?? []).toHaveLength(0);
            });
        });
    }

    it("the cost filter excludes EVERY Lair, not just the entering one", () => {
        const enteringLair = lairInstance(crosissCatacombs, "entering-lair");
        const otherLair = lairInstance(darigaazsCaldera, "other-lair");
        const legalLand = nonLairLand("legal-land");
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [enteringLair, otherLair, legalLand],
                }),
                makePlayer("p2"),
            ],
        });
        fireLairEtb(state, enteringLair, "crosiss-catacombs-etb");
        const head = state.pendingChoices![0];
        // Neither the entering Lair nor the pre-existing Lair is offered —
        // only the genuinely non-Lair land.
        expect(head.candidateIds).toEqual(["legal-land"]);
    });

    it("with no legal non-Lair land, the Lair is sacrificed and the choice is still surfaced", () => {
        const lair = lairInstance(crosissCatacombs, "lair");
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [lair] }),
                makePlayer("p2"),
            ],
        });
        fireLairEtb(state, lair, "crosiss-catacombs-etb");
        const head = state.pendingChoices![0];
        // The offer is still surfaced (CR 118 "unless" — a forced outcome is
        // still information the player must see) even though there is no
        // legal candidate to accept. With zero candidates the return leg's
        // picker never lights up (`mayPaySacrificeChoiceRequired` is false),
        // so `candidateIds` stays unset rather than an empty array.
        expect(head.kind).toBe("may-pay");
        expect(head.candidateIds).toBeUndefined();
        expect(canPayMayPayCost(state, "p1", head.cost!)).toBe(false);
        applyMayPaySubmit(state, { playerId: "p1", accept: false });
        const p1 = state.players[0];
        expect(p1.graveyard.some((c) => c.id === "lair")).toBe(true);
    });

    it("the prompt and its outcome survive the wire projection (projectPublicState)", () => {
        const lair = lairInstance(crosissCatacombs, "lair");
        const forestLand = nonLairLand("forest-land");
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [lair, forestLand] }),
                makePlayer("p2"),
            ],
        });
        fireLairEtb(state, lair, "crosiss-catacombs-etb");

        const projected = projectPublicState(state, 1, "p1");
        const head = projected.pendingChoices![0];
        expect(head.kind).toBe("may-pay");
        expect(head.permanentAction).toBe("return");
        expect(head.candidateIds).toEqual(["forest-land"]);

        applyMayPaySubmit(state, {
            playerId: "p1",
            accept: true,
            sacrificeIds: ["forest-land"],
        });
        const afterProjection = projectPublicState(state, 2, "p1");
        const p1 = afterProjection.players[0];
        expect(p1.battlefield.map((c) => c.id)).toEqual(["lair"]);
        expect(p1.hand).toHaveLength(1);
    });
});
