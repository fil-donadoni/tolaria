// Per-card behavior tests for multicolor cards in `convex/cards/sets/drk/multicolor.ts`
// (The Dark, split by colour per ADR 0043). Each non-trivial card gets a
// describe block citing the CR section it exercises; set-wide registry-parity
// checks live in colorless.test.ts. Shared stack/resolve shims live in
// ./helpers; fixtures stay in convex/cards/__tests__/setup.ts.

import { describe, it, expect } from "vitest";
import { darkHeartOfTheWood, scarwoodGoblins } from "..";
import { resolveActivated } from "./helpers";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { projectPublicState } from "../../../../gameProjections";
import { resolveTopOfStack } from "../../../../gre/state";
import { getDefinition } from "../../../index";

describe("Scarwood Goblins (vanilla creature, CR 302)", () => {
    it("resolves onto the battlefield and survives projection (CR 608.3)", () => {
        // Wire-format guard: the slim projected instance keeps only `{ id }` on
        // card.card, so its definition must be recoverable from the registry by
        // id after projectPublicState (the card survives the wire).
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const item = pushSpell(state, scarwoodGoblins.id, "p1");
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === item.id
        );
        expect(slim).toBeDefined();
        const def = getDefinition((slim!.card as { id: string }).id);
        expect(def.name).toBe("Scarwood Goblins");
        expect(def.subtypes).toEqual(["Goblin"]);
    });
});

describe("Dark Heart of the Wood — Sacrifice a Forest: gain 3 life (CR 118.5 / 119.3)", () => {
    it("the ability gains its controller 3 life on resolution (CR 119.3)", () => {
        const dh = makeInstance(darkHeartOfTheWood.id, {
            id: "dh",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [dh] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, dh, "dark-heart-of-the-wood-gain", []);
        expect(state.players[0].life).toBe(23); // 20 + 3
    });
});
