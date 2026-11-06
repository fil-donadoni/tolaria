// CR 702.33 / 702.27a (issue #2081) — the Bot's move enumerator never paid
// an additional cost, so every kicker/buyback card was played naked. Three
// seams had to move together (a cast is reimplemented three times over):
//
//   ENUMERATION — `enumerateCastMoves` (`moves.ts`) offers one Move per
//     BOUNDED Kicker/Buyback payment variant (`enumerateKickerVariants`,
//     `gre/kicker.ts` — see its doc for the bound rationale, AC #1).
//   EXECUTION — TWO independent search sandboxes reimplement "cast a spell"
//     and both had to learn to charge the payment: `applyMoveForSearch`
//     (`applyMove.ts`, the greedy 1-ply leaf) and `applyMoveInSearch`
//     (`search.ts`, every ISMCTS rollout — the path that actually decides).
//   FORWARDING — `executor.ts` had to learn to name `kickerPayments`/`buyback`
//     to the real `announceCast` mutation, or the server is never told
//     anything was kicked however correctly the first two seams priced it.
//
// Every `describe` below is one seam or one acceptance criterion from issue
// #2081; see each block's header comment for which.
import { describe, expect, it } from "vitest";
import { getCardByName, preloadDefinitions } from "../../cards";
import type { CardDefinition } from "../../cards/types";
import { enumerateMoves, type Move } from "../moves";
import { applyMoveForSearch } from "../applyMove";
import { applyMoveInSearch, searchWithTrace } from "../search";
import {
    buildCastPermanentCostChoice,
    enumerateKickerVariants,
    resolveCastPermanentSelection,
} from "../kicker";
import { buildCastCostSelection } from "../castCostPicks";
import { completeSacrificeSelection } from "../paymentPicks";
import { resolveAdditionalCosts } from "../additionalCost";
import { getPlayer, type GameState } from "../state";
import { describeMove } from "../describeMove";
import { assertKickerAnnouncementLegal } from "../../game";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";

const BOT = "p1";
const OPP = "p2";

const BURST_LIGHTNING = getCardByName("Burst Lightning").id;
const MAGMA_BURST = getCardByName("Magma Burst").id;
const PHYREXIAN_SCUTA = getCardByName("Phyrexian Scuta").id;
const CORPSE_DANCE = getCardByName("Corpse Dance").id;
const EVERFLOWING_CHALICE = getCardByName("Everflowing Chalice").id;
const HILL_GIANT = getCardByName("Hill Giant").id;
const GRIZZLY_BEARS = getCardByName("Grizzly Bears").id;
const MOUNTAIN = getCardByName("Mountain").id;
const SWAMP = getCardByName("Swamp").id;
const FOREST = getCardByName("Forest").id;
const DROUGHT = getCardByName("Drought").id;
const BOG_DOWN = getCardByName("Bog Down").id;
const SOL_RING = getCardByName("Sol Ring").id;

// Synthetic fixture — no shipped card pairs a permanent-leg Kicker with a
// CASTER-CHOSEN `oneOf` additional-cost leg that ITSELF carries a
// `sacrificeFilter`, and `resolveAdditionalCosts` flattens such a leg onto the
// spec like the base field. Shape: "As an additional cost to cast this spell,
// sacrifice a land or pay 3 life. Kicker—Sacrifice a Forest." — the Bitter
// Triumph disjunction (`lci/black.cards.ts`) with a sacrifice leg standing in for
// its discard leg, plus a Magma Burst-shaped (`pls/red.cards.ts`) permanent Kicker
// leg.
const SYNTHETIC_KICKER_ONEOF_ID = "00000000-0000-4000-8000-00002081f001";
const SYNTHETIC_KICKER_ONEOF: CardDefinition = {
    id: SYNTHETIC_KICKER_ONEOF_ID,
    rarity: "common",
    name: "Synthetic Kicker/OneOf Collision Test",
    oracleText:
        "As an additional cost to cast this spell, sacrifice a land or pay 3 life.\nKicker—Sacrifice a Forest.\nThis spell deals 1 damage to any target.",
    manaCost: { R: 1 },
    types: ["Instant"],
    additionalCosts: {
        oneOf: [
            {
                id: "sac-land",
                label: "Sacrifice a land",
                sacrificeFilter: { types: "Land" },
            },
            { id: "pay-3-life", label: "Pay 3 life", payLife: 3 },
        ],
    },
    kickers: [
        {
            id: "kicker",
            description: "Kicker—Sacrifice a Forest",
            permanent: {
                action: "sacrifice",
                filter: { types: "Land", subtypes: "Forest" },
                count: 1,
            },
        },
    ],
    targetRequirement: { type: "any", count: 1 },
    effects: [{ op: "dealDamage", amount: 1, to: { target: 0 } }],
};
preloadDefinitions([SYNTHETIC_KICKER_ONEOF]);

function bf(cardId: string, id: string, owner: string, extra = {}) {
    return makeInstance(cardId, {
        id,
        controllerId: owner,
        ownerId: owner,
        zone: "battlefield",
        ...extra,
    });
}

function lands(cardId: string, n: number, prefix: string, owner = BOT) {
    return Array.from({ length: n }, (_, i) =>
        bf(cardId, `${prefix}${i}`, owner)
    );
}

function castMoves(state: GameState, cardInstanceId: string): Move[] {
    return enumerateMoves(state, BOT).filter(
        (m) => m.kind === "cast-spell" && m.cardInstanceId === cardInstanceId
    );
}

describe("ENUMERATION — Burst Lightning (mana-only single Kicker)", () => {
    function board() {
        return makeState({
            players: [
                makePlayer(BOT, {
                    hand: [
                        makeInstance(BURST_LIGHTNING, {
                            id: "bl",
                            zone: "hand",
                            controllerId: BOT,
                            ownerId: BOT,
                        }),
                    ],
                    battlefield: lands(MOUNTAIN, 5, "mtn"),
                }),
                makePlayer(OPP, {
                    battlefield: [bf(HILL_GIANT, "giant", OPP)],
                }),
            ],
            activePlayerId: BOT,
            priorityPlayerId: BOT,
        });
    }

    it("enumerates exactly TWO payment variants — unkicked and kicked — never a per-mana-unit sweep", () => {
        // Burst Lightning targets "any" (creature/planeswalker/battle/player),
        // so THIS board's target axis alone contributes 3 legal targets
        // (Hill Giant, both players) — the assertion here is scoped to the
        // KICKER axis, not the total move count, which the target/mode/leg
        // axes also contribute to independently.
        const moves = castMoves(board(), "bl");
        const kicked = moves.map((m) =>
            m.kind === "cast-spell" ? (m.kickerPayments ?? null) : undefined
        );
        expect(new Set(kicked.map((k) => JSON.stringify(k)))).toEqual(
            new Set(["null", '{"kicker":1}'])
        );
    });

    it("the KICKED variant's tapPlan covers the full {4}{R}, the unkicked one only {R}", () => {
        const moves = castMoves(board(), "bl");
        const unkicked = moves.find(
            (m) => m.kind === "cast-spell" && !m.kickerPayments
        );
        const kicked = moves.find(
            (m) => m.kind === "cast-spell" && m.kickerPayments
        );
        expect(
            unkicked?.kind === "cast-spell" && unkicked.tapPlan
        ).toHaveLength(1);
        expect(kicked?.kind === "cast-spell" && kicked.tapPlan).toHaveLength(5);
    });

    it("offers NO kicked variant when the extra {4} isn't affordable", () => {
        const state = board();
        // Only 1 Mountain — enough for the printed {R}, not for +{4}.
        getPlayer(state, BOT).battlefield = lands(MOUNTAIN, 1, "mtn");
        const moves = castMoves(state, "bl");
        expect(moves.length).toBeGreaterThan(0);
        expect(
            moves.every((m) => m.kind === "cast-spell" && !m.kickerPayments)
        ).toBe(true);
    });
});

describe("AC #4 — the KICKED target requirement is honoured (Magma Burst, count 1 → 2)", () => {
    function board() {
        return makeState({
            players: [
                makePlayer(BOT, {
                    hand: [
                        makeInstance(MAGMA_BURST, {
                            id: "mb",
                            zone: "hand",
                            controllerId: BOT,
                            ownerId: BOT,
                        }),
                    ],
                    battlefield: lands(MOUNTAIN, 4, "mtn"),
                }),
                makePlayer(OPP, {
                    battlefield: [
                        bf(HILL_GIANT, "giant", OPP),
                        bf(GRIZZLY_BEARS, "bears", OPP),
                    ],
                }),
            ],
            activePlayerId: BOT,
            priorityPlayerId: BOT,
        });
    }

    it("unkicked casts target exactly ONE permanent; kicked casts target exactly TWO", () => {
        const moves = castMoves(board(), "mb");
        const unkicked = moves.filter(
            (m) => m.kind === "cast-spell" && !m.kickerPayments
        );
        const kicked = moves.filter(
            (m) => m.kind === "cast-spell" && m.kickerPayments
        );
        expect(unkicked.length).toBeGreaterThan(0);
        expect(kicked.length).toBeGreaterThan(0);
        expect(
            new Set(
                unkicked.map((m) =>
                    m.kind === "cast-spell" ? m.targets.length : -1
                )
            )
        ).toEqual(new Set([1]));
        // Before this issue's fix, `groupsFor` fell back to
        // `cardDef.targetRequirement` unconditionally (the enumerator's own
        // admission comment) — a kicked Magma Burst would have enumerated
        // with ONE target, exactly like the unkicked cast, silently dropping
        // the widened "target ANOTHER permanent" clause.
        expect(
            new Set(
                kicked.map((m) =>
                    m.kind === "cast-spell" ? m.targets.length : -1
                )
            )
        ).toEqual(new Set([2]));
    });
});

describe("EXECUTION — Magma Burst's PERMANENT Kicker leg, both sandboxes", () => {
    function board() {
        return makeState({
            players: [
                makePlayer(BOT, {
                    hand: [
                        makeInstance(MAGMA_BURST, {
                            id: "mb",
                            zone: "hand",
                            controllerId: BOT,
                            ownerId: BOT,
                        }),
                    ],
                    battlefield: lands(MOUNTAIN, 4, "mtn"),
                }),
                makePlayer(OPP, {
                    battlefield: [
                        bf(HILL_GIANT, "giant", OPP),
                        bf(GRIZZLY_BEARS, "bears", OPP),
                    ],
                }),
            ],
            activePlayerId: BOT,
            priorityPlayerId: BOT,
        });
    }

    function kickedMove(state: GameState): Move {
        const m = castMoves(state, "mb").find(
            (mv) => mv.kind === "cast-spell" && mv.kickerPayments
        );
        if (!m) throw new Error("no kicked Magma Burst move enumerated");
        return m;
    }

    it("applyMoveForSearch sacrifices TWO lands, cheapest-first, and pays no extra mana", () => {
        const state = board();
        const move = kickedMove(state);
        const before = getPlayer(state, BOT).battlefield.filter((c) =>
            c.id.startsWith("mtn")
        ).length;
        const after = applyMoveForSearch(state, BOT, move);
        const p = getPlayer(after, BOT);
        const remainingLands = p.battlefield.filter((c) =>
            c.id.startsWith("mtn")
        ).length;
        expect(remainingLands).toBe(before - 2);
        expect(p.graveyard.filter((c) => c.id.startsWith("mtn"))).toHaveLength(
            2
        );
        // No mana leg on this Kicker — the tap plan is identical size to the
        // printed cost's own plan (4 lands for {3}{R}), never inflated.
        expect(move.kind === "cast-spell" ? move.tapPlan : []).toHaveLength(4);
    });

    it("applyMoveInSearch (the ISMCTS tree) sacrifices the SAME two lands independently", () => {
        const state = board();
        const move = kickedMove(state);
        const before = getPlayer(state, BOT).battlefield.filter((c) =>
            c.id.startsWith("mtn")
        ).length;
        const world = structuredClone(state);
        applyMoveInSearch(world, BOT, move);
        const p = getPlayer(world, BOT);
        const remainingLands = p.battlefield.filter((c) =>
            c.id.startsWith("mtn")
        ).length;
        expect(remainingLands).toBe(before - 2);
        expect(p.graveyard.filter((c) => c.id.startsWith("mtn"))).toHaveLength(
            2
        );
    });
});

describe("EXECUTION — Phyrexian Scuta's LIFE Kicker leg, both sandboxes", () => {
    function board() {
        return makeState({
            players: [
                makePlayer(BOT, {
                    hand: [
                        makeInstance(PHYREXIAN_SCUTA, {
                            id: "scuta",
                            zone: "hand",
                            controllerId: BOT,
                            ownerId: BOT,
                        }),
                    ],
                    battlefield: lands(SWAMP, 4, "swp"),
                    life: 20,
                }),
                makePlayer(OPP),
            ],
            activePlayerId: BOT,
            priorityPlayerId: BOT,
        });
    }

    function kickedMove(state: GameState): Move {
        const m = castMoves(state, "scuta").find(
            (mv) => mv.kind === "cast-spell" && mv.kickerPayments
        );
        if (!m) throw new Error("no kicked Phyrexian Scuta move enumerated");
        return m;
    }

    it("enumerates the kicked variant only while life covers it, with payLife = 3", () => {
        const state = board();
        const move = kickedMove(state);
        expect(move.kind === "cast-spell" ? move.payLife : 0).toBe(3);

        const broke = board();
        getPlayer(broke, BOT).life = 2;
        expect(
            castMoves(broke, "scuta").some(
                (m) => m.kind === "cast-spell" && m.kickerPayments
            )
        ).toBe(false);
    });

    it("applyMoveForSearch deducts the 3 life", () => {
        const state = board();
        const move = kickedMove(state);
        const after = applyMoveForSearch(state, BOT, move);
        expect(getPlayer(after, BOT).life).toBe(17);
    });

    it("applyMoveInSearch (the ISMCTS tree) deducts the 3 life too", () => {
        // This ALSO pins the pre-existing gap issue #2081 found and closed as
        // a byproduct: `applyMoveInSearch` never deducted `move.payLife` at
        // all before this change (proof-of-failure: reverting just the new
        // `if (move.payLife …) player.life -= move.payLife;` line in
        // `search.ts` turns this test red while every OTHER test in this file
        // stays green, since Magma Burst/Burst Lightning carry no `payLife`).
        const state = board();
        const move = kickedMove(state);
        const world = structuredClone(state);
        applyMoveInSearch(world, BOT, move);
        expect(getPlayer(world, BOT).life).toBe(17);
    });
});

describe("ENUMERATION + EXECUTION — Corpse Dance's Buyback (mana-only, top-level field)", () => {
    function board() {
        return makeState({
            players: [
                makePlayer(BOT, {
                    hand: [
                        makeInstance(CORPSE_DANCE, {
                            id: "cd",
                            zone: "hand",
                            controllerId: BOT,
                            ownerId: BOT,
                        }),
                    ],
                    battlefield: lands(SWAMP, 5, "swp"),
                    graveyard: [
                        makeInstance(GRIZZLY_BEARS, {
                            id: "deadbears",
                            zone: "graveyard",
                            controllerId: BOT,
                            ownerId: BOT,
                        }),
                    ],
                }),
                makePlayer(OPP),
            ],
            activePlayerId: BOT,
            priorityPlayerId: BOT,
        });
    }

    it("enumerates both a plain cast and a Buyback-paid cast, the second tapping 2 more lands", () => {
        const moves = castMoves(board(), "cd");
        const plain = moves.find(
            (m) => m.kind === "cast-spell" && !m.buybackPaid
        );
        const bought = moves.find(
            (m) => m.kind === "cast-spell" && m.buybackPaid
        );
        expect(plain?.kind === "cast-spell" && plain.tapPlan).toHaveLength(3);
        expect(bought?.kind === "cast-spell" && bought.tapPlan).toHaveLength(5);
    });

    it("applyMoveForSearch resolving a Buyback-paid cast returns the card to HAND, not the graveyard", () => {
        const state = board();
        const bought = castMoves(state, "cd").find(
            (m) => m.kind === "cast-spell" && m.buybackPaid
        )!;
        const after = applyMoveForSearch(state, BOT, bought);
        const p = getPlayer(after, BOT);
        expect(p.hand.some((c) => c.id === "cd")).toBe(true);
        expect(p.graveyard.some((c) => c.id === "cd")).toBe(false);
    });

    it("applyMoveInSearch (the ISMCTS tree) stamps buybackPaid on the pushed stack item", () => {
        const state = board();
        const bought = castMoves(state, "cd").find(
            (m) => m.kind === "cast-spell" && m.buybackPaid
        )!;
        const world = structuredClone(state);
        applyMoveInSearch(world, BOT, bought);
        expect(world.stack[world.stack.length - 1]?.buybackPaid).toBe(true);
    });
});

describe("the BOUND — Multikicker's repetition axis is a fixed sample, not the affordable maximum (Everflowing Chalice)", () => {
    it("enumerateKickerVariants offers exactly {undefined, 1, 2} regardless of how much mana is on the battlefield", () => {
        const state = makeState({
            players: [
                makePlayer(BOT, {
                    hand: [
                        makeInstance(EVERFLOWING_CHALICE, {
                            id: "efc",
                            zone: "hand",
                            controllerId: BOT,
                            ownerId: BOT,
                        }),
                    ],
                    // Deliberately WAY more mana than the bound would ever
                    // sample up to (20 Forests), to prove the cap is a
                    // property of the BOUND, not of what's affordable.
                    battlefield: lands(FOREST, 20, "for"),
                }),
                makePlayer(OPP),
            ],
            activePlayerId: BOT,
            priorityPlayerId: BOT,
        });
        const def = getCardByName("Everflowing Chalice");
        const variants = enumerateKickerVariants(
            state,
            getPlayer(state, BOT),
            def,
            getPlayer(state, BOT).hand[0]
        );
        expect(variants).toEqual([undefined, { kicker: 1 }, { kicker: 2 }]);
    });

    it("enumerateCastMoves stays at 3 variants (never N+1) at that same abundant-mana board", () => {
        const state = makeState({
            players: [
                makePlayer(BOT, {
                    hand: [
                        makeInstance(EVERFLOWING_CHALICE, {
                            id: "efc",
                            zone: "hand",
                            controllerId: BOT,
                            ownerId: BOT,
                        }),
                    ],
                    battlefield: lands(FOREST, 20, "for"),
                }),
                makePlayer(OPP),
            ],
            activePlayerId: BOT,
            priorityPlayerId: BOT,
        });
        expect(castMoves(state, "efc")).toHaveLength(3);
    });
});

describe("a permanent-leg Kicker is priced ON TOP of a board-wide static additional sacrifice (Drought + Bog Down, CR 601.2f)", () => {
    // Drought's "Sacrifice a Swamp" (CR 118.8, one per black mana symbol) is owed
    // beside Bog Down's "Kicker — Sacrifice two lands", from distinct lands. The
    // mana sources are kept off the land count with Sol Ring, so the only thing
    // deciding the offer is how many lands the two costs together need.
    function board(swamps: number, forests: number) {
        return makeState({
            players: [
                makePlayer(BOT, {
                    hand: [
                        makeInstance(BOG_DOWN, {
                            id: "bogdown",
                            zone: "hand",
                            controllerId: BOT,
                            ownerId: BOT,
                        }),
                    ],
                    battlefield: [
                        bf(DROUGHT, "drought1", BOT),
                        bf(SOL_RING, "ring", BOT),
                        // The Swamps' ids sort first, so a cheapest-first pick
                        // (mana value, then id) reaches for them before a Forest.
                        ...lands(SWAMP, swamps, "aswp"),
                        ...lands(FOREST, forests, "for"),
                    ],
                }),
                makePlayer(OPP),
            ],
            activePlayerId: BOT,
            priorityPlayerId: BOT,
        });
    }

    function kicked(moves: Move[]) {
        return moves.filter((m) => m.kind === "cast-spell" && m.kickerPayments);
    }

    it("offers the kicked cast once the board covers the tax AND the Kicker", () => {
        expect(kicked(castMoves(board(1, 2), "bogdown"))).not.toHaveLength(0);
    });

    it("the announcement accepts the payment the enumerator offers", () => {
        const state = board(1, 2);
        const def = getCardByName("Bog Down");
        const player = getPlayer(state, BOT);
        expect(() =>
            assertKickerAnnouncementLegal(
                state,
                def,
                player.hand[0],
                player,
                { kicker: 1 },
                "hand",
                def.additionalCosts
            )
        ).not.toThrow();
    });

    it("two lands cover each cost alone but not both: only the unkicked cast is offered, and the announcement agrees", () => {
        const state = board(2, 0);
        const moves = castMoves(state, "bogdown");
        expect(moves.length).toBeGreaterThan(0);
        expect(kicked(moves)).toHaveLength(0);

        const def = getCardByName("Bog Down");
        const player = getPlayer(state, BOT);
        expect(() =>
            assertKickerAnnouncementLegal(
                state,
                def,
                player.hand[0],
                player,
                { kicker: 1 },
                "hand",
                def.additionalCosts
            )
        ).toThrow(/not enough permanents to sacrifice/);
    });

    it("both search appliers charge the tax AND the Kicker, never spending the taxed Swamp on the Kicker", () => {
        // A cheapest-first Kicker leg paid ahead of the tax would take the Swamp
        // and leave Drought's cost unpaid, with a Forest surviving.
        const state = board(1, 2);
        const move = kicked(castMoves(state, "bogdown"))[0];
        const expected = ["aswp0", "for0", "for1"];

        const greedy = applyMoveForSearch(state, BOT, move);
        expect(
            getPlayer(greedy, BOT)
                .graveyard.filter((c) => !c.types.includes("Sorcery"))
                .map((c) => c.id)
                .sort()
        ).toEqual(expected);

        const world = structuredClone(state);
        applyMoveInSearch(world, BOT, move);
        expect(
            getPlayer(world, BOT)
                .graveyard.filter((c) => !c.types.includes("Sorcery"))
                .map((c) => c.id)
                .sort()
        ).toEqual(expected);
    });

    it("the live owed-payment seam completes the merged park the announcement raises", () => {
        const state = board(1, 2);
        const owner = getPlayer(state, BOT);
        const card = owner.hand[0];
        const own = buildCastCostSelection(
            state,
            owner,
            card,
            undefined,
            "Bog Down"
        ).selection;
        const merged = resolveCastPermanentSelection(
            buildCastPermanentCostChoice(
                state,
                BOT,
                undefined,
                getCardByName("Bog Down"),
                { kicker: 1 },
                "Bog Down",
                card
            ),
            own
        )!;
        expect(merged.picked).toEqual(["aswp0"]);
        expect(completeSacrificeSelection(state, merged)).toEqual([
            "for0",
            "for1",
        ]);
    });

    it("without Drought, two lands are enough for the same kicked cast (the tax, not Kicker itself, is what raises the price)", () => {
        const state = board(2, 0);
        const owner = getPlayer(state, BOT);
        owner.battlefield = owner.battlefield.filter(
            (c) => c.id !== "drought1"
        );
        expect(kicked(castMoves(state, "bogdown"))).not.toHaveLength(0);
    });
});

describe("a permanent-leg Kicker is priced ON TOP of a CASTER-CHOSEN oneOf additional-cost leg (CR 601.2b / 601.2f)", () => {
    // The leg is only known once `moves.ts` crosses the Kicker axis with the leg
    // axis, and `assertKickerAnnouncementLegal` prices the EFFECTIVE spec
    // (`resolveAdditionalCosts`, the leg flattened on), so the enumerator prices
    // the same pair. No shipped card has this shape: the fixture is synthetic.
    function board(
        battlefield: ReturnType<typeof bf>[],
        manaPool?: { R: number }
    ) {
        return makeState({
            players: [
                makePlayer(BOT, {
                    hand: [
                        makeInstance(SYNTHETIC_KICKER_ONEOF_ID, {
                            id: "synth",
                            zone: "hand",
                            controllerId: BOT,
                            ownerId: BOT,
                        }),
                    ],
                    battlefield,
                    ...(manaPool
                        ? {
                              manaPool: {
                                  W: 0,
                                  U: 0,
                                  B: 0,
                                  G: 0,
                                  C: 0,
                                  ...manaPool,
                              },
                          }
                        : {}),
                }),
                makePlayer(OPP),
            ],
            activePlayerId: BOT,
            priorityPlayerId: BOT,
        });
    }

    function offered(state: GameState, leg: string, isKicked: boolean) {
        return castMoves(state, "synth").some(
            (m) =>
                m.kind === "cast-spell" &&
                !!m.kickerPayments === isKicked &&
                m.additionalCostLegId === leg
        );
    }

    it("offers kicked+sac-land when a second Forest pays the Kicker, and the announcement accepts it", () => {
        const state = board([
            bf(MOUNTAIN, "mtn0", BOT),
            bf(FOREST, "for0", BOT),
            bf(FOREST, "for1", BOT),
        ]);
        expect(offered(state, "sac-land", true)).toBe(true);

        const player = getPlayer(state, BOT);
        expect(() =>
            assertKickerAnnouncementLegal(
                state,
                SYNTHETIC_KICKER_ONEOF,
                player.hand[0],
                player,
                { kicker: 1 },
                "hand",
                resolveAdditionalCosts(
                    SYNTHETIC_KICKER_ONEOF.additionalCosts,
                    "sac-land"
                )
            )
        ).not.toThrow();
    });

    it("a broad own sacrifice beside a narrower Kicker leg is only offered when BOTH walks finish, so the announcement never refuses a Move", () => {
        // The announcement reserves first-match, and the Mountain sits behind the
        // Forest: the "sacrifice a land" leg takes the Forest and leaves the
        // Kicker's Forest unpayable, though the Mountain could have paid the leg.
        const state = board(
            [bf(FOREST, "zfor0", BOT), bf(MOUNTAIN, "amtn0", BOT)],
            { R: 1 }
        );
        expect(offered(state, "sac-land", true)).toBe(false);

        const player = getPlayer(state, BOT);
        expect(() =>
            assertKickerAnnouncementLegal(
                state,
                SYNTHETIC_KICKER_ONEOF,
                player.hand[0],
                player,
                { kicker: 1 },
                "hand",
                resolveAdditionalCosts(
                    SYNTHETIC_KICKER_ONEOF.additionalCosts,
                    "sac-land"
                )
            )
        ).toThrow(/not enough permanents to sacrifice/);
    });

    it("the mirror board: the announcement would accept it, but the Bot's cheapest-first answer cannot finish, so no Move is offered", () => {
        // Battlefield order gives the Mountain to the "sacrifice a land" leg, so
        // the announcement passes; cheapest-first spends the Forest on that leg
        // and the merged selection could never complete.
        const state = board(
            [bf(MOUNTAIN, "zmtn0", BOT), bf(FOREST, "afor0", BOT)],
            { R: 1 }
        );
        expect(offered(state, "sac-land", true)).toBe(false);

        const player = getPlayer(state, BOT);
        expect(() =>
            assertKickerAnnouncementLegal(
                state,
                SYNTHETIC_KICKER_ONEOF,
                player.hand[0],
                player,
                { kicker: 1 },
                "hand",
                resolveAdditionalCosts(
                    SYNTHETIC_KICKER_ONEOF.additionalCosts,
                    "sac-land"
                )
            )
        ).not.toThrow();
    });

    it("a lone Forest cannot pay both, so only kicked+pay-3-life and unkicked+sac-land are offered, and the announcement agrees", () => {
        const state = board([bf(FOREST, "for0", BOT)], { R: 1 });
        expect(offered(state, "sac-land", true)).toBe(false);
        expect(offered(state, "pay-3-life", true)).toBe(true);
        expect(offered(state, "sac-land", false)).toBe(true);

        const player = getPlayer(state, BOT);
        expect(() =>
            assertKickerAnnouncementLegal(
                state,
                SYNTHETIC_KICKER_ONEOF,
                player.hand[0],
                player,
                { kicker: 1 },
                "hand",
                resolveAdditionalCosts(
                    SYNTHETIC_KICKER_ONEOF.additionalCosts,
                    "sac-land"
                )
            )
        ).toThrow(/not enough permanents to sacrifice/);
    });
});

describe("AC #5 — the bot CHOOSES to pay when paying is right (Burst Lightning root-move decision)", () => {
    // Hill Giant is a vanilla 3/3: unkicked Burst Lightning's 2 damage does
    // NOT kill it, kicked's 4 does. The mana has nothing else to do this
    // turn (Burst Lightning is the only card in hand), so kicking strictly
    // dominates — same card, same turn, opponent's only creature dies
    // instead of surviving. A deterministic single scenario + a root-move
    // assertion (`.claude/rules/gre-development.md` / bot-change doctrine),
    // never self-play.
    function board() {
        return makeState({
            players: [
                makePlayer(BOT, {
                    hand: [
                        makeInstance(BURST_LIGHTNING, {
                            id: "bl",
                            zone: "hand",
                            controllerId: BOT,
                            ownerId: BOT,
                        }),
                    ],
                    battlefield: lands(MOUNTAIN, 5, "mtn"),
                }),
                makePlayer(OPP, {
                    battlefield: [bf(HILL_GIANT, "giant", OPP)],
                }),
            ],
            activePlayerId: BOT,
            priorityPlayerId: BOT,
        });
    }

    it("selects the KICKED cast over the unkicked one, across multiple seeds", () => {
        for (const seed of [1, 2, 3]) {
            const { move, trace } = searchWithTrace(
                board(),
                BOT,
                { iterations: 300 },
                seed
            );
            expect(move).not.toBeNull();
            expect(move!.kind).toBe("cast-spell");
            expect(
                move!.kind === "cast-spell" ? move!.kickerPayments : undefined
            ).toEqual({ kicker: 1 });
            // AC #6 — measured, not assumed: the wider branching factor a
            // Kicker adds does not starve the search of its own budget. Both
            // numbers are read straight off `decisionTelemetry.ts`'s
            // `SearchStats` surface (`iterationsCompleted` /
            // `iterationsRequested`), reused rather than re-instrumented.
            expect(trace).not.toBeNull();
            expect(trace!.iterationsCompleted).toBe(300);
            expect(trace!.iterationsRequested).toBe(300);
        }
    });

    it("describeMove labels the chosen line distinguishably (kicker vs. plain)", () => {
        const state = board();
        const kicked = castMoves(state, "bl").find(
            (m) => m.kind === "cast-spell" && m.kickerPayments
        )!;
        expect(describeMove(kicked, state)).toContain("[kicker:kicker=1]");
    });
});
