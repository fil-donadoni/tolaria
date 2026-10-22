// A copy effect and the instance's cosmetic art pin (CR 707.2 / 707.4 / 708.5,
// issue #4104). Art is not a copiable value: the copy shows the print of the
// object it copied, the copier's own print is remembered and comes back when
// the copy ends, and a face-down source never lends its print.
import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import {
    applyCopy,
    applyTimedCopy,
    presentedDefId,
    rematerialiseTimedCopies,
    revertCopy,
} from "../copy";
import {
    buildSpellContext,
    removePermanentTo,
    type CardInstanceState,
} from "../state";
import { turnFaceDown } from "../faceDown";
import { NO_BOARD_LAYER_VIEW } from "../layers";
import { compactState, expandState } from "../serialize";
import { projectPublicState } from "../../gameProjections";

const CLONE = getCardByName("Clone");
const SERRA = getCardByName("Serra Angel");
const BEARS = getCardByName("Grizzly Bears");

const OWN = "print-own";
const SOURCE = "print-source";
const HIDDEN = "print-hidden";

const bf = (id: string, extra = {}) =>
    makeInstance(id, {
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
        ...extra,
    });

describe("copy effects and art (CR 707.2, issue #4104)", () => {
    it("shows the copied object's print and restores the copier's own on revert", () => {
        const copy = bf(CLONE.id, { imagePrintId: OWN });
        applyCopy(
            NO_BOARD_LAYER_VIEW,
            copy,
            bf(SERRA.id, { imagePrintId: SOURCE })
        );
        expect(copy.imagePrintId).toBe(SOURCE);
        expect(copy.preCopyImagePrintId).toBe(OWN);

        revertCopy(NO_BOARD_LAYER_VIEW, copy);
        expect(copy.imagePrintId).toBe(OWN);
        expect(copy.preCopyImagePrintId).toBeUndefined();
    });

    it("a copier with no print of its own ends with none", () => {
        const copy = bf(CLONE.id);
        applyCopy(
            NO_BOARD_LAYER_VIEW,
            copy,
            bf(SERRA.id, { imagePrintId: SOURCE })
        );
        expect(copy.imagePrintId).toBe(SOURCE);
        expect(copy.preCopyImagePrintId).toBeUndefined();
        revertCopy(NO_BOARD_LAYER_VIEW, copy);
        expect("imagePrintId" in copy).toBe(false);
    });

    it("opts.imagePrintId (a token frame) beats the source's print", () => {
        const copy = bf(CLONE.id);
        applyCopy(
            NO_BOARD_LAYER_VIEW,
            copy,
            bf(SERRA.id, { imagePrintId: SOURCE }),
            { imagePrintId: "print-frame" }
        );
        expect(copy.imagePrintId).toBe("print-frame");
    });

    it("a re-copy (CR 707.4) switches to the new source's print and keeps the own one", () => {
        const copy = bf(CLONE.id, { imagePrintId: OWN });
        applyCopy(
            NO_BOARD_LAYER_VIEW,
            copy,
            bf(SERRA.id, { imagePrintId: SOURCE })
        );
        applyCopy(
            NO_BOARD_LAYER_VIEW,
            copy,
            bf(BEARS.id, { imagePrintId: "print-bears" })
        );
        expect(copy.imagePrintId).toBe("print-bears");
        expect(copy.preCopyImagePrintId).toBe(OWN);
        // A re-copy of a printless source must not leave the old borrowed art.
        applyCopy(NO_BOARD_LAYER_VIEW, copy, bf(SERRA.id));
        expect(copy.imagePrintId).toBeUndefined();
        revertCopy(NO_BOARD_LAYER_VIEW, copy);
        expect(copy.imagePrintId).toBe(OWN);
    });

    it("a timed copy layer records the source print so rematerialising keeps the art", () => {
        const copy = bf(CLONE.id, { imagePrintId: OWN });
        applyTimedCopy(
            NO_BOARD_LAYER_VIEW,
            copy,
            bf(SERRA.id, { imagePrintId: SOURCE }),
            {},
            { phase: "end-of-turn" }
        );
        expect(copy.imagePrintId).toBe(SOURCE);
        // The recorded layer re-applies with the same art (rematerialise path).
        expect(copy.timedCopyEffects?.effects[0].sourceImagePrintId).toBe(
            SOURCE
        );
    });

    it("an expiring timed copy re-shows the indefinite copy's print it covered", () => {
        const copy = bf(CLONE.id, { imagePrintId: OWN });
        applyCopy(
            NO_BOARD_LAYER_VIEW,
            copy,
            bf(SERRA.id, { imagePrintId: SOURCE })
        );
        applyTimedCopy(
            NO_BOARD_LAYER_VIEW,
            copy,
            bf(BEARS.id, { imagePrintId: "print-bears" }),
            {},
            { phase: "end-of-turn" }
        );
        expect(copy.imagePrintId).toBe("print-bears");
        const expired = copy.timedCopyEffects!.effects;
        rematerialiseTimedCopies(NO_BOARD_LAYER_VIEW, copy, [], expired);
        expect(presentedDefId(copy)).toBe(SERRA.id);
        expect(copy.imagePrintId).toBe(SOURCE);
        expect(copy.preCopyImagePrintId).toBe(OWN);
    });

    it("a token copy made from last-known information shows the departed object's print, through serialization", () => {
        const source = bf(SERRA.id, { id: "src", imagePrintId: SOURCE });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [source] }),
                makePlayer("p2"),
            ],
        });
        const item = pushSpell(state, BEARS.id, "p1");
        const ctx = buildSpellContext(state, item);
        removePermanentTo(state, "src", "graveyard");
        const kept = expandState(compactState(state));
        expect(kept.lastKnownCopiable?.src.imagePrintId).toBe(SOURCE);
        const id = ctx.createTokenCopyOf("src", "p1", undefined, {
            lastKnownCopiable: true,
        });
        const token = state.players[0].battlefield.find(
            (c: CardInstanceState) => c.id === id
        )!;
        expect(token.imagePrintId).toBe(SOURCE);
    });

    it("a face-down permanent's departure record carries no print", () => {
        const hidden = bf(SERRA.id, { id: "fd", imagePrintId: HIDDEN });
        turnFaceDown(NO_BOARD_LAYER_VIEW, hidden, "morph");
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [hidden] }),
                makePlayer("p2"),
            ],
        });
        removePermanentTo(state, "fd", "graveyard");
        expect(state.lastKnownCopiable?.fd.imagePrintId).toBeUndefined();
    });

    it("a face-down source lends no print (CR 708.5) — through projectPublicState, both viewers", () => {
        const hidden = bf(SERRA.id, { imagePrintId: HIDDEN });
        turnFaceDown(NO_BOARD_LAYER_VIEW, hidden, "morph");
        const copy = bf(CLONE.id, { id: "copier", imagePrintId: OWN });
        applyCopy(NO_BOARD_LAYER_VIEW, copy, hidden);
        expect(copy.imagePrintId).toBeUndefined();

        const base = makeState();
        const state = makeState({
            players: [
                { ...base.players[0], id: "p1", battlefield: [copy] },
                { ...base.players[1], id: "p2" },
            ],
        });
        for (const viewer of ["p1", "p2"]) {
            const slim = projectPublicState(state, 1, viewer).players[0]
                .battlefield[0];
            expect(slim.imagePrintId).toBeUndefined();
            expect(JSON.stringify(slim)).not.toContain(HIDDEN);
        }
    });

    it("survives the wire and persistence round-trip", () => {
        const copy = bf(CLONE.id, { id: "copier", imagePrintId: OWN });
        applyCopy(
            NO_BOARD_LAYER_VIEW,
            copy,
            bf(SERRA.id, { imagePrintId: SOURCE })
        );
        const base = makeState();
        const state = makeState({
            players: [
                { ...base.players[0], id: "p1", battlefield: [copy] },
                base.players[1],
            ],
        });
        const slim = projectPublicState(state, 1, "p2").players[0]
            .battlefield[0];
        expect(slim.imagePrintId).toBe(SOURCE);
        expect(slim.preCopyImagePrintId).toBe(OWN);

        const back = expandState(compactState(state));
        const restored = back.players[0].battlefield[0];
        expect(restored.imagePrintId).toBe(SOURCE);
        expect(restored.preCopyImagePrintId).toBe(OWN);
    });
});
