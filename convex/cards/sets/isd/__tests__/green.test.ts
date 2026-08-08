// Innistrad (ISD) — green behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { getManaTapOptionsDetailed } from "../../../../gre/constants";
import { avacynsPilgrim } from "../green";

// Avacyn's Pilgrim — {G} 1/1 Human Monk, "{T}: Add {W}." A colour-fixing mana
// dork: the one thing that matters about it is that the engine's tap-option
// authority offers {W} — not {G}, its own colour — for a single {T}.
describe("Avacyn's Pilgrim ({T}: Add {W}, CR 605.1a)", () => {
    it("offers exactly one tap option, producing {W} rather than its own {G}", () => {
        const pilgrim = makeInstance(avacynsPilgrim.id, {
            id: "pilgrim",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [pilgrim] }),
                makePlayer("p2"),
            ],
        });
        const battlefields = state.players.map((p) => ({
            playerId: p.id,
            battlefield: p.battlefield,
        }));

        // getManaTapOptionsDetailed is the single authority the tap mutation,
        // the auto-tap solver and the client picker all read (CR 106.1).
        expect(getManaTapOptionsDetailed(pilgrim, "p1", battlefields)).toEqual([
            {
                mana: { W: 1 },
                source: {
                    kind: "activated",
                    abilityId: avacynsPilgrim.activatedAbilities![0].id,
                },
            },
        ]);
    });
});
