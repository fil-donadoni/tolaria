// May-pay PERMANENT leg, `action: "return"` (CR 400.7 / 118.9, ADR 0079,
// issue #1933).
//
// Unifying `AlternativeCost` and `MayPayCost` onto one `CostLegs` type hands
// the may-pay pipeline a return-to-hand leg for free — the leg the alternative
// costs (Gush / Thwart / Daze) already had. This suite is that leg's own test:
// legality, the ALWAYS-explicit picker, payment through the unified
// `sacrificeChoice` layer, and the decline path.
//
// The card that will use it in anger is the Planeshift Lair cycle ("When this
// land enters, sacrifice it unless you return a non-Lair land you control to
// its owner's hand"), which ships in a later slice. The probe below is that
// exact Oracle shape so the leg is exercised end-to-end today.

import { describe, it, expect } from "vitest";
import {
    canPayMayPayCost,
    payMayPayCost,
    normalizeMayPayCost,
    mayPayPermanentAction,
    mayPaySacrificeChoiceRequired,
    getMayPaySacrificeCandidateIds,
    type CardInstanceState,
    type GameState,
} from "../state";
import { applyMayPaySubmit } from "../pendingChoiceSubmit";
import { projectPublicState } from "../../gameProjections";
import { makePlayer, makeState } from "../../cards/__tests__/setup";
import {
    RETURN_A_LAND,
    fireReturnLegEtb,
    returnLegLand,
    returnLegProbeInstance,
} from "./fixtures/mayPayReturnLegProbe";

const land = (id: string) => returnLegLand(id, "p1");

function stateWith(extraLands: string[]): {
    state: GameState;
    probe: CardInstanceState;
} {
    const probe = returnLegProbeInstance("probe", "p1");
    const state = makeState({
        players: [
            makePlayer("p1", {
                battlefield: [probe, ...extraLands.map(land)],
            }),
            makePlayer("p2"),
        ],
    });
    return { state, probe };
}

// ─── Layer 1: the leg vocabulary itself ────────────────────────────────────

describe("CostLegs.permanent — return leg (CR 400.7 / 118.9, ADR 0079)", () => {
    it("normalizes onto the shared `permanent` leg with its action", () => {
        const norm = normalizeMayPayCost(RETURN_A_LAND);
        expect(norm.permanent).toEqual({
            action: "return",
            filter: { subtypes: "Forest" },
            count: 1,
        });
        expect(mayPayPermanentAction(RETURN_A_LAND)).toBe("return");
        // A bare ManaCost still widens to `{ mana }` — the shorthand is kept.
        expect(mayPayPermanentAction({ U: 1 })).toBeUndefined();
    });

    it("is affordable only while a matching permanent exists (CR 118.5)", () => {
        const { state } = stateWith(["l1"]);
        expect(canPayMayPayCost(state, "p1", RETURN_A_LAND)).toBe(true);
        // The probe itself does not match the leg's filter, so a board with
        // only the probe on it can't pay.
        const { state: bare } = stateWith([]);
        expect(canPayMayPayCost(bare, "p1", RETURN_A_LAND)).toBe(false);
    });

    it("ALWAYS owes an explicit pick, even with exactly one legal permanent", () => {
        const { state } = stateWith(["only"]);
        expect(
            getMayPaySacrificeCandidateIds(state, "p1", RETURN_A_LAND)
        ).toEqual(["only"]);
        // The sibling `"sacrifice"` leg auto-resolves here (candidates ≤ count);
        // the return leg never does — a returned permanent stays a resource the
        // payer keeps playing with, so the choice is information they must see.
        expect(mayPaySacrificeChoiceRequired(state, "p1", RETURN_A_LAND)).toBe(
            true
        );
        expect(
            mayPaySacrificeChoiceRequired(state, "p1", {
                permanent: {
                    action: "sacrifice",
                    filter: { subtypes: "Forest" },
                    count: 1,
                },
            })
        ).toBe(false);
    });

    it("pays by bouncing the CHOSEN permanent to its owner's hand (CR 400.7)", () => {
        const { state } = stateWith(["keep", "bounce"]);
        payMayPayCost(state, "p1", RETURN_A_LAND, undefined, ["bounce"]);
        const p1 = state.players[0];
        expect(p1.hand.map((c) => c.id)).toEqual(["bounce"]);
        expect(p1.battlefield.map((c) => c.id)).toEqual(["probe", "keep"]);
        // A return is NOT a sacrifice — nothing reaches the graveyard.
        expect(p1.graveyard).toHaveLength(0);
    });
});

// ─── Layer 2: the ETB / submit boundary (`submitMayPay`'s pure core) ───────

describe("may-pay return leg — pick, pay and decline (issue #1933)", () => {
    it("opens a battlefield picker tagged with the return action", () => {
        const { state, probe } = stateWith(["l1", "l2"]);
        fireReturnLegEtb(state, probe);
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("may-pay");
        expect(head.zone).toBe("battlefield");
        expect(head.permanentAction).toBe("return");
        expect(head.filter).toEqual({ subtypes: "Forest" });
        expect(new Set(head.candidateIds)).toEqual(new Set(["l1", "l2"]));
    });

    it("accept: the chosen land goes to hand and the source survives", () => {
        const { state, probe } = stateWith(["l1", "l2"]);
        fireReturnLegEtb(state, probe);
        applyMayPaySubmit(state, {
            playerId: "p1",
            accept: true,
            sacrificeIds: ["l2"],
        });
        const p1 = state.players[0];
        expect(p1.hand.map((c) => c.id)).toEqual(["l2"]);
        expect(p1.battlefield.map((c) => c.id)).toEqual(["probe", "l1"]);
        expect(p1.graveyard).toHaveLength(0);
    });

    it("decline: the CR 118 `unless` consequence sacrifices the source", () => {
        const { state, probe } = stateWith(["l1"]);
        fireReturnLegEtb(state, probe);
        applyMayPaySubmit(state, { playerId: "p1", accept: false });
        const p1 = state.players[0];
        expect(p1.battlefield.map((c) => c.id)).toEqual(["l1"]);
        expect(p1.graveyard.some((c) => c.id === "probe")).toBe(true);
        expect(p1.hand).toHaveLength(0);
    });

    it("rejects a pick that is not a legal candidate", () => {
        const { state, probe } = stateWith(["l1"]);
        fireReturnLegEtb(state, probe);
        expect(() =>
            applyMayPaySubmit(state, {
                playerId: "p1",
                accept: true,
                sacrificeIds: ["not-on-the-battlefield"],
            })
        ).toThrow(/Illegal sacrifice choice/);
    });

    it("rejects a pick of the wrong size, naming the return action", () => {
        const { state, probe } = stateWith(["l1", "l2"]);
        fireReturnLegEtb(state, probe);
        expect(() =>
            applyMayPaySubmit(state, {
                playerId: "p1",
                accept: true,
                sacrificeIds: ["l1", "l2"],
            })
        ).toThrow(/Must choose 1 permanent\(s\) to return/);
    });
});

// ─── Layer 3: the wire projection ──────────────────────────────────────────

describe("may-pay return leg — wire format (projectPublicState)", () => {
    it("carries the cost legs, candidates and `permanentAction` to the client", () => {
        const { state, probe } = stateWith(["l1", "l2"]);
        fireReturnLegEtb(state, probe);

        const projected = projectPublicState(state, 1, "p1");
        const head = projected.pendingChoices![0];
        expect(head.kind).toBe("may-pay");
        expect(head.zone).toBe("battlefield");
        // The field the prompt's verb reads must survive the projection — a
        // hand-built view would mask a drop here.
        expect(head.permanentAction).toBe("return");
        expect(normalizeMayPayCost(head.cost!).permanent).toEqual({
            action: "return",
            filter: { subtypes: "Forest" },
            count: 1,
        });
        expect(new Set(head.candidateIds)).toEqual(new Set(["l1", "l2"]));
    });
});
