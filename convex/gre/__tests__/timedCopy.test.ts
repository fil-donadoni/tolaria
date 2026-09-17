// CR 707.2 / 611.2a — a copy effect WITH A DURATION, and the `becomeCopy` Op
// that reaches it from the DSL. Issue #3236 (Saheeli, Sublime Artificer).
//
// Two things had never existed together before this issue: a copy effect
// reachable from an Effect Script at all (`becomeCopyOf` was a `resolve()`-only
// primitive), and a copy effect that ENDS while the permanent stays on the
// battlefield (`revertCopy` fired on the leave-the-battlefield path alone).
// What the tests below are written against:
//
//   - CR 611.2a — the copy lasts as long as stated, and the cleanup step
//     (CR 514.2) is where an "until end of turn" one ends;
//   - CR 707.4 — a permanent that stops copying, or starts copying something
//     else, while on the battlefield is the SAME object: no trigger, and every
//     noncopy effect on it (counters, a colour set) survives untouched;
//   - CR 613.7 — two overlapping timed copy effects each keep their OWN expiry
//     (the single-slot shape that broke timed colour sets, issues #2254/#2936),
//     and the latest timestamp is the one layer 1 shows;
//   - CR 400.7 — a permanent that LEAVES is a new object, so no pending revert
//     may fire on what comes back.

import { describe, expect, it } from "vitest";
import { applyCopy, applyTimedCopy, presentedDefId } from "../copy";
import { transformPermanent } from "../transform";
import { finalizeCleanup } from "../phases";
import { getEffectivePower, getEffectiveToughness } from "../layers";
import { removePermanentTo } from "../state";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { getCardByName } from "../../cards";
import { projectPublicState } from "../../gameProjections";
import { compactState, expandState } from "../serialize";
import type { CardInstanceState, Duration, GameState } from "../state";

const BEARS = getCardByName("Grizzly Bears").id; // 2/2 vanilla creature
const JACE = getCardByName("Jace, Vryn's Prodigy").id; // transforms (CR 712)
const SERRA = getCardByName("Serra Angel").id; // 4/4 flying, vigilance
const LOTUS = getCardByName("Black Lotus").id; // noncreature artifact

/** p1 controls a Black Lotus (the recipient), a Serra Angel and a Grizzly
 *  Bears (two distinct copy sources). */
function board(): GameState {
    const p1 = makePlayer("p1", {
        battlefield: [
            makeInstance(LOTUS, { id: "lotus", controllerId: "p1" }),
            makeInstance(SERRA, { id: "angel", controllerId: "p1" }),
            makeInstance(BEARS, { id: "bears", controllerId: "p1" }),
        ],
    });
    return makeState({ players: [p1, makePlayer("p2")], activePlayerId: "p1" });
}

const find = (s: GameState, id: string): CardInstanceState =>
    s.players[0].battlefield.find((c) => c.id === id)!;

const UNTIL_END_OF_TURN: Duration = { phase: "end-of-turn" };
/** "Until your NEXT end of turn" — one matching boundary skipped, so it
 *  outlives an `end-of-turn` created in the same turn. */
const UNTIL_NEXT_END_OF_TURN: Duration = { phase: "end-of-turn", skip: 1 };

/** CR 514.2 — run the cleanup step's "until end of turn" boundary. */
function cleanup(state: GameState): void {
    state.phase = "CLEANUP";
    finalizeCleanup(state);
    state.turn += 1;
    state.phase = "PRECOMBAT_MAIN";
}

describe("timed copy effects (CR 707.2 / 611.2a, issue #3236)", () => {
    it("applies the copy, then reverts at the stated boundary with the permanent still on the battlefield (CR 514.2)", () => {
        const state = board();
        applyTimedCopy(
            state,
            find(state, "lotus"),
            find(state, "angel"),
            { additionalTypes: ["Artifact"] },
            UNTIL_END_OF_TURN
        );

        const copied = find(state, "lotus");
        expect(presentedDefId(copied)).toBe(SERRA);
        // CR 707.9b — "except it's an artifact in addition to its other types".
        expect(copied.types).toEqual(
            expect.arrayContaining(["Creature", "Artifact"])
        );
        expect(getEffectivePower(state, copied)).toBe(4);
        expect(copied.staticAbilities).toContain("flying");

        cleanup(state);

        const reverted = find(state, "lotus");
        expect(presentedDefId(reverted)).toBe(LOTUS);
        expect(reverted.types).toEqual(["Artifact"]);
        expect(reverted.copiedFrom).toBeUndefined();
        expect(reverted.timedCopyEffects).toBeUndefined();
    });

    it("keeps the recipient's own counters across both the copy and the revert (CR 707.2 / 707.4)", () => {
        const state = board();
        find(state, "bears").counters = { "+1/+1": 1 };
        applyTimedCopy(
            state,
            find(state, "bears"),
            find(state, "angel"),
            {},
            UNTIL_END_OF_TURN
        );
        // 4/4 copiable body + the +1/+1 counter that was never copied away.
        expect(getEffectivePower(state, find(state, "bears"))).toBe(5);

        cleanup(state);
        expect(getEffectivePower(state, find(state, "bears"))).toBe(3);
        expect(getEffectiveToughness(state, find(state, "bears"))).toBe(3);
    });

    it("gives two overlapping timed copies INDEPENDENT expiries — the second never clobbers the first (CR 613.7)", () => {
        const state = board();
        // The longer effect first, the shorter one on top: layer 1 shows the
        // latest timestamp, and when it ends the earlier one is still running.
        applyTimedCopy(
            state,
            find(state, "lotus"),
            find(state, "bears"),
            {},
            UNTIL_NEXT_END_OF_TURN
        );
        applyTimedCopy(
            state,
            find(state, "lotus"),
            find(state, "angel"),
            {},
            UNTIL_END_OF_TURN
        );
        expect(presentedDefId(find(state, "lotus"))).toBe(SERRA);

        cleanup(state);
        // The Serra copy ended; the Bears copy has a boundary still to skip.
        expect(presentedDefId(find(state, "lotus"))).toBe(BEARS);
        expect(getEffectivePower(state, find(state, "lotus"))).toBe(2);

        cleanup(state);
        expect(presentedDefId(find(state, "lotus"))).toBe(LOTUS);
        expect(find(state, "lotus").timedCopyEffects).toBeUndefined();
    });

    it("re-applies the INDEFINITE copy effect underneath when the timed one ends (CR 611.2a)", () => {
        const state = board();
        // Copy Artifact's shape: an indefinite copy with its own "except"
        // clause, which the timed copy on top must not consume.
        applyCopy(state, find(state, "lotus"), find(state, "bears"), {
            additionalTypes: ["Enchantment"],
        });
        applyTimedCopy(
            state,
            find(state, "lotus"),
            find(state, "angel"),
            {},
            UNTIL_END_OF_TURN
        );
        expect(presentedDefId(find(state, "lotus"))).toBe(SERRA);

        cleanup(state);
        const back = find(state, "lotus");
        expect(presentedDefId(back)).toBe(BEARS);
        expect(back.types).toEqual(
            expect.arrayContaining(["Creature", "Enchantment"])
        );
        expect(getEffectivePower(state, back)).toBe(2);
    });

    it("drops the pending revert when the permanent LEAVES the battlefield (CR 400.7)", () => {
        const state = board();
        applyTimedCopy(
            state,
            find(state, "lotus"),
            find(state, "angel"),
            {},
            UNTIL_END_OF_TURN
        );
        removePermanentTo(state, "lotus", "graveyard");

        const inYard = state.players[0].graveyard.find(
            (c) => c.id === "lotus"
        )!;
        expect(presentedDefId(inYard)).toBe(LOTUS);
        expect(inYard.timedCopyEffects).toBeUndefined();

        // The object that comes back is a NEW object: the boundary passes and
        // nothing reverts it a second time.
        state.players[0].graveyard = state.players[0].graveyard.filter(
            (c) => c.id !== "lotus"
        );
        state.players[0].battlefield.push({ ...inYard, zone: "battlefield" });
        cleanup(state);
        expect(presentedDefId(find(state, "lotus"))).toBe(LOTUS);
    });

    it("leaves a NONCOPY colour override in place when the copy reverts (CR 707.4)", () => {
        const state = board();
        applyTimedCopy(
            state,
            find(state, "lotus"),
            find(state, "angel"),
            {},
            UNTIL_END_OF_TURN
        );
        // A separate layer-5 effect on the same permanent ("becomes the colour
        // of your choice", the `setColor` Op) — not part of the copy effect.
        find(state, "lotus").colorOverride = ["G"];

        cleanup(state);
        expect(find(state, "lotus").colorOverride).toEqual(["G"]);
    });

    it("survives a save/load round trip and still reverts on schedule", () => {
        const state = board();
        applyTimedCopy(
            state,
            find(state, "lotus"),
            find(state, "angel"),
            { additionalTypes: ["Artifact"] },
            UNTIL_END_OF_TURN
        );

        const restored = expandState(compactState(state));
        const carried = restored.players[0].battlefield.find(
            (c) => c.id === "lotus"
        )!;
        expect(carried.timedCopyEffects?.effects).toHaveLength(1);
        expect(presentedDefId(carried)).toBe(SERRA);

        cleanup(restored);
        expect(
            presentedDefId(
                restored.players[0].battlefield.find((c) => c.id === "lotus")!
            )
        ).toBe(LOTUS);
    });

    it("leaves a TRANSFORMED copy alone at the boundary — layer 1 belongs to the later effect (CR 613.7 / 712)", () => {
        // Review finding: `revertCopy` was written for the departure funnel,
        // where the transform revert runs beside it. Fired mid-battlefield it
        // would rewrite `card.card` and leave `transformed`/`transformedFrom`
        // pointing at the copied card — and the permanent would then LEAVE the
        // battlefield as the object it had copied.
        const state = board();
        const p1 = state.players[0];
        p1.battlefield.push(
            makeInstance(JACE, { id: "jace", controllerId: "p1" })
        );
        applyTimedCopy(
            state,
            find(state, "lotus"),
            find(state, "jace"),
            {},
            UNTIL_END_OF_TURN
        );
        transformPermanent(state, find(state, "lotus"));
        const backFaceId = presentedDefId(find(state, "lotus"));
        expect(backFaceId).not.toBe(JACE);

        cleanup(state);

        const after = find(state, "lotus");
        // The transform outranks the expiring copy: the identity it installed
        // stands, and its own restore anchor still matches what it presents.
        expect(presentedDefId(after)).toBe(backFaceId);
        expect(after.transformed).toBe(true);
        expect(after.transformedFrom).toBe(JACE);
        expect(after.timedCopyEffects).toBeUndefined();
    });

    it("re-applies a copy-BORN token's own except clause on expiry (CR 707.9)", () => {
        // A token created by `createTokenCopy … except {…}` carries the clause
        // on `copyOptions` and NO `copiedFrom` (the placeholder anchor is
        // cleared at creation). Gating the capture on `copiedFrom` alone lost
        // the clause: the token reverted to the bare copied definition.
        const state = board();
        const token = find(state, "bears");
        applyCopy(state, token, find(state, "angel"), {
            basePower: 4,
            baseToughness: 4,
            additionalTypes: ["Artifact"],
        });
        delete token.copiedFrom; // as `createTokenPermanents` leaves it
        applyTimedCopy(
            state,
            token,
            find(state, "lotus"),
            {},
            UNTIL_END_OF_TURN
        );
        expect(presentedDefId(find(state, "bears"))).toBe(LOTUS);

        cleanup(state);
        const back = find(state, "bears");
        expect(presentedDefId(back)).toBe(SERRA);
        expect(getEffectivePower(state, back)).toBe(4);
        expect(back.types).toEqual(
            expect.arrayContaining(["Creature", "Artifact"])
        );
    });

    it("drops the colour a PREVIOUS copy effect stamped when a new one does not name colours (CR 613.7)", () => {
        const state = board();
        applyCopy(state, find(state, "lotus"), find(state, "bears"), {
            colorOverride: ["B"],
        });
        expect(find(state, "lotus").colorOverride).toEqual(["B"]);
        applyTimedCopy(
            state,
            find(state, "lotus"),
            find(state, "angel"),
            {},
            UNTIL_END_OF_TURN
        );
        // The Serra copy names no colour exception, so the earlier copy
        // effect's "except it's black" is gone with the effect that stamped it.
        expect(find(state, "lotus").colorOverride).toBeUndefined();
    });

    it("reports the copied characteristics across the wire (projectPublicState)", () => {
        const state = board();
        applyTimedCopy(
            state,
            find(state, "lotus"),
            find(state, "angel"),
            { additionalTypes: ["Artifact"] },
            UNTIL_END_OF_TURN
        );

        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "lotus"
        )!;
        // The projection strips `card` down to `{ id }` — which IS the copied
        // definition id, so every client-side reader sees the copy.
        expect(presentedDefId(slim)).toBe(SERRA);
        expect(slim.types).toEqual(
            expect.arrayContaining(["Creature", "Artifact"])
        );
        expect(getEffectivePower(projected, slim)).toBe(4);
        expect(slim.staticAbilities).toContain("flying");
    });
});
