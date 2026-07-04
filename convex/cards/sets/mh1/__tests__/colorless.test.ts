// MH1 (Modern Horizons) — colorless behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import {
    waterloggedGrove,
    sunbakedCanyon,
    talismanOfCreativity,
    talismanOfConviction,
    talismanOfCuriosity,
} from "../colorless";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import {
    resolveTopOfStack,
    type GameState,
    type CardInstanceState,
} from "../../../../gre/state";
import type { CardDefinition as Def } from "../../../types";
import { tapSourceIntoPayment } from "../../../../game";
import { projectPublicState } from "../../../../gameProjections";

function resolveActivated(
    state: GameState,
    source: CardInstanceState,
    abilityId: string
): void {
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        abilityId,
        targets: [],
    });
    resolveTopOfStack(state);
}

const cases: { card: Def; mana: string; draw: string; colors: object[] }[] = [
    {
        card: waterloggedGrove,
        mana: "waterlogged-grove-mana",
        draw: "waterlogged-grove-draw",
        colors: [{ G: 1 }, { U: 1 }],
    },
    {
        card: sunbakedCanyon,
        mana: "sunbaked-canyon-mana",
        draw: "sunbaked-canyon-draw",
        colors: [{ R: 1 }, { W: 1 }],
    },
];

describe.each(cases)(
    "$card.name (Horizon-land painland cantrip, CR 605.1a / 305)",
    ({ card, mana, draw, colors }) => {
        it("is a Land with a pay-life dual mana ability and sacrifice cantrip", () => {
            expect(card.types).toEqual(["Land"]);
            expect(card.manaCost).toBeUndefined();
            const m = card.activatedAbilities!.find((a) => a.id === mana)!;
            expect(m.useStack).toBe(false);
            expect(m.cost).toMatchObject({ tap: true, life: 1 });
            expect(m.manaChoices).toEqual(colors);
            const d = card.activatedAbilities!.find((a) => a.id === draw)!;
            expect(d.cost).toMatchObject({
                mana: { X: 1 },
                tap: true,
                sacrifice: true,
            });
        });

        it("the cantrip ability draws a card on resolution (CR 121.1)", () => {
            const land = makeInstance(card.id, {
                id: "land",
                controllerId: "p1",
                ownerId: "p1",
                zone: "battlefield",
            });
            const lib = makeInstance(card.id, {
                id: "top",
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            });
            const state = makeState({
                players: [
                    makePlayer("p1", { battlefield: [land], library: [lib] }),
                    makePlayer("p2"),
                ],
            });
            resolveActivated(state, land, draw);
            expect(state.players[0].hand.map((c) => c.id)).toEqual(["top"]);
        });
    }
);

// Talisman cycle (issue #675) — same painland shape as ICE's Adarkar Wastes
// cycle (`convex/cards/sets/ice/__tests__/colorless.test.ts`): one choice
// mana ability, index 0 is the painless {C}, indices 1-2 are the two
// colours carrying `dealsDamageToControllerOnColoredTap: 1` (CR 605.1a / 120).
describe.each([
    { def: talismanOfCreativity, colors: ["U", "R"] as const },
    { def: talismanOfConviction, colors: ["R", "W"] as const },
    { def: talismanOfCuriosity, colors: ["G", "U"] as const },
])(
    "$def.name (Talisman painland cycle, CR 605.1a / 120)",
    ({ def, colors }) => {
        it("is a {2} Artifact with one {T} choice mana ability: {C} (index 0) + the two colours carrying a 1-damage rider", () => {
            expect(def.types).toEqual(["Artifact"]);
            expect(def.manaCost).toEqual({ X: 2 });
            const mana = def.activatedAbilities?.find(
                (a) => !a.useStack && a.manaChoices
            );
            expect(mana?.useStack).toBe(false);
            expect(mana?.cost).toEqual({ tap: true });
            expect(mana?.manaChoices).toEqual([
                { C: 1 },
                { [colors[0]]: 1 },
                { [colors[1]]: 1 },
            ]);
            expect(mana?.dealsDamageToControllerOnColoredTap).toBe(1);
        });

        it("tapping for {C} (the painless choice) costs no life and adds {C}", () => {
            const rock = makeInstance(def.id, {
                id: "rock",
                controllerId: "p1",
                ownerId: "p1",
            });
            const player = makePlayer("p1", { battlefield: [rock] });
            const state = makeState({ players: [player, makePlayer("p2")] });
            state.activePlayerId = "p1";
            tapSourceIntoPayment(state, player, rock, 0, []);
            expect(player.manaPool.C).toBe(1);
            expect(player.life).toBe(20);
        });

        it(`tapping for ${colors[0]} (a coloured choice) costs 1 life and adds {${colors[0]}}`, () => {
            const rock = makeInstance(def.id, {
                id: "rock",
                controllerId: "p1",
                ownerId: "p1",
            });
            const player = makePlayer("p1", { battlefield: [rock] });
            const state = makeState({ players: [player, makePlayer("p2")] });
            state.activePlayerId = "p1";
            tapSourceIntoPayment(state, player, rock, 1, []);
            expect(player.manaPool[colors[0]]).toBe(1);
            expect(player.life).toBe(19);
        });

        it("the coloured-tap life loss survives the wire-format projection (PublicGameState)", () => {
            const rock = makeInstance(def.id, {
                id: "rock",
                controllerId: "p1",
                ownerId: "p1",
            });
            const player = makePlayer("p1", { battlefield: [rock] });
            const state = makeState({ players: [player, makePlayer("p2")] });
            state.activePlayerId = "p1";
            tapSourceIntoPayment(state, player, rock, 2, []);
            const projected = projectPublicState(state, 1, "p1");
            expect(projected.players[0].life).toBe(19);
        });
    }
);
