// CR 400.7 / 205 (issue #2086) — a layer-4 card-type ADD / REMOVE mutates the
// TARGET permanent's `types` array in place and records provenance in
// `grantedTypes` / `suppressedTypes` keyed by the SOURCE. Reversal is driven by
// `stopApplyingStaticEffects`, i.e. by the SOURCE leaving the battlefield —
// nothing reversed it when the TARGET left, so a permanent bounced to hand and
// recast came back as a NEW object still carrying the old type mutation.
//
// `resetBattlefieldTransientState` already reverts the sibling INDEFINITE
// layer-4 mutations (`revertAnimation`, `indefiniteSubtypeSet`,
// `temporarySubtypeChange`, all added by issue #1746); `revertTypeProvenance`
// is the card-TYPE member of that family.
import { describe, it, expect } from "vitest";
import {
    beginApplyingStaticEffects,
    removePermanentTo,
    revertTypeProvenance,
} from "../state";
import type { CardInstanceState } from "../state";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { projectPublicState } from "../../gameProjections";
import { titaniasSong } from "../../cards/sets/atq/green";
import { blackLotus, moxSapphire } from "../../cards/sets/lea/colorless";
import { airElemental } from "../../cards/sets/lea/blue";
import { wireCharacteristicsOf } from "../../cards/__tests__/setup";

/** Titania's Song — "Each noncreature artifact … becomes an artifact
 *  creature". The source is a permanent OTHER than its targets, which is the
 *  whole point: source-departure and target-departure are different events. */
function makeSongBoard() {
    const lotus = makeInstance(blackLotus.id, { id: "lotus-1" });
    const mox = makeInstance(moxSapphire.id, { id: "mox-1" });
    const song = makeInstance(titaniasSong.id, { id: "song-1" });
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [lotus, mox, song] }),
            makePlayer("p2"),
        ],
    });
    beginApplyingStaticEffects(state, song);
    return { state, lotus, mox, song };
}

function inHand(
    state: ReturnType<typeof makeSongBoard>["state"],
    id: string
): CardInstanceState {
    return state.players[0].hand.find((c) => c?.id === id)!;
}

describe("layer-4 type provenance dies with the TARGET (CR 400.7, issue #2086)", () => {
    it("applies the type-add to every noncreature artifact first", () => {
        const { lotus, mox } = makeSongBoard();
        expect(lotus.types).toContain("Creature");
        expect(mox.types).toContain("Creature");
        expect(
            wireCharacteristicsOf(makeSongBoard().state, "lotus-1").grantedTypes
        ).toEqual([{ type: "Creature", auraId: "song-1" }]);
    });

    it("a bounced target comes back with its PRINTED types (source still in play)", () => {
        const { state } = makeSongBoard();
        removePermanentTo(state, "lotus-1", "hand");
        const bounced = inHand(state, "lotus-1");
        expect(bounced.types).toEqual(["Artifact"]);
    });

    it("does not disturb another target whose granting source is still on the battlefield", () => {
        const { state } = makeSongBoard();
        removePermanentTo(state, "lotus-1", "hand");
        const stillInPlay = state.players[0].battlefield.find(
            (c) => c.id === "mox-1"
        )!;
        expect(stillInPlay.types).toContain("Creature");
        expect(wireCharacteristicsOf(state, "mox-1").grantedTypes).toEqual([
            { type: "Creature", auraId: "song-1" },
        ]);
    });

    it("survives the wire projection — the bounced card reads printed there too", () => {
        const { state } = makeSongBoard();
        removePermanentTo(state, "lotus-1", "hand");
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].hand.find(
            (c) => c?.id === "lotus-1"
        )!;
        expect(slim.types).toEqual(["Artifact"]);
        const slimMox = projected.players[0].battlefield.find(
            (c) => c.id === "mox-1"
        )!;
        expect(slimMox.types).toContain("Creature");
    });
});

describe("revertTypeProvenance origin discipline (CR 205 / 400.7, issue #2086)", () => {
    /** A hand-built provenance record is the only way to reach the
     *  `type-remove` arm with S ≠ T: the sole shipped `type-remove` is
     *  Reconfigure (Lion Sash), whose `applies` is self-scoped, so its source
     *  and target depart together. The REVERT is still exercised through the
     *  real path (`removePermanentTo` → `resetBattlefieldTransientState`). */
    /** PRD #2064 S6b-part-2 — the suppression MARKER this fixture used to write
     *  is gone from `CardInstanceState`; the layer-4 BASE is what the revert
     *  restores from, and it is what a suppression leaves behind. */
    function makeSuppressedElemental(
        baseTypes: CardInstanceState["types"],
        types: CardInstanceState["types"]
    ) {
        const creature = makeInstance(airElemental.id, { id: "elem-1" });
        creature.types = [...types];
        creature.baseTypes = [...baseTypes];
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [creature] }),
                makePlayer("p2"),
            ],
        });
        return { state, creature };
    }

    it("restores a PRINTED type another source had suppressed", () => {
        const { state } = makeSuppressedElemental(["Creature"], []);
        removePermanentTo(state, "elem-1", "hand");
        const bounced = inHand(state, "elem-1");
        expect(bounced.types).toEqual(["Creature"]);
    });

    it("never RESTORES a type the card never printed", () => {
        const { state } = makeSuppressedElemental(["Creature"], ["Creature"]);
        removePermanentTo(state, "elem-1", "hand");
        const bounced = inHand(state, "elem-1");
        expect(bounced.types).toEqual(["Creature"]);
    });

    it("never STRIPS a granted type the card also printed", () => {
        // A grant that duplicates a printed type (Titania's Song's "Artifact"
        // twin shape) must not take the printed type with it.
        const lotus = makeInstance(blackLotus.id, { id: "lotus-1" });
        lotus.baseTypes = ["Artifact"];
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [lotus] }),
                makePlayer("p2"),
            ],
        });
        removePermanentTo(state, "lotus-1", "hand");
        const bounced = inHand(state, "lotus-1");
        expect(bounced.types).toEqual(["Artifact"]);
    });

    it("clears entries whose source id names no live permanent (one-shot arm, issue #2084)", () => {
        const lotus = makeInstance(blackLotus.id, { id: "lotus-1" });
        lotus.types = ["Artifact", "Creature"];
        lotus.baseTypes = ["Artifact"];
        lotus.typeLineHolds = [{ types: ["Artifact", "Creature"], seq: 1 }];
        revertTypeProvenance(lotus);
        expect(lotus.types).toEqual(["Artifact"]);
        expect(lotus.typeLineHolds).toBeUndefined();
    });
});
