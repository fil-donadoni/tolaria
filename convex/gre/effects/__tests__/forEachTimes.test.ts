// Effect Script grammar for issue #1368 — the permanent tests the two new
// members earn under the per-Op regime (`.claude/rules/gre-development.md`
// § DSL-first authoring):
//
//  - `forEach { set: "times", count }` — N independent repetitions of the
//    body, the count read ONCE at construct entry (CR 608.2h) and frozen; a
//    suspending body Op (`optionChoice`) resumes on every iteration.
//  - `counters.bindCount` — how many counters the Op ACTUALLY moved, readable
//    as a `{ ref }` after the removal emptied the live count (CR 609.3).
//
// Plus the full path the two compose into (Coalition Relic): a real phase
// advance into the precombat main phase (CR 505.1a), the colour choices
// answered through the Pending Choice submit seam, and the result read
// through `projectPublicState`.

import { describe, it, expect } from "vitest";
import type { EffectOp } from "../../../cards/types";
import { registerTokenDefinition } from "../../../cards";
import { colorChoiceModes } from "../../../cards/abilities/chooseColor";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
    resolveTriggerOrder,
    submitChoice,
} from "../../../cards/__tests__/setup.helper";
import { resolveTopOfStack, type GameState } from "../../state";
import { advancePhase } from "../../phases";
import { projectPublicState } from "../../../gameProjections";
import { validateEffectScript } from "../validate";

/** "Add one mana of any color" — the five-mode colour `optionChoice`. */
const ONE_MANA_ANY_COLOR: EffectOp = {
    op: "optionChoice",
    prompt: "Choose a color to add one mana of.",
    modes: colorChoiceModes((color) => [
        { op: "addMana", mana: { [color]: 1 } },
    ]),
};

function registerSpell(id: string, effects: EffectOp[]): string {
    registerTokenDefinition({
        id,
        name: id,
        rarity: "common",
        manaCost: { R: 1 },
        types: ["Instant"],
        effects,
    });
    return id;
}

const ADD_THREE = registerSpell("test-1368-times-three", [
    {
        op: "forEach",
        select: { set: "times", count: 3 },
        effects: [ONE_MANA_ANY_COLOR],
    },
]);

const ADD_NONE = registerSpell("test-1368-times-zero", [
    {
        op: "forEach",
        select: { set: "times", count: 0 },
        effects: [ONE_MANA_ANY_COLOR],
    },
    { op: "gainLife", player: "controller", amount: 1 },
]);

/** The count is frozen at entry: the body's own counter removal would
 *  shrink a live `{ counters }` read to 0 after the first iteration. */
const FROZEN = registerSpell("test-1368-times-frozen", [
    {
        op: "forEach",
        select: {
            set: "times",
            count: { counters: { of: { target: 0 }, type: "charge" } },
        },
        effects: [
            {
                op: "counters",
                action: "remove",
                counter: "charge",
                target: { target: 0 },
                count: 99,
            },
            { op: "gainLife", player: "controller", amount: 1 },
        ],
    },
]);

/** "Remove all charge counters from target permanent, then gain 1 life for
 *  each counter removed this way." */
const REMOVE_ALL = registerSpell("test-1368-bindcount-remove", [
    {
        op: "counters",
        action: "remove",
        counter: "charge",
        target: { target: 0 },
        count: { counters: { of: { target: 0 }, type: "charge" } },
        bindCount: "$removed",
    },
    { op: "gainLife", player: "controller", amount: { ref: "$removed" } },
]);

/** "Put two charge counters on target permanent, then gain 1 life for each
 *  counter put this way." */
const ADD_TWO = registerSpell("test-1368-bindcount-add", [
    {
        op: "counters",
        action: "add",
        counter: "charge",
        target: { target: 0 },
        count: 2,
        bindCount: "$added",
    },
    { op: "gainLife", player: "controller", amount: { ref: "$added" } },
]);

/** Coalition Relic's print id (`fut/colorless.cards.ts`). */
const COALITION_RELIC_ID = "7a7c98b0-d64d-4d0a-b284-1187a8e7095e";

/** `validateEffectScript` over a spell-shaped host. */
function validate(effects: EffectOp[]): string[] {
    return validateEffectScript({
        id: "test-1368",
        name: "test-1368",
        effects,
    });
}

const ROCK_ID = "test-1368-rock";
registerTokenDefinition({
    id: ROCK_ID,
    name: ROCK_ID,
    rarity: "common",
    manaCost: { X: 1 },
    types: ["Artifact"],
});

function rock(charge: number) {
    return makeInstance(ROCK_ID, {
        id: "rock",
        controllerId: "p1",
        ownerId: "p1",
        ...(charge > 0 ? { counters: { charge } } : {}),
    });
}

const ROCK_TARGET = [{ type: "permanent" as const, id: "rock" }];

function pool(state: GameState): Record<string, number> {
    return Object.fromEntries(
        Object.entries(state.players[0].manaPool).filter(([, n]) => n > 0)
    );
}

describe('forEach { set: "times" } — N repetitions (issue #1368, CR 608.2h)', () => {
    it("count 3 with an optionChoice body: three independent prompts, each resumes, the pool holds the three picks", () => {
        const state = makeState();
        pushSpell(state, ADD_THREE, "p1");
        expect(resolveTopOfStack(state)).toBeNull(); // suspended on pick 1

        const picks = ["R", "R", "G"];
        for (const [i, color] of picks.entries()) {
            const head = state.pendingChoices![0];
            expect(head.kind).toBe("option-pick");
            expect(head.playerId).toBe("p1");
            // CR 106.1a — the five colours, never colourless.
            expect(head.options?.map((o) => o.id)).toEqual([
                "W",
                "U",
                "B",
                "R",
                "G",
            ]);
            // Every prompt is a NEW iteration's choice, not a replay.
            expect(state.stack).toHaveLength(1);
            submitChoice(state, [color]);
            if (i < picks.length - 1) {
                expect(state.pendingChoices).toHaveLength(1);
            }
        }
        expect(state.pendingChoices).toBeUndefined();
        expect(state.stack).toHaveLength(0);
        expect(pool(state)).toEqual({ R: 2, G: 1 });
    });

    it("count 0: no iteration, no prompt — the rest of the script runs", () => {
        const state = makeState();
        pushSpell(state, ADD_NONE, "p1");
        resolveTopOfStack(state);
        expect(state.pendingChoices).toBeUndefined();
        expect(pool(state)).toEqual({});
        expect(state.players[0].life).toBe(21);
    });

    it("freezes the count at construct entry: a body that removes what the count reads still runs every iteration", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [rock(3)] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, FROZEN, "p1", ROCK_TARGET);
        resolveTopOfStack(state);
        // Three iterations from the count read at entry, though the first
        // iteration's removal leaves the live count at 0.
        expect(state.players[0].life).toBe(23);
        expect(state.players[0].battlefield[0].counters).toBeUndefined();
    });
});

describe("counters.bindCount — the number actually moved (issue #1368, CR 609.3)", () => {
    it("remove all from a permanent with k counters binds k, read back through { ref }", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [rock(4)] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, REMOVE_ALL, "p1", ROCK_TARGET);
        resolveTopOfStack(state);
        expect(state.players[0].battlefield[0].counters).toBeUndefined();
        expect(state.players[0].life).toBe(24);
    });

    it("remove all from a permanent with none binds 0", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [rock(0)] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, REMOVE_ALL, "p1", ROCK_TARGET);
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(20);
    });

    it("an add binds the counters the placement put", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [rock(1)] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, ADD_TWO, "p1", ROCK_TARGET);
        resolveTopOfStack(state);
        expect(state.players[0].battlefield[0].counters).toEqual({ charge: 3 });
        expect(state.players[0].life).toBe(22);
    });
});

describe('validator — forEach { set: "times" } (issue #1368)', () => {
    it("accepts a times body and a count reading an earlier bindCount", () => {
        expect(
            validate([
                {
                    op: "counters",
                    action: "remove",
                    counter: "charge",
                    target: { target: 0 },
                    count: 1,
                    bindCount: "$n",
                },
                {
                    op: "forEach",
                    select: { set: "times", count: { ref: "$n" } },
                    effects: [ONE_MANA_ANY_COLOR],
                },
            ])
        ).toEqual([]);
    });

    it("rejects a body reading $each — an iteration index is not an object", () => {
        const errors = validate([
            {
                op: "forEach",
                select: { set: "times", count: 2 },
                effects: [{ op: "destroy", target: { ref: "$each" } }],
            },
        ]);
        expect(errors.some((e) => e.includes('"$each"'))).toBe(true);
    });

    it("rejects a count ref no earlier Op binds", () => {
        const errors = validate([
            {
                op: "forEach",
                select: { set: "times", count: { ref: "$nope" } },
                effects: [ONE_MANA_ANY_COLOR],
            },
        ]);
        expect(errors.some((e) => e.includes('"$nope"'))).toBe(true);
    });

    it("rejects simultaneous and stray selector fields", () => {
        const simultaneous = validate([
            {
                op: "forEach",
                select: { set: "times", count: 2 },
                simultaneous: true,
                effects: [ONE_MANA_ANY_COLOR],
            },
        ]);
        expect(simultaneous.length).toBeGreaterThan(0);
        const stray = validate([
            {
                op: "forEach",
                select: { set: "times", count: 2, controller: "controller" },
                effects: [ONE_MANA_ANY_COLOR],
            } as unknown as EffectOp,
        ]);
        expect(stray.length).toBeGreaterThan(0);
    });
});

describe("Coalition Relic — full path (issue #1368, CR 505.1a)", () => {
    function relicBoard(charge: number, phase: GameState["phase"]) {
        return makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(COALITION_RELIC_ID, {
                            id: "relic",
                            controllerId: "p1",
                            ownerId: "p1",
                            ...(charge > 0 ? { counters: { charge } } : {}),
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
            phase,
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });
    }

    function relic(state: GameState) {
        return state.players[0].battlefield.find((c) => c.id === "relic")!;
    }

    it("advancing into the precombat main phase: two counters → two colour choices, the pool and the counters as answered", () => {
        const state = relicBoard(2, "DRAW");
        advancePhase(state);
        resolveTriggerOrder(state);
        expect(state.phase).toBe("PRECOMBAT_MAIN");
        expect(state.stack).toHaveLength(1);

        expect(resolveTopOfStack(state)).toBeNull(); // first colour
        expect(relic(state).counters).toBeUndefined(); // removed first

        // Wire: the pending colour choice reaches the client's view.
        const view = projectPublicState(state, 1, "p1");
        const pending = view.pendingChoices?.[0];
        expect(pending?.kind).toBe("option-pick");
        expect(pending?.options?.map((o) => o.id)).toEqual([
            "W",
            "U",
            "B",
            "R",
            "G",
        ]);

        submitChoice(state, ["U"]);
        expect(state.pendingChoices?.[0]?.kind).toBe("option-pick");
        submitChoice(state, ["U"]);
        expect(state.pendingChoices).toBeUndefined();
        expect(state.stack).toHaveLength(0);
        expect(pool(state)).toEqual({ U: 2 });

        // Wire: the resulting pool is what the client sees.
        const after = projectPublicState(state, 2, "p1");
        const me = after.players.find((p) => p.id === "p1")!;
        expect(me.manaPool.U).toBe(2);
    });

    it("with no charge counters the trigger adds nothing and asks nothing", () => {
        const state = relicBoard(0, "DRAW");
        advancePhase(state);
        resolveTriggerOrder(state);
        if (state.stack.length > 0) resolveTopOfStack(state);
        expect(state.pendingChoices).toBeUndefined();
        expect(pool(state)).toEqual({});
    });

    it("does NOT trigger at the beginning of a postcombat main phase", () => {
        const state = relicBoard(2, "END_OF_COMBAT");
        advancePhase(state);
        resolveTriggerOrder(state);
        expect(state.phase).toBe("POSTCOMBAT_MAIN");
        expect(state.stack).toHaveLength(0);
        expect(relic(state).counters).toEqual({ charge: 2 });
    });
});
