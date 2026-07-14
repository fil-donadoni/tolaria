// Unit tests for the `landfallTrigger` factory (Landfall ability word —
// CR 702 preamble; mechanically a CR 603.6a PERMANENT_ENTERED trigger gated to
// Lands you control, CR 109.2). Built once for the Landfall CAP (issue #694)
// and reused by every landfall card. The underlying scope/filter wiring is
// covered by `enteredTrigger.test.ts`; this file pins the landfall-specific
// contract: only a LAND controlled by the source's controller fires it.

import { describe, expect, it, vi } from "vitest";
import { landfallTrigger } from "../landfallTrigger";
import type {
    CardType,
    PermanentEnteredEvent,
    PermanentView,
    SpellContext,
} from "../../../types";

function makeSelf(overrides: Partial<PermanentView> = {}): PermanentView {
    return {
        id: "self",
        controllerId: "p1",
        ownerId: "p1",
        types: ["Creature"] as CardType[],
        subtypes: [],
        isTapped: false,
        card: {},
        ...overrides,
    };
}

function makeLandEvent(
    overrides: Partial<PermanentEnteredEvent> = {}
): PermanentEnteredEvent {
    return {
        type: "PERMANENT_ENTERED",
        instanceId: "land1",
        controllerId: "p1",
        types: ["Land"] as CardType[],
        ...overrides,
    };
}

describe("landfallTrigger factory (CR 603.6a / 109.2 — 'a land you control enters')", () => {
    it("declares PERMANENT_ENTERED as the event type", () => {
        const ability = landfallTrigger({
            id: "x",
            oracleText: "Landfall — ...",
            resolve: () => {},
        });
        expect(ability.event).toBe("PERMANENT_ENTERED");
    });

    it("fires when a LAND you control enters", () => {
        const ability = landfallTrigger({
            id: "x",
            oracleText: "Landfall — ...",
            resolve: () => {},
        });
        expect(
            ability.matches(makeLandEvent({ controllerId: "p1" }), makeSelf())
        ).toBe(true);
    });

    it("does NOT fire on an OPPONENT's land (CR 109.2 — you control)", () => {
        const ability = landfallTrigger({
            id: "x",
            oracleText: "Landfall — ...",
            resolve: () => {},
        });
        expect(
            ability.matches(makeLandEvent({ controllerId: "p2" }), makeSelf())
        ).toBe(false);
    });

    it("does NOT fire on a NON-land you control", () => {
        const ability = landfallTrigger({
            id: "x",
            oracleText: "Landfall — ...",
            resolve: () => {},
        });
        expect(
            ability.matches(
                makeLandEvent({
                    controllerId: "p1",
                    types: ["Creature"] as CardType[],
                }),
                makeSelf()
            )
        ).toBe(false);
    });

    it("carries a DSL effect script through to the ability (ADR 0045)", () => {
        const ability = landfallTrigger({
            id: "x",
            oracleText: "Landfall — ...",
            effects: [{ op: "draw", player: "controller", count: 1 }],
        });
        expect(ability.effects).toEqual([
            { op: "draw", player: "controller", count: 1 },
        ]);
        expect(ability.resolve).toBeUndefined();
    });

    it("delivers a flattened payload to an imperative `resolve`", () => {
        const seen = vi.fn();
        const ability = landfallTrigger({
            id: "x",
            oracleText: "Landfall — ...",
            resolve: (_ctx, _event, entered) => seen(entered),
        });
        ability.resolve!(
            {} as SpellContext,
            makeLandEvent({ instanceId: "fetched-land", controllerId: "p1" })
        );
        expect(seen).toHaveBeenCalledWith({
            id: "fetched-land",
            controllerId: "p1",
            types: ["Land"],
        });
    });
});
