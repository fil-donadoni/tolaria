// CR 205.2a / 205.4a / 608.2h (issue #6503) — the cost-victim snapshot carries
// the victim's card types and live supertypes at every writer, so a resolving
// ability can read "if the exiled card is a snow land".

import { describe, it, expect } from "vitest";
import { makePlayer, makeState } from "../../cards/__tests__/setup.helper";
import type { CardInstanceState } from "../state";
import { exileCostSnapshot } from "../activation";
import { sacrificeSourceSnapshot } from "../sacrificeChoice";

const SNOW_LAND = {
    card: { id: "snow-forest", supertypes: ["Snow"] },
};

/** A bare land instance; the snapshot reads only types and the embedded
 *  card's supertypes, so no registered definition is needed. */
function land(overrides: Record<string, unknown>) {
    return {
        id: "x",
        card: { id: "plain-forest" },
        types: ["Land"],
        subtypes: [],
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
        isTapped: false,
        ...overrides,
    } as never as CardInstanceState;
}

describe("cost-victim snapshot types/supertypes (CR 608.2h)", () => {
    it("exileCostSnapshot carries the exiled card's types and supertypes", () => {
        const victim = land({ id: "v", ...SNOW_LAND });
        const owner = makePlayer("p1", { graveyard: [victim] });
        expect(exileCostSnapshot(owner, ["v"])).toMatchObject({
            cardInstanceId: "v",
            types: ["Land"],
            supertypes: ["Snow"],
        });
    });

    it("omits supertypes for a card with none", () => {
        const victim = land({ id: "v", types: ["Land"] });
        const owner = makePlayer("p1", { graveyard: [victim] });
        const snap = exileCostSnapshot(owner, ["v"]);
        expect(snap?.types).toEqual(["Land"]);
        expect(snap?.supertypes).toBeUndefined();
    });

    it("sacrificeSourceSnapshot carries them for a self-sacrificed permanent", () => {
        const source = land({ id: "s", ...SNOW_LAND });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [source] }),
                makePlayer("p2"),
            ],
        });
        expect(sacrificeSourceSnapshot(state, source)).toMatchObject({
            types: ["Land"],
            supertypes: ["Snow"],
        });
    });
});
