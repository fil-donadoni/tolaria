// Magic 2014 (M14) — green behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { getManaTapOptionsDetailed } from "../../../../gre/constants";
import { elvishMystic } from "../green";

// Elvish Mystic — {G} 1/1 Elf Druid, "{T}: Add {G}." The archetypal ramp dork:
// what has to hold is that a single {T} yields exactly one {G} option through
// the engine's tap-option authority, so the auto-tap solver can spend it.
describe("Elvish Mystic ({T}: Add {G}, CR 605.1a)", () => {
    it("offers exactly one tap option, producing a single {G}", () => {
        const mystic = makeInstance(elvishMystic.id, {
            id: "mystic",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mystic] }),
                makePlayer("p2"),
            ],
        });
        const battlefields = state.players.map((p) => ({
            playerId: p.id,
            battlefield: p.battlefield,
        }));

        // getManaTapOptionsDetailed is the single authority the tap mutation,
        // the auto-tap solver and the client picker all read (CR 106.1).
        expect(getManaTapOptionsDetailed(mystic, "p1", battlefields)).toEqual([
            {
                mana: { G: 1 },
                source: {
                    kind: "activated",
                    abilityId: elvishMystic.activatedAbilities![0].id,
                },
            },
        ]);
    });
});
