// CR 613.7 / 611.2a / 105.3 — overlapping timed colour sets each end at their
// OWN boundary (issue #2936, Dwarven Song + Sylvan Paradise). The single-slot
// revert record let the second write capture the first spell's colours as the
// value to restore and destroy the first's own record, so the first colour
// leaked past cleanup.

import { describe, expect, it } from "vitest";
import { finalizeCleanup } from "../phases";
import { applyColorOverrideToPermanent } from "../state";
import { applyCopy } from "../copy";
import { getEffectiveColors } from "../../cards/effectiveColors";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { getCardByName } from "../../cards";
import { compactState, expandState } from "../serialize";
import type { CardInstanceState, Duration, GameState } from "../state";

const BEARS = getCardByName("Grizzly Bears").id; // {1}{G}
const SERRA = getCardByName("Serra Angel").id; // {3}{W}{W}

const EOT: Duration = { phase: "end-of-turn" };
const NEXT_EOT: Duration = { phase: "end-of-turn", skip: 1 };

function board(): { state: GameState; card: CardInstanceState } {
    const card = makeInstance(BEARS, { id: "bears", controllerId: "p1" });
    const state = makeState({
        players: [makePlayer("p1", { battlefield: [card] }), makePlayer("p2")],
        activePlayerId: "p1",
    });
    return { state, card };
}

/** CR 514.2 — run the cleanup step's "until end of turn" boundary. */
function cleanup(state: GameState): void {
    state.phase = "CLEANUP";
    finalizeCleanup(state);
    state.turn += 1;
    state.phase = "PRECOMBAT_MAIN";
}

const colors = (c: CardInstanceState) => getEffectiveColors(c);

describe("timed colour override ledger (CR 613.7, issue #2936)", () => {
    it.each([
        [["R"], ["U"]],
        [["U"], ["R"]],
    ] as const)(
        "two until-end-of-turn sets (%j then %j) both expire at cleanup",
        (first, second) => {
            const { state, card } = board();
            applyColorOverrideToPermanent(card, first, EOT);
            applyColorOverrideToPermanent(card, second, EOT);
            expect(colors(card)).toEqual(second);
            cleanup(state);
            expect(card.colorOverride).toBeUndefined();
            expect(card.temporaryColorOverrides).toBeUndefined();
            expect(colors(card)).toEqual(["G"]);
        }
    );

    it("three overlapping sets all expire", () => {
        const { state, card } = board();
        applyColorOverrideToPermanent(card, ["R"], EOT);
        applyColorOverrideToPermanent(card, ["U"], EOT);
        applyColorOverrideToPermanent(card, ["B"], EOT);
        expect(colors(card)).toEqual(["B"]);
        cleanup(state);
        expect(card.colorOverride).toBeUndefined();
        expect(card.temporaryColorOverrides).toBeUndefined();
    });

    it("the later set's expiry falls back to the earlier one while it is live", () => {
        const { state, card } = board();
        applyColorOverrideToPermanent(card, ["R"], NEXT_EOT);
        applyColorOverrideToPermanent(card, ["U"], EOT);
        cleanup(state);
        expect(colors(card)).toEqual(["R"]);
        cleanup(state);
        expect(card.colorOverride).toBeUndefined();
        expect(colors(card)).toEqual(["G"]);
    });

    it("the earlier set expiring under a live later one leaves the later showing", () => {
        const { state, card } = board();
        applyColorOverrideToPermanent(card, ["R"], EOT);
        applyColorOverrideToPermanent(card, ["U"], NEXT_EOT);
        cleanup(state);
        expect(colors(card)).toEqual(["U"]);
        cleanup(state);
        expect(card.colorOverride).toBeUndefined();
    });

    it("an indefinite override underneath is restored, not cleared", () => {
        const { state, card } = board();
        applyColorOverrideToPermanent(card, ["W"], undefined);
        applyColorOverrideToPermanent(card, ["R"], EOT);
        applyColorOverrideToPermanent(card, ["U"], EOT);
        cleanup(state);
        expect(card.colorOverride).toEqual(["W"]);
        expect(card.temporaryColorOverrides).toBeUndefined();
    });

    it("a copy effect's kept colour underneath survives a timed set", () => {
        const { state, card } = board();
        const serra = makeInstance(SERRA, { id: "serra", controllerId: "p1" });
        state.players[0].battlefield.push(serra);
        applyCopy(state, card, serra, { colorOverride: ["B"] });
        const underneath = card.colorOverride
            ? [...card.colorOverride]
            : undefined;
        applyColorOverrideToPermanent(card, ["R"], EOT);
        cleanup(state);
        expect(card.colorOverride).toEqual(underneath);
    });

    it("an indefinite set after a timed one supersedes it (latest timestamp)", () => {
        const { state, card } = board();
        applyColorOverrideToPermanent(card, ["R"], EOT);
        applyColorOverrideToPermanent(card, ["W"], undefined);
        cleanup(state);
        expect(card.colorOverride).toEqual(["W"]);
    });

    it("round-trips the ledger through the wire format", () => {
        const { state, card } = board();
        applyColorOverrideToPermanent(card, ["R"], NEXT_EOT);
        applyColorOverrideToPermanent(card, ["U"], EOT);
        const got = expandState(compactState(state)).players[0].battlefield[0];
        expect(got.temporaryColorOverrides).toEqual(
            card.temporaryColorOverrides
        );
        cleanup(state);
        cleanup(expandState(compactState(state)));
        expect(card.colorOverride).toEqual(["R"]);
    });
});
