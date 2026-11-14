// A nonmodal back face's own "enters with N counters" replacement (CR 614.1c,
// CR 122.6), and the count "for each instant and sorcery spell you've cast this
// turn" (CR 601.2i) — issue #9434, for Ral, Monsoon Mage // Ral, Leyline
// Prodigy (issue #8630): "Ral enters with an additional loyalty counter on him
// for each instant and sorcery spell you've cast this turn", on top of the
// CR 306.5b starting loyalty, when he is exiled and returned transformed.
//
// Layers, one file:
//   - GRE unit: the frontend-safe oracle `resolveEntersWithCounters` reading
//     the `spellsCastThisTurn` count.
//   - Codec: `backFaceAsTokenSpec` → `tokenDefinitionId` → a cold decode
//     (`getDefinition` on an id nobody registered) carries the face's
//     `entersWith.counters`; `tokenSpecFromDefinitionId` round-trips it.
//   - game.ts integration: a real cast commit (`tryAutoCommitPendingCast`)
//     writes the controller's tally, which survives a save/load and is what
//     the flip's entry reads.
//   - Wire format: `projectPublicState` shows the loyalty on both seats.

import { describe, expect, it } from "vitest";
import { tryAutoCommitPendingCast } from "../../game";
import { projectPublicState } from "../../gameProjections";
import {
    getCardByName,
    getDefinition,
    registerTokenDefinition,
    tokenDefinitionId,
    tokenSpecFromDefinitionId,
} from "../../cards";
import { backFaceAsTokenSpec } from "../../cards/backFaceSpec";
import {
    resolveEntersWithCounters,
    type EntersWithCount,
} from "../../cards/entersWith";
import type { CardBackFace } from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
    resolveActivated,
} from "../../cards/__tests__/setup.helper";
import { compactState, expandState } from "../serialize";
import type { GameState } from "../state";

const INSTANTS_AND_SORCERIES: EntersWithCount = {
    spellsCastThisTurn: { types: ["Instant", "Sorcery"] },
};

const BACK_FACE: CardBackFace = {
    name: "Test Leyline Walker",
    types: ["Planeswalker"],
    subtypes: ["Ral"],
    colors: ["U", "R"],
    loyalty: 2,
    entersWith: {
        counters: [{ type: "loyalty", count: INSTANTS_AND_SORCERIES }],
    },
    oracleText:
        "This planeswalker enters with an additional loyalty counter on it for each instant and sorcery spell you've cast this turn.",
};

const FRONT_ID = "test-back-face-enters-with-front";
const FLIP = "test-back-face-enters-with-flip";
registerTokenDefinition({
    id: FRONT_ID,
    name: "Test Monsoon Mage",
    rarity: "mythic",
    manaCost: { U: 1, R: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Wizard"],
    power: 1,
    toughness: 3,
    activatedAbilities: [
        {
            id: FLIP,
            oracleText:
                "{0}: Exile this creature, then return it to the battlefield transformed under its owner's control.",
            cost: {},
            useStack: true,
            effects: [
                { op: "exileAndReturnTransformed", target: { ref: "$source" } },
            ],
        },
    ],
    backFace: BACK_FACE,
});

const OPT = getCardByName("Opt").id;

function board(tally: {
    total: number;
    byType: Record<string, number>;
}): GameState {
    return makeState({
        phase: "PRECOMBAT_MAIN",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", {
                battlefield: [
                    makeInstance(FRONT_ID, {
                        id: "mage",
                        controllerId: "p1",
                        ownerId: "p1",
                    }),
                ],
                hand: [
                    makeInstance(OPT, {
                        id: "opt",
                        zone: "hand",
                        controllerId: "p1",
                        ownerId: "p1",
                    }),
                ],
                library: [
                    makeInstance(OPT, { ownerId: "p1", zone: "library" }),
                    makeInstance(OPT, { ownerId: "p1", zone: "library" }),
                ],
                manaPool: { U: 1 },
                spellsCastThisTurn: tally.total,
                spellTypesCastThisTurn: tally.byType,
            }),
            makePlayer("p2", {
                // The opponent's spells are not "you've cast" (CR 109.5).
                spellsCastThisTurn: 3,
                spellTypesCastThisTurn: { Instant: 3 },
            }),
        ],
    });
}

function loyaltyOf(state: GameState): number {
    const walker = state.players[0].battlefield.find((c) => c.id === "mage");
    expect(walker?.transformed).toBe(true);
    return walker!.counters?.loyalty ?? 0;
}

describe("spellsCastThisTurn entry count — oracle (CR 601.2i)", () => {
    const def = { entersWith: BACK_FACE.entersWith };

    it("counts only the listed types among the controller's spells this turn", () => {
        expect(
            resolveEntersWithCounters(def, {
                manaSpentToCast: {},
                spellsCastThisTurn: {
                    total: 4,
                    byType: { Instant: 2, Sorcery: 1, Creature: 1 },
                },
            })
        ).toEqual({ loyalty: 3 });
    });

    it("an absent type filter counts every spell cast this turn", () => {
        expect(
            resolveEntersWithCounters(
                {
                    entersWith: {
                        counters: [
                            {
                                type: "+1/+1",
                                count: { spellsCastThisTurn: {} },
                            },
                        ],
                    },
                },
                {
                    manaSpentToCast: {},
                    spellsCastThisTurn: {
                        total: 4,
                        byType: { Instant: 2, Creature: 2 },
                    },
                }
            )
        ).toEqual({ "+1/+1": 4 });
    });

    it("no spells cast this turn adds nothing", () => {
        expect(resolveEntersWithCounters(def, { manaSpentToCast: {} })).toEqual(
            {}
        );
    });
});

describe("a back face's entersWith rides its content-derived id (CR 712.8e, ADR 0067)", () => {
    it("a cold decode carries the face's entry counters", () => {
        // A fresh face so no earlier registration answers for this id.
        const id = tokenDefinitionId(
            backFaceAsTokenSpec({ ...BACK_FACE, name: "Test Cold Walker" })
        );
        const decoded = getDefinition(id);
        expect(decoded.loyalty).toBe(2);
        expect(decoded.entersWith?.counters).toEqual([
            { type: "loyalty", count: INSTANTS_AND_SORCERIES },
        ]);
        expect(
            tokenSpecFromDefinitionId(id)?.copiableEntersWithCounters
        ).toEqual(BACK_FACE.entersWith!.counters);
    });

    it("two faces differing only in their entry count get two ids", () => {
        const other: CardBackFace = {
            ...BACK_FACE,
            entersWith: {
                counters: [
                    { type: "loyalty", count: { spellsCastThisTurn: {} } },
                ],
            },
        };
        expect(tokenDefinitionId(backFaceAsTokenSpec(other))).not.toBe(
            tokenDefinitionId(backFaceAsTokenSpec(BACK_FACE))
        );
    });

    it("a face without entersWith keeps its id byte-identical", () => {
        const id = tokenDefinitionId(
            backFaceAsTokenSpec({ ...BACK_FACE, entersWith: undefined })
        );
        expect(id.split("|")).toHaveLength(16);
    });
});

describe("returned transformed, it enters with starting loyalty + N (CR 614.1c / 306.5b)", () => {
    it("adds one loyalty counter per instant and sorcery the controller cast this turn", () => {
        const state = board({
            total: 3,
            byType: { Instant: 1, Sorcery: 1, Creature: 1 },
        });
        resolveActivated(state, state.players[0].battlefield[0], FLIP);
        expect(loyaltyOf(state)).toBe(2 + 2);
    });

    it("with no instant or sorcery cast this turn it enters with its printed loyalty", () => {
        const state = board({ total: 1, byType: { Creature: 1 } });
        resolveActivated(state, state.players[0].battlefield[0], FLIP);
        expect(loyaltyOf(state)).toBe(2);
    });

    it("a real cast feeds the count, across a save, and both seats see it", () => {
        const state = board({ total: 1, byType: { Sorcery: 1 } });
        state.pendingCast = {
            playerId: "p1",
            cardInstanceId: "opt",
            manaCost: { U: 1 },
            tappedLandIds: [],
        };
        expect(tryAutoCommitPendingCast(state, "p1")).not.toBeNull();
        expect(state.players[0].spellTypesCastThisTurn?.Instant).toBe(1);

        // The tally survives a save; the flip resolves on the reloaded state
        // with Opt still on the stack beneath it.
        const reloaded = expandState(compactState(state));
        expect(reloaded.players[0].spellsCastThisTurn).toBe(2);
        resolveActivated(reloaded, reloaded.players[0].battlefield[0], FLIP);
        expect(reloaded.stack.map((s) => s.id)).toEqual(["opt"]);
        expect(loyaltyOf(reloaded)).toBe(2 + 2);

        for (const viewerId of ["p1", "p2"]) {
            const seen = projectPublicState(
                reloaded,
                1,
                viewerId
            ).players[0].battlefield.find((c) => c.id === "mage");
            expect(seen?.transformed).toBe(true);
            expect(seen?.counters?.loyalty).toBe(4);
        }
    });
});
