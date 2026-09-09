// SPM — multicolor card behavior tests (ADR 0043 colour split). Spider-Woman,
// Stunning Savior's whole rules text is one battlefield-scanned enters-tapped
// replacement (CR 614.1c / 110.5b) whose `forcesTapped` predicate is
// hand-written logic: the tests below drive the scanner directly, on each side
// of the two filters it applies (opponent-controlled, artifact-or-creature).

import { describe, it, expect } from "vitest";
import type { CardInstanceState, GameState } from "../../../../gre/state";
import { entersTappedByReplacement } from "../../../entersTapped";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { getDefinition } from "../../../index";

const spiderWoman = getDefinition("bc9b2a76-3cce-4fd0-a4ef-932747cb11b2");
const grizzlyBears = getDefinition("ce2d603a-3231-4a8c-bf39-1617586ea870");
const blackLotus = getDefinition("b0faa7f2-b547-42c4-a810-839da50dadfe");
const forest = getDefinition("6f1c8cb0-38eb-408b-94e8-16db83999b3b");
const concordantCrossroads = getDefinition(
    "3bdcfae4-86c9-4d8a-bcfe-f0a928ec29db"
);

/** p1 controls Spider-Woman; p2 is the opponent. */
function makeSpiderWomanState(): GameState {
    const sw = makeInstance(spiderWoman.id, {
        id: "spider-woman-1",
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
    });
    return makeState({
        players: [makePlayer("p1", { battlefield: [sw] }), makePlayer("p2")],
    });
}

/** A would-be-entering permanent (controllerId is its PROSPECTIVE controller,
 *  CR 614.1c — the replacement is applied before it is on the battlefield). */
function entering(
    cardId: string,
    controllerId: string,
    overrides: Partial<CardInstanceState> = {}
): CardInstanceState {
    return makeInstance(cardId, {
        controllerId,
        ownerId: controllerId,
        ...overrides,
    });
}

describe("Spider-Woman, Stunning Savior (CR 614.1c replacement, 110.5b enters tapped, 207.2c ability word — issue #3228)", () => {
    it("forces an opponent's creature and artifact to enter tapped", () => {
        const state = makeSpiderWomanState();
        expect(
            entersTappedByReplacement(
                entering(grizzlyBears.id, "p2"),
                state as never
            )
        ).toBe(true);
        expect(
            entersTappedByReplacement(
                entering(blackLotus.id, "p2"),
                state as never
            )
        ).toBe(true);
    });

    it("does NOT tap an opponent's LAND — the one narrowing against Kismet", () => {
        const state = makeSpiderWomanState();
        expect(
            entersTappedByReplacement(entering(forest.id, "p2"), state as never)
        ).toBe(false);
    });

    it("does NOT tap its own controller's artifacts or creatures", () => {
        const state = makeSpiderWomanState();
        expect(
            entersTappedByReplacement(
                entering(grizzlyBears.id, "p1"),
                state as never
            )
        ).toBe(false);
        expect(
            entersTappedByReplacement(
                entering(blackLotus.id, "p1"),
                state as never
            )
        ).toBe(false);
    });

    it("does NOT tap an opponent's non-(artifact/creature) permanent", () => {
        const state = makeSpiderWomanState();
        expect(
            entersTappedByReplacement(
                entering(concordantCrossroads.id, "p2"),
                state as never
            )
        ).toBe(false);
    });

    it("taps an opponent's TOKEN creature too (CR 111.1 — a token is a permanent)", () => {
        const state = makeSpiderWomanState();
        expect(
            entersTappedByReplacement(
                entering(grizzlyBears.id, "p2", { isToken: true }),
                state as never
            )
        ).toBe(true);
    });

    it("does nothing while Spider-Woman is not on the battlefield", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        expect(
            entersTappedByReplacement(
                entering(grizzlyBears.id, "p2"),
                state as never
            )
        ).toBe(false);
    });
});
