// Integration: announceCast rejects an unpayable additional-cost sacrifice
// cleanly instead of crashing (issue #944, CR 118.8 / 601.2f). A spell whose
// additional cost is "sacrifice/exile a permanent matching a filter" must be
// illegal to announce when the caster controls no matching permanent — you
// can't announce a spell whose additional cost can't be paid.
//
// The project has no convex-test harness for game.ts mutations (ADR 0001 /
// moves-integration.test.ts), so — like repro-mox.test.ts and
// sacrifice-cost-activation.test.ts — this drives the REAL exported pieces
// `announceCast` calls, in the same order, over the real GRE state:
//   1. `assertLegalAction` (convex/gre/rules.ts) — the up-front legality gate
//      `announceCast` calls before touching the stack. Must throw a clean,
//      catchable Error (never let execution reach the picker) when the
//      additional cost is unpayable.
//   2. `buildAdditionalCostPicker` (convex/game.ts) — the additional-cost
//      picker builder itself, exported for this test. With the gate fixed,
//      calling it directly still proves the payable path returns a valid
//      picker whose candidate set matches what the player would see.
//
// Class-wide: covers Natural Order (`sacrificeFilter`, colour-scoped) and
// Soul Exchange (`exileFilter`).

import { describe, it, expect } from "vitest";
import { assertLegalAction } from "../rules";
import { getPlayer, type GameState } from "../state";
import { buildAdditionalCostPicker } from "../../game";
import { getDefinition } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { naturalOrder } from "../../cards/sets/vis";
import { soulExchange } from "../../cards/sets/fem";
import { grizzlyBears } from "../../cards/sets/lea";

describe("announceCast — unpayable additional-cost sacrifice (issue #944)", () => {
    it("Natural Order: assertLegalAction rejects cleanly with no green creature (no crash)", () => {
        const naturalOrderInst = makeInstance(naturalOrder.id, {
            zone: "hand",
        });
        const state: GameState = makeState({
            players: [
                makePlayer("p1", {
                    hand: [naturalOrderInst],
                    manaPool: { W: 5, U: 5, B: 5, R: 5, G: 5, C: 5 },
                }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });
        const player = getPlayer(state, "p1");
        const cardInHand = player.hand.find(
            (c) => c.id === naturalOrderInst.id
        )!;

        // The exact check announceCast runs before ever reaching
        // buildAdditionalCostPicker — must throw a normal, catchable Error
        // (a rejected mutation), never an unhandled crash.
        expect(() =>
            assertLegalAction(state, player, cardInHand, "cast")
        ).toThrow(/Illegal action "cast"/);
    });

    it("Natural Order: assertLegalAction allows the cast and buildAdditionalCostPicker returns the real picker once a green creature exists", () => {
        const bears = makeInstance(grizzlyBears.id, { zone: "battlefield" });
        const naturalOrderInst = makeInstance(naturalOrder.id, {
            zone: "hand",
        });
        const state: GameState = makeState({
            players: [
                makePlayer("p1", {
                    hand: [naturalOrderInst],
                    battlefield: [bears],
                    manaPool: { W: 5, U: 5, B: 5, R: 5, G: 5, C: 5 },
                }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });
        const player = getPlayer(state, "p1");
        const cardInHand = player.hand.find(
            (c) => c.id === naturalOrderInst.id
        )!;

        expect(() =>
            assertLegalAction(state, player, cardInHand, "cast")
        ).not.toThrow();

        const def = getDefinition(naturalOrder.id);
        const picker = buildAdditionalCostPicker(def.additionalCosts, player);
        expect(picker).toEqual({
            kind: "sacrifice",
            filter: { types: "Creature", colors: "G" },
        });
    });

    it("Soul Exchange: assertLegalAction rejects cleanly with no creature to exile (no crash)", () => {
        const grave = makeInstance(grizzlyBears.id, { zone: "graveyard" });
        const soulExchangeInst = makeInstance(soulExchange.id, {
            zone: "hand",
        });
        const state: GameState = makeState({
            players: [
                makePlayer("p1", {
                    hand: [soulExchangeInst],
                    graveyard: [grave],
                    manaPool: { W: 5, U: 5, B: 5, R: 5, G: 5, C: 5 },
                }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });
        const player = getPlayer(state, "p1");
        const cardInHand = player.hand.find(
            (c) => c.id === soulExchangeInst.id
        )!;

        // A legal graveyard target exists (the return-target requirement is
        // satisfiable) — only the exile additional cost is unpayable.
        expect(() =>
            assertLegalAction(state, player, cardInHand, "cast")
        ).toThrow(/Illegal action "cast"/);
    });

    it("Soul Exchange: assertLegalAction allows the cast and buildAdditionalCostPicker returns the real picker once an own creature exists", () => {
        const bears = makeInstance(grizzlyBears.id, { zone: "battlefield" });
        const grave = makeInstance(grizzlyBears.id, { zone: "graveyard" });
        const soulExchangeInst = makeInstance(soulExchange.id, {
            zone: "hand",
        });
        const state: GameState = makeState({
            players: [
                makePlayer("p1", {
                    hand: [soulExchangeInst],
                    battlefield: [bears],
                    graveyard: [grave],
                    manaPool: { W: 5, U: 5, B: 5, R: 5, G: 5, C: 5 },
                }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });
        const player = getPlayer(state, "p1");
        const cardInHand = player.hand.find(
            (c) => c.id === soulExchangeInst.id
        )!;

        expect(() =>
            assertLegalAction(state, player, cardInHand, "cast")
        ).not.toThrow();

        const def = getDefinition(soulExchange.id);
        const picker = buildAdditionalCostPicker(def.additionalCosts, player);
        expect(picker).toEqual({
            kind: "exile",
            filter: { types: "Creature", controllerRelation: "you" },
        });
    });
});
