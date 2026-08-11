import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { getCardByName, getDefinition } from "../../../index";
import type { GameState, StackItem } from "../../../../gre/state";
import { resolveTopOfStack } from "../../../../gre/state";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { projectPublicState } from "../../../../gameProjections";
import { sunfall } from "../white";

// Sunfall — {3}{W}{W} Sorcery. "Exile all creatures. Incubate X, where X is
// the number of creatures exiled this way." (CR 701.13 exile; CR 701.53
// Incubate, issue #924/#1210.) Exercises the full Incubate composition end to
// end through the real card: dynamic X = creature count, a token-scoped
// "{2}: Transform this artifact." activated ability, and the front/back
// (Incubator → Phyrexian) transform.

const BEAR_ID = "ce2d603a-3231-4a8c-bf39-1617586ea870"; // Grizzly Bears (LEA), 2/2 vanilla

/** Pushes a "{2}: Transform this artifact." activation for `sourceId` onto
 *  the stack, mirroring the shape the real `game.ts` activateAbility
 *  mutation would push (same pattern the transform Op's own interpreter
 *  suite uses, `convex/gre/effects/__tests__/interpreter.test.ts`). */
function activateIncubatorTransform(
    state: GameState,
    controllerId: string,
    sourceId: string
): void {
    const src = state.players
        .find((p) => p.id === controllerId)!
        .battlefield.find((c) => c.id === sourceId)!;
    const item: StackItem = {
        ...src,
        zone: "stack",
        castById: controllerId,
        abilityId: "incubator-transform",
        targets: [],
    };
    state.stack.push(item);
}

describe("Sunfall (CR 701.13 exile, CR 701.53 Incubate, issue #924)", () => {
    it("pins the definition — mana cost, oracle text, DSL effects", () => {
        expect(sunfall.name).toBe("Sunfall");
        expect(sunfall.manaCost).toEqual({ generic: 3, W: 2 });
        expect(sunfall.types).toEqual(["Sorcery"]);
        expect(sunfall.oracleText).toContain("Exile all creatures");
        expect(getCardByName("Sunfall").id).toBe(sunfall.id);
    });

    it("exiles every creature on both battlefields and incubates X = that count", () => {
        const p1Bear1 = makeInstance(BEAR_ID, {
            id: "p1bear1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const p1Bear2 = makeInstance(BEAR_ID, {
            id: "p1bear2",
            controllerId: "p1",
            ownerId: "p1",
        });
        const p2Bear = makeInstance(BEAR_ID, {
            id: "p2bear1",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [p1Bear1, p1Bear2] }),
                makePlayer("p2", { battlefield: [p2Bear] }),
            ],
        });
        pushSpell(state, sunfall.id, "p1", []);
        resolveTopOfStack(state);

        const p1 = state.players.find((p) => p.id === "p1")!;
        const p2 = state.players.find((p) => p.id === "p2")!;

        // CR 701.13 — every creature is gone from both battlefields...
        expect(
            p1.battlefield.some((c) => c.id === "p1bear1" || c.id === "p1bear2")
        ).toBe(false);
        expect(p2.battlefield.some((c) => c.id === "p2bear1")).toBe(false);
        // ...and exiled under its OWNER (CR 400.7 default destination).
        expect(p1.exile.map((c) => c.id).sort()).toEqual([
            "p1bear1",
            "p1bear2",
        ]);
        expect(p2.exile.map((c) => c.id)).toEqual(["p2bear1"]);

        // CR 701.53 — Incubate X where X = 3 creatures exiled this way. The
        // Incubator token enters under the controller (p1, CR 111.2), not a
        // creature (no P/T), colorless Artifact, with 3 +1/+1 counters.
        const incubator = p1.battlefield.find((c) => c.isToken);
        expect(incubator).toBeDefined();
        const incubatorDef = getDefinition(
            (incubator!.card as { id: string }).id
        );
        expect(incubatorDef.name).toBe("Incubator");
        expect(incubator!.types).toEqual(["Artifact"]);
        expect(incubator!.counters).toEqual({ "+1/+1": 3 });
        expect(
            incubatorDef.activatedAbilities?.some(
                (a) => a.id === "incubator-transform"
            )
        ).toBe(true);
    });

    it("Incubate 0 (no creatures on either battlefield) drops the counter, still creates the token", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        pushSpell(state, sunfall.id, "p1", []);
        resolveTopOfStack(state);

        const p1 = state.players.find((p) => p.id === "p1")!;
        const incubator = p1.battlefield.find((c) => c.isToken);
        expect(incubator).toBeDefined();
        // CR 122 — "put N counters" with N <= 0 is a no-op, not a 0-stamp.
        expect(incubator!.counters).toBeUndefined();
    });

    it("the Incubator's counters and its transform ability survive projection (wire format)", () => {
        const p1Bear1 = makeInstance(BEAR_ID, {
            id: "wbear1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [p1Bear1] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, sunfall.id, "p1", []);
        resolveTopOfStack(state);

        const p1 = state.players.find((p) => p.id === "p1")!;
        const incubator = p1.battlefield.find((c) => c.isToken)!;
        expect(incubator.counters).toEqual({ "+1/+1": 1 });

        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players
            .find((p) => p.id === "p1")!
            .battlefield.find((c) => c.id === incubator.id)!;
        expect(slim.counters).toEqual({ "+1/+1": 1 });
        const slimDef = getDefinition((slim.card as { id: string }).id);
        expect(
            slimDef.activatedAbilities?.some(
                (a) => a.id === "incubator-transform"
            )
        ).toBe(true);
    });

    it("'{2}: Transform this artifact.' flips the Incubator into a 0/0 Phyrexian, carrying counters over", () => {
        const p1Bear1 = makeInstance(BEAR_ID, {
            id: "tbear1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const p1Bear2 = makeInstance(BEAR_ID, {
            id: "tbear2",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [p1Bear1, p1Bear2] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, sunfall.id, "p1", []);
        resolveTopOfStack(state);

        const p1 = state.players.find((p) => p.id === "p1")!;
        const incubator = p1.battlefield.find((c) => c.isToken)!;
        expect(incubator.counters).toEqual({ "+1/+1": 2 });

        activateIncubatorTransform(state, "p1", incubator.id);
        resolveTopOfStack(state);

        const flipped = state.players
            .find((p) => p.id === "p1")!
            .battlefield.find((c) => c.id === incubator.id)!;
        expect(flipped.transformed).toBe(true);
        expect(flipped.types).toEqual(["Artifact", "Creature"]);
        expect(flipped.subtypes).toEqual(["Phyrexian"]);
        expect(flipped.power).toBe(0);
        expect(flipped.toughness).toBe(0);
        // CR 122 — counters carry across the flip (transform doesn't remove
        // them); the layer system reads base 0/0 + 2 +1/+1 counters as 2/2.
        expect(flipped.counters).toEqual({ "+1/+1": 2 });
        expect(getEffectivePower(state, flipped)).toBe(2);
        expect(getEffectiveToughness(state, flipped)).toBe(2);

        // Wire format — the flip and the carried-over counters survive
        // projection identically (CR 712.6 — transform is always public,
        // no per-viewer hiding).
        const projected = projectPublicState(state, 2, "p2");
        const slim = projected.players
            .find((p) => p.id === "p1")!
            .battlefield.find((c) => c.id === flipped.id)!;
        expect(slim.transformed).toBe(true);
        expect(slim.counters).toEqual({ "+1/+1": 2 });
        expect(getEffectivePower(projected, slim)).toBe(2);
        expect(getEffectiveToughness(projected, slim)).toBe(2);
    });
});
