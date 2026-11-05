// Bot-lane half of collect evidence (CR 701.59) and the bestow-scoped
// graveyard cast (CR 118.9b), issue #2074 — Detective's Phoenix.
//
// Lives in a `*.bot.test.ts` file because `convex/gre/moves.ts` is a declared
// bot module (`bot-suite-boundary.test.ts`).
//
// Pinned:
//   1. from the GRAVEYARD the Bot enumerates the bestowed cast only — never the
//      printed-cost cast the scoped permission does not license (a Move
//      `announceCast` refuses is the bot-freeze shape);
//   2. each bestow Move carries the collect-evidence exile picks, a set whose
//      total mana value reaches 6 and never names the Phoenix itself;
//   3. one mana value short to collect evidence (CR 701.59b), no bestow Move —
//      in hand OR
//      graveyard;
//   4. the search sandbox charges the picks: the evidence is exiled and the
//      Phoenix is attached.

import { describe, it, expect } from "vitest";
import { getCardByName } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { enumerateMoves, type Move } from "../moves";
import { applyMoveForSearch } from "../applyMove";
import { totalManaValue } from "../collectEvidence";
import { chooseCastExileCost } from "../paymentPicks";
import type { CardInstanceState, GameState } from "../state";
import { detectivesPhoenix } from "../../cards/sets/mh3/red.cards";
import {
    ancestralRecall,
    disenchant,
    grizzlyBears,
    lightningBolt,
} from "../../cards/sets/lea/index.cards";

const MOUNTAIN = getCardByName("Mountain").id;

function board(opts: {
    phoenixZone: "hand" | "graveyard";
    short?: boolean;
}): GameState {
    const phoenix = makeInstance(detectivesPhoenix().id, {
        id: "phoenix",
        controllerId: "p1",
        ownerId: "p1",
        zone: opts.phoenixZone,
    });
    // Bears 2 + Disenchant 2 + Bolt 1 + Recall 1 = 6; `short` drops Recall.
    const fodder: CardInstanceState[] = [
        makeInstance(grizzlyBears().id, { id: "ev-bears", zone: "graveyard" }),
        makeInstance(disenchant().id, {
            id: "ev-disenchant",
            zone: "graveyard",
        }),
        makeInstance(lightningBolt().id, { id: "ev-bolt", zone: "graveyard" }),
        ...(opts.short
            ? []
            : [
                  makeInstance(ancestralRecall().id, {
                      id: "ev-recall",
                      zone: "graveyard",
                  }),
              ]),
    ].map((c) => ({ ...c, ownerId: "p1", controllerId: "p1" }));
    return makeState({
        players: [
            makePlayer("p1", {
                hand: opts.phoenixZone === "hand" ? [phoenix] : [],
                graveyard:
                    opts.phoenixZone === "graveyard"
                        ? [phoenix, ...fodder]
                        : fodder,
                battlefield: [
                    makeInstance(MOUNTAIN, { id: "m1", controllerId: "p1" }),
                    makeInstance(MOUNTAIN, { id: "m2", controllerId: "p1" }),
                    makeInstance(MOUNTAIN, { id: "m3", controllerId: "p1" }),
                    makeInstance(grizzlyBears().id, {
                        id: "host",
                        controllerId: "p1",
                    }),
                ],
            }),
            makePlayer("p2"),
        ],
    });
}

function phoenixCasts(state: GameState): Move[] {
    return enumerateMoves(state, "p1").filter(
        (m) => m.kind === "cast-spell" && m.cardInstanceId === "phoenix"
    );
}

describe("Detective's Phoenix — Bot move enumeration", () => {
    it("from the graveyard, enumerates only the bestowed cast, carrying collect-evidence picks", () => {
        const state = board({ phoenixZone: "graveyard" });
        const casts = phoenixCasts(state);
        expect(casts.length).toBeGreaterThan(0);
        const graveyard = state.players[0].graveyard;
        for (const m of casts) {
            if (m.kind !== "cast-spell") throw new Error("narrowing");
            expect(m.alternativeCostId).toBe("bestow");
            const ids = m.castCostPicks?.exileCostCardIds ?? [];
            expect(ids).not.toContain("phoenix");
            expect(
                totalManaValue(graveyard.filter((c) => ids.includes(c.id)))
            ).toBeGreaterThanOrEqual(6);
        }
    });

    it("from hand, still offers the printed cast beside the bestowed one", () => {
        const casts = phoenixCasts(board({ phoenixZone: "hand" }));
        const ids = casts.map((m) =>
            m.kind === "cast-spell" ? m.alternativeCostId : "?"
        );
        expect(ids).toContain(undefined);
        expect(ids).toContain("bestow");
    });

    it("one mana value short to collect evidence, enumerates no bestow cast (CR 701.59b)", () => {
        const fromGraveyard = phoenixCasts(
            board({ phoenixZone: "graveyard", short: true })
        );
        expect(fromGraveyard).toEqual([]);
        const fromHand = phoenixCasts(
            board({ phoenixZone: "hand", short: true })
        );
        expect(
            fromHand.some(
                (m) =>
                    m.kind === "cast-spell" && m.alternativeCostId === "bestow"
            )
        ).toBe(false);
    });

    it("the search sandbox exiles the evidence and attaches the Phoenix", () => {
        const state = board({ phoenixZone: "graveyard" });
        const move = phoenixCasts(state)[0]!;
        const next = applyMoveForSearch(state, "p1", move);
        const p1 = next.players.find((p) => p.id === "p1")!;
        const phoenix = p1.battlefield.find((c) => c.id === "phoenix")!;
        expect(phoenix.bestowed).toBe(true);
        expect(phoenix.attachedTo).toBe("host");
        const exiled =
            move.kind === "cast-spell"
                ? (move.castCostPicks?.exileCostCardIds ?? [])
                : [];
        expect(exiled.length).toBeGreaterThan(0);
        expect(p1.exile.map((c) => c.id)).toEqual(
            expect.arrayContaining(exiled)
        );
    });
});

describe("chooseCastExileCost — collect-evidence threshold (CR 701.59a)", () => {
    it("accumulates cheapest-first to the threshold, skipping zero-mana-value cards", () => {
        expect(
            chooseCastExileCost({
                candidateIds: ["land", "a", "b", "c"],
                required: 4,
                maximum: 4,
                manaValueCover: {
                    minTotalManaValue: 3,
                    manaValueById: { land: 0, a: 1, b: 2, c: 5 },
                },
            })
        ).toEqual(["a", "b"]);
    });
});
