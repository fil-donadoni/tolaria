// CR 601.3 / 601.3e (issue #7205) — the Bot's reach under a FILTERED
// cast-from-top-of-library permission: `enumerateMoves` offers exactly the
// casts the grant covers, and nothing `announceCast` would then refuse (the
// #2283/#2284 bot-freeze shape). The legality gate, wire and mutation sides
// live in `libraryTopCastFilter.test.ts`.

import { describe, expect, it } from "vitest";
import { enumerateMoves } from "../moves";
import { splitCastAltCostId } from "../splitCast";
import { adventureCastAltCostId } from "../adventure";
import { MORPH_CAST_ALT_COST_ID } from "../morph";
import type { GameState } from "../state";
import {
    ARTIFACT_MORPH,
    BLUE_ARTIFACT,
    BRAZEN_BORROWER,
    CITADEL,
    CREATURES_FOR_LIFE,
    CREATURES_ONLY,
    EXALTED_ANGEL,
    FORGE,
    GRIZZLY_BEARS,
    INSTANTS_AND_SORCERIES,
    NONCREATURE_MORPH,
    STAND_DELIVER,
    WHITE_ONLY,
    board,
    withDefs,
} from "./libraryTopCastFilter.fixture";

/** The announcement of every `cast-spell` Move naming the library top. */
const topCasts = (state: GameState) =>
    enumerateMoves(state, "p1").flatMap((m) =>
        m.kind === "cast-spell" && m.cardInstanceId === "top"
            ? [{ alt: m.alternativeCostId, zone: m.castFromZone }]
            : []
    );

const LEFT = splitCastAltCostId(STAND_DELIVER, "left");
const RIGHT = splitCastAltCostId(STAND_DELIVER, "right");

describe("CR 601.3 — the Bot casts only what a filtered permission covers (issue #7205)", () => {
    it("a covered top card is enumerated, from the library", () => {
        withDefs(() => {
            expect(topCasts(board([FORGE.id], BLUE_ARTIFACT.id))).toEqual([
                { alt: undefined, zone: "library" },
            ]);
        });
    });

    it("an uncovered top card is not enumerated at all", () => {
        withDefs(() => {
            expect(topCasts(board([FORGE.id], GRIZZLY_BEARS.id))).toEqual([]);
        });
    });

    it("a split card offers only its covered half (CR 601.3e)", () => {
        withDefs(() => {
            expect(topCasts(board([WHITE_ONLY.id], STAND_DELIVER.id))).toEqual([
                {
                    alt: splitCastAltCostId(STAND_DELIVER, "left"),
                    zone: "library",
                },
            ]);
        });
    });

    it("a half licensed by a DIFFERENT grant than the card pays that grant's life (CR 601.3e)", () => {
        withDefs(() => {
            // Whole card → white-only grant (no replacement); Deliver → the
            // Citadel (3 life). The half must carry its own life payment, and
            // be dropped when the caster cannot pay it — else `announceCast`
            // refuses the Move (the #2283/#2284 freeze shape).
            const state = board([WHITE_ONLY.id, CITADEL.id], STAND_DELIVER.id);
            const deliver = enumerateMoves(state, "p1").find(
                (m) =>
                    m.kind === "cast-spell" &&
                    m.cardInstanceId === "top" &&
                    m.alternativeCostId === RIGHT
            );
            expect(deliver).toMatchObject({ payLife: 3, tapPlan: [] });

            // Stand is covered by BOTH grants, so the caster picks (issue
            // #7525): 1 life under the Citadel, or {W} under the white grant.
            state.players[0].life = 2;
            expect(topCasts(state).map((c) => c.alt)).toEqual([LEFT, LEFT]);
        });
    });
});

describe("CR 601.3e — the Bot's library-top Adventure and morph casts (issue #7526)", () => {
    const PETTY_THEFT = adventureCastAltCostId(BRAZEN_BORROWER);
    const alts = (state: GameState) => [
        ...new Set(topCasts(state).map((c) => c.alt)),
    ];

    it("an instant-and-sorcery grant: Petty Theft, never Brazen Borrower", () => {
        withDefs(() => {
            expect(
                alts(board([INSTANTS_AND_SORCERIES.id], BRAZEN_BORROWER.id))
            ).toEqual([PETTY_THEFT]);
        });
    });

    it("a creature grant: Brazen Borrower, never Petty Theft", () => {
        withDefs(() => {
            expect(
                alts(board([CREATURES_ONLY.id], BRAZEN_BORROWER.id))
            ).toEqual([undefined]);
        });
    });

    it("a creature grant: a noncreature morph card face down only", () => {
        withDefs(() => {
            expect(
                alts(board([CREATURES_ONLY.id], NONCREATURE_MORPH.id))
            ).toEqual([MORPH_CAST_ALT_COST_ID]);
        });
    });

    it("an artifact-or-colorless grant: a coloured morph card face down only", () => {
        withDefs(() => {
            expect(alts(board([FORGE.id], EXALTED_ANGEL.id))).toEqual([
                MORPH_CAST_ALT_COST_ID,
            ]);
        });
    });

    it("CR 601.2b — no morph Move rides Bolas's Citadel's life payment", () => {
        withDefs(() => {
            expect(alts(board([CITADEL.id], EXALTED_ANGEL.id))).toEqual([
                undefined,
            ]);
            expect(
                alts(board([CREATURES_FOR_LIFE.id], NONCREATURE_MORPH.id))
            ).toEqual([]);
        });
    });

    it("an Adventure licensed apart from the Citadel-covered card is still enumerated", () => {
        withDefs(() => {
            // The creature rides the Citadel (3 life); Petty Theft the
            // instant-and-sorcery grant, which keeps the mana cost — the
            // caster's permission choice (issue #7525). A whole-card
            // `lifeInsteadOfMana` guard dropped the Adventure here.
            const state = board(
                [INSTANTS_AND_SORCERIES.id, CITADEL.id],
                BRAZEN_BORROWER.id
            );
            expect(alts(state).sort()).toEqual([PETTY_THEFT, undefined].sort());
            // Below the creature's 3 life the printed Move goes; Petty Theft,
            // which owes no life, stays (no whole-card life refusal).
            state.players[0].life = 2;
            expect(alts(state)).toEqual([PETTY_THEFT]);
        });
    });
});

describe("CR 601.2b / 118.9 — the Bot picks among overlapping permissions (issue #7525)", () => {
    const topMoves = (state: GameState) =>
        enumerateMoves(state, "p1").filter(
            (m) => m.kind === "cast-spell" && m.cardInstanceId === "top"
        );

    it("Citadel + Forge, an artifact on top: a life Move and a mana Move, each priced its own way", () => {
        withDefs(() => {
            const moves = topMoves(
                board([FORGE.id, CITADEL.id], BLUE_ARTIFACT.id)
            );
            const life = moves.find(
                (m) =>
                    m.kind === "cast-spell" &&
                    m.declineManaCostReplacement === undefined
            );
            const mana = moves.find(
                (m) =>
                    m.kind === "cast-spell" &&
                    m.declineManaCostReplacement === true
            );
            expect(life).toMatchObject({ payLife: 1, tapPlan: [] });
            expect(mana).toBeDefined();
            expect(mana).not.toMatchObject({ payLife: 1 });
            expect(mana?.kind === "cast-spell" && mana.tapPlan.length).toBe(1);
        });
    });

    it("no mana Move where the Forge does not cover the card", () => {
        withDefs(() => {
            expect(
                topMoves(board([FORGE.id, CITADEL.id], GRIZZLY_BEARS.id)).some(
                    (m) =>
                        m.kind === "cast-spell" &&
                        m.declineManaCostReplacement === true
                )
            ).toBe(false);
        });
    });

    it("an artifact with morph: the printed cast offers both choices, the morph cast never announces a decline", () => {
        withDefs(() => {
            const moves = topMoves(
                board([CITADEL.id, FORGE.id], ARTIFACT_MORPH.id)
            );
            const printed = moves.filter(
                (m) =>
                    m.kind === "cast-spell" && m.alternativeCostId === undefined
            );
            expect(
                new Set(
                    printed.map(
                        (m) =>
                            m.kind === "cast-spell" &&
                            m.declineManaCostReplacement === true
                    )
                )
            ).toEqual(new Set([false, true]));
            const morph = moves.filter(
                (m) =>
                    m.kind === "cast-spell" &&
                    m.alternativeCostId === MORPH_CAST_ALT_COST_ID
            );
            expect(morph.length).toBeGreaterThan(0);
            expect(
                morph.some(
                    (m) =>
                        m.kind === "cast-spell" &&
                        m.declineManaCostReplacement === true
                )
            ).toBe(false);
        });
    });

    it("a morph cast the Citadel refuses rides the Forge (CR 601.2b, CR 702.37c)", () => {
        withDefs(() => {
            const morph = topMoves(
                board([CITADEL.id, FORGE.id], EXALTED_ANGEL.id)
            ).filter(
                (m) =>
                    m.kind === "cast-spell" &&
                    m.alternativeCostId === MORPH_CAST_ALT_COST_ID
            );
            // The choice is forced (only the Forge can license a morph cast),
            // so no morph Move announces a decline — `announceCast` refuses
            // the flag where it chooses nothing.
            expect(morph.length).toBeGreaterThan(0);
            expect(
                morph.some(
                    (m) =>
                        m.kind === "cast-spell" &&
                        m.declineManaCostReplacement === true
                )
            ).toBe(false);
        });
    });
});
