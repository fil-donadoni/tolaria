// Effect Script grammar for CR 701.23h — the permanent tests each new member
// earns under the per-Op regime (`.claude/rules/gre-development.md`
// § DSL-first authoring). Nothing here names the card that needed them.
//
//  - `boundCount` (CR 608.2h / 701.23h) — how many iterations of an EARLIER
//    `forEach` captured a body snapshot binding, optionally only those whose
//    last-known controller is a given player: "for each creature exiled this
//    way, its controller …" read after the sweep.
//  - `choice.count: { min: 0, max: <EffectValue> }` — a COMPUTED search
//    ceiling, resolved as the choice is raised; at or below zero it raises
//    nothing, not even the no-hit library search.
//  - the validator's `iterated` binding family: a forEach body snapshot is
//    readable after the construct ONLY through `boundCount`.

import { describe, it, expect } from "vitest";
import type { EffectOp } from "../../../cards/types";
import { registerTokenDefinition } from "../../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../../cards/__tests__/setup.helper";
import { resolveTopOfStack, type GameState } from "../../state";
import { validateEffectScript } from "../validate";

const BODY_ID = "test-701-23h-body";
registerTokenDefinition({
    id: BODY_ID,
    name: BODY_ID,
    rarity: "common",
    manaCost: { G: 1 },
    types: ["Creature"],
    power: 1,
    toughness: 1,
});

const exileEveryCreature: EffectOp = {
    op: "forEach",
    select: {
        set: "permanents",
        zone: "battlefield",
        filter: { type: "Creature" },
    },
    effects: [{ op: "exile", target: { ref: "$each" }, bind: "$gone" }],
};

/** "Exile all creatures. Each player gains 1 life for each creature they
 *  controlled exiled this way; you gain 1 life for each creature exiled this
 *  way." — both readings of the value after one sweep. */
const COUNT_EFFECTS: EffectOp[] = [
    exileEveryCreature,
    {
        op: "forEach",
        select: { set: "players" },
        effects: [
            {
                op: "gainLife",
                player: { ref: "$each" },
                amount: {
                    boundCount: {
                        of: { ref: "$gone" },
                        controller: { ref: "$each" },
                    },
                },
            },
        ],
    },
    {
        op: "loseLife",
        player: "controller",
        amount: { boundCount: { of: { ref: "$gone" } } },
    },
];
const COUNT_ID = "test-701-23h-count";
registerTokenDefinition({
    id: COUNT_ID,
    name: COUNT_ID,
    rarity: "common",
    manaCost: { W: 1 },
    types: ["Sorcery"],
    effects: COUNT_EFFECTS,
});

/** "Exile all creatures. Each player may search their library for up to one
 *  card for each creature they controlled exiled this way." — no `if` gate, so
 *  the choice's own computed ceiling decides who is asked. */
const SEARCH_EFFECTS: EffectOp[] = [
    exileEveryCreature,
    {
        op: "forEach",
        select: { set: "players" },
        effects: [
            {
                op: "choice",
                kind: "search-library",
                player: { ref: "$each" },
                zone: "library",
                count: {
                    min: 0,
                    max: {
                        boundCount: {
                            of: { ref: "$gone" },
                            controller: { ref: "$each" },
                        },
                    },
                },
                prompt: "Search your library.",
                bind: "$found",
            },
        ],
    },
];
const SEARCH_ID = "test-701-23h-search";
registerTokenDefinition({
    id: SEARCH_ID,
    name: SEARCH_ID,
    rarity: "common",
    manaCost: { W: 1 },
    types: ["Sorcery"],
    effects: SEARCH_EFFECTS,
});

function body(id: string, controllerId: string, ownerId = controllerId) {
    return makeInstance(BODY_ID, { id, controllerId, ownerId });
}

function libraryCard(id: string, ownerId: string) {
    return makeInstance(BODY_ID, {
        id,
        controllerId: ownerId,
        ownerId,
        zone: "library",
    });
}

function castBy(state: GameState, cardId: string): void {
    state.stack.push({
        ...makeInstance(cardId, {
            id: "spell",
            controllerId: "p1",
            ownerId: "p1",
        }),
        zone: "stack",
        castById: "p1",
    });
}

describe("boundCount — an earlier sweep's captures, read after it (CR 608.2h / 701.23h)", () => {
    it("counts every capture, and per player by LAST-KNOWN controller", () => {
        // p2 controls three creatures, one of them stolen from p1: after the
        // exile it sits in p1's exile, and only the snapshot still says p2
        // controlled it.
        const state = makeState({
            players: [
                makePlayer("p1", { life: 20, battlefield: [body("a", "p1")] }),
                makePlayer("p2", {
                    life: 20,
                    battlefield: [
                        body("b", "p2"),
                        body("c", "p2"),
                        body("stolen", "p2", "p1"),
                    ],
                }),
            ],
        });
        castBy(state, COUNT_ID);
        resolveTopOfStack(state);
        expect(state.players[0].exile.map((c) => c.id).sort()).toEqual([
            "a",
            "stolen",
        ]);
        // p1 gains 1 (its one creature) and then loses 4 (every capture);
        // p2 gains 3 — the stolen creature counts for its CONTROLLER.
        expect(state.players[0].life).toBe(20 + 1 - 4);
        expect(state.players[1].life).toBe(20 + 3);
    });

    it("reads 0 for a player none of whose creatures was exiled", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { life: 20 }),
                makePlayer("p2", {
                    life: 20,
                    battlefield: [body("b", "p2")],
                }),
            ],
        });
        castBy(state, COUNT_ID);
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(20 - 1);
        expect(state.players[1].life).toBe(20 + 1);
    });
});

describe("choice — a computed { min: 0, max } search ceiling (CR 701.23h)", () => {
    it("raises ONE search for as many cards as the ceiling resolves to", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    library: [libraryCard("l1", "p1")],
                }),
                makePlayer("p2", {
                    battlefield: [
                        body("b", "p2"),
                        body("c", "p2"),
                        body("d", "p2"),
                    ],
                    library: [
                        libraryCard("m1", "p2"),
                        libraryCard("m2", "p2"),
                        libraryCard("m3", "p2"),
                        libraryCard("m4", "p2"),
                    ],
                }),
            ],
        });
        castBy(state, SEARCH_ID);
        resolveTopOfStack(state);
        // p1 had nothing exiled: its ceiling is 0, so it is never asked even
        // though its library holds a card the search would match.
        expect(state.pendingChoices).toHaveLength(1);
        const head = state.pendingChoices![0];
        expect(head.playerId).toBe("p2");
        expect(head.kind).toBe("search-library");
        expect(head.count).toEqual({ min: 0, max: 3 });
    });

    it("a ceiling of 0 raises nothing — not even the no-hit search an EMPTY library would get", () => {
        // p1 has nothing exiled AND an empty library: a literal-ceiling search
        // would still raise a 0-pick look (CR 701.23a); a computed 0 asks for no
        // card at all, so there is no search to perform.
        const state = makeState({
            players: [
                makePlayer("p1", { library: [] }),
                makePlayer("p2", {
                    battlefield: [body("b", "p2")],
                    library: [libraryCard("m1", "p2")],
                }),
            ],
        });
        castBy(state, SEARCH_ID);
        resolveTopOfStack(state);
        expect(state.pendingChoices?.map((c) => c.playerId)).toEqual(["p2"]);
    });
});

describe("validateEffectScript — the iterated binding family", () => {
    const probe = (effects: EffectOp[]) =>
        validateEffectScript({
            id: "test:701-23h-validate",
            name: "Probe",
            types: ["Sorcery"],
            effects,
        });

    it("accepts boundCount naming an earlier forEach body's snapshot", () => {
        expect(probe(COUNT_EFFECTS)).toEqual([]);
        expect(probe(SEARCH_EFFECTS)).toEqual([]);
    });

    it("refuses a single-object read of a body snapshot past its forEach", () => {
        const errors = probe([
            exileEveryCreature,
            {
                op: "gainLife",
                player: { ref: "$gone.controller" },
                amount: 1,
            },
        ]);
        expect(errors.join("\n")).toMatch(/\$gone/);
    });

    it("refuses boundCount over a binding no forEach body declared", () => {
        const errors = probe([
            {
                op: "exile",
                target: { target: 0 },
                bind: "$lone",
            },
            {
                op: "gainLife",
                player: "controller",
                amount: { boundCount: { of: { ref: "$lone" } } },
            },
        ]);
        expect(errors.join("\n")).toMatch(
            /boundCount ref "\$lone" must name a snapshot binding declared inside an earlier forEach body/
        );
    });

    it("refuses re-declaring an iterated name after the sweep", () => {
        const errors = probe([
            exileEveryCreature,
            { op: "exile", target: { target: 0 }, bind: "$gone" },
        ]);
        expect(errors.join("\n")).toMatch(/re-declares an existing binding/);
    });

    it("refuses carrying an iterated binding into a reflexive trigger", () => {
        const errors = probe([
            exileEveryCreature,
            {
                op: "reflexiveTrigger",
                oracleText: "When you do, gain 1 life per creature.",
                capture: { $gone: { ref: "$gone" } },
                effects: [
                    {
                        op: "gainLife",
                        player: "controller",
                        amount: { boundCount: { of: { ref: "$gone" } } },
                    },
                ],
            },
        ]);
        expect(errors.join("\n")).toMatch(
            /capture "\$gone" ref "\$gone" names an iterated binding/
        );
    });

    it("refuses a computed ceiling paired with a non-zero min", () => {
        const errors = probe([
            exileEveryCreature,
            {
                op: "choice",
                kind: "search-library",
                player: "controller",
                zone: "library",
                count: {
                    min: 1,
                    max: { boundCount: { of: { ref: "$gone" } } },
                },
                prompt: "Search.",
                bind: "$found",
            },
        ]);
        expect(errors.join("\n")).toMatch(
            /Op "choice" field "count" has invalid value/
        );
    });
});
