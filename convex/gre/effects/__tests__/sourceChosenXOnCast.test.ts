// `$source.chosenXOnCast` — the X a permanent was cast with, read by its own
// ability's Effect Script (CR 400.7d), including through `divide`. The read has
// to survive what `{ X: true }` cannot: the save/load between a trigger going on
// the stack and resolving, and the source leaving in response (CR 608.2h).

import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../cards/__tests__/setup.helper";
import { registerTokenDefinition } from "../../../cards/registry";
import { enteredTrigger } from "../../../cards/abilities/triggers/enteredTrigger";
import type { CardDefinition } from "../../../cards/types";
import {
    putReanimatedSetOnBattlefield,
    removePermanentTo,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
} from "../../state";
import { compactState, expandState } from "../../serialize";

const SOURCE_ID = "test-cast-time-x-source";
const LIBRARY_CARD_ID = "test-cast-time-x-library-card";
const ETB_ID = "test-cast-time-x-etb";

registerTokenDefinition({
    id: LIBRARY_CARD_ID,
    name: "Test Cast-Time X Library Card",
    rarity: "common",
    manaCost: {},
    types: ["Sorcery"],
} satisfies CardDefinition);

registerTokenDefinition({
    id: SOURCE_ID,
    name: "Test Cast-Time X Source",
    rarity: "common",
    manaCost: { X: "X", U: 1 },
    types: ["Creature"],
    power: 1,
    toughness: 1,
    triggeredAbilities: [
        enteredTrigger({
            id: ETB_ID,
            oracleText:
                "When this creature enters, put X +1/+1 counters on it. Then draw half X cards, rounded down.",
            scope: "self",
            effects: [
                {
                    op: "counters",
                    action: "add",
                    counter: "+1/+1",
                    count: { ref: "$source.chosenXOnCast" },
                    target: { ref: "$source" },
                },
                {
                    op: "draw",
                    player: "controller",
                    count: {
                        divide: {
                            value: { ref: "$source.chosenXOnCast" },
                            by: 2,
                            rounding: "down",
                        },
                    },
                },
            ],
        }),
    ],
} satisfies CardDefinition);

function etbOnTheStack(x: number): {
    state: GameState;
    source: CardInstanceState;
} {
    const library = Array.from({ length: 6 }, (_, i) =>
        makeInstance(LIBRARY_CARD_ID, {
            id: `lib-${i}`,
            ownerId: "p1",
            zone: "library",
        })
    );
    const state = makeState({
        players: [makePlayer("p1", { library }), makePlayer("p2")],
    });
    const item = pushSpell(state, SOURCE_ID, "p1");
    item.chosenX = x;
    resolveTopOfStack(state);
    expect(state.stack[state.stack.length - 1].triggeredAbilityId).toBe(ETB_ID);
    const source = state.players[0].battlefield.find((c) => c.id === item.id)!;
    return { state, source };
}

describe("$source.chosenXOnCast in a trigger's script (CR 400.7d)", () => {
    it("reads the X the permanent was cast with, as an amount and as a divide dividend", () => {
        const { state, source } = etbOnTheStack(5);
        resolveTopOfStack(state);
        expect(source.counters?.["+1/+1"]).toBe(5);
        expect(state.players[0].hand).toHaveLength(2);
    });

    it("survives a save/load between the trigger going on the stack and resolving", () => {
        const { state } = etbOnTheStack(5);
        const reloaded = expandState(compactState(state));
        resolveTopOfStack(reloaded);
        expect(reloaded.players[0].battlefield[0].counters?.["+1/+1"]).toBe(5);
        expect(reloaded.players[0].hand).toHaveLength(2);
    });

    it("rounds the way `rounding` says at an odd and at a zero dividend (CR 107.1a)", () => {
        const one = etbOnTheStack(1);
        resolveTopOfStack(one.state);
        expect(one.source.counters?.["+1/+1"]).toBe(1);
        expect(one.state.players[0].hand).toHaveLength(0);
        const zero = etbOnTheStack(0);
        resolveTopOfStack(zero.state);
        expect(zero.source.counters?.["+1/+1"] ?? 0).toBe(0);
        expect(zero.state.players[0].hand).toHaveLength(0);
    });
});

describe("$source.chosenXOnCast once the source has left (CR 608.2h / 400.7)", () => {
    it("a source gone before resolution takes no counters, but the draw reads its last-known X, across a save/load", () => {
        const { state, source } = etbOnTheStack(5);
        removePermanentTo(state, source.id, "graveyard");
        const reloaded = expandState(compactState(state));
        resolveTopOfStack(reloaded);
        expect(reloaded.players[0].battlefield).toHaveLength(0);
        expect(reloaded.players[0].graveyard[0].counters).toBeUndefined();
        expect(reloaded.players[0].hand).toHaveLength(2);
    });

    it("a blinked source is a new object: no counters on it, and the draw still reads the old X", () => {
        const { state, source } = etbOnTheStack(5);
        const left = removePermanentTo(state, source.id, "exile")!;
        const owner = state.players[0];
        const idx = owner.exile.findIndex((c) => c.id === source.id);
        const [card] = owner.exile.splice(idx, 1);
        putReanimatedSetOnBattlefield(state, [
            { card, controllerId: left.ownerId },
        ]);
        resolveTopOfStack(state);
        const returned = owner.battlefield.find((c) => c.id === source.id)!;
        expect(returned.chosenXOnCast).toBeUndefined();
        expect(returned.counters?.["+1/+1"] ?? 0).toBe(0);
        expect(owner.hand).toHaveLength(2);
    });
});
