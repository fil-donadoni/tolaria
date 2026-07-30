import { describe, expect, it } from "vitest";
import { isManaCostCovered, manaCostToString } from "../card-utils";
import { normalizeManaCost } from "@convex/gre/state";
import { getDefinition } from "@convex/cards";
import { projectPublicState } from "@convex/gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "@convex/cards/__tests__/setup";

// Guild-hybrid pips on the CLIENT (CR 202.1a, issues #1738/#1740). Two cost
// SHAPES reach these helpers and both must work: a card's PRINTED cost (the
// `hybrid` colour-pair array) and a live `PendingCast.manaCost` (already
// NORMALIZED, pips as composite `"R/W"` keys).

const FIGURE_OF_DESTINY = "0da69523-cece-425a-b08a-fb27fac29374";

describe("manaCostToString renders hybrid pips (CR 202.1a)", () => {
    it("emits the printed `{R/W}` token, not a dropped pip", () => {
        expect(manaCostToString({ hybrid: [["R", "W"]] })).toBe("{R/W}");
        // The token maps to the `R_W.svg` symbol asset (slash → underscore),
        // exactly as `{B/P}` does — so the colour ORDER must be the printed
        // one, not WUBRG order.
        expect(manaCostToString({ hybrid: [["W", "R"]] })).toBe("{R/W}");
        expect(manaCostToString({ hybrid: [["W", "G"]] })).toBe("{G/W}");
    });

    it("orders generic before the pips", () => {
        expect(
            manaCostToString({
                generic: 1,
                hybrid: [
                    ["G", "W"],
                    ["G", "W"],
                ],
            })
        ).toBe("{1}{G/W}{G/W}");
    });

    it("renders a real card's printed cost", () => {
        const def = getDefinition(FIGURE_OF_DESTINY);
        expect(manaCostToString(def.manaCost)).toBe("{R/W}");
    });

    it("also renders a NORMALIZED cost's composite keys", () => {
        // The payment banner is handed `PendingCast.manaCost`, not a printed
        // cost — dropping this shape would make the owed pips invisible.
        const normalized = normalizeManaCost({
            generic: 1,
            hybrid: [["R", "W"]],
        });
        expect(manaCostToString(normalized)).toBe("{1}{R/W}");
    });
});

describe("client isManaCostCovered agrees with the engine (CR 601.2g)", () => {
    it("owes a hybrid pip from a printed cost", () => {
        const cost = { hybrid: [["R", "W"] as [string, string]] } as never;
        expect(isManaCostCovered({ R: 1 }, cost)).toBe(true);
        expect(isManaCostCovered({ W: 1 }, cost)).toBe(true);
        expect(isManaCostCovered({ G: 1 }, cost)).toBe(false);
        expect(isManaCostCovered({}, cost)).toBe(false);
    });

    it("owes a hybrid pip from a NORMALIZED cost too", () => {
        const cost = normalizeManaCost({
            generic: 1,
            hybrid: [["R", "W"]],
        }) as never;
        expect(isManaCostCovered({ R: 1, G: 1 }, cost)).toBe(true);
        // Two mana of an unrelated colour cover the generic but not the pip.
        expect(isManaCostCovered({ G: 2 }, cost)).toBe(false);
    });
});

// Frontend-wiring mandate (`.claude/rules/gre-development.md` § Frontend
// wiring analysis) — a hand-built `PendingCast`/cost object cannot prove the
// pip survives the wire; `pendingCast` must cross `projectPublicState`
// unmangled. It does today only because `projectPublicState` spreads
// `...state` and never touches `pendingCast`, but that is exactly the kind of
// silent field-drop the reducer walk exists to catch pre-emptively — assert
// it explicitly so a future projection rewrite that starts picking fields
// individually cannot drop it unnoticed (#1740).
describe("pendingCast hybrid pip survives projectPublicState (CR 202.1a, issue #1740)", () => {
    function stateWithHybridPendingCast() {
        const figure = makeInstance(FIGURE_OF_DESTINY, {
            id: "figure",
            zone: "hand",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [makePlayer("p1", { hand: [figure] }), makePlayer("p2")],
        });
        state.pendingCast = {
            playerId: "p1",
            cardInstanceId: "figure",
            // The pending cast carries the NORMALIZED shape (composite
            // "R/W" keys) — `announceCast` never leaves the printed
            // `hybrid` array on it.
            manaCost: normalizeManaCost(
                getDefinition(FIGURE_OF_DESTINY).manaCost!
            ),
            tappedLandIds: [],
        };
        return state;
    }

    it("is owed and clears on payment — on the FAT state", () => {
        const state = stateWithHybridPendingCast();
        const cost = state.pendingCast!.manaCost;
        expect(manaCostToString(cost)).toBe("{R/W}");
        expect(isManaCostCovered({}, cost)).toBe(false);
        expect(isManaCostCovered({ R: 1 }, cost)).toBe(true);
        expect(isManaCostCovered({ W: 1 }, cost)).toBe(true);
    });

    it("the same pip, read off the PROJECTED wire state, is still owed and payable", () => {
        const state = stateWithHybridPendingCast();
        for (const viewerId of ["p1", "p2"]) {
            const projected = projectPublicState(state, 1, viewerId);
            expect(projected.pendingCast, `viewer ${viewerId}`).toBeDefined();
            const wireCost = projected.pendingCast!.manaCost;
            expect(manaCostToString(wireCost), `viewer ${viewerId}`).toBe(
                "{R/W}"
            );
            expect(
                isManaCostCovered({}, wireCost),
                `viewer ${viewerId} empty pool`
            ).toBe(false);
            expect(
                isManaCostCovered({ R: 1 }, wireCost),
                `viewer ${viewerId} paid with R`
            ).toBe(true);
        }
    });
});
