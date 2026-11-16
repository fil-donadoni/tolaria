// A targets-set `forEach` member in a bare player position (CR 115.4): the
// `$each` that stands for an announced `{ target: n }` slot reads wherever the
// slot reads, so "target player discards two cards" swept through
// `forEach { set: "targets" }` (an overload body, CR 702.96a) names the player.

import { describe, it, expect } from "vitest";
import type { EffectOp } from "../../../cards/types";
import { registerTokenDefinition } from "../../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../cards/__tests__/setup.helper";
import { resolveTopOfStack } from "../../state";
import { validateEffectScript } from "../validate";

const BEAR_ID = "test-targets-member-bear";
registerTokenDefinition({
    id: BEAR_ID,
    name: BEAR_ID,
    rarity: "common",
    manaCost: { G: 2 },
    types: ["Creature"],
    power: 2,
    toughness: 2,
});

/** "Each of those targets gains 3 life", read through a bare `$each`. */
function sweep(select: Record<string, unknown>): EffectOp[] {
    return [
        {
            op: "forEach",
            select,
            effects: [{ op: "gainLife", player: { ref: "$each" }, amount: 3 }],
        } as EffectOp,
    ];
}

function registerSpell(id: string, effects: EffectOp[]): string {
    registerTokenDefinition({
        id,
        name: id,
        rarity: "common",
        manaCost: { B: 1 },
        types: ["Sorcery"],
        effects,
    });
    return id;
}

const GAIN_EACH = registerSpell(
    "test-targets-member-gain",
    sweep({ set: "targets" })
);

function playerMemberErrors(effects: EffectOp[]): string[] {
    return validateEffectScript({
        id: "test-targets-member-host",
        name: "Targets Member Host",
        types: ["Sorcery"],
        effects,
    }).filter((e) => /bare player position/.test(e));
}

describe("targets-set forEach $each in a bare player position (CR 115.4)", () => {
    it("validates: a targets-set member reads as a player", () => {
        expect(playerMemberErrors(sweep({ set: "targets" }))).toEqual([]);
    });

    it("validates: a graveyard-narrowed targets set holds cards, never a player", () => {
        expect(
            playerMemberErrors(sweep({ set: "targets", zone: "graveyard" }))
        ).toHaveLength(1);
    });

    it("resolves a player target member to that player", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const before = state.players[1].life;
        pushSpell(state, GAIN_EACH, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(before + 3);
        expect(state.players[0].life).toBe(before);
    });

    it("skips a permanent target member in the player position", () => {
        const bear = makeInstance(BEAR_ID, {
            controllerId: "p1",
            ownerId: "p1",
            id: "targetsMemberBear",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear] }),
                makePlayer("p2"),
            ],
        });
        const before = state.players[0].life;
        pushSpell(state, GAIN_EACH, "p1", [
            { type: "permanent", id: "targetsMemberBear" },
            { type: "player", id: "p2" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(before);
        expect(state.players[1].life).toBe(before + 3);
    });
});
