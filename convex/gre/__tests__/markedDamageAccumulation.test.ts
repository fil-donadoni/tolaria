import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup";
import { resolveTopOfStack } from "../state";
import { lightningBolt } from "../../cards/sets/lea/red";
import { serraAngel } from "../../cards/sets/lea/white";

/**
 * Noncombat damage ACCUMULATES on a creature across events (issue #4490).
 *
 * CR 120.3e — damage dealt to a creature by a source with neither wither nor
 * infect causes that much damage to be marked on that creature.
 * CR 704.5g — a creature with toughness greater than 0 and total marked
 * damage at or above its toughness has been dealt lethal damage and is
 * destroyed.
 *
 * The seam is one line in `dealDamageToPermanent` (`gre/state.ts`):
 * `damageMarked = (damageMarked ?? 0) + reduced`. A regression to
 * `= reduced` keeps every single-hit test green — 3 marked after one Bolt
 * either way — and only a SECOND noncombat hit on the same creature tells the
 * two apart. That proof used to live in the LEA white suite as a card test on
 * Lightning Bolt and Serra Angel; it is an engine invariant, so it lives here,
 * with the two cards as fixtures.
 */
describe("marked damage accumulates across noncombat events (CR 120.3e, 704.5g)", () => {
    function boardWithAngel() {
        // Serra Angel: 4/4. One Bolt (3) leaves her alive at 3 marked; a
        // second accumulates to 6 >= 4 and the SBA destroys her.
        const angel = makeInstance(serraAngel.id, {
            id: "angel",
            controllerId: "p2",
            ownerId: "p2",
        });
        return makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [angel] }),
            ],
        });
    }
    const bolt = (state: ReturnType<typeof boardWithAngel>) => {
        pushSpell(state, lightningBolt.id, "p1", [
            { type: "permanent", id: "angel" },
        ]);
        resolveTopOfStack(state);
    };

    it("a single non-lethal hit is marked, not lethal", () => {
        const state = boardWithAngel();
        bolt(state);
        const angel = state.players[1].battlefield.find(
            (c) => c.id === "angel"
        );
        expect(angel?.damageMarked).toBe(3);
    });

    it("a second hit adds to the marked total and the SBA destroys the creature", () => {
        const state = boardWithAngel();
        bolt(state);
        bolt(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "angel")
        ).toBeUndefined();
        expect(
            state.players[1].graveyard.some(
                (c) => (c.card as { id: string }).id === serraAngel.id
            )
        ).toBe(true);
    });

    it("the total is the SUM, read on a survivor: 3 + 3 on a 7-toughness body", () => {
        const state = boardWithAngel();
        const angel = state.players[1].battlefield[0];
        angel.toughness = 7;
        bolt(state);
        bolt(state);
        const survivor = state.players[1].battlefield.find(
            (c) => c.id === "angel"
        );
        expect(survivor?.damageMarked).toBe(6);
    });
});
