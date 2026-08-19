// mh1 (Modern Horizons) — multicolor behavior tests (ADR 0043 colour split).
//
// Wrenn and Six (issue #2358). All three loyalty abilities run through the real
// GRE resolution path (`resolveTopOfStack`), mirroring the Teferi, Hero of
// Dominaria harness (`sets/dom/__tests__/multicolor.test.ts`): the +1 is the
// "up to one target land card from your graveyard" bounce, the −1 is the "any
// target" ping, and the −7 creates the emblem whose grant is the ONLY producer
// of Retrace (CR 702.81) in the pool. The keyword's own behaviour lives in
// `convex/gre/__tests__/retrace.test.ts`; what this file owns is that the
// ultimate actually reaches it.

import { describe, it, expect } from "vitest";
import { wrennAndSix } from "../multicolor";
import { mountain } from "../../lea/colorless";
import { grizzlyBears } from "../../lea/green";
import { lightningBolt } from "../../lea/red";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { resolveTopOfStack, getPlayer } from "../../../../gre/state";
import type { GameState } from "../../../../gre/state";
import { projectPublicState } from "../../../../gameProjections";
import { WRENN_AND_SIX_EMBLEM_ID } from "../../../emblems";
import { hasRetrace } from "../../../../gre/retrace";
import type { TargetSelection } from "../../../types";

const PLUS1 = "wrenn-and-six-plus1";
const MINUS1 = "wrenn-and-six-minus1";
const MINUS7 = "wrenn-and-six-minus7";

function wrennOnBattlefield(loyalty = 3) {
    return makeInstance(wrennAndSix.id, {
        id: "wrenn1",
        controllerId: "p1",
        ownerId: "p1",
        counters: { loyalty },
    });
}

/** Pushes one of Wrenn's loyalty abilities on the stack and resolves it through
 *  the real path (the loyalty framework's cost payment is exercised in game.ts;
 *  the card test asserts the EFFECT — the Teferi harness shape). */
function activate(
    state: GameState,
    abilityId: string,
    targets?: TargetSelection[]
): void {
    const wrenn = getPlayer(state, "p1").battlefield.find(
        (c) => c.id === "wrenn1"
    )!;
    state.stack.push({
        ...wrenn,
        zone: "stack",
        castById: "p1",
        abilityId,
        ...(targets ? { targets } : {}),
    });
    resolveTopOfStack(state);
}

describe("Wrenn and Six — +1 (return up to one target land card from your graveyard, CR 601.2c)", () => {
    it("returns the targeted land card from the graveyard to hand", () => {
        const land = makeInstance(mountain.id, {
            id: "gyLand",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [wrennOnBattlefield()],
                    graveyard: [land],
                }),
                makePlayer("p2"),
            ],
        });

        activate(state, PLUS1, [
            { type: "graveyard-card", id: "gyLand", playerId: "p1" },
        ]);

        const p1 = getPlayer(state, "p1");
        expect(p1.hand.some((c) => c.id === "gyLand")).toBe(true);
        expect(p1.graveyard.some((c) => c.id === "gyLand")).toBe(false);
    });

    it("resolves as a no-op when the controller declines the up-to-one target", () => {
        // CR 601.2c — `count: { min: 0, max: 1 }` permits an EMPTY announced
        // set; the ability still resolves and simply moves nothing.
        const land = makeInstance(mountain.id, {
            id: "gyLand",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [wrennOnBattlefield()],
                    graveyard: [land],
                }),
                makePlayer("p2"),
            ],
        });

        activate(state, PLUS1, []);

        const p1 = getPlayer(state, "p1");
        expect(p1.hand).toHaveLength(0);
        expect(p1.graveyard.some((c) => c.id === "gyLand")).toBe(true);
    });
});

describe("Wrenn and Six — −1 (1 damage to any target, CR 115.4)", () => {
    it("deals 1 damage to a targeted player", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [wrennOnBattlefield()] }),
                makePlayer("p2"),
            ],
        });

        activate(state, MINUS1, [{ type: "player", id: "p2" }]);

        expect(getPlayer(state, "p2").life).toBe(19);
    });

    it("marks 1 damage on a targeted creature", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [wrennOnBattlefield()] }),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });

        activate(state, MINUS1, [{ type: "permanent", id: "bear" }]);

        // CR 119.3 / 704.5g — a 2/2 survives 1 damage, which is marked on it.
        const target = getPlayer(state, "p2").battlefield.find(
            (c) => c.id === "bear"
        );
        expect(target?.damageMarked).toBe(1);
    });
});

describe("Wrenn and Six — −7 (emblem granting retrace, CR 114 / 702.81)", () => {
    it("creates the emblem, which grants retrace to instants and sorceries in the graveyard", () => {
        const bolt = makeInstance(lightningBolt.id, {
            id: "gyBolt",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [wrennOnBattlefield(7)],
                    graveyard: [bolt],
                }),
                makePlayer("p2"),
            ],
        });
        // Before the ultimate nothing in the graveyard has retrace.
        expect(hasRetrace(state, bolt)).toBe(false);

        activate(state, MINUS7);

        expect(state.emblems ?? []).toHaveLength(1);
        expect(state.emblems![0].emblemId).toBe(WRENN_AND_SIX_EMBLEM_ID);
        expect(state.emblems![0].ownerId).toBe("p1");

        const gyBolt = getPlayer(state, "p1").graveyard.find(
            (c) => c.id === "gyBolt"
        )!;
        expect(hasRetrace(state, gyBolt)).toBe(true);
        // …and the emblem survives the wire projection so the client can render
        // it in the command zone.
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.emblems?.[0]?.emblemId).toBe(WRENN_AND_SIX_EMBLEM_ID);
    });
});
