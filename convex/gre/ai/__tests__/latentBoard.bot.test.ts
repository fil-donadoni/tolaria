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
} from "../../../cards/__tests__/setup.helper";
import { evaluateBreakdown, permanentRealisedValue } from "../../evaluate";
import { DEFAULT_EVAL_WEIGHTS, type EvalWeights } from "../evalWeights";
import {
    openEndedSlotRequirement,
    representativeVictimLoss,
    targetSlotRequirements,
} from "../latentBoard";
import { shivanDragon, stoneRain } from "../../../cards/sets/lea/red.cards";
import {
    armageddon,
    disenchant,
    swordsToPlowshares,
} from "../../../cards/sets/lea/white.cards";
import {
    crawWurm,
    grizzlyBears,
    llanowarElves,
} from "../../../cards/sets/lea/green.cards";
import {
    blackLotus,
    forest,
    plains,
    solRing,
} from "../../../cards/sets/lea/colorless.cards";
import { fellwarStone } from "../../../cards/sets/drk/colorless.cards";
import { mindStone } from "../../../cards/sets/wth/colorless.cards";
import { flashfires } from "../../../cards/sets/lea/red.cards";
import { pyroclasm } from "../../../cards/sets/ice/red.cards";
import { hibernation } from "../../../cards/sets/usg/blue.cards";
import { forceOfVigor } from "../../../cards/sets/mh1/green.cards";

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
        const slots = targetSlotRequirements(stoneRain());
        expect(slots).toHaveLength(1);
        expect(slots[0].type).toBe("Land");
    });

    it("emits one slot per slot a BOUNDED range authorises", () => {
        // Force of Vigor: `count: { min: 0, max: 2 }`, and a script that names
        // BOTH `{ target: 0 }` and `{ target: 1 }`. Emitting a single slot for
        // the group left slot 1 off the end of the list, where the valuer read
        // it as one full representative victim.
        const slots = targetSlotRequirements(forceOfVigor());
        expect(slots).toHaveLength(2);
        expect(slots[1]).toBe(slots[0]);
        // Bounded on both ends, so nothing absorbs a HIGHER index: a script
        // naming slot 2 would be naming a requirement the card never declares.
        expect(openEndedSlotRequirement(forceOfVigor())).toBeUndefined();
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
        const { state } = boardWith(stoneRain().id, [forest().id]);
        const land = state.players[1].battlefield[0];
        // `permanentWeight` + `manaWeight` — the quantity issue #3322 quotes
        // (at the pre-fit weights, 17) for what a Forest is worth on the
        // board.
        expect(permanentRealisedValue(state, land)).toBe(LAND_ON_BOARD);
    });

    it("prices a big creature far above a small one", () => {
        const { state } = boardWith(swordsToPlowshares().id, [
            shivanDragon().id,
            llanowarElves().id,
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
        expect(latentInHand(stoneRain().id, [])).toBe(0);
    });

    it("is the fitted weight times a LAND's realised loss against three Forests", () => {
        const forests = [forest().id, forest().id, forest().id];
        // `latent.boardRemoval` × (a Forest's board worth / the representative
        // victim's) — the weight times the best legal victim's realised board
        // loss in representative-victim units.
        const expected =
            DEFAULT_EVAL_WEIGHTS.latent.boardRemoval *
            (LAND_ON_BOARD / representativeVictimLoss(DEFAULT_EVAL_WEIGHTS));
        expect(latentInHand(stoneRain().id, forests)).toBeCloseTo(expected, 6);
    });

    it("prices Stone Rain BELOW the land it destroys, so announcing it is not a loss", () => {
        // The whole symptom of issue #3322: the spell leaving the hand must
        // cost less than the board loss it inflicts, or the search passes.
        const value = latentInHand(stoneRain().id, [forest().id]);
        expect(value).toBeLessThan(LAND_ON_BOARD);
    });

    it("values Swords to Plowshares against Shivan Dragon above Llanowar Elves", () => {
        expect(
            latentInHand(swordsToPlowshares().id, [shivanDragon().id])
        ).toBeGreaterThan(
            latentInHand(swordsToPlowshares().id, [llanowarElves().id])
        );
    });

    it("values Disenchant by the enchantment it can hit, not by a creature it cannot", () => {
        // A fat creature is NOT a legal Disenchant target: the lens must read
        // the requirement, not the board's biggest permanent. Black Lotus (an
        // Artifact) is legal; Shivan Dragon is not.
        const againstArtifact = latentInHand(disenchant().id, [
            blackLotus().id,
            shivanDragon().id,
        ]);
        const againstNothingLegal = latentInHand(disenchant().id, [
            shivanDragon().id,
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
        expect(latentInHand(forceOfVigor().id, [shivanDragon().id])).toBe(0);
        // And with one legal victim it is priced by THAT victim, on both
        // slots, not by a phantom on the second.
        const oneArtifact = latentInHand(forceOfVigor().id, [blackLotus().id]);
        expect(oneArtifact).toBeGreaterThan(0);
        expect(oneArtifact).toBeLessThan(
            2 * DEFAULT_EVAL_WEIGHTS.latent.boardRemoval
        );
    });

    it("never counts the CASTER's own permanents as victims", () => {
        // p1 holds Stone Rain and controls the only land in play. Destroying
        // your own land is a cost the search finds on its own — never latent
        // worth held in hand.
        const handCard = makeInstance(stoneRain().id, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [handCard],
                    battlefield: [
                        makeInstance(forest().id, {
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

/** The committed vector with the two axes issue #4874 and issue #4880 added
 *  to a sweep's price switched off: the per-player aggregate terms its
 *  members move (`manaDevelopment`, `colorCoverage`) and the discount on its
 *  recoverable members. What is left is the MEMBER surplus issue #4773 and
 *  issue #4781 price, which the blocks below pin; each added axis has its own
 *  block further down. */
const MEMBERS_ONLY: EvalWeights = {
    ...DEFAULT_EVAL_WEIGHTS,
    manaDevWeight: 0,
    colorCoverageWeight: 0,
    recoverableSweepFraction: 1,
};

/** p1 holds `handCardId` and controls `ownBoard`; p2 controls `oppBoard`. */
function latentAgainst(
    handCardId: string,
    ownBoard: readonly string[],
    oppBoard: readonly string[],
    weights: EvalWeights = MEMBERS_ONLY
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
    return evaluateBreakdown(state, "p1", weights).self.hand;
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
                armageddon().id,
                [forest().id],
                [forest().id, forest().id, forest().id]
            )
        ).toBeCloseTo(units(2), 6);
    });

    it("is ZERO on a symmetric board, and never negative when the caster is ahead", () => {
        expect(
            latentAgainst(
                armageddon().id,
                [forest().id, forest().id],
                [forest().id, forest().id]
            )
        ).toBe(0);
        expect(
            latentAgainst(
                armageddon().id,
                [forest().id, forest().id, forest().id],
                [forest().id]
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
                latentAgainst(
                    nonland.id,
                    [forest().id],
                    [forest().id, forest().id]
                )
            ).toBe(0);
            expect(
                latentAgainst(nonland.id, [], [llanowarElves().id])
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
                latentAgainst(
                    cheap.id,
                    [grizzlyBears().id, grizzlyBears().id],
                    []
                )
            ).toBe(empty);
        });
    });

    it("counts only the swept type", () => {
        // A land sweep takes nothing from an opponent whose surplus is a
        // creature: the Shivan Dragon is not a member.
        expect(
            latentAgainst(
                armageddon().id,
                [forest().id],
                [forest().id, shivanDragon().id]
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
            hibernation().id,
            [grizzlyBears().id],
            [grizzlyBears().id, grizzlyBears().id]
        );
        expect(ahead).toBeGreaterThan(0);
        // The surplus, not the gross count: one Bears net either way.
        expect(ahead).toBeCloseTo(
            latentAgainst(hibernation().id, [], [grizzlyBears().id]),
            6
        );
        expect(
            latentAgainst(
                hibernation().id,
                [grizzlyBears().id],
                [grizzlyBears().id]
            )
        ).toBe(0);
        expect(
            latentAgainst(
                hibernation().id,
                [grizzlyBears().id, grizzlyBears().id],
                []
            )
        ).toBe(0);
    });

    it("a bounced card comes back without its counters (CR 400.7)", () => {
        // What the bounce takes is the permanent's realised loss minus the
        // card's worth back in hand — and the card in hand is a new object,
        // so the counters stay behind: they are all taken.
        const handCard = makeInstance(hibernation().id, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const bears = (counters?: Record<string, number>) =>
            makeInstance(grizzlyBears().id, {
                controllerId: "p2",
                ownerId: "p2",
                ...(counters ? { counters } : {}),
            });
        const at = (victim: ReturnType<typeof bears>) => {
            const state = makeState({
                players: [
                    makePlayer("p1", { hand: [handCard] }),
                    makePlayer("p2", { battlefield: [victim] }),
                ],
            });
            return {
                latent: evaluateBreakdown(state, "p1", MEMBERS_ONLY).self.hand,
                realised: permanentRealisedValue(state, victim),
            };
        };
        const vanilla = at(bears());
        const grown = at(bears({ "+1/+1": 2 }));
        expect(grown.latent - vanilla.latent).toBeCloseTo(
            (DEFAULT_EVAL_WEIGHTS.latent.boardRemoval *
                (grown.realised - vanilla.realised)) /
                representativeVictimLoss(DEFAULT_EVAL_WEIGHTS),
            6
        );
    });

    it("a bounced card goes to its OWNER's hand, not its controller's (CR 400.3)", () => {
        // p1 controls one of p2's Bears: bouncing it takes the body from p1
        // AND hands the card to p2, so it outweighs the surplus of three.
        const handCard = makeInstance(hibernation().id, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const opp = () =>
            makeInstance(grizzlyBears().id, {
                controllerId: "p2",
                ownerId: "p2",
            });
        const worth = (ownerOfMine: "p1" | "p2") =>
            evaluateBreakdown(
                makeState({
                    players: [
                        makePlayer("p1", {
                            hand: [handCard],
                            battlefield: [
                                makeInstance(grizzlyBears().id, {
                                    controllerId: "p1",
                                    ownerId: ownerOfMine,
                                }),
                            ],
                        }),
                        makePlayer("p2", {
                            battlefield: [opp(), opp(), opp()],
                        }),
                    ],
                }),
                "p1"
            ).self.hand;
        expect(worth("p1")).toBeGreaterThan(0);
        expect(worth("p2")).toBe(0);
    });

    it("a bounce sweep's colour filter is matched exactly", () => {
        // CR 105.2 — Shivan Dragon is red: Hibernation returns nothing.
        expect(latentAgainst(hibernation().id, [], [shivanDragon().id])).toBe(
            0
        );
    });

    it("a damage sweep is worth the opponent's surplus in what it kills", () => {
        // Pyroclasm: 2 damage to each creature. CR 704.5g — the 2/2 and the
        // 1/1 die, the 6/4 survives and is no loss to anyone.
        const kills = latentAgainst(
            pyroclasm().id,
            [],
            [grizzlyBears().id, llanowarElves().id]
        );
        expect(kills).toBeGreaterThan(0);
        expect(
            latentAgainst(
                pyroclasm().id,
                [],
                [grizzlyBears().id, llanowarElves().id, crawWurm().id]
            )
        ).toBeCloseTo(kills, 6);
        expect(latentAgainst(pyroclasm().id, [], [crawWurm().id])).toBe(0);
        expect(
            latentAgainst(
                pyroclasm().id,
                [grizzlyBears().id],
                [grizzlyBears().id]
            )
        ).toBe(0);
        expect(
            latentAgainst(
                pyroclasm().id,
                [grizzlyBears().id, llanowarElves().id],
                [crawWurm().id]
            )
        ).toBe(0);
    });

    it("a damage sweep counts the damage already marked (CR 120.3e)", () => {
        const handCard = makeInstance(pyroclasm().id, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const wurm = (damageMarked: number) =>
            makeInstance(crawWurm().id, {
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
            latentAgainst(
                flashfires().id,
                [plains().id],
                [plains().id, plains().id]
            )
        ).toBeGreaterThan(0);
        expect(
            latentAgainst(flashfires().id, [], [forest().id, forest().id])
        ).toBe(0);
        expect(
            latentAgainst(flashfires().id, [plains().id], [plains().id])
        ).toBe(0);
    });
});

/** The `hand` term per unit of a sweep's net realised loss: what
 *  `sweepUnits` scales `boardRemoval` by. */
const PER_POINT =
    DEFAULT_EVAL_WEIGHTS.latent.boardRemoval /
    representativeVictimLoss(DEFAULT_EVAL_WEIGHTS);

describe("a sweep's price counts the aggregate terms its members move (issue #4874)", () => {
    // Summed per permanent alone, Armageddon over a board of mana rocks priced
    // above what its resolution realised: the caster's `manaDevelopment`
    // falls to zero with its lands and nothing in the price said so.
    const own = [
        plains().id,
        plains().id,
        solRing().id,
        mindStone().id,
        fellwarStone().id,
    ];
    const opp = [
        forest().id,
        forest().id,
        forest().id,
        forest().id,
        forest().id,
        forest().id,
    ];
    const noDiscount = { ...DEFAULT_EVAL_WEIGHTS, recoverableSweepFraction: 1 };

    /** Both players' `manaDevelopment + colorCoverage` from p1's side, with
     *  Armageddon in p1's hand, on the given boards. */
    function aggregates(
        ownBoard: readonly string[],
        oppBoard: readonly string[]
    ) {
        const on = (pid: string, ids: readonly string[]) =>
            ids.map((id) =>
                makeInstance(id, { controllerId: pid, ownerId: pid })
            );
        const b = evaluateBreakdown(
            makeState({
                players: [
                    makePlayer("p1", {
                        hand: [
                            makeInstance(armageddon().id, {
                                controllerId: "p1",
                                ownerId: "p1",
                                zone: "hand",
                            }),
                        ],
                        battlefield: on("p1", ownBoard),
                    }),
                    makePlayer("p2", { battlefield: on("p2", oppBoard) }),
                ],
            }),
            "p1",
            noDiscount
        );
        return {
            self: b.self.manaDevelopment + b.self.colorCoverage,
            opp: b.opp.manaDevelopment + b.opp.colorCoverage,
        };
    }

    it("adds what the resolution moves in them, read on the board it leaves", () => {
        const before = aggregates(own, opp);
        // CR 701.8a — every land goes; the rocks and the card in hand stay.
        const after = aggregates(
            [solRing().id, mindStone().id, fellwarStone().id],
            []
        );
        const moved = before.opp - after.opp - (before.self - after.self);
        expect(before.self - after.self).toBeGreaterThan(0);
        expect(
            latentAgainst(armageddon().id, own, opp, noDiscount) -
                latentAgainst(armageddon().id, own, opp, {
                    ...noDiscount,
                    manaDevWeight: 0,
                    colorCoverageWeight: 0,
                })
        ).toBeCloseTo(PER_POINT * moved, 6);
    });

    it("never prices the relief of unloading a card no cast can unload", () => {
        // Armageddon over a Forest is uncastable (CR 202.1a): its {W} pip
        // costs the hand `colorCoverage` whatever the sweep takes. Taking the
        // card out of the hand in the "after" board read that cost back as
        // the sweep's worth, so a sweep whose only member is the caster's own
        // Forest was worth more than the land it loses.
        expect(
            latentAgainst(armageddon().id, [forest().id], [], noDiscount)
        ).toBe(0);
    });
});

describe("a recoverable sweep's swing is credited in part (issue #4880)", () => {
    // A land is replaced by its owner's next land drop (CR 305.2) and a card
    // bounced to hand is recast, so the swing such a sweep realises decays
    // from the turn it resolves, while its price in hand is read off each
    // leaf's board. `recoverableSweepFraction` of the recoverable part is what
    // the hand is credited; what is gone for good is credited in full.
    const at = (fraction: number) => ({
        ...MEMBERS_ONLY,
        recoverableSweepFraction: fraction,
    });

    it("scales a land sweep's surplus by the fraction", () => {
        const full = latentAgainst(
            armageddon().id,
            [forest().id],
            [forest().id, forest().id, forest().id],
            at(1)
        );
        expect(full).toBeGreaterThan(0);
        expect(
            latentAgainst(
                armageddon().id,
                [forest().id],
                [forest().id, forest().id, forest().id],
                at(0.5)
            )
        ).toBeCloseTo(0.5 * full, 6);
    });

    it("scales the aggregate terms the lands move with them", () => {
        // Committed weights, aggregates on: an all-land sweep is recoverable
        // whole, so its WHOLE price scales.
        const own = [
            plains().id,
            plains().id,
            solRing().id,
            mindStone().id,
            fellwarStone().id,
        ];
        const opp = [
            forest().id,
            forest().id,
            forest().id,
            forest().id,
            forest().id,
            forest().id,
        ];
        const withAggregates = (fraction: number) =>
            latentAgainst(armageddon().id, own, opp, {
                ...DEFAULT_EVAL_WEIGHTS,
                recoverableSweepFraction: fraction,
            });
        expect(withAggregates(1)).toBeGreaterThan(0);
        expect(withAggregates(0.25)).toBeCloseTo(0.25 * withAggregates(1), 6);
    });

    it("scales a bounce, but not a bounced token (CR 111.7)", () => {
        const bounced = latentAgainst(
            hibernation().id,
            [],
            [grizzlyBears().id],
            at(1)
        );
        expect(
            latentAgainst(hibernation().id, [], [grizzlyBears().id], at(0.5))
        ).toBeCloseTo(0.5 * bounced, 6);
        const handCard = makeInstance(hibernation().id, {
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const token = makeInstance(grizzlyBears().id, {
            controllerId: "p2",
            ownerId: "p2",
            isToken: true,
        });
        const worth = (fraction: number) =>
            evaluateBreakdown(
                makeState({
                    players: [
                        makePlayer("p1", { hand: [handCard] }),
                        makePlayer("p2", { battlefield: [token] }),
                    ],
                }),
                "p1",
                at(fraction)
            ).self.hand;
        expect(worth(1)).toBeGreaterThan(0);
        expect(worth(0.5)).toBe(worth(1));
    });

    it("leaves a sweep of what is gone for good unchanged", () => {
        // Pyroclasm's dead creatures and a creature wrath do not regrow.
        for (const fraction of [1, 0.5, 0]) {
            expect(
                latentAgainst(
                    pyroclasm().id,
                    [],
                    [grizzlyBears().id, llanowarElves().id],
                    at(fraction)
                )
            ).toBeCloseTo(
                latentAgainst(
                    pyroclasm().id,
                    [],
                    [grizzlyBears().id, llanowarElves().id],
                    at(1)
                ),
                6
            );
        }
    });

    it("discounts only the land half of a sweep that takes both", () => {
        const everything: CardDefinition = {
            id: "latent-board-test:everything",
            name: "Latent Board everything",
            rarity: "common",
            manaCost: { R: 1, generic: 3 },
            types: ["Sorcery"],
            effects: [
                {
                    op: "forEach",
                    select: { set: "permanents", zone: "battlefield" },
                    effects: [{ op: "destroy", target: { ref: "$each" } }],
                },
            ],
        };
        withTemporaryDefinition(everything, () => {
            const board = (f: number, opp: readonly string[]) =>
                latentAgainst(everything.id, [], opp, at(f));
            const creature = board(1, [grizzlyBears().id]);
            const land = board(1, [forest().id]);
            expect(board(0.5, [grizzlyBears().id, forest().id])).toBeCloseTo(
                creature + 0.5 * land,
                6
            );
        });
    });

    it("splits the aggregate terms: the fixed members' in full, the rest discounted", () => {
        // Committed weights, aggregates on. The opponent's Llanowar Elves
        // is its curve demand (`manaDevelopment` = min(lands, curveTop)):
        // destroyed, it takes that demand for good; its Forest regrows. The
        // price at fraction 0 is exactly what the Elves take — its body AND
        // the aggregate it moves alone — so the aggregate is split, not
        // wholly discounted.
        const everything: CardDefinition = {
            id: "latent-board-test:everything-aggregate",
            name: "Latent Board everything aggregate",
            rarity: "common",
            manaCost: { R: 1, generic: 3 },
            types: ["Sorcery"],
            effects: [
                {
                    op: "forEach",
                    select: { set: "permanents", zone: "battlefield" },
                    effects: [{ op: "destroy", target: { ref: "$each" } }],
                },
            ],
        };
        const withAggregates = (fraction: number) => ({
            ...DEFAULT_EVAL_WEIGHTS,
            recoverableSweepFraction: fraction,
        });
        const oppAggregate = (oppBoard: readonly string[]) =>
            evaluateBreakdown(
                makeState({
                    players: [
                        makePlayer("p1"),
                        makePlayer("p2", {
                            battlefield: oppBoard.map((id) =>
                                makeInstance(id, {
                                    controllerId: "p2",
                                    ownerId: "p2",
                                })
                            ),
                        }),
                    ],
                }),
                "p1",
                withAggregates(1)
            ).opp;
        withTemporaryDefinition(everything, () => {
            const before = oppAggregate([llanowarElves().id, forest().id]);
            const elvesGone = oppAggregate([forest().id]);
            const elvesAggregate =
                before.manaDevelopment +
                before.colorCoverage -
                (elvesGone.manaDevelopment + elvesGone.colorCoverage);
            expect(elvesAggregate).toBeGreaterThan(0);
            const elvesBody = latentAgainst(
                everything.id,
                [],
                [llanowarElves().id],
                at(1)
            );
            expect(
                latentAgainst(
                    everything.id,
                    [],
                    [llanowarElves().id, forest().id],
                    withAggregates(0)
                )
            ).toBeCloseTo(elvesBody + PER_POINT * elvesAggregate, 6);
        });
    });
});
