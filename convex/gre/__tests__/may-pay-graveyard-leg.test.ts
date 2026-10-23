// May-pay GRAVEYARD leg (CR 118.3 / 118.12a) — "sacrifice it unless you return
// a basic land card from your graveyard to your hand" (Harvest Wurm).
//
// The leg's own test: legality (CR 118.3 — the graveyard must hold a matching
// card), the ALWAYS-explicit pick (never auto-picked, even with one card),
// payment by moving the chosen card graveyard → hand, the decline / unpayable
// paths that sacrifice the source, and the wire projection the client reads.

import { describe, it, expect } from "vitest";
import {
    canPayMayPayCost,
    getMayPayGraveyardCandidateIds,
    mayPayGraveyardChoiceRequired,
    normalizeMayPayCost,
    payMayPayCost,
    type CardInstanceState,
    type GameState,
} from "../state";
import { applyMayPaySubmit } from "../pendingChoiceSubmit";
import { canPayAlternativeCost } from "../alternativeCost";
import { validateEffectScript } from "../effects/validate";
import { projectPublicState } from "../../gameProjections";
import { makePlayer, makeState } from "../../cards/__tests__/setup.helper";
import type { EffectOp } from "../../cards/types";
import {
    GRAVEYARD_LEG_FOREST_ID,
    GRAVEYARD_LEG_ISLAND_ID,
    GRAVEYARD_LEG_NONBASIC_ID,
    RETURN_A_BASIC_LAND_CARD,
    fireGraveyardLegEtb,
    graveyardCard,
    graveyardLegProbeInstance,
} from "./fixtures/mayPayGraveyardLegProbe.fixture";

const forest = (id: string) => graveyardCard(GRAVEYARD_LEG_FOREST_ID, id, "p1");
const island = (id: string) => graveyardCard(GRAVEYARD_LEG_ISLAND_ID, id, "p1");
const nonbasic = (id: string) =>
    graveyardCard(GRAVEYARD_LEG_NONBASIC_ID, id, "p1");

function stateWith(graveyard: CardInstanceState[]): {
    state: GameState;
    probe: CardInstanceState;
} {
    const probe = graveyardLegProbeInstance("wurm", "p1");
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [probe], graveyard }),
            makePlayer("p2"),
        ],
    });
    return { state, probe };
}

const ids = (cards: { id: string }[]) => cards.map((c) => c.id);

// ─── Layer 1: the leg vocabulary ───────────────────────────────────────────

describe("CostLegs.graveyard — legality (CR 118.3)", () => {
    it("normalizes onto the shared graveyard leg", () => {
        expect(normalizeMayPayCost(RETURN_A_BASIC_LAND_CARD).graveyard).toEqual(
            {
                action: "return",
                filter: { type: "Land", supertype: "Basic" },
                count: 1,
            }
        );
    });

    it("is payable only while a basic land card is in the payer's graveyard", () => {
        const { state } = stateWith([forest("f1")]);
        expect(canPayMayPayCost(state, "p1", RETURN_A_BASIC_LAND_CARD)).toBe(
            true
        );
        // A NONBASIC land card does not match "basic land card".
        const { state: nonbasicOnly } = stateWith([nonbasic("n1")]);
        expect(
            canPayMayPayCost(nonbasicOnly, "p1", RETURN_A_BASIC_LAND_CARD)
        ).toBe(false);
        const { state: empty } = stateWith([]);
        expect(canPayMayPayCost(empty, "p1", RETURN_A_BASIC_LAND_CARD)).toBe(
            false
        );
    });

    it("reads the payer's OWN graveyard, never the opponent's", () => {
        const probe = graveyardLegProbeInstance("wurm", "p1");
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [probe] }),
                makePlayer("p2", {
                    graveyard: [
                        graveyardCard(GRAVEYARD_LEG_FOREST_ID, "f2", "p2"),
                    ],
                }),
            ],
        });
        expect(canPayMayPayCost(state, "p1", RETURN_A_BASIC_LAND_CARD)).toBe(
            false
        );
    });

    it("ALWAYS owes an explicit pick, even with exactly one legal card", () => {
        const { state } = stateWith([forest("only"), nonbasic("n1")]);
        expect(
            getMayPayGraveyardCandidateIds(
                state,
                "p1",
                RETURN_A_BASIC_LAND_CARD
            )
        ).toEqual(["only"]);
        expect(
            mayPayGraveyardChoiceRequired(state, "p1", RETURN_A_BASIC_LAND_CARD)
        ).toBe(true);
    });

    it("opens no picker when fewer cards match than the leg returns", () => {
        const { state } = stateWith([forest("f1")]);
        const returnTwo = {
            graveyard: { ...RETURN_A_BASIC_LAND_CARD.graveyard!, count: 2 },
        };
        expect(canPayMayPayCost(state, "p1", returnTwo)).toBe(false);
        expect(mayPayGraveyardChoiceRequired(state, "p1", returnTwo)).toBe(
            false
        );
    });
});

describe("payMayPayCost — the graveyard leg never auto-picks", () => {
    it("throws without a legal pick and pays NO leg, not even the mana", () => {
        const { state } = stateWith([forest("f1")]);
        state.players[0]!.manaPool = { G: 1 };
        const cost = { ...RETURN_A_BASIC_LAND_CARD, mana: { G: 1 } };
        expect(() => payMayPayCost(state, "p1", cost)).toThrow(
            /Choose the card\(s\) to return from your graveyard/
        );
        expect(state.players[0]!.manaPool.G).toBe(1);
        expect(ids(state.players[0]!.graveyard)).toEqual(["f1"]);
    });

    it("moves the named card when given a legal pick", () => {
        const { state } = stateWith([forest("f1"), island("i1")]);
        payMayPayCost(
            state,
            "p1",
            RETURN_A_BASIC_LAND_CARD,
            undefined,
            undefined,
            undefined,
            ["f1"]
        );
        expect(ids(state.players[0]!.hand)).toEqual(["f1"]);
        expect(ids(state.players[0]!.graveyard)).toEqual(["i1"]);
    });
});

// ─── Layer 2: the ETB / submit boundary (`submitMayPay`'s pure core) ───────

describe("may-pay graveyard leg — pick, pay and decline (CR 118.12a)", () => {
    it("opens a graveyard picker over the matching cards only", () => {
        const { state, probe } = stateWith([
            forest("f1"),
            nonbasic("n1"),
            island("i1"),
        ]);
        fireGraveyardLegEtb(state, probe);
        const head = state.pendingChoices![0]!;
        expect(head.kind).toBe("may-pay");
        expect(head.zone).toBe("graveyard");
        expect(new Set(head.candidateIds)).toEqual(new Set(["f1", "i1"]));
    });

    it("accept: exactly the CHOSEN card returns to hand and the source stays", () => {
        const { state, probe } = stateWith([forest("f1"), island("i1")]);
        fireGraveyardLegEtb(state, probe);
        applyMayPaySubmit(state, {
            playerId: "p1",
            accept: true,
            graveyardIds: ["i1"],
        });
        const p1 = state.players[0]!;
        expect(ids(p1.hand)).toEqual(["i1"]);
        expect(p1.hand[0]!.zone).toBe("hand");
        expect(ids(p1.graveyard)).toEqual(["f1"]);
        expect(ids(p1.battlefield)).toEqual(["wurm"]);
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(state.stack).toHaveLength(0);
    });

    it("decline: the `unless` consequence sacrifices the source", () => {
        const { state, probe } = stateWith([forest("f1")]);
        fireGraveyardLegEtb(state, probe);
        applyMayPaySubmit(state, { playerId: "p1", accept: false });
        const p1 = state.players[0]!;
        expect(p1.battlefield).toHaveLength(0);
        expect(new Set(ids(p1.graveyard))).toEqual(new Set(["f1", "wurm"]));
        expect(p1.hand).toHaveLength(0);
    });

    it("no basic land card: nothing to pick, Pay refused, the source is sacrificed", () => {
        const { state, probe } = stateWith([nonbasic("n1")]);
        fireGraveyardLegEtb(state, probe);
        const head = state.pendingChoices![0]!;
        expect(head.zone).toBeUndefined();
        expect(head.candidateIds).toBeUndefined();
        expect(() =>
            applyMayPaySubmit(state, { playerId: "p1", accept: true })
        ).toThrow(/Cannot pay the cost/);
        applyMayPaySubmit(state, { playerId: "p1", accept: false });
        const p1 = state.players[0]!;
        expect(p1.battlefield).toHaveLength(0);
        expect(new Set(ids(p1.graveyard))).toEqual(new Set(["n1", "wurm"]));
    });

    it.each([
        ["no pick at all (never auto-picked)", undefined],
        ["a card that does not match the filter", ["n1"]],
        ["a card not in the graveyard", ["elsewhere"]],
        ["more cards than the leg returns", ["f1", "i1"]],
        ["the same card twice", ["f1", "f1"]],
    ])("rejects %s, paying nothing", (_label, pick) => {
        const { state, probe } = stateWith([
            forest("f1"),
            island("i1"),
            nonbasic("n1"),
        ]);
        fireGraveyardLegEtb(state, probe);
        const before = structuredClone(state.players[0]!);
        expect(() =>
            applyMayPaySubmit(state, {
                playerId: "p1",
                accept: true,
                ...(pick ? { graveyardIds: pick } : {}),
            })
        ).toThrow(/Illegal graveyard choice/);
        expect(state.players[0]!.graveyard).toEqual(before.graveyard);
        expect(state.players[0]!.hand).toEqual(before.hand);
    });
});

// ─── Layer 3: the wire projection ──────────────────────────────────────────

describe("may-pay graveyard leg — wire format (projectPublicState)", () => {
    it("carries the leg, the zone and the candidates to the client", () => {
        const { state, probe } = stateWith([forest("f1"), nonbasic("n1")]);
        fireGraveyardLegEtb(state, probe);
        const projected = projectPublicState(state, 1, "p1");
        const head = projected.pendingChoices![0]!;
        expect(head.kind).toBe("may-pay");
        expect(head.zone).toBe("graveyard");
        expect(normalizeMayPayCost(head.cost!).graveyard).toEqual({
            action: "return",
            filter: { type: "Land", supertype: "Basic" },
            count: 1,
        });
        expect(head.candidateIds).toEqual(["f1"]);
        // The graveyard the picker draws from is public and fully projected.
        expect(ids(projected.players[0]!.graveyard)).toEqual(["f1", "n1"]);
    });
});

// ─── Layer 4: the authoring surface and the paths that refuse the leg ──────

describe("may-pay graveyard leg — authoring and other cost surfaces", () => {
    const host = (cost: unknown) => ({
        id: "test:graveyard-leg-host",
        name: "Graveyard-Leg Host",
        effects: [
            {
                op: "mayPay",
                player: "controller",
                cost,
                prompt: "Return a card, or not?",
                bind: "$paid",
            },
        ] as unknown as EffectOp[],
    });

    it("validates the leg's shape", () => {
        expect(validateEffectScript(host(RETURN_A_BASIC_LAND_CARD))).toEqual(
            []
        );
        for (const bad of [
            { graveyard: { action: "exile", filter: {}, count: 1 } },
            { graveyard: { action: "return", filter: {}, count: 0 } },
            { graveyard: { action: "return", count: 1 } },
            // One picker per may-pay entry: a second picked leg beside the
            // graveyard one could never be answered.
            {
                ...RETURN_A_BASIC_LAND_CARD,
                permanent: { action: "sacrifice", filter: {}, count: 1 },
            },
            {
                ...RETURN_A_BASIC_LAND_CARD,
                hand: {
                    action: "discard",
                    requirements: [{ filter: {}, count: 1 }],
                },
            },
        ]) {
            expect(validateEffectScript(host(bad))).not.toEqual([]);
        }
    });

    it("an alternative cost carrying the leg is never payable (fails closed)", () => {
        const { state } = stateWith([forest("f1")]);
        expect(
            canPayAlternativeCost(state, "p1", {
                id: "graveyard-alt",
                description: "Return a basic land card from your graveyard",
                ...RETURN_A_BASIC_LAND_CARD,
            } as Parameters<typeof canPayAlternativeCost>[2])
        ).toBe(false);
    });
});
