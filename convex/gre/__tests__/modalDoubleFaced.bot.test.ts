// CR 712.12 (ADR 0122 §2) — the MOVE ENUMERATION half of the modal
// double-faced card's land play. Split from `modalDoubleFaced.test.ts` because
// `gre/moves.ts` is a bot-only module: `bot-suite-boundary.test.ts` keeps
// application tests out of it, so the enumerator's own assertions live in the
// bot suite.
//
// What it guards is REACHABILITY, the seam nothing catalogue-wide covers for a
// new card (`.claude/rules/gre-development.md` § Bot reachability): before this
// slice the three enumeration sites filtered candidates on
// `types.includes("Land")`, which is false for Sink into Stupor in every zone
// (CR 712.8a), so the Bot would hold the card forever and pass.

import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { enumerateMoves } from "../moves";

const SINK_INTO_STUPOR = "5358b87a-1a29-426d-b165-40c97da2c14d";
const FOREST = "6f1c8cb0-38eb-408b-94e8-16db83999b3b";

describe("modal double-faced land play — Move enumeration (CR 712.12)", () => {
    it("emits one play-land Move naming the BACK face", () => {
        const card = makeInstance(SINK_INTO_STUPOR, {
            id: "mdfc",
            controllerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [makePlayer("p1", { hand: [card] }), makePlayer("p2")],
        });

        expect(
            enumerateMoves(state, "p1").filter((m) => m.kind === "play-land")
        ).toEqual([
            { kind: "play-land", cardInstanceId: "mdfc", face: "back" },
        ]);
    });

    it("leaves an ordinary land's Move unmarked, so every existing Move compares equal", () => {
        const card = makeInstance(FOREST, {
            id: "forest",
            controllerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [makePlayer("p1", { hand: [card] }), makePlayer("p2")],
        });

        // Absent === "front" (ADR 0122 §2). A Move that spelled the front face
        // out would be a different object from every shipped blade entry and
        // every executor comparison, for no rules reason at all.
        expect(
            enumerateMoves(state, "p1").filter((m) => m.kind === "play-land")
        ).toEqual([{ kind: "play-land", cardInstanceId: "forest" }]);
    });
});
