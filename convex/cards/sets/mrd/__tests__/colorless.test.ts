// mrd (Mirrodin) — colorless behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import { talismanOfProgress, talismanOfDominance } from "../colorless";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { tapSourceIntoPayment } from "../../../../game";
import { projectPublicState } from "../../../../gameProjections";

// Talisman cycle (issue #675) — same painland shape as ICE's Adarkar Wastes
// cycle (`convex/cards/sets/ice/__tests__/colorless.test.ts`): one choice
// mana ability, index 0 is the painless {C}, indices 1-2 are the two
// colours carrying `dealsDamageToControllerOnColoredTap: 1` (CR 605.1a / 120).
describe.each([
    { def: talismanOfProgress, colors: ["W", "U"] as const },
    { def: talismanOfDominance, colors: ["U", "B"] as const },
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

        it(`tapping for ${colors[1]} (a coloured choice) costs 1 life and adds {${colors[1]}}`, () => {
            const rock = makeInstance(def.id, {
                id: "rock",
                controllerId: "p1",
                ownerId: "p1",
            });
            const player = makePlayer("p1", { battlefield: [rock] });
            const state = makeState({ players: [player, makePlayer("p2")] });
            state.activePlayerId = "p1";
            tapSourceIntoPayment(state, player, rock, 2, []);
            expect(player.manaPool[colors[1]]).toBe(1);
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
            tapSourceIntoPayment(state, player, rock, 1, []);
            const projected = projectPublicState(state, 1, "p1");
            expect(projected.players[0].life).toBe(19);
        });
    }
);
