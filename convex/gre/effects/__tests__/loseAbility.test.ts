// `loseAbility` Op — a permanent loses ONE keyword (CR 613.1f layer 6,
// issue #2125). The Op's permanent test (per-Op regime, ADR 0045): every leg
// runs through the REAL resolution path (`pushSpell` / `resolveActivated` →
// `resolveTopOfStack`), and one assertion reads the projection the client
// receives (`projectPublicState`).
//
//  - TIMED leg ("loses flying until end of turn", Radjan Spirit / Vertigo):
//    the keyword comes back at cleanup (CR 611.2a).
//  - INDEFINITE leg ("it loses defender", Elder Land Wurm): no duration stated,
//    so it lasts until the end of the game (CR 611.2a) — cleanup leaves it.
//  - TIMESTAMP order (CR 613.7, layer 6): a grant AFTER the removal survives
//    it; a grant BEFORE it is removed. Both orders, both legs.
//  - CR 400.7: a permanent that leaves and returns is a new object — no
//    removal residue follows it back.
//  - Construct sites: an announced slot, `$source`, a forEach `$each`.

import { describe, expect, it } from "vitest";
import { registerTokenDefinition } from "../../../cards";
import type {
    CardDefinition,
    EffectOp,
    TargetSelection,
} from "../../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
    resolveActivated,
} from "../../../cards/__tests__/setup.helper";
import { resolveTopOfStack } from "../../state";
import type { CardInstanceState, GameState } from "../../state";
import { finalizeCleanup } from "../../phases";
import { projectPublicState } from "../../../gameProjections";

/** A synthetic DSL-only sorcery under a stable test id (the registry's
 *  injection seam, as `interpreter.test.ts` registers its scripts). */
function registerScript(
    id: string,
    effects: EffectOp[],
    extra: Partial<CardDefinition> = {}
): string {
    registerTokenDefinition({
        id,
        name: id,
        rarity: "common",
        manaCost: { R: 1 },
        types: ["Sorcery"],
        effects,
        ...extra,
    });
    return id;
}

/** A 2/2 with defender AND flying: one drawback keyword, one evasion keyword,
 *  so a removal of one must leave the other standing. */
const WALL_ID = "test-loseability-flying-wall";
registerTokenDefinition({
    id: WALL_ID,
    name: WALL_ID,
    rarity: "common",
    manaCost: { X: 1, W: 1 },
    types: ["Creature"],
    subtypes: ["Wall"],
    power: 2,
    toughness: 2,
    staticAbilities: ["defender", "flying"],
});

/** The same body with a self-targeted activated ability: "{0}: This creature
 *  loses defender." — the `$source` site, indefinite. */
const SELF_ID = "test-loseability-self";
registerTokenDefinition({
    id: SELF_ID,
    name: SELF_ID,
    rarity: "common",
    manaCost: { X: 1, W: 1 },
    types: ["Creature"],
    subtypes: ["Wall"],
    power: 2,
    toughness: 2,
    staticAbilities: ["defender", "flying"],
    activatedAbilities: [
        {
            id: "self-lose-defender",
            oracleText: "{0}: This creature loses defender.",
            cost: {},
            useStack: true,
            effects: [
                {
                    op: "loseAbility",
                    target: { ref: "$source" },
                    ability: "defender",
                },
            ],
        },
    ],
});

const LOSE_FLYING_EOT = registerScript("test-loseability-flying-eot", [
    {
        op: "loseAbility",
        target: { target: 0 },
        ability: "flying",
        duration: { phase: "end-of-turn" },
    },
]);
const LOSE_DEFENDER = registerScript("test-loseability-defender", [
    { op: "loseAbility", target: { target: 0 }, ability: "defender" },
]);
const GRANT_FLYING_EOT = registerScript("test-loseability-grant-flying-eot", [
    {
        op: "grantAbility",
        target: { target: 0 },
        ability: "flying",
        duration: { phase: "end-of-turn" },
    },
]);
const GRANT_DEFENDER = registerScript("test-loseability-grant-defender", [
    { op: "grantAbility", target: { target: 0 }, ability: "defender" },
]);

const AT_WALL: TargetSelection[] = [{ type: "permanent", id: "wall" }];

/** p2 controls the flying Wall; p1 casts at it. */
function wallState(): GameState {
    return makeState({
        players: [
            makePlayer("p1"),
            makePlayer("p2", {
                battlefield: [
                    makeInstance(WALL_ID, {
                        id: "wall",
                        controllerId: "p2",
                        ownerId: "p2",
                    }),
                ],
            }),
        ],
    });
}

function wall(state: GameState): CardInstanceState {
    return state.players[1].battlefield.find((c) => c.id === "wall")!;
}

function cast(state: GameState, scriptId: string): void {
    pushSpell(state, scriptId, "p1", AT_WALL);
    resolveTopOfStack(state);
}

function cleanup(state: GameState): void {
    state.phase = "CLEANUP";
    finalizeCleanup(state);
}

describe("Effect Script Op: loseAbility — timed leg (CR 613.1f, CR 611.2a)", () => {
    it("removes exactly the named keyword until end of turn, then it returns", () => {
        const state = wallState();
        expect(wall(state).staticAbilities).toEqual(["defender", "flying"]);
        cast(state, LOSE_FLYING_EOT);
        expect(wall(state).staticAbilities).toEqual(["defender"]);
        cleanup(state);
        expect(wall(state).staticAbilities).toContain("flying");
    });

    it("a keyword GRANTED after the removal survives it (CR 613.7)", () => {
        const state = wallState();
        cast(state, LOSE_FLYING_EOT);
        cast(state, GRANT_FLYING_EOT);
        expect(wall(state).staticAbilities).toContain("flying");
    });

    it("a keyword granted BEFORE the removal is removed with it (CR 613.7)", () => {
        const state = wallState();
        // The printed flying plus a granted occurrence: the removal, later in
        // timestamp order than both, takes every occurrence of the keyword.
        cast(state, GRANT_FLYING_EOT);
        cast(state, LOSE_FLYING_EOT);
        expect(wall(state).staticAbilities).not.toContain("flying");
    });
});

describe("Effect Script Op: loseAbility — indefinite leg (CR 611.2a)", () => {
    it("an omitted duration outlasts cleanup", () => {
        const state = wallState();
        cast(state, LOSE_DEFENDER);
        expect(wall(state).staticAbilities).toEqual(["flying"]);
        cleanup(state);
        expect(wall(state).staticAbilities).toEqual(["flying"]);
    });

    it("a keyword GRANTED after the indefinite removal survives it (CR 613.7)", () => {
        const state = wallState();
        cast(state, LOSE_DEFENDER);
        cast(state, GRANT_DEFENDER);
        expect(wall(state).staticAbilities).toContain("defender");
    });

    it("an indefinite grant made BEFORE the removal is removed (CR 613.7)", () => {
        const state = wallState();
        cast(state, GRANT_DEFENDER);
        cast(state, LOSE_DEFENDER);
        expect(wall(state).staticAbilities).not.toContain("defender");
        cleanup(state);
        expect(wall(state).staticAbilities).not.toContain("defender");
    });

    it("leaves no residue on the object a zone change creates (CR 400.7)", () => {
        const blink = registerScript("test-loseability-blink", [
            { op: "exile", target: { target: 0 }, bind: "$c" },
            { op: "moveZone", target: { ref: "$c" }, to: "battlefield" },
        ]);
        const state = wallState();
        cast(state, LOSE_DEFENDER);
        expect(wall(state).staticAbilities).not.toContain("defender");
        cast(state, blink);
        const returned = state.players[1].battlefield.find(
            (c) => c.id === "wall"
        );
        expect(returned).toBeDefined();
        expect(returned!.staticAbilities).toContain("defender");
    });

    it("is a no-op when the target is gone (CR 608.2b) and still resolves", () => {
        const state = wallState();
        pushSpell(state, LOSE_DEFENDER, "p1", [
            { type: "permanent", id: "ghost" },
        ]);
        expect(() => resolveTopOfStack(state)).not.toThrow();
        expect(wall(state).staticAbilities).toEqual(["defender", "flying"]);
    });
});

describe("Effect Script Op: loseAbility — construct sites", () => {
    it("$source: the activated ability's own permanent loses defender", () => {
        const self = makeInstance(SELF_ID, {
            id: "self",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [self] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, self, "self-lose-defender");
        const after = state.players[0].battlefield.find(
            (c) => c.id === "self"
        )!;
        expect(after.staticAbilities).toEqual(["flying"]);
    });

    it("forEach $each: every creature on every battlefield loses flying (the sweep shape)", () => {
        const sweep = registerScript("test-loseability-sweep", [
            {
                op: "forEach",
                select: {
                    set: "permanents",
                    zone: "battlefield",
                    filter: { type: "Creature" },
                },
                effects: [
                    {
                        op: "loseAbility",
                        target: { ref: "$each" },
                        ability: "flying",
                        duration: { phase: "end-of-turn" },
                    },
                ],
            },
        ]);
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(WALL_ID, {
                            id: "mine",
                            controllerId: "p1",
                            ownerId: "p1",
                        }),
                    ],
                }),
                makePlayer("p2", {
                    battlefield: [
                        makeInstance(WALL_ID, {
                            id: "theirs",
                            controllerId: "p2",
                            ownerId: "p2",
                        }),
                    ],
                }),
            ],
        });
        pushSpell(state, sweep, "p1", []);
        resolveTopOfStack(state);
        for (const player of state.players)
            for (const card of player.battlefield)
                expect(card.staticAbilities).toEqual(["defender"]);
    });
});

describe("Effect Script Op: loseAbility — wire format", () => {
    it("the removal survives projection: the client sees the keyword gone", () => {
        const state = wallState();
        cast(state, LOSE_FLYING_EOT);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[1].battlefield.find(
            (c) => c.id === "wall"
        )!;
        expect(slim.staticAbilities).toEqual(["defender"]);
    });
});
