// Board-aware latent script value (issue #3398, PRD #3397).
//
// The defect: `DESTROY_VALUE = 160` priced a removal spell in hand at a 2/2's
// worth whatever the board held, so announcing Stone Rain against three
// Forests cost 205 margin points (160 leaves the hand, the 17-point land comes
// back) and the Bot never cast it (issue #3322,
// `docs/research/greedy-vs-search.md`).
//
// Every assertion runs through the REAL card-value path — `evaluateBreakdown`'s
// `hand` term over a real registry definition and a real board, i.e. exactly
// what the search's leaf reads. A test that valued a synthetic `OpValue` would
// pass on a lens nothing wires up.
import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../../cards/__tests__/setup";
import { evaluateBreakdown, permanentRealisedValue } from "../../evaluate";
import { DEFAULT_EVAL_WEIGHTS } from "../evalWeights";
import {
    representativeVictimLoss,
    targetSlotRequirements,
} from "../latentBoard";
import { shivanDragon, stoneRain } from "../../../cards/sets/lea/red";
import { disenchant, swordsToPlowshares } from "../../../cards/sets/lea/white";
import { llanowarElves } from "../../../cards/sets/lea/green";
import { blackLotus, forest } from "../../../cards/sets/lea/colorless";

/** A two-player state where `p1` holds exactly `handCardId` and `p2`'s
 *  battlefield is `oppBoard` (card ids). Everything else is the shared
 *  fixture default. */
function boardWith(handCardId: string, oppBoard: readonly string[]) {
    const handCard = makeInstance(handCardId, {
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
    });
    const state = makeState({
        players: [
            makePlayer("p1", { hand: [handCard] }),
            makePlayer("p2", {
                battlefield: oppBoard.map((id) =>
                    makeInstance(id, { controllerId: "p2", ownerId: "p2" })
                ),
            }),
        ],
    });
    return { state, handCard };
}

/** The latent worth of the ONE card in p1's hand, against `oppBoard` — read
 *  off `evaluate`'s own `hand` term, the production path. */
function latentInHand(handCardId: string, oppBoard: readonly string[]): number {
    const { state } = boardWith(handCardId, oppBoard);
    return evaluateBreakdown(state, "p1").self.hand;
}

describe("the representative victim (issue #3398)", () => {
    it("is a vanilla 2/2 for two plus the flat board-presence weight", () => {
        // 168 (`creatureValueRaw(2, 2, 2)`) + 5 (`permanentWeight`). ONE unit
        // of `boardRemoval` costs `latent.boardRemoval` = 160, which IS the
        // deleted `DESTROY_VALUE`: a re-parameterisation, not a re-tuning.
        expect(representativeVictimLoss(DEFAULT_EVAL_WEIGHTS)).toBe(173);
    });

    it("flattens a card's target requirements into the slot list its script indexes", () => {
        // Stone Rain's `{ op: "destroy", target: { target: 0 } }` reads slot 0,
        // which must resolve to "target land" — not to nothing.
        const slots = targetSlotRequirements(stoneRain);
        expect(slots).toHaveLength(1);
        expect(slots[0].type).toBe("Land");
    });
});

describe("permanentRealisedValue — what removing one permanent costs (issue #3398)", () => {
    it("prices an untapped basic land at the board-presence + mana weights", () => {
        const { state } = boardWith(stoneRain.id, [forest.id]);
        const land = state.players[1].battlefield[0];
        // 5 (`permanentWeight`) + 12 (`manaWeight`) = 17 — the exact figure
        // issue #3322 quotes for what a Forest is worth on the board.
        expect(permanentRealisedValue(state, land)).toBe(17);
    });

    it("prices a big creature far above a small one", () => {
        const { state } = boardWith(swordsToPlowshares.id, [
            shivanDragon.id,
            llanowarElves.id,
        ]);
        const [dragon, elves] = state.players[1].battlefield;
        expect(permanentRealisedValue(state, dragon)).toBeGreaterThan(
            permanentRealisedValue(state, elves)
        );
    });
});

describe("latent removal value follows the board (issue #3398)", () => {
    it("is ZERO for Stone Rain against an empty opposing board", () => {
        // Nothing legal to destroy ⇒ no units ⇒ no latent worth. Under the
        // fixed `DESTROY_VALUE` this read 160, and the `base + MV` floor kept
        // it at 38 even once the script valued at nothing.
        expect(latentInHand(stoneRain.id, [])).toBe(0);
    });

    it("is the fitted weight times a LAND's realised loss against three Forests", () => {
        const forests = [forest.id, forest.id, forest.id];
        // 160 × (17 / 173) — the weight times the best legal victim's realised
        // board loss in representative-victim units.
        const expected =
            DEFAULT_EVAL_WEIGHTS.latent.boardRemoval *
            (17 / representativeVictimLoss(DEFAULT_EVAL_WEIGHTS));
        expect(latentInHand(stoneRain.id, forests)).toBeCloseTo(expected, 6);
    });

    it("prices Stone Rain BELOW the land it destroys, so announcing it is not a loss", () => {
        // The whole symptom of issue #3322: the spell leaving the hand must
        // cost less than the board loss it inflicts, or the search passes.
        const value = latentInHand(stoneRain.id, [forest.id]);
        expect(value).toBeLessThan(17);
    });

    it("values Swords to Plowshares against Shivan Dragon above Llanowar Elves", () => {
        expect(
            latentInHand(swordsToPlowshares.id, [shivanDragon.id])
        ).toBeGreaterThan(
            latentInHand(swordsToPlowshares.id, [llanowarElves.id])
        );
    });

    it("values Disenchant by the enchantment it can hit, not by a creature it cannot", () => {
        // A fat creature is NOT a legal Disenchant target: the lens must read
        // the requirement, not the board's biggest permanent. Black Lotus (an
        // Artifact) is legal; Shivan Dragon is not.
        const againstArtifact = latentInHand(disenchant.id, [
            blackLotus.id,
            shivanDragon.id,
        ]);
        const againstNothingLegal = latentInHand(disenchant.id, [
            shivanDragon.id,
        ]);
        expect(againstNothingLegal).toBe(0);
        expect(againstArtifact).toBeGreaterThan(0);
    });

    it("never counts the CASTER's own permanents as victims", () => {
        // p1 holds Stone Rain and controls the only land in play. Destroying
        // your own land is a cost the search finds on its own — never latent
        // worth held in hand.
        const handCard = makeInstance(stoneRain.id, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [handCard],
                    battlefield: [
                        makeInstance(forest.id, {
                            controllerId: "p1",
                            ownerId: "p1",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        expect(evaluateBreakdown(state, "p1").self.hand).toBe(0);
    });
});
