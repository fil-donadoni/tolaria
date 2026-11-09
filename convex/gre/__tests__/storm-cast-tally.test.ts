// Storm cast-time tally on the stack item (CR 702.40a; display only).
// `StackItem.spellsCastBefore` is the global spells-cast tally read BEFORE the
// spell's own cast incremented it: it must stay fixed while later spells are
// cast, survive save/load and the public projection, and be absent on a storm
// copy (CR 707.10: a copy is created, not cast).
import { describe, it, expect } from "vitest";
import {
    makeState,
    makePlayer,
    makeInstance,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import { emitSpellCastEvent, resolveTopOfStack } from "../state";
import { compactState, expandState } from "../serialize";
import { projectPublicState } from "../../gameProjections";
import { lightningBolt, grizzlyBears } from "../../cards/sets/lea/index.cards";
import { grapeshot } from "../../cards/sets/tsp/index.cards";

function castBolt(state: ReturnType<typeof makeState>, who: "p1" | "p2") {
    const bolt = pushSpell(state, lightningBolt().id, who, [
        { type: "player", id: who === "p1" ? "p2" : "p1" },
    ]);
    emitSpellCastEvent(state, bolt);
    return bolt;
}

function stateWithStormSpellOnStack() {
    const lib = (id: string) =>
        Array.from({ length: 5 }, (_, i) =>
            makeInstance(grizzlyBears().id, {
                id: `lib-${id}-${i}`,
                controllerId: id,
                ownerId: id,
                zone: "library",
            })
        );
    const state = makeState({
        players: [
            makePlayer("p1", { library: lib("p1") }),
            makePlayer("p2", { library: lib("p2") }),
        ],
    });
    castBolt(state, "p1");
    castBolt(state, "p2");
    const storm = pushSpell(state, grapeshot().id, "p1", [
        { type: "player", id: "p2" },
    ]);
    emitSpellCastEvent(state, storm);
    return { state, stormId: storm.id };
}

describe("Storm cast-time tally (CR 702.40a)", () => {
    it("fixes the tally at cast time and does not drift on later casts", () => {
        const { state, stormId } = stateWithStormSpellOnStack();
        const read = () =>
            state.stack.find((s) => s.id === stormId)!.spellsCastBefore;
        expect(read()).toBe(2);
        castBolt(state, "p2");
        expect(state.spellsCastThisTurn).toBe(4);
        expect(read()).toBe(2);
    });

    it("survives serialize/deserialize", () => {
        const { state, stormId } = stateWithStormSpellOnStack();
        const back = expandState(compactState(state));
        expect(back.stack.find((s) => s.id === stormId)!.spellsCastBefore).toBe(
            2
        );
    });

    it("survives projectPublicState, with the global tally, unredacted", () => {
        const { state, stormId } = stateWithStormSpellOnStack();
        const projected = projectPublicState(state, 1, "p2");
        expect(projected.spellsCastThisTurn).toBe(3);
        expect(
            projected.stack.find((s) => s.id === stormId)!.spellsCastBefore
        ).toBe(2);
    });

    it("a storm copy carries no cast-time tally (CR 707.10)", () => {
        const { state, stormId } = stateWithStormSpellOnStack();
        // The storm trigger sits above the spell; resolving it makes the copies.
        resolveTopOfStack(state);
        const copies = state.stack.filter((s) => s.isCopy);
        expect(copies.length).toBeGreaterThan(0);
        for (const copy of copies)
            expect(copy.spellsCastBefore).toBeUndefined();
        expect(
            state.stack.find((s) => s.id === stormId)!.spellsCastBefore
        ).toBe(2);
    });

    it("a resolved permanent spell keeps no cast-time tally on the battlefield", () => {
        const state = makeState();
        state.spellsCastThisTurn = 3;
        const bears = pushSpell(state, grizzlyBears().id, "p1", []);
        emitSpellCastEvent(state, bears);
        expect(bears.spellsCastBefore).toBe(3);
        resolveTopOfStack(state);
        const onBattlefield = state.players
            .flatMap((p) => p.battlefield)
            .find((c) => c.id === bears.id)!;
        expect(onBattlefield).toBeDefined();
        expect(onBattlefield).not.toHaveProperty("spellsCastBefore");
    });
});
