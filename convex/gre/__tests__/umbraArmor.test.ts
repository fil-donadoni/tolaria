// Umbra armor (CR 702.89a): "If enchanted permanent would be destroyed, instead
// remove all damage marked on it and destroy this Aura." Driven through the real
// destroy chokepoint: an Effect Script at resolution, the SBA sweeps, a mass
// destroy on either player's board.

import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import { getCardByName } from "../../cards";
import { registerTokenDefinition } from "../../cards/registry";
import type { CardDefinition, EffectOp } from "../../cards/types";
import { checkStateBasedActions } from "../sba";
import {
    destroyWithReplacements,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
} from "../state";

const AURA: CardDefinition = {
    id: "test-umbra-armor-aura",
    name: "Test Umbra",
    rarity: "common",
    manaCost: { G: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    staticAbilities: ["umbra armor"],
    targetRequirement: { type: "Creature", count: 1 },
};
registerTokenDefinition(AURA);

function script(id: string, effects: EffectOp[]): string {
    registerTokenDefinition({
        id,
        name: id,
        rarity: "common",
        manaCost: { R: 1 },
        types: ["Sorcery"],
        effects,
    });
    return id;
}

const BEARS_ID = getCardByName("Grizzly Bears").id;

const host = (over: Partial<CardInstanceState> = {}) =>
    makeInstance(BEARS_ID, {
        id: "host",
        controllerId: "p1",
        ownerId: "p1",
        ...over,
    });

const umbra = (
    id = "umbra",
    controllerId = "p1",
    over: Partial<CardInstanceState> = {}
) =>
    makeInstance(AURA.id, {
        id,
        controllerId,
        ownerId: controllerId,
        attachedTo: "host",
        staticAbilities: ["umbra armor"],
        ...over,
    });

function board(
    p1: CardInstanceState[],
    p2: CardInstanceState[] = [],
    over: Partial<GameState> = {}
): GameState {
    return makeState({
        players: [
            makePlayer("p1", { battlefield: p1 }),
            makePlayer("p2", { battlefield: p2 }),
        ],
        ...over,
    });
}

const ids = (cards: CardInstanceState[]) => cards.map((c) => c.id);

describe("umbra armor replaces the destruction (CR 702.89a)", () => {
    it("a destroy effect keeps the permanent, removes its damage and destroys the Aura instead", () => {
        const state = board([host({ damageMarked: 1 }), umbra()]);
        const destroyed = destroyWithReplacements(state, "host");
        expect(destroyed).toBe(false);
        expect(ids(state.players[0].battlefield)).toEqual(["host"]);
        expect(state.players[0].battlefield[0].damageMarked).toBeUndefined();
        expect(ids(state.players[0].graveyard)).toEqual(["umbra"]);
    });

    it("is not regeneration: the permanent stays untapped and in combat, and a can't-be-regenerated destroy is still replaced (CR 701.19c)", () => {
        const state = board([host({ isAttacking: true }), umbra()], [], {
            combat: {
                attackerIds: ["host"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: false,
            },
        });
        expect(
            destroyWithReplacements(state, "host", { cantBeRegenerated: true })
        ).toBe(false);
        const saved = state.players[0].battlefield[0];
        expect(saved.isTapped).toBeFalsy();
        expect(saved.isAttacking).toBe(true);
        expect(state.combat?.attackerIds).toEqual(["host"]);
    });

    it("an Effect Script destroy resolving on the host is replaced", () => {
        const state = board([host(), umbra()]);
        const id = script("test-umbra-destroy", [
            { op: "destroy", target: { target: 0 } },
        ]);
        pushSpell(state, id, "p2", [{ type: "permanent", id: "host" }]);
        resolveTopOfStack(state);
        expect(ids(state.players[0].battlefield)).toEqual(["host"]);
        expect(ids(state.players[0].graveyard)).toEqual(["umbra"]);
    });

    it("lethal damage is replaced by the SBA's destroy (CR 704.5g)", () => {
        const state = board([host({ damageMarked: 5 }), umbra()]);
        checkStateBasedActions(state);
        expect(ids(state.players[0].battlefield)).toEqual(["host"]);
        expect(state.players[0].battlefield[0].damageMarked).toBeUndefined();
        expect(ids(state.players[0].graveyard)).toEqual(["umbra"]);
    });

    it("lethal and deathtouch damage in one SBA check cost a single Aura (CR 704.5g, CR 704.5h)", () => {
        const state = board([
            host({ damageMarked: 5, dealtDeathtouchDamage: true }),
            umbra("first"),
            umbra("second"),
        ]);
        checkStateBasedActions(state);
        expect(ids(state.players[0].battlefield)).toEqual(["host", "second"]);
        expect(ids(state.players[0].graveyard)).toEqual(["first"]);
        // The mark is spent: the next SBA check has nothing to destroy for.
        checkStateBasedActions(state);
        expect(ids(state.players[0].battlefield)).toEqual(["host", "second"]);
    });

    it("an Aura under another player's control protects the host, and goes to its owner's graveyard (CR 303.4e)", () => {
        const state = board([host()], [umbra("umbra", "p2")]);
        expect(destroyWithReplacements(state, "host")).toBe(false);
        expect(ids(state.players[0].battlefield)).toEqual(["host"]);
        expect(ids(state.players[1].graveyard)).toEqual(["umbra"]);
    });
});

describe("what umbra armor does not replace (CR 702.89a)", () => {
    it("an indestructible host is never destroyed, so the Aura stays (CR 702.12b)", () => {
        const state = board([
            host({ staticAbilities: ["indestructible"], damageMarked: 5 }),
            umbra(),
        ]);
        checkStateBasedActions(state);
        destroyWithReplacements(state, "host");
        expect(ids(state.players[0].battlefield)).toEqual(["host", "umbra"]);
        expect(state.players[0].battlefield[0].damageMarked).toBe(5);
    });

    it("a sacrifice is no destruction: host gone, Aura follows by SBA (CR 701.21)", () => {
        const sacrificeHost: CardDefinition = {
            id: "test-umbra-sacrifice-host",
            name: "test-umbra-sacrifice-host",
            rarity: "common",
            manaCost: { R: 1 },
            types: ["Sorcery"],
            resolve: (ctx) => ctx.sacrifice("host"),
        };
        registerTokenDefinition(sacrificeHost);
        const state = board([host(), umbra()]);
        pushSpell(state, sacrificeHost.id, "p1");
        resolveTopOfStack(state);
        checkStateBasedActions(state);
        expect(state.players[0].battlefield).toEqual([]);
        expect(ids(state.players[0].graveyard)).toEqual(
            expect.arrayContaining(["host", "umbra"])
        );
    });

    it("an Aura that lost the keyword no longer protects (CR 613.1f)", () => {
        const state = board([
            host(),
            umbra("umbra", "p1", { staticAbilities: [] }),
        ]);
        expect(destroyWithReplacements(state, "host")).toBe(true);
        expect(ids(state.players[0].graveyard)).toContain("host");
    });

    it("protects only the permanent it enchants", () => {
        const state = board([
            host(),
            umbra(),
            makeInstance(BEARS_ID, {
                id: "other",
                controllerId: "p1",
                ownerId: "p1",
            }),
        ]);
        expect(destroyWithReplacements(state, "other")).toBe(true);
        expect(ids(state.players[0].battlefield)).toEqual(["host", "umbra"]);
    });
});

describe("umbra armor beside other destroy outcomes (CR 702.89a)", () => {
    it("a regeneration shield answers first, and the Aura stays", () => {
        const state = board([host({ regenerationShields: 1 }), umbra()]);
        expect(destroyWithReplacements(state, "host")).toBe(false);
        expect(ids(state.players[0].battlefield)).toEqual(["host", "umbra"]);
        expect(
            state.players[0].battlefield[0].regenerationShields
        ).toBeUndefined();
    });

    it("an indestructible Aura survives its own destruction and the host is still saved", () => {
        const state = board([
            host({ damageMarked: 1 }),
            umbra("umbra", "p1", {
                staticAbilities: ["umbra armor", "indestructible"],
            }),
        ]);
        expect(destroyWithReplacements(state, "host")).toBe(false);
        expect(ids(state.players[0].battlefield)).toEqual(["host", "umbra"]);
        expect(state.players[0].battlefield[0].damageMarked).toBeUndefined();
    });
});

describe("a mass destroy is one event for host and Aura (CR 702.89a)", () => {
    const destroyAllNonlands = script("test-umbra-destroy-all", [
        {
            op: "forEach",
            select: {
                set: "permanents",
                zone: "battlefield",
                filter: { type: ["Creature", "Enchantment"] },
            },
            effects: [{ op: "destroy", target: { ref: "$each" } }],
        },
    ]);

    it("an Aura walked before its host still saves it: the Aura listed first", () => {
        const state = board([umbra(), host()]);
        pushSpell(state, destroyAllNonlands, "p2");
        resolveTopOfStack(state);
        expect(ids(state.players[0].battlefield)).toEqual(["host"]);
        expect(ids(state.players[0].graveyard)).toEqual(["umbra"]);
    });

    it("an Aura walked before its host still saves it: the Aura on the first player's board", () => {
        const state = board(
            [umbra("umbra", "p1")],
            [host({ controllerId: "p2", ownerId: "p2" })]
        );
        pushSpell(state, destroyAllNonlands, "p2");
        resolveTopOfStack(state);
        expect(ids(state.players[1].battlefield)).toEqual(["host"]);
        expect(ids(state.players[0].graveyard)).toEqual(["umbra"]);
    });

    it("a destroy under a forEach's `if` is the same event (Gaze of Granite's shape)", () => {
        const conditional = script("test-umbra-destroy-if", [
            {
                op: "forEach",
                select: {
                    set: "permanents",
                    zone: "battlefield",
                    filter: { type: ["Creature", "Enchantment"] },
                },
                effects: [
                    {
                        op: "if",
                        predicate: { left: 1, op: "ge", right: 1 },
                        then: [{ op: "destroy", target: { ref: "$each" } }],
                    },
                ],
            },
        ]);
        const state = board([umbra(), host()]);
        pushSpell(state, conditional, "p2");
        resolveTopOfStack(state);
        expect(ids(state.players[0].battlefield)).toEqual(["host"]);
        expect(ids(state.players[0].graveyard)).toEqual(["umbra"]);
    });

    it("destroyAll, the imperative primitive, walks hosts first too", () => {
        const resolver: CardDefinition = {
            id: "test-umbra-destroy-all-closure",
            name: "test-umbra-destroy-all-closure",
            rarity: "common",
            manaCost: { R: 1 },
            types: ["Sorcery"],
            resolve: (ctx) => ctx.destroyAll(["Creature", "Enchantment"]),
        };
        registerTokenDefinition(resolver);
        const state = board([umbra(), host()]);
        pushSpell(state, resolver.id, "p2");
        resolveTopOfStack(state);
        expect(ids(state.players[0].battlefield)).toEqual(["host"]);
        expect(ids(state.players[0].graveyard)).toEqual(["umbra"]);
    });
});
