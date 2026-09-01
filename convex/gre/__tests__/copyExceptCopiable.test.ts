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
import { turnFaceDown, turnFaceUp } from "../faceDown";
import { getEffectivePower, getEffectiveToughness } from "../layers";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { getCardByName } from "../../cards";
import { projectPublicState } from "../../gameProjections";
import { compactState, expandState } from "../serialize";
import type { CardInstanceState, GameState } from "../state";

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

    it("wire format: a copy made FROM the projected instance is still N/N", () => {
        const state = scenario();
        applyCopy(find(state, "tok"), find(state, "src"), {
            basePower: 1,
            baseToughness: 1,
        });
        applyCopy(find(state, "clone"), find(state, "tok"));

        const projected = projectPublicState(state, 1, "p1");
        const slim = (id: string) =>
            projected.players[0].battlefield.find((c) => c.id === id)!;
        // The stamp has to cross, on the inherited copy as well as the first
        // one: the client-side Brain re-runs the copy path over projected
        // state (ADR 0074), so a third copy is simulated from THESE objects.
        expect(slim("tok").copyExcept).toEqual({
            basePower: 1,
            baseToughness: 1,
        });
        expect(slim("clone").copyExcept).toEqual({
            basePower: 1,
            baseToughness: 1,
        });
        // The load-bearing assertion: copying the PROJECTED instance is the
        // only shape here that goes red if the stamp fails to cross. Reading
        // P/T straight off a projected card would not — `power`/`toughness`
        // are materialised instance fields `slimCard` forwarded long before
        // this change, so such an assertion passes eitherway.
        const recipient = { ...slim("src") } as unknown as CardInstanceState;
        applyCopy(recipient, slim("tok") as unknown as CardInstanceState);
        expect(getEffectivePower(projected, recipient)).toBe(1);
        expect(getEffectiveToughness(projected, recipient)).toBe(1);
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
        // `power` round-trips on its own, so re-copying off the restored
        // instance is what actually proves the STAMP survived the round trip.
        const recipient = round.players[0].battlefield.find(
            (c) => c.id === "clone"
        )!;
        applyCopy(recipient, token);
        expect(getEffectivePower(round, recipient)).toBe(1);
    });

    it("a new clause overrides only the half it names (CR 707.2)", () => {
        const state = scenario();
        applyCopy(find(state, "tok"), find(state, "src"), {
            basePower: 1,
            baseToughness: 1,
        });
        // CR 707.2 — the copy first acquires the source's copiable values
        // (already 1/1 per CR 707.3), and only then does this effect's own
        // "except" overwrite the halves it actually names. So power is 7 and
        // toughness stays the inherited 1, NOT the printed 2.
        applyCopy(find(state, "clone"), find(state, "tok"), { basePower: 7 });

        expect(getEffectivePower(state, find(state, "clone"))).toBe(7);
        expect(getEffectiveToughness(state, find(state, "clone"))).toBe(1);
    });

    it("carries through a three-deep copy chain", () => {
        const state = scenario();
        const third = makeInstance(OGRE, { id: "third", controllerId: "p1" });
        state.players[0].battlefield.push(third);

        applyCopy(find(state, "tok"), find(state, "src"), {
            basePower: 1,
            baseToughness: 1,
        });
        applyCopy(find(state, "clone"), find(state, "tok"));
        applyCopy(find(state, "third"), find(state, "clone"));

        expect(getEffectivePower(state, find(state, "third"))).toBe(1);
        expect(getEffectiveToughness(state, find(state, "third"))).toBe(1);
    });

    it("a REVERTED source contributes no exception to a later copy", () => {
        const state = scenario();
        applyCopy(find(state, "tok"), find(state, "src"), {
            basePower: 1,
            baseToughness: 1,
        });
        revertCopy(find(state, "tok"));
        // The copy effect ended, so the object is Hill Giant again and there
        // is no exception left for a copier to acquire.
        applyCopy(find(state, "clone"), find(state, "tok"));

        expect(getEffectivePower(state, find(state, "clone"))).toBe(3);
        expect(getEffectiveToughness(state, find(state, "clone"))).toBe(3);
    });

    it("a FACE-DOWN source copies as the 2/2 sentinel, not its exception (CR 707.2)", () => {
        const state = scenario();
        const token = find(state, "tok");
        applyCopy(token, find(state, "src"), {
            basePower: 1,
            baseToughness: 1,
        });
        turnFaceDown(token, "morph");
        applyCopy(find(state, "clone"), find(state, "tok"));

        // CR 707.2's own example: a Clone of a face-down creature is a 2/2.
        expect(getEffectivePower(state, find(state, "clone"))).toBe(2);
        expect(getEffectiveToughness(state, find(state, "clone"))).toBe(2);

        // The copy effect never stopped applying, so turning the source back
        // face up restores its exception for the NEXT copier.
        turnFaceUp(find(state, "tok"));
        applyCopy(find(state, "clone"), find(state, "tok"));
        expect(getEffectivePower(state, find(state, "clone"))).toBe(1);
    });
});
