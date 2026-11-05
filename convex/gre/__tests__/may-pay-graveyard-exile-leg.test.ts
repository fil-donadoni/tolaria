// May-pay GRAVEYARD EXILE leg (CR 118.12 / 118.3) — "you may exile eight cards
// from your graveyard. If you do, …": the optional action is a cost paid as the
// ability resolves, and a cost the graveyard cannot cover in full is not paid.

import { describe, it, expect } from "vitest";
import {
    canPayMayPayCost,
    mayPayGraveyardChoiceRequired,
    type CardInstanceState,
    type GameState,
} from "../state";
import { applyMayPaySubmit } from "../pendingChoiceSubmit";
import { altCostGraveyardExileCards } from "../alternativeCost";
import { validateEffectScript } from "../effects/validate";
import { projectPublicState } from "../../gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import type { EffectOp } from "../../cards/types";
import {
    GRAVEYARD_LEG_FOREST_ID,
    graveyardCard,
} from "./fixtures/mayPayGraveyardLegProbe.fixture";
import {
    EXILE_TWO_CARDS,
    fireGraveyardExileLegEtb,
    graveyardExileLegProbeInstance,
} from "./fixtures/mayPayGraveyardExileLegProbe.fixture";

const card = (id: string) => graveyardCard(GRAVEYARD_LEG_FOREST_ID, id, "p1");
const ids = (cards: { id: string }[]) => cards.map((c) => c.id);

function board(graveyard: CardInstanceState[]): {
    state: GameState;
    probe: CardInstanceState;
} {
    const probe = graveyardExileLegProbeInstance("probe", "p1");
    const state = makeState({
        players: [
            makePlayer("p1", {
                battlefield: [probe],
                graveyard,
                library: [
                    makeInstance(GRAVEYARD_LEG_FOREST_ID, {
                        id: "top",
                        controllerId: "p1",
                        ownerId: "p1",
                        zone: "library",
                    }),
                ],
            }),
            makePlayer("p2"),
        ],
    });
    return { state, probe };
}

describe("may-pay graveyard exile leg — vocabulary", () => {
    const mayPay = (graveyard: unknown) => ({
        id: "test:exile-host",
        name: "Exile Host",
        effects: [
            {
                op: "mayPay",
                player: "controller",
                cost: { graveyard },
                prompt: "Exile?",
                bind: "$paid",
            },
        ] as unknown as EffectOp[],
    });

    it("the script validator admits the payer-picked exile", () => {
        expect(validateEffectScript(mayPay(EXILE_TWO_CARDS.graveyard))).toEqual(
            []
        );
    });

    it("the script validator still refuses the positional exile on a may-pay", () => {
        expect(
            validateEffectScript(
                mayPay({
                    action: "exile",
                    filter: {},
                    count: 2,
                    position: "top",
                })
            )
        ).not.toEqual([]);
    });

    it("an alternative cost refuses the payer-picked exile (fails closed)", () => {
        const player = { graveyard: [card("a"), card("b")] };
        expect(
            altCostGraveyardExileCards(player, EXILE_TWO_CARDS, "cast")
        ).toBeUndefined();
    });
});

describe("may-pay graveyard exile leg — paid in full or not at all (CR 118.3)", () => {
    it("is payable only with at least `count` matching cards", () => {
        const short = board([card("a")]).state;
        expect(canPayMayPayCost(short, "p1", EXILE_TWO_CARDS)).toBe(false);
        expect(
            mayPayGraveyardChoiceRequired(short, "p1", EXILE_TWO_CARDS)
        ).toBe(false);
        const enough = board([card("a"), card("b")]).state;
        expect(canPayMayPayCost(enough, "p1", EXILE_TWO_CARDS)).toBe(true);
        expect(
            mayPayGraveyardChoiceRequired(enough, "p1", EXILE_TWO_CARDS)
        ).toBe(true);
    });

    it("short of the count: Pay is refused and nothing moves or draws", () => {
        const { state, probe } = board([card("a")]);
        fireGraveyardExileLegEtb(state, probe);
        expect(() =>
            applyMayPaySubmit(state, {
                playerId: "p1",
                accept: true,
                graveyardIds: ["a"],
            })
        ).toThrow(/Cannot pay the cost/);
        applyMayPaySubmit(state, { playerId: "p1", accept: false });
        const p1 = state.players[0]!;
        expect(ids(p1.graveyard)).toEqual(["a"]);
        expect(p1.exile).toHaveLength(0);
        expect(p1.hand).toHaveLength(0);
    });

    it.each([
        ["fewer cards than the leg takes", ["a"]],
        ["the same card twice", ["a", "a"]],
        ["no pick at all", undefined],
    ])("rejects %s, paying nothing", (_label, pick) => {
        const { state, probe } = board([card("a"), card("b"), card("c")]);
        fireGraveyardExileLegEtb(state, probe);
        expect(() =>
            applyMayPaySubmit(state, {
                playerId: "p1",
                accept: true,
                ...(pick ? { graveyardIds: pick } : {}),
            })
        ).toThrow(/Illegal graveyard choice/);
        expect(ids(state.players[0]!.graveyard)).toEqual(["a", "b", "c"]);
        expect(state.players[0]!.exile).toHaveLength(0);
    });
});

describe("may-pay graveyard exile leg — If you do (CR 118.12)", () => {
    it("accept: exactly the CHOSEN cards are exiled and the gated effect runs", () => {
        const { state, probe } = board([card("a"), card("b"), card("c")]);
        fireGraveyardExileLegEtb(state, probe);
        applyMayPaySubmit(state, {
            playerId: "p1",
            accept: true,
            graveyardIds: ["a", "c"],
        });
        const p1 = state.players[0]!;
        expect(new Set(ids(p1.exile))).toEqual(new Set(["a", "c"]));
        expect(ids(p1.graveyard)).toEqual(["b"]);
        expect(ids(p1.hand)).toEqual(["top"]);
        expect(state.pendingChoices ?? []).toHaveLength(0);
    });

    it("decline: nothing is exiled and the gated effect does not run", () => {
        const { state, probe } = board([card("a"), card("b")]);
        fireGraveyardExileLegEtb(state, probe);
        applyMayPaySubmit(state, { playerId: "p1", accept: false });
        const p1 = state.players[0]!;
        expect(ids(p1.graveyard)).toEqual(["a", "b"]);
        expect(p1.exile).toHaveLength(0);
        expect(p1.hand).toHaveLength(0);
    });
});

describe("may-pay graveyard exile leg — wire format (projectPublicState)", () => {
    it("carries the action, the zone and the candidates to the client", () => {
        const { state, probe } = board([card("a"), card("b")]);
        fireGraveyardExileLegEtb(state, probe);
        const head = projectPublicState(state, 1, "p1").pendingChoices![0]!;
        expect(head.kind).toBe("may-pay");
        expect(head.zone).toBe("graveyard");
        expect(head.cost).toEqual(EXILE_TWO_CARDS);
        expect(head.candidateIds).toEqual(["a", "b"]);
    });
});
