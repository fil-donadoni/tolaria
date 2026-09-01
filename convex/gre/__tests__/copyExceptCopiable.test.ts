// CR 707.2 / 707.3 — an "except it's N/N" clause on a copy effect overrides a
// COPIABLE value, not a layer-7 continuous effect. Issue #2076.
//
// The distinction is observable in exactly one place: copy the copy. CR 707.3
// says "the copy's copiable values become the copied information. Objects that
// copy the object will use the new copiable values" — so a Clone copying an
// Eternalize token must itself be 4/4, not the printed body. A layer-7
// override would hand back the printed size instead.
//
// `applyCopy` derives the copiable base from `getDefinition(presentedDefId)`,
// which is the COPIED CARD's printed P/T; the override therefore has to be
// re-read from the source instance's own stamped exception, which is what
// `copyExcept` carries.

import { describe, expect, it } from "vitest";
import { applyCopy, revertCopy } from "../copy";
import { getEffectivePower, getEffectiveToughness } from "../layers";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { getCardByName } from "../../cards";
import { projectPublicState } from "../../gameProjections";
import { compactState, expandState } from "../serialize";
import type { GameState } from "../state";

const BEARS = getCardByName("Grizzly Bears").id; // 2/2
const OGRE = getCardByName("Hill Giant").id; // a distinct printed body

function scenario(): GameState {
    const p1 = makePlayer("p1", {
        battlefield: [
            makeInstance(BEARS, { id: "src", controllerId: "p1" }),
            makeInstance(OGRE, { id: "tok", controllerId: "p1" }),
            makeInstance(OGRE, { id: "clone", controllerId: "p1" }),
        ],
    });
    return makeState({ players: [p1, makePlayer("p2")] });
}

const find = (s: GameState, id: string) =>
    s.players[0].battlefield.find((c) => c.id === id)!;

describe('CR 707.2 "except it\'s N/N" is a COPIABLE value (issue #2076)', () => {
    it("stamps the overridden base P/T on the copy itself", () => {
        const state = scenario();
        applyCopy(find(state, "tok"), find(state, "src"), {
            basePower: 1,
            baseToughness: 1,
        });

        const token = find(state, "tok");
        expect(getEffectivePower(state, token)).toBe(1);
        expect(getEffectiveToughness(state, token)).toBe(1);
    });

    it("a copy OF the copy keeps N/N (CR 707.3) — the copiable-vs-layer-7 proof", () => {
        const state = scenario();
        applyCopy(find(state, "tok"), find(state, "src"), {
            basePower: 1,
            baseToughness: 1,
        });
        // No `except` of its own: a plain Clone copying the 1/1 token.
        applyCopy(find(state, "clone"), find(state, "tok"));

        const clone = find(state, "clone");
        // A layer-7 override on the token would leave the printed 2/2 here.
        expect(getEffectivePower(state, clone)).toBe(1);
        expect(getEffectiveToughness(state, clone)).toBe(1);
    });

    it("does not survive the copy leaving the battlefield (revertCopy)", () => {
        const state = scenario();
        applyCopy(find(state, "tok"), find(state, "src"), {
            basePower: 1,
            baseToughness: 1,
        });
        revertCopy(find(state, "tok"));

        const reverted = find(state, "tok");
        // Hill Giant's own printed body, with no trace of the 1/1 exception.
        expect(getEffectivePower(state, reverted)).toBe(3);
        expect(getEffectiveToughness(state, reverted)).toBe(3);
        expect(reverted.copyExcept).toBeUndefined();
    });

    it("a re-copy WITHOUT the clause drops it (Vesuvan idempotency)", () => {
        const state = scenario();
        const token = find(state, "tok");
        applyCopy(token, find(state, "src"), {
            basePower: 1,
            baseToughness: 1,
        });
        applyCopy(token, find(state, "src"));

        expect(getEffectivePower(state, find(state, "tok"))).toBe(2);
        expect(getEffectiveToughness(state, find(state, "tok"))).toBe(2);
    });

    it("a layer-7 overlay still stacks on top of the overridden base (CR 613.4a)", () => {
        const state = scenario();
        const token = find(state, "tok");
        applyCopy(token, find(state, "src"), {
            basePower: 1,
            baseToughness: 1,
        });
        // A +1/+1 counter is layer 7d — applied over the 7a base the exception
        // replaced, so the 1/1 reads 2/2 rather than the printed 2/2 + 1.
        token.counters = { "+1/+1": 1 };

        expect(getEffectivePower(state, find(state, "tok"))).toBe(2);
        expect(getEffectiveToughness(state, find(state, "tok"))).toBe(2);
    });

    it("wire format: the override and its copiable stamp survive projectPublicState", () => {
        const state = scenario();
        applyCopy(find(state, "tok"), find(state, "src"), {
            basePower: 1,
            baseToughness: 1,
        });
        applyCopy(find(state, "clone"), find(state, "tok"));

        const projected = projectPublicState(state, 1, "p1");
        const slim = (id: string) =>
            projected.players[0].battlefield.find((c) => c.id === id)!;
        // The projection rewrites `card` down to `{ id }`, so a P/T read off
        // the fat definition would be gone by here.
        expect(getEffectivePower(projected, slim("tok"))).toBe(1);
        expect(getEffectiveToughness(projected, slim("tok"))).toBe(1);
        expect(getEffectivePower(projected, slim("clone"))).toBe(1);
        // The stamp itself crosses too — the client-side Brain re-runs the
        // copy path over projected state (ADR 0074) and needs it to simulate
        // a further copy correctly.
        expect(slim("tok").copyExcept).toEqual({
            basePower: 1,
            baseToughness: 1,
        });
    });

    it("survives a serialize/deserialize round trip", () => {
        const state = scenario();
        applyCopy(find(state, "tok"), find(state, "src"), {
            basePower: 1,
            baseToughness: 1,
        });

        const round = expandState(compactState(state));
        const token = round.players[0].battlefield.find((c) => c.id === "tok")!;
        expect(token.copyExcept).toEqual({ basePower: 1, baseToughness: 1 });
        expect(getEffectivePower(round, token)).toBe(1);
    });
});
