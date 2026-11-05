// Bot-lane half of collect evidence's two non-alternative surfaces (CR 701.59,
// issue #7723). `moves.ts` is a declared bot module (`bot-suite-boundary.test.ts`).
//
// Pinned, per surface: the Move carries the picks the executor submits, they
// cover the threshold, the sandbox charges them, and below the threshold no Move
// is offered (a Move the mutation refuses is the bot-freeze shape).

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { applyMoveForSearch } from "../applyMove";
import { totalManaValue } from "../collectEvidence";
import { withKickerEvidencePicks } from "../castCostPicks";
import { enumerateMoves, type Move } from "../moves";
import { pickForOwedPayment } from "../paymentPicks";
import type { OwedPayment } from "../owedPayment";
import type { CardInstanceState, GameState } from "../state";

function fodder(short: boolean): CardInstanceState[] {
    const card = (name: string, id: string) =>
        makeInstance(getCardByName(name).id, {
            id,
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
    // Lightning Bolt 1 + Grizzly Bears 2 + Hill Giant 4 = 7; short = Bolt alone.
    return short
        ? [card("Lightning Bolt", "ev-bolt")]
        : [
              card("Hill Giant", "ev-giant"),
              card("Lightning Bolt", "ev-bolt"),
              card("Grizzly Bears", "ev-bears"),
          ];
}

function targetBears(): CardInstanceState {
    return makeInstance(getCardByName("Grizzly Bears").id, {
        id: "opp-bears",
        controllerId: "p2",
        ownerId: "p2",
    });
}

describe("activation cost: Forensic Researcher's Collect evidence 3", () => {
    const researcher = () => getCardByName("Forensic Researcher");
    const abilityId = () => researcher().activatedAbilities![1]!.id;

    function board(short = false): GameState {
        return makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(researcher().id, {
                            id: "src",
                            controllerId: "p1",
                            ownerId: "p1",
                            isSummoningSick: false,
                        }),
                    ],
                    graveyard: fodder(short),
                }),
                makePlayer("p2", { battlefield: [targetBears()] }),
            ],
            phase: "PRECOMBAT_MAIN",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });
    }

    const evidenceMoves = (state: GameState) =>
        enumerateMoves(state, "p1").filter(
            (m): m is Extract<Move, { kind: "activate-ability" }> =>
                m.kind === "activate-ability" && m.abilityId === abilityId()
        );

    it("names a cheapest cover of the threshold, never a zero-value overpay", () => {
        const [move] = evidenceMoves(board());
        // Bolt 1 + Bears 2 = 3: the Giant the graveyard is keeping stays.
        expect(move?.costPicks?.exileFromGraveyard).toEqual({
            graveyardOwnerId: "p1",
            cardInstanceIds: ["ev-bolt", "ev-bears"],
        });
    });

    it("offers no Move below the threshold (CR 701.59b)", () => {
        expect(evidenceMoves(board(true))).toEqual([]);
    });

    it("the sandbox exiles exactly the picks", () => {
        const state = board();
        const [move] = evidenceMoves(state);
        const next = applyMoveForSearch(state, "p1", move!);
        const me = next.players[0]!;
        expect(me.exile.map((c) => c.id).sort()).toEqual([
            "ev-bears",
            "ev-bolt",
        ]);
        expect(me.graveyard.map((c) => c.id)).toEqual(["ev-giant"]);
    });

    it("the live park's answer is the same cover as the plan", () => {
        const state = board();
        state.pendingActivation = {
            playerId: "p1",
            cardInstanceId: "src",
            abilityId: abilityId(),
            manaCost: {},
            tappedLandIds: [],
            exileFromGraveyardChoice: {
                count: 1,
                owner: "you",
                minTotalManaValue: 3,
            },
        } as unknown as GameState["pendingActivation"];
        expect(
            pickForOwedPayment(state, "p1", {
                kind: "activation:exileFromGraveyardChoice",
            } as OwedPayment)
        ).toEqual({
            mutation: "selectActivationExileCost",
            graveyardOwnerId: "p1",
            cardInstanceIds: ["ev-bolt", "ev-bears"],
        });
    });
});

describe("optional additional cost: Crimestopper Sprite's collect evidence 6", () => {
    const sprite = () => getCardByName("Crimestopper Sprite");

    function board(opts: {
        short?: boolean;
        zone?: "hand" | "graveyard";
    }): GameState {
        const card = makeInstance(sprite().id, {
            id: "sprite",
            controllerId: "p1",
            ownerId: "p1",
            zone: opts.zone ?? "hand",
        });
        return makeState({
            players: [
                makePlayer("p1", {
                    hand: [card],
                    graveyard: fodder(opts.short ?? false),
                    manaPool: { W: 0, U: 3, B: 0, R: 0, G: 0, C: 0 },
                }),
                makePlayer("p2", { battlefield: [targetBears()] }),
            ],
            phase: "PRECOMBAT_MAIN",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });
    }

    const casts = (state: GameState) =>
        enumerateMoves(state, "p1").filter(
            (m): m is Extract<Move, { kind: "cast-spell" }> =>
                m.kind === "cast-spell" && m.cardInstanceId === "sprite"
        );
    const paid = (state: GameState) =>
        casts(state).filter(
            (m) => m.kickerPayments?.["collect-evidence"] === 1
        );

    it("offers both the paying and the plain cast, the paying one naming a cover of 6", () => {
        const state = board({});
        expect(casts(state).some((m) => !m.kickerPayments)).toBe(true);
        const [move] = paid(state);
        const ids = move?.castCostPicks?.exileCostCardIds ?? [];
        const picked = state.players[0]!.graveyard.filter((c) =>
            ids.includes(c.id)
        );
        expect(totalManaValue(picked)).toBeGreaterThanOrEqual(6);
    });

    it("offers no paying cast below the threshold (CR 701.59b), the plain one stands", () => {
        const state = board({ short: true });
        expect(paid(state)).toEqual([]);
        expect(casts(state).length).toBeGreaterThan(0);
    });

    it("refuses the variant when another exile cost holds the cast's one picker slot", () => {
        const state = board({});
        const taken = withKickerEvidencePicks(
            { exileCostCardIds: ["ev-bolt"] },
            state.players[0]!,
            sprite(),
            { "collect-evidence": 1 },
            "sprite"
        );
        expect(taken).toBeNull();
    });

    it("the sandbox charges the picks and records the payment, never a kick", () => {
        const state = board({});
        const [move] = paid(state);
        const next = applyMoveForSearch(state, "p1", move!);
        const me = next.players[0]!;
        expect(me.exile.length).toBeGreaterThan(0);
        // The search applies a cast through to its resolution.
        const entered = me.battlefield.find((c) => c.id === "sprite");
        expect(entered?.unkickedCostPayments).toEqual({
            "collect-evidence": 1,
        });
        expect(entered?.kickerPayments).toBeUndefined();
    });
});

describe('"another target" from a graveyard source: Bonebind Orator', () => {
    function board(alone: boolean): GameState {
        const gy = (name: string, id: string) =>
            makeInstance(getCardByName(name).id, {
                id,
                controllerId: "p1",
                ownerId: "p1",
                zone: "graveyard",
            });
        const swamp = (id: string) =>
            makeInstance(getCardByName("Swamp").id, {
                id,
                controllerId: "p1",
                ownerId: "p1",
            });
        return makeState({
            players: [
                makePlayer("p1", {
                    battlefield: ["s1", "s2", "s3", "s4"].map(swamp),
                    graveyard: [
                        gy("Bonebind Orator", "orator"),
                        ...(alone ? [] : [gy("Grizzly Bears", "gy-bears")]),
                    ],
                }),
                makePlayer("p2"),
            ],
            phase: "PRECOMBAT_MAIN",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });
    }
    const activations = (state: GameState) =>
        enumerateMoves(state, "p1").filter(
            (m): m is Extract<Move, { kind: "activate-ability" }> =>
                m.kind === "activate-ability" && m.cardInstanceId === "orator"
        );

    it("never names itself: alone in the graveyard it has no Move at all", () => {
        expect(activations(board(true))).toEqual([]);
    });

    it("names only the other creature card", () => {
        const targets = activations(board(false)).flatMap((m) => m.targets);
        expect(targets.map((t) => t.id)).toEqual(["gy-bears"]);
    });
});
