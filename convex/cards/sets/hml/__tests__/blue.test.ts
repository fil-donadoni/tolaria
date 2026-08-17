// hml — blue behavior tests (ADR 0043 colour split).
//
// Memory Lapse counters a spell and redirects it to the TOP of its owner's
// library (CR 701.6a + the `destination` parameter on `SpellContext.counter`).
// The stack is a public zone (CR 405.1), so every player watched that specific
// card go to a known position in a hidden zone; CR 400.2's concealment of a
// hidden zone does not retroactively un-reveal what the players already saw.
// The engine models that as ADR 0026 persistent per-viewer knowledge
// (`knownTo`) — the SAME mechanism `putSpellOnLibrary` (Subtlety) already
// uses, not a parallel marker. Issue #1696.
import { describe, it, expect } from "vitest";
import { memoryLapse } from "../blue";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import {
    resolveTopOfStack,
    getPlayer,
    drawCard,
    buildSpellContext,
} from "../../../../gre/state";
import { compactState, expandState } from "../../../../gre/serialize";
import { projectPublicState } from "../../../../gameProjections";
import { grizzlyBears } from "../../lea";
import { mountain } from "../../lea/colorless";

/** p2 casts Grizzly Bears; p1 answers with Memory Lapse. p2's library is
 *  pre-stocked with two Mountains so "the rest of the library stays hidden"
 *  is actually assertable. */
function setupCounter() {
    const p1 = makePlayer("p1");
    const p2 = makePlayer("p2", {
        library: [
            makeInstance(mountain.id, {
                id: "lib-a",
                controllerId: "p2",
                ownerId: "p2",
                zone: "library",
            }),
            makeInstance(mountain.id, {
                id: "lib-b",
                controllerId: "p2",
                ownerId: "p2",
                zone: "library",
            }),
        ],
    });
    const state = makeState({ players: [p1, p2] });
    const bears = pushSpell(state, grizzlyBears.id, "p2");
    bears.id = "bears-spell";
    pushSpell(state, memoryLapse.id, "p1", [
        { type: "spell", id: "bears-spell" },
    ]);
    return state;
}

describe("Memory Lapse — counter to top of library (CR 701.6a / 400.2, #1696)", () => {
    it("puts the countered spell on top of its owner's library", () => {
        const state = setupCounter();
        resolveTopOfStack(state);
        const p2 = getPlayer(state, "p2");
        expect(p2.library.map((c) => c.id)).toEqual([
            "bears-spell",
            "lib-a",
            "lib-b",
        ]);
        expect(p2.graveyard).toHaveLength(0);
    });

    it("marks the redirected card known to EVERY player (both watched it)", () => {
        const state = setupCounter();
        resolveTopOfStack(state);
        const p2 = getPlayer(state, "p2");
        expect([...(p2.library[0].knownTo ?? [])].sort()).toEqual(["p1", "p2"]);
        // The rest of the library was never seen by anyone.
        expect(p2.library[1].knownTo).toBeUndefined();
        expect(p2.library[2].knownTo).toBeUndefined();
    });

    it("survives the wire projection for BOTH viewers, exposing only that card", () => {
        const state = setupCounter();
        resolveTopOfStack(state);
        for (const viewerId of ["p1", "p2"]) {
            const projected = projectPublicState(state, 1, viewerId);
            const lib = projected.players.find((p) => p.id === "p2")!.library;
            expect(lib.count).toBe(3);
            expect(lib.known).toHaveLength(1);
            expect(lib.known[0].index).toBe(0);
            expect(lib.known[0].card.id).toBe("bears-spell");
            expect(lib.known[0].card.card.id).toBe(grizzlyBears.id);
        }
    });

    it("leaks nothing about the rest of the library, to anyone", () => {
        const state = setupCounter();
        resolveTopOfStack(state);
        for (const viewerId of ["p1", "p2"]) {
            const projected = projectPublicState(state, 1, viewerId);
            const lib = projected.players.find((p) => p.id === "p2")!.library;
            const ids = lib.known.map((k) => k.card.id);
            expect(ids).not.toContain("lib-a");
            expect(ids).not.toContain("lib-b");
        }
        // A viewer who was never granted the knowledge (a spectator id) sees
        // the library as a pure count — the negative direction of the gate.
        const spectator = projectPublicState(state, 1, "p3");
        const lib = spectator.players.find((p) => p.id === "p2")!.library;
        expect(lib.count).toBe(3);
        expect(lib.known).toHaveLength(0);
    });

    it("clears the knowledge on a shuffle (CR 701.24) for every player", () => {
        const state = setupCounter();
        resolveTopOfStack(state);
        const p2 = getPlayer(state, "p2");
        // Real shuffle path: the SpellContext primitive every shuffling card
        // calls (it runs `seededShuffle` + `clearKnowledge(library, null)`).
        const ctx = buildSpellContext(
            state,
            pushSpell(state, mountain.id, "p1")
        );
        ctx.shuffleLibrary("p2");
        expect(p2.library.every((c) => c.knownTo === undefined)).toBe(true);
        for (const viewerId of ["p1", "p2"]) {
            const projected = projectPublicState(state, 1, viewerId);
            const lib = projected.players.find((p) => p.id === "p2")!.library;
            expect(lib.known).toHaveLength(0);
        }
    });

    it("keeps the knowledge across a DB round trip (compact → expand)", () => {
        // The knowledge rides the EXISTING per-card `knownTo` serialization
        // (`compactLibrary`'s 3-tuple), so no new optional GameState key is
        // introduced — this asserts the whole path end to end rather than the
        // helper in isolation.
        const state = setupCounter();
        resolveTopOfStack(state);
        const expanded = expandState(compactState(state));
        const lib = getPlayer(expanded, "p2").library;
        expect(lib[0].id).toBe("bears-spell");
        expect([...(lib[0].knownTo ?? [])].sort()).toEqual(["p1", "p2"]);
        expect(lib[1].knownTo).toBeUndefined();
        const projected = projectPublicState(expanded, 1, "p1");
        const wire = projected.players.find((p) => p.id === "p2")!.library;
        expect(wire.known.map((k) => k.card.id)).toEqual(["bears-spell"]);
    });

    it("stops exposing the card once it is drawn — the library is a count again", () => {
        const state = setupCounter();
        resolveTopOfStack(state);
        const p2 = getPlayer(state, "p2");
        drawCard(p2);
        expect(p2.library.map((c) => c.id)).toEqual(["lib-a", "lib-b"]);
        expect(p2.hand.map((c) => c.id)).toEqual(["bears-spell"]);
        for (const viewerId of ["p1", "p2"]) {
            const projected = projectPublicState(state, 1, viewerId);
            const lib = projected.players.find((p) => p.id === "p2")!.library;
            expect(lib.count).toBe(2);
            expect(lib.known).toHaveLength(0);
        }
    });
});
