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
import { withTemporaryDefinition } from "../../../cards/registry";
import type { CardDefinition } from "../../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../../cards/__tests__/setup";
import { evaluateBreakdown, permanentRealisedValue } from "../../evaluate";
import { DEFAULT_EVAL_WEIGHTS } from "../evalWeights";
import {
    openEndedSlotRequirement,
    representativeVictimLoss,
    targetSlotRequirements,
} from "../latentBoard";
import { shivanDragon, stoneRain } from "../../../cards/sets/lea/red";
import {
    armageddon,
    disenchant,
    swordsToPlowshares,
} from "../../../cards/sets/lea/white";
import {
    crawWurm,
    grizzlyBears,
    llanowarElves,
} from "../../../cards/sets/lea/green";
import { blackLotus, forest, plains } from "../../../cards/sets/lea/colorless";
import { flashfires } from "../../../cards/sets/lea/red";
import { pyroclasm } from "../../../cards/sets/ice/red";
import { hibernation } from "../../../cards/sets/usg/blue";
import { forceOfVigor } from "../../../cards/sets/mh1/green";

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

/** What ONE untapped basic land is worth on the board: the flat board-presence
 *  bonus plus one untapped mana source. Read off the committed vector, never
 *  spelled out — the weights are FITTED (issue #3401). */
const LAND_ON_BOARD =
    DEFAULT_EVAL_WEIGHTS.permanentWeight + DEFAULT_EVAL_WEIGHTS.manaWeight;

describe("the representative victim (issue #3398)", () => {
    it("is a vanilla 2/2 for two plus the flat board-presence weight", () => {
        // 168 (`creatureValueRaw(2, 2, 2)`, weight-free) plus the flat
        // `permanentWeight`. ONE unit of `boardRemoval` costs
        // `latent.boardRemoval`, the fitted successor of the deleted
        // `DESTROY_VALUE` (issue #3398, refitted by issue #3401).
        expect(representativeVictimLoss(DEFAULT_EVAL_WEIGHTS)).toBe(
            168 + DEFAULT_EVAL_WEIGHTS.permanentWeight
        );
    });

    it("flattens a card's target requirements into the slot list its script indexes", () => {
        // Stone Rain's `{ op: "destroy", target: { target: 0 } }` reads slot 0,
        // which must resolve to "target land" — not to nothing.
        const slots = targetSlotRequirements(stoneRain);
        expect(slots).toHaveLength(1);
        expect(slots[0].type).toBe("Land");
    });

    it("emits one slot per slot a BOUNDED range authorises", () => {
        // Force of Vigor: `count: { min: 0, max: 2 }`, and a script that names
        // BOTH `{ target: 0 }` and `{ target: 1 }`. Emitting a single slot for
        // the group left slot 1 off the end of the list, where the valuer read
        // it as one full representative victim.
        const slots = targetSlotRequirements(forceOfVigor);
        expect(slots).toHaveLength(2);
        expect(slots[1]).toBe(slots[0]);
        // Bounded on both ends, so nothing absorbs a HIGHER index: a script
        // naming slot 2 would be naming a requirement the card never declares.
        expect(openEndedSlotRequirement(forceOfVigor)).toBeUndefined();
    });

    it("leaves an OPEN-ENDED group to absorb every index past the authored list", () => {
        // `count: "X"` is resolved against `chosenX` at announcement (CR
        // 601.2c) and has no ceiling a pre-announcement valuation can read, so
        // the group itself answers for slot 1, 2, … rather than the lens
        // inventing a victim for them.
        const variable = {
            targetRequirement: {
                type: "Land" as const,
                count: "X" as const,
            },
        };
        expect(targetSlotRequirements(variable)).toHaveLength(1);
        expect(openEndedSlotRequirement(variable)).toBe(
            variable.targetRequirement
        );
    });
});

describe("permanentRealisedValue — what removing one permanent costs (issue #3398)", () => {
    it("prices an untapped basic land at the board-presence + mana weights", () => {
        const { state } = boardWith(stoneRain.id, [forest.id]);
        const land = state.players[1].battlefield[0];
        // `permanentWeight` + `manaWeight` — the quantity issue #3322 quotes
        // (at the pre-fit weights, 17) for what a Forest is worth on the
        // board.
        expect(permanentRealisedValue(state, land)).toBe(LAND_ON_BOARD);
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
        // `latent.boardRemoval` × (a Forest's board worth / the representative
        // victim's) — the weight times the best legal victim's realised board
        // loss in representative-victim units.
        const expected =
            DEFAULT_EVAL_WEIGHTS.latent.boardRemoval *
            (LAND_ON_BOARD / representativeVictimLoss(DEFAULT_EVAL_WEIGHTS));
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

    it("is ZERO on every slot of a bounded multi-target group with no legal victim", () => {
        // Force of Vigor's second `destroy` reads slot 1. Before the slot list
        // covered a bounded range, slot 1 fell through to the representative
        // victim and the card priced at 160 in hand against a board holding
        // nothing it could legally destroy — MORE than Stone Rain is worth
        // against three real Forests, with the `base + MV` floor lifted
        // underneath it because slot 0 had answered.
        expect(latentInHand(forceOfVigor.id, [shivanDragon.id])).toBe(0);
        // And with one legal victim it is priced by THAT victim, on both
        // slots, not by a phantom on the second.
        const oneArtifact = latentInHand(forceOfVigor.id, [blackLotus.id]);
        expect(oneArtifact).toBeGreaterThan(0);
        expect(oneArtifact).toBeLessThan(
            2 * DEFAULT_EVAL_WEIGHTS.latent.boardRemoval
        );
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

/** p1 holds `handCardId` and controls `ownBoard`; p2 controls `oppBoard`. */
function latentAgainst(
    handCardId: string,
    ownBoard: readonly string[],
    oppBoard: readonly string[]
): number {
    const on = (pid: string, ids: readonly string[]) =>
        ids.map((id) => makeInstance(id, { controllerId: pid, ownerId: pid }));
    const handCard = makeInstance(handCardId, {
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
    });
    const state = makeState({
        players: [
            makePlayer("p1", {
                hand: [handCard],
                battlefield: on("p1", ownBoard),
            }),
            makePlayer("p2", { battlefield: on("p2", oppBoard) }),
        ],
    });
    return evaluateBreakdown(state, "p1").self.hand;
}

describe("a sweep's latent value is the surplus it takes (issue #4773)", () => {
    // CR 701.8a — a symmetric destroy sweep moves the caster's own members to the
    // graveyard too. Priced at ONE representative victim whatever the board
    // held, Armageddon sat in hand above the land surplus it would take, and
    // casting it a land behind read as a loss at 1 ply.
    const units = (n: number) =>
        DEFAULT_EVAL_WEIGHTS.latent.boardRemoval *
        ((n * LAND_ON_BOARD) / representativeVictimLoss(DEFAULT_EVAL_WEIGHTS));

    it("is the opponent's land surplus, net of the caster's own lands", () => {
        expect(
            latentAgainst(
                armageddon.id,
                [forest.id],
                [forest.id, forest.id, forest.id]
            )
        ).toBeCloseTo(units(2), 6);
    });

    it("is ZERO on a symmetric board, and never negative when the caster is ahead", () => {
        expect(
            latentAgainst(
                armageddon.id,
                [forest.id, forest.id],
                [forest.id, forest.id]
            )
        ).toBe(0);
        expect(
            latentAgainst(
                armageddon.id,
                [forest.id, forest.id, forest.id],
                [forest.id]
            )
        ).toBe(0);
    });

    const sweep = (
        id: string,
        filter: Record<string, unknown>
    ): CardDefinition => ({
        id: `latent-board-test:${id}`,
        name: `Latent Board ${id}`,
        rarity: "common",
        manaCost: { W: 1, generic: 3 },
        types: ["Sorcery"],
        effects: [
            {
                op: "forEach",
                select: { set: "permanents", zone: "battlefield", filter },
                effects: [{ op: "destroy", target: { ref: "$each" } }],
            },
        ],
    });

    it("reads an excludeType filter: everything but lands, net", () => {
        const nonland = sweep("nonland", { excludeType: "Land" });
        withTemporaryDefinition(nonland, () => {
            expect(
                latentAgainst(nonland.id, [forest.id], [forest.id, forest.id])
            ).toBe(0);
            expect(
                latentAgainst(nonland.id, [], [llanowarElves.id])
            ).toBeGreaterThan(0);
        });
    });

    it("keeps the representative valuation for a filter it cannot match exactly", () => {
        // A mana-value bound is not read: counting every creature, or none,
        // would both be guesses. The board-free price stands on every board.
        const cheap = sweep("cheap", {
            type: "Creature",
            manaValueAtMost: 3,
        });
        withTemporaryDefinition(cheap, () => {
            const empty = latentAgainst(cheap.id, [], []);
            expect(empty).toBeGreaterThan(0);
            expect(
                latentAgainst(cheap.id, [grizzlyBears.id, grizzlyBears.id], [])
            ).toBe(empty);
        });
    });

    it("counts only the swept type", () => {
        // A land sweep takes nothing from an opponent whose surplus is a
        // creature: the Shivan Dragon is not a member.
        expect(
            latentAgainst(
                armageddon.id,
                [forest.id],
                [forest.id, shivanDragon.id]
            )
        ).toBe(0);
    });
});

describe("bounce, damage and filtered sweeps read the board (issue #4781)", () => {
    // Each family used to sit in hand at ONE representative victim whatever
    // the board held. Every assertion is the `hand` term the leaf reads.

    it("a bounce sweep is worth the opponent's surplus in what it returns", () => {
        // Hibernation: "Return all green permanents to their owners' hands."
        const ahead = latentAgainst(
            hibernation.id,
            [grizzlyBears.id],
            [grizzlyBears.id, grizzlyBears.id]
        );
        expect(ahead).toBeGreaterThan(0);
        // The surplus, not the gross count: one Bears net either way.
        expect(ahead).toBeCloseTo(
            latentAgainst(hibernation.id, [], [grizzlyBears.id]),
            6
        );
        expect(
            latentAgainst(hibernation.id, [grizzlyBears.id], [grizzlyBears.id])
        ).toBe(0);
        expect(
            latentAgainst(
                hibernation.id,
                [grizzlyBears.id, grizzlyBears.id],
                []
            )
        ).toBe(0);
    });

    it("a bounce sweep's colour filter is matched exactly", () => {
        // CR 105.2 — Shivan Dragon is red: Hibernation returns nothing.
        expect(latentAgainst(hibernation.id, [], [shivanDragon.id])).toBe(0);
    });

    it("a damage sweep is worth the opponent's surplus in what it kills", () => {
        // Pyroclasm: 2 damage to each creature. CR 704.5g — the 2/2 and the
        // 1/1 die, the 6/4 survives and is no loss to anyone.
        const kills = latentAgainst(
            pyroclasm.id,
            [],
            [grizzlyBears.id, llanowarElves.id]
        );
        expect(kills).toBeGreaterThan(0);
        expect(
            latentAgainst(
                pyroclasm.id,
                [],
                [grizzlyBears.id, llanowarElves.id, crawWurm.id]
            )
        ).toBeCloseTo(kills, 6);
        expect(latentAgainst(pyroclasm.id, [], [crawWurm.id])).toBe(0);
        expect(
            latentAgainst(pyroclasm.id, [grizzlyBears.id], [grizzlyBears.id])
        ).toBe(0);
        expect(
            latentAgainst(
                pyroclasm.id,
                [grizzlyBears.id, llanowarElves.id],
                [crawWurm.id]
            )
        ).toBe(0);
    });

    it("a damage sweep counts the damage already marked (CR 120.3e)", () => {
        const handCard = makeInstance(pyroclasm.id, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const wurm = (damageMarked: number) =>
            makeInstance(crawWurm.id, {
                controllerId: "p2",
                ownerId: "p2",
                damageMarked,
            });
        const worth = (damageMarked: number) =>
            evaluateBreakdown(
                makeState({
                    players: [
                        makePlayer("p1", { hand: [handCard] }),
                        makePlayer("p2", { battlefield: [wurm(damageMarked)] }),
                    ],
                }),
                "p1"
            ).self.hand;
        expect(worth(1)).toBe(0);
        expect(worth(2)).toBeGreaterThan(0);
    });

    it("a subtype-filtered destroy sweep reads the board (CR 205.3)", () => {
        // Flashfires: "Destroy all Plains."
        expect(
            latentAgainst(flashfires.id, [plains.id], [plains.id, plains.id])
        ).toBeGreaterThan(0);
        expect(latentAgainst(flashfires.id, [], [forest.id, forest.id])).toBe(
            0
        );
        expect(latentAgainst(flashfires.id, [plains.id], [plains.id])).toBe(0);
    });
});
