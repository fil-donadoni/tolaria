// ONS — per-card behavior tests for red cards in
// `convex/cards/sets/ons/red.ts` (set split by colour, ADR 0043). Lava Dart's
// `dealDamage` Op is already exercised catalogue-wide (Firebolt, ody/red.ts),
// so the main cast is covered by the effect-script static sweep +
// auto-generated smoke test (per-Op regime, `.claude/rules/gre-development.md`
// § DSL-first authoring). What is card-specific and worth a hand-written test
// is the flashback cast's non-mana "Sacrifice a Mountain" additional cost
// (CR 702.34a flashback / 118.5) — the sacrificeChoice fold shipped generically in
// #1035/#1037 (`convex/gre/__tests__/flashback.test.ts`), and this is its
// first real-card consumer.

import { describe, it, expect } from "vitest";
import { lavaDart } from "../red";
import { mountain } from "../../lea/colorless";
import { grizzlyBears } from "../../lea/green";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import {
    resolveTopOfStack,
    removeFromZone,
    getPlayer,
    type StackItem,
} from "../../../../gre/state";
import {
    locateCastSource,
    castRawManaCost,
    flashbackStackFlags,
    buildCastSacrificeSelection,
} from "../../../../game";
import { applySacrificeSelection } from "../../../../gre/sacrificeChoice";

describe("Lava Dart (CR 702.34) — 1 damage + flashback sacrifice a Mountain", () => {
    it("main cast: deals 1 damage to any target (player)", () => {
        const p1 = makePlayer("p1");
        const p2 = makePlayer("p2");
        const state = makeState({ players: [p1, p2] });
        const item: StackItem = {
            ...makeInstance(lavaDart.id, {
                controllerId: "p1",
                ownerId: "p1",
                zone: "stack",
            }),
            castById: "p1",
            targets: [{ type: "player", id: "p2" }],
        };
        state.stack.push(item);
        resolveTopOfStack(state);

        expect(getPlayer(state, "p2").life).toBe(19);
        // A normal cast never exiles — it goes to the graveyard as usual.
        expect(
            getPlayer(state, "p1").graveyard.some((c) => c.id === item.id)
        ).toBe(true);
    });

    it("flashback cast: sacrifices a Mountain (no mana), deals 1 damage, then exiles Lava Dart (CR 702.34a)", () => {
        const mtn = makeInstance(mountain.id, {
            id: "mtn1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const dart = makeInstance(lavaDart.id, {
            id: "dart1",
            zone: "graveyard",
            controllerId: "p1",
            ownerId: "p1",
        });
        const p1 = makePlayer("p1", {
            graveyard: [dart],
            battlefield: [mtn],
        });
        const p2 = makePlayer("p2");
        const state = makeState({ players: [p1, p2] });

        // Drive the real cast-source resolution announceCast uses.
        const src = locateCastSource(state, getPlayer(state, "p1"), dart.id);
        expect(src.zone).toBe("graveyard");
        // No mana portion — Lava Dart's flashback cost is purely "Sacrifice a
        // Mountain" (CR 702.34a).
        expect(castRawManaCost(state, src.card!, src.zone)).toBeUndefined();

        // Assemble + auto-resolve the fungible single-Mountain sacrifice
        // requirement folded onto this flashback cast.
        const { selection } = buildCastSacrificeSelection(
            state,
            undefined,
            src.card!,
            getPlayer(state, "p1"),
            undefined,
            "Flashback",
            src.zone
        );
        expect(selection).toBeDefined();
        expect(selection!.picked).toEqual([mtn.id]);
        applySacrificeSelection(state, selection!);

        // The Mountain is sacrificed: off the battlefield, into the graveyard.
        expect(
            getPlayer(state, "p1").battlefield.some((c) => c.id === mtn.id)
        ).toBe(false);
        expect(
            getPlayer(state, "p1").graveyard.some((c) => c.id === mtn.id)
        ).toBe(true);

        // Commit: move graveyard -> stack with the flashback flags, then resolve.
        const removed = removeFromZone(
            getPlayer(state, "p1"),
            dart.id,
            src.zone
        );
        const stackItem: StackItem = {
            ...removed,
            castById: "p1",
            targets: [{ type: "player", id: "p2" }],
            ...flashbackStackFlags(src.zone),
        };
        expect(stackItem.exileOnResolve).toBe(true);
        expect(stackItem.castFromGraveyard).toBe(true);
        state.stack.push(stackItem);
        resolveTopOfStack(state);

        // CR 115.4 / 702.34a — 1 damage dealt, then the flashback card is
        // EXILED as it resolves — never returned to the graveyard.
        expect(getPlayer(state, "p2").life).toBe(19);
        expect(getPlayer(state, "p1").exile.some((c) => c.id === dart.id)).toBe(
            true
        );
        expect(
            getPlayer(state, "p1").graveyard.some((c) => c.id === dart.id)
        ).toBe(false);
    });

    it("the flashback sacrifice does NOT fold onto a normal hand cast (CR 702.34a)", () => {
        const mtn = makeInstance(mountain.id, {
            id: "mtn2",
            controllerId: "p1",
            ownerId: "p1",
        });
        const dartInHand = makeInstance(lavaDart.id, {
            zone: "hand",
            controllerId: "p1",
            ownerId: "p1",
        });
        const p1 = makePlayer("p1", {
            hand: [dartInHand],
            battlefield: [mtn],
        });
        const state = makeState({ players: [p1, makePlayer("p2")] });

        const { selection } = buildCastSacrificeSelection(
            state,
            lavaDart.manaCost,
            dartInHand,
            getPlayer(state, "p1"),
            undefined,
            "Cast",
            "hand"
        );
        expect(selection).toBeUndefined();
    });

    it("a graveyard cast is blocked without a Mountain to sacrifice (getLegalActions)", async () => {
        const { getLegalActions } = await import("../../../../gre/rules");
        const dart = makeInstance(lavaDart.id, {
            zone: "graveyard",
            controllerId: "p1",
            ownerId: "p1",
        });
        // No Mountain (and grizzlyBears proves a non-land permanent doesn't
        // count) — the flashback sacrifice cost is unaffordable.
        const bear = makeInstance(grizzlyBears.id, {
            controllerId: "p1",
            ownerId: "p1",
        });
        const p1 = makePlayer("p1", {
            graveyard: [dart],
            battlefield: [bear],
        });
        const state = makeState({ players: [p1, makePlayer("p2")] });
        expect(getLegalActions(state, p1, dart)).toEqual([]);
    });
});
