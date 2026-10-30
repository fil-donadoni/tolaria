// CR 601.3 / 601.3e (issue #7205) — the Bot's reach under a FILTERED
// cast-from-top-of-library permission: `enumerateMoves` offers exactly the
// casts the grant covers, and nothing `announceCast` would then refuse (the
// #2283/#2284 bot-freeze shape). The legality gate, wire and mutation sides
// live in `libraryTopCastFilter.test.ts`.

import { describe, expect, it } from "vitest";
import { enumerateMoves } from "../moves";
import { splitCastAltCostId } from "../splitCast";
import type { GameState } from "../state";
import {
    BLUE_ARTIFACT,
    CITADEL,
    FORGE,
    GRIZZLY_BEARS,
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

            state.players[0].life = 2;
            expect(topCasts(state).map((c) => c.alt)).toEqual([LEFT]);
        });
    });
});
