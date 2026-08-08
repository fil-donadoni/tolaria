// MH1 (Modern Horizons) — blue behavior tests (ADR 0043 colour split).
//
// Echo of Eons is Timetwister (CR 103.4 — each player shuffles hand + graveyard
// into their library, then draws seven) with Flashback {2}{U} (CR 702.34). The
// whole-table reset uses composed SpellContext zone primitives (resolve()); the
// flashback exile itself is covered class-wide by convex/gre/__tests__/flashback.test.ts.
import { describe, it, expect } from "vitest";
import { echoOfEons, forceOfNegation } from "../blue";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { resolveTopOfStack, getPlayer } from "../../../../gre/state";
import { grizzlyBears } from "../../lea";
import { lightningBolt } from "../../lea/red";
import { projectPublicState } from "../../../../gameProjections";

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

// Force of Negation — {1}{U}{U} Instant. "Counter target noncreature spell. If
// that spell is countered this way, exile it instead of putting it into its
// owner's graveyard." The `counter` Op with `destination: "exile"` isn't
// scenario-generatable (a spell-on-the-stack target), so the smoke sweep
// skips it — hand-write it here. The `spellExcludeTypeFilter` legality gate
// itself is already class-wide covered (Spell Pierce,
// convex/gre/__tests__/targeting.test.ts), so this focuses on the resolution
// outcome the sweep can't reach.
describe("Force of Negation (counter → exile instead of graveyard, CR 701.5a)", () => {
    it("countering a noncreature spell removes it from the stack and exiles it (not the graveyard)", () => {
        const state = makeState();
        const bolt = pushSpell(state, lightningBolt.id, "p2", [
            { type: "player", id: "p1" },
        ]);
        pushSpell(state, forceOfNegation.id, "p1", [
            { type: "spell", id: bolt.id },
        ]);
        resolveTopOfStack(state);
        expect(state.stack.find((s) => s.id === bolt.id)).toBeUndefined();
        expect(state.players[1].graveyard).toHaveLength(0);
        expect(state.players[1].exile.map((c) => c.id)).toEqual([bolt.id]);
        // The bolt never resolved — no damage dealt.
        expect(state.players[0].life).toBe(20);
    });

    it("the exiled destination survives the wire-format projection (PublicGameState)", () => {
        const state = makeState();
        const bolt = pushSpell(state, lightningBolt.id, "p2", [
            { type: "player", id: "p1" },
        ]);
        pushSpell(state, forceOfNegation.id, "p1", [
            { type: "spell", id: bolt.id },
        ]);
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[1].exile.map((c) => c.id)).toEqual([bolt.id]);
        expect(
            projected.players[1].graveyard.find((c) => c.id === bolt.id)
        ).toBeUndefined();
    });
});
