// C13 — per-card behaviour tests for white cards in `convex/cards/sets/c13/white.ts`
// (set split by colour, ADR 0043).
//
// Unexpectedly Absent (issue #3242): "just beneath the top X cards" is the
// `{ beneathTop: X }` library position. The official rulings are the cases
// that matter — X = 0 puts the permanent on TOP, a library with fewer than X
// cards puts it on the bottom — plus CR 400.3: it goes to its OWNER's library.

import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { resolveTopOfStack } from "../../../../gre/state";
import { unexpectedlyAbsent } from "../white";

const GRIZZLY_BEARS_ID = "ce2d603a-3231-4a8c-bf39-1617586ea870";

function castWithX(x: number): string[] {
    const stolen = makeInstance(GRIZZLY_BEARS_ID, {
        id: "stolen",
        controllerId: "p1",
        ownerId: "p2",
    });
    const library = ["libA", "libB"].map((id) =>
        makeInstance(GRIZZLY_BEARS_ID, {
            id,
            controllerId: "p2",
            ownerId: "p2",
            zone: "library",
        })
    );
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [stolen] }),
            makePlayer("p2", { library }),
        ],
    });
    const item = pushSpell(state, unexpectedlyAbsent.id, "p1", [
        { type: "permanent", id: "stolen" },
    ]);
    item.chosenX = x;
    resolveTopOfStack(state);
    expect(state.players[0].battlefield).toHaveLength(0);
    expect(state.players[0].library).toHaveLength(0);
    return state.players[1].library.map((c) => c.id);
}

describe("Unexpectedly Absent (issue #3242)", () => {
    it("X = 0 puts the permanent on top of its OWNER's library", () => {
        expect(castWithX(0)).toEqual(["stolen", "libA", "libB"]);
    });

    it("X = 1 puts it just beneath the top card", () => {
        expect(castWithX(1)).toEqual(["libA", "stolen", "libB"]);
    });

    it("X larger than the library puts it on the bottom", () => {
        expect(castWithX(5)).toEqual(["libA", "libB", "stolen"]);
    });
});
