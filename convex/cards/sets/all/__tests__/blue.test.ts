// ALL (Alliances) — blue behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import { forceOfWill } from "../blue";
import { makeState, pushSpell } from "../../../__tests__/setup";
import { resolveTopOfStack } from "../../../../gre/state";
import { lightningBolt } from "../../lea/red";
import { projectPublicState } from "../../../../gameProjections";

// Force of Will — {3}{U}{U} Instant. "You may pay 1 life and exile a blue card
// from your hand rather than pay this spell's mana cost. Counter target
// spell." The pitch alternative cost (life + hand legs) is already covered
// end-to-end by convex/gre/__tests__/pitch-cost.test.ts; that file never
// resolves the spell, so the `counter` Op itself — the actual "counter target
// spell" effect — has zero behavior coverage. The smoke sweep skips it (a
// spell-on-the-stack target isn't scenario-generatable), so hand-write it
// here, cast the plain (mana-cost) way to keep the alternative-cost machinery
// out of scope.
describe("Force of Will (counter target spell, CR 701.5a)", () => {
    it("countering a spell removes it from the stack and sends it to its owner's graveyard", () => {
        const state = makeState();
        const bolt = pushSpell(state, lightningBolt.id, "p2", [
            { type: "player", id: "p1" },
        ]);
        pushSpell(state, forceOfWill.id, "p1", [
            { type: "spell", id: bolt.id },
        ]);
        resolveTopOfStack(state);
        expect(state.stack.find((s) => s.id === bolt.id)).toBeUndefined();
        expect(state.players[1].graveyard.map((c) => c.id)).toEqual([bolt.id]);
        // The bolt never resolved — no damage dealt.
        expect(state.players[0].life).toBe(20);
    });

    it("the countered spell's graveyard placement survives the wire-format projection (PublicGameState)", () => {
        const state = makeState();
        const bolt = pushSpell(state, lightningBolt.id, "p2", [
            { type: "player", id: "p1" },
        ]);
        pushSpell(state, forceOfWill.id, "p1", [
            { type: "spell", id: bolt.id },
        ]);
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[1].graveyard.map((c) => c.id)).toEqual([
            bolt.id,
        ]);
        expect(projected.stack).toHaveLength(0);
    });
});
