// Per-card behaviour tests for APC white cards
// (`convex/cards/sets/apc/white.ts`).
//
// Haunted Angel is hand-tail (issue #4334): its dies trigger exiles the dead
// card (CR 603.10a look-back, CR 406) and gives EACH OTHER player a 3/3 black
// flying Angel (CR 111.2 — the token's creator owns and controls it), so the
// controller must get none.
//
// Resolved through the REGISTRY SEAM by id, never by name.
import { describe, expect, it } from "vitest";
import { getDefinition } from "../../../index";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { resolveTrigger } from "../../leg/__tests__/helpers";
import type { StackItem } from "../../../../gre/state";

const HAUNTED_ANGEL = "78d2d11b-12e4-4810-a32d-8f1cdda3ec49";

describe("Haunted Angel (dies → exile it, each other player gets an Angel, CR 603.10a / 111.2)", () => {
    it("exiles itself and creates one 3/3 black flying Angel for the opponent only", () => {
        expect(getDefinition(HAUNTED_ANGEL).name).toBe("Haunted Angel");
        const angel = makeInstance(HAUNTED_ANGEL, {
            id: "angel",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { graveyard: [angel] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(state, angel, "haunted-angel-exile-tokens", {
            type: "CREATURE_DIED",
            creatureInstanceId: "angel",
            creatureControllerId: "p1",
            creatureTypes: ["Creature"],
            damagedBySources: [],
            creaturePower: 3,
            creatureToughness: 3,
        } as StackItem["triggerEvent"]);

        const [p1, p2] = state.players;
        expect(p1.graveyard.find((c) => c.id === "angel")).toBeUndefined();
        expect(p1.exile.find((c) => c.id === "angel")).toBeDefined();

        const tokens = (p: typeof p1) =>
            p.battlefield.filter((c) => c.isToken === true);
        expect(tokens(p1)).toHaveLength(0);
        const made = tokens(p2);
        expect(made).toHaveLength(1);
        expect(made[0].controllerId).toBe("p2");
        const token = made[0];
        expect(token.subtypes).toContain("Angel");
        // A token's colour rides on its synthesized definition, whose mana
        // cost carries one pip per colour (a token has no printed cost, colour
        // only): black, and nothing else.
        expect(
            getDefinition((token.card as { id: string }).id).manaCost
        ).toEqual({ B: 1 });
        expect(token.power).toBe(3);
        expect(token.toughness).toBe(3);
        expect(token.staticAbilities).toContain("flying");
    });
});
