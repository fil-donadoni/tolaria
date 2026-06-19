import { describe, it, expect } from "vitest";
import { projectFullState, projectPublicState } from "@convex/gameProjections";
import type {
    CardInstanceState,
    GameState,
    PlayerState,
} from "@convex/gre/state";
import type { Player } from "../game";

// ---------------------------------------------------------------------------
// Type-compatibility contract: projection types must be assignable to the
// frontend Player type. Enforced at COMPILE time — if a future refactor drifts
// the shapes apart, these assignments fail `tsc` before tests ever run,
// preventing the class of bugs where `as unknown as Player[]` hid the issue.
// ---------------------------------------------------------------------------

function makeCard(id: string): CardInstanceState {
    return {
        id,
        card: { id: "def-" + id },
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
        types: ["Creature"],
        subtypes: [],
        staticAbilities: [],
        isTapped: false,
    };
}

function makePlayer(
    id: string,
    overrides: Partial<PlayerState> = {}
): PlayerState {
    return {
        id,
        name: id,
        bgColor: "#000",
        life: 20,
        hand: [],
        library: [],
        graveyard: [],
        exile: [],
        battlefield: [],
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        ...overrides,
    };
}

function makeState(): GameState {
    return {
        players: [
            makePlayer("p1", {
                hand: [makeCard("p1-h1")],
                library: [makeCard("p1-l1")],
            }),
            makePlayer("p2", {
                hand: [makeCard("p2-h1"), makeCard("p2-h2")],
                library: [makeCard("p2-l1"), makeCard("p2-l2")],
            }),
        ],
        stack: [],
        turn: 1,
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        passCount: 0,
        phase: "PRECOMBAT_MAIN",
        rngSeed: 0,
        rngCounter: 0,
    };
}

describe("projection ↔ frontend Player contract", () => {
    it("PublicPlayer[] is structurally assignable to frontend Player[]", () => {
        const result = projectPublicState(makeState(), 1, "p1");
        // This assignment is the actual contract: tsc errors out if incompatible.
        const asFrontend: Player[] = result.players;
        expect(asFrontend).toHaveLength(2);
        // Runtime sanity checks that mirror the runtime bugs caught in Oct 2026:
        //   - PlayerLibrary crashed because library was { count } at runtime.
        //   - PlayerHand crashed because opponent hand was (CardInstance | null)[].
        // ADR 0026 — library is the sparse { count, known } shape; no card
        // is `knownTo` the viewer here, so `known` is empty.
        expect(asFrontend[0].library).toEqual({ count: 1, known: [] });
        expect(
            (asFrontend[1].hand as (unknown | null)[]).every((c) => c === null)
        ).toBe(true);
    });

    it("colorOverride survives projection to frontend CardInstance", () => {
        const state = makeState();
        state.players[0].battlefield = [
            {
                ...makeCard("laced"),
                zone: "battlefield",
                colorOverride: ["R"],
            },
        ];
        const result = projectPublicState(state, 1, "p1");
        const card = result.players[0].battlefield[0];
        expect((card as { colorOverride?: string[] }).colorOverride).toEqual([
            "R",
        ]);
    });

    it("FullPlayer[] is structurally assignable to frontend Player[]", () => {
        const result = projectFullState(makeState(), 1);
        const asFrontend: Player[] = result.players;
        expect(asFrontend).toHaveLength(2);
        for (const p of asFrontend) {
            expect(Array.isArray(p.library)).toBe(true);
        }
    });
});
