// MH1 (Modern Horizons) — blue behavior tests (ADR 0043 colour split).
//
// Echo of Eons is Timetwister (CR 103.4 — each player shuffles hand + graveyard
// into their library, then draws seven) with Flashback {2}{U} (CR 702.34). The
// whole-table reset uses composed SpellContext zone primitives (resolve()); the
// flashback exile itself is covered class-wide by convex/gre/__tests__/flashback.test.ts.
import { describe, it, expect } from "vitest";
import { echoOfEons, forceOfNegation } from "../blue";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { resolveTopOfStack, getPlayer } from "../../../../gre/state";
import { grizzlyBears } from "../../lea";

function bears(owner: string, count: number, prefix: string, zone: string) {
    return Array.from({ length: count }, (_, i) =>
        makeInstance(grizzlyBears.id, {
            id: `${prefix}-${i}`,
            controllerId: owner,
            ownerId: owner,
            zone: zone as never,
        })
    );
}

describe("Echo of Eons (Timetwister with flashback, CR 103.4 / 702.34)", () => {
    it("is a {4}{U}{U} sorcery with Flashback {2}{U}", () => {
        expect(echoOfEons.manaCost).toEqual({ X: 4, U: 2 });
        expect(echoOfEons.flashback).toEqual({ X: 2, U: 1 });
        expect(echoOfEons.types).toEqual(["Sorcery"]);
    });

    it("each player shuffles hand + graveyard into their library, then draws seven", () => {
        const p1 = makePlayer("p1", {
            hand: bears("p1", 3, "p1-hand", "hand"),
            graveyard: bears("p1", 2, "p1-gy", "graveyard"),
            library: bears("p1", 10, "p1-lib", "library"),
        });
        const p2 = makePlayer("p2", {
            hand: bears("p2", 1, "p2-hand", "hand"),
            graveyard: bears("p2", 4, "p2-gy", "graveyard"),
            library: bears("p2", 10, "p2-lib", "library"),
        });
        const state = makeState({ players: [p1, p2] });

        // Echo of Eons resolving on the stack (cast from hand for this test);
        // it isn't in either graveyard, so the shuffle doesn't touch it.
        state.stack.push({
            ...makeInstance(echoOfEons.id, {
                id: "echo",
                zone: "stack",
                controllerId: "p1",
                ownerId: "p1",
            }),
            castById: "p1",
            targets: [],
        });
        resolveTopOfStack(state);

        // CR 103.4 — both players drew a fresh seven; the pre-existing hands
        // and graveyards were swept into the libraries first.
        expect(getPlayer(state, "p1").hand).toHaveLength(7);
        expect(getPlayer(state, "p2").hand).toHaveLength(7);
        // Echo of Eons was cast from hand here, so after resolving it goes to
        // p1's (previously-emptied) graveyard — the flashback exile path is
        // covered class-wide by flashback.test.ts.
        expect(getPlayer(state, "p1").graveyard.map((c) => c.id)).toEqual([
            "echo",
        ]);
        expect(getPlayer(state, "p2").graveyard).toHaveLength(0);
        // p1 started with 3+2+10 = 15 cards (excl. Echo); 7 in hand → 8 in library.
        expect(getPlayer(state, "p1").library).toHaveLength(8);
        // p2 started with 1+4+10 = 15 cards; 7 in hand → 8 left in library.
        expect(getPlayer(state, "p2").library).toHaveLength(8);
    });
});

// Force of Negation — {1}{U}{U} Instant. "If it's not your turn, you may exile a
// blue card from your hand rather than pay this spell's mana cost. Counter target
// noncreature spell. If that spell is countered this way, exile it instead of
// putting it into its owner's graveyard." (CR 118.9 pitch cost; CR 701.5a
// counter-to-exile.) The hand leg + not-your-turn condition and the reused
// counter-with-destination Op are covered by the framework + smoke sweep; here
// we pin the definition shape.
describe("Force of Negation (pitch: exile a blue card, not your turn)", () => {
    it("declares the conditional hand alternative cost and counter-to-exile of a noncreature spell", () => {
        expect(forceOfNegation.alternativeCosts).toEqual([
            {
                id: "pitch-exile-blue",
                description: "Exile a blue card from your hand",
                condition: { kind: "not-your-turn" },
                hand: {
                    action: "exile",
                    requirements: [{ filter: { color: "U" }, count: 1 }],
                },
            },
        ]);
        expect(forceOfNegation.targetRequirement).toEqual({
            type: "spell",
            count: 1,
            spellExcludeTypeFilter: "Creature",
        });
        expect(forceOfNegation.effects).toEqual([
            { op: "counter", target: { target: 0 }, destination: "exile" },
        ]);
    });
});
