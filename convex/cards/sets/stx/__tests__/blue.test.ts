// STX (Strixhaven) — blue card behavior tests (ADR 0043 colour split). Each
// card's describe block cites the CR section it exercises.
import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
    submitChoice,
} from "../../../__tests__/setup.helper";
import { preloadDefinitions } from "../../../index";
import { resolveTopOfStack } from "../../../../gre/state";
import { registerTokenDefinition } from "../../../index";
import { testOfTalents } from "../blue.cards";

// Filler library cards whose name differs from the spell's.
registerTokenDefinition({
    id: "test-stx-blue-filler",
    name: "test-stx-blue-filler",
    rarity: "common",
    types: ["Land"],
});

// Test of Talents (CR 701.6a counter, CR 608.2h last-known name/controller,
// CR 701.23a/b search, CR 701.24a shuffle): the sweep follows
// the countered spell's CONTROLLER, never the caster of the counterspell.
describe("Test of Talents", () => {
    const talents = testOfTalents();
    preloadDefinitions([talents]);
    const copy = (
        id: string,
        owner: "p1" | "p2",
        zone: "hand" | "graveyard" | "library"
    ) =>
        makeInstance(talents.id, {
            id,
            controllerId: owner,
            ownerId: owner,
            zone,
        });

    it("counters the spell, exiles same-named cards from its controller's zones and draws per card exiled from hand", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { hand: [copy("tt-mine", "p1", "hand")] }),
                makePlayer("p2", {
                    graveyard: [copy("tt-gy", "p2", "graveyard")],
                    hand: [
                        copy("tt-h1", "p2", "hand"),
                        copy("tt-h2", "p2", "hand"),
                    ],
                    library: [
                        copy("tt-lib", "p2", "library"),
                        ...["tt-draw-a", "tt-draw-b", "tt-draw-c"].map((id) =>
                            makeInstance("test-stx-blue-filler", {
                                id,
                                controllerId: "p2",
                                ownerId: "p2",
                                zone: "library",
                            })
                        ),
                    ],
                }),
            ],
        });
        const victim = pushSpell(state, talents.id, "p2");
        victim.id = "tt-victim";
        pushSpell(state, talents.id, "p1", [
            { type: "spell", id: "tt-victim" },
        ]);
        expect(resolveTopOfStack(state)).toBeNull(); // suspended on the picks

        // The countered spell now sits in its owner's graveyard and is a
        // candidate of the graveyard leg.
        expect(state.stack.some((s) => s.id === "tt-victim")).toBe(false);
        const gy = state.pendingChoices![0];
        expect(gy.zoneOwnerId).toBe("p2");
        expect(gy.candidateIds).toContain("tt-gy");
        submitChoice(state, ["tt-gy"]);
        submitChoice(state, ["tt-h1", "tt-h2"]);
        const search = state.pendingChoices![0];
        expect(search.kind).toBe("search-library");
        expect(search.zoneOwnerId).toBe("p2");
        submitChoice(state, ["tt-lib"]);

        const p2 = state.players[1];
        expect(p2.exile.map((c) => c.id).sort()).toEqual([
            "tt-gy",
            "tt-h1",
            "tt-h2",
            "tt-lib",
        ]);
        // Two cards left the hand → two cards drawn by p2, not p1.
        expect(p2.hand).toHaveLength(2);
        expect(state.players[0].hand.map((c) => c.id)).toEqual(["tt-mine"]);
        expect(state.players[0].exile).toHaveLength(0);
    });

    it("declining every pick exiles nothing and draws nothing (CR 701.23b)", () => {
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { hand: [copy("tt-keep", "p2", "hand")] }),
            ],
        });
        const victim = pushSpell(state, talents.id, "p2");
        victim.id = "tt-victim2";
        pushSpell(state, talents.id, "p1", [
            { type: "spell", id: "tt-victim2" },
        ]);
        expect(resolveTopOfStack(state)).toBeNull();
        submitChoice(state, []);
        submitChoice(state, []);
        submitChoice(state, []);

        expect(state.players[1].exile).toHaveLength(0);
        expect(state.players[1].hand.map((c) => c.id)).toEqual(["tt-keep"]);
    });
});
