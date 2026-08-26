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
import { getCardByName } from "../../cards";
import { enumerateMoves, type Move } from "../moves";
import { applyMoveForSearch } from "../applyMove";
import { applyMoveInSearch, searchWithTrace } from "../search";
import { enumerateKickerVariants } from "../kicker";
import { getPlayer, type GameState } from "../state";
import { describeMove } from "../describeMove";
import { assertKickerAnnouncementLegal } from "../../game";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";

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

describe("AC #3 fixup (review round 1) — a permanent-leg Kicker never collides with a board-wide static additional sacrifice (Drought + Bog Down)", () => {
    // Before this fix, `enumerateKickerVariants` only checked the Kicker's
    // OWN legs for affordability (`canPayKickerLegs`) — nothing checked
    // whether the cast ALSO owed a sacrifice of its own, so it happily
    // offered a kicked Bog Down cast under Drought. `announceCast`'s prelude
    // gate (`assertKickerAnnouncementLegal` -> `assertKickerPermanentSlotFree`,
    // `game.ts`) then rejected it — live, `executeMove`'s promise rejects,
    // the driver retries to `BOT_SUBMIT_RETRY_LIMIT`, and the watchdog takes
    // the window: the bot stalling on a move it generated itself (AC #3).
    // Drought's board-wide "Sacrifice a Swamp" (CR 118.5, one per black mana
    // symbol) collides with Bog Down's own permanent Kicker leg ("Kicker —
    // Sacrifice two lands") because the cast has exactly ONE permanent-cost
    // selection slot (`assertKickerPermanentSlotFree`'s own doc).
    function board() {
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
                        // {2}{B} printed cost — 3 Swamps covers it.
                        ...lands(SWAMP, 3, "swp"),
                        // Extra lands to sacrifice for the Kicker's OWN
                        // "Sacrifice two lands" leg, distinct from the mana
                        // lands above.
                        ...lands(FOREST, 2, "for"),
                    ],
                }),
                makePlayer(OPP),
            ],
            activePlayerId: BOT,
            priorityPlayerId: BOT,
        });
    }

    it("enumerateMoves offers NO kicked Bog Down cast, but still offers the unkicked one", () => {
        const moves = castMoves(board(), "bogdown");
        // The unkicked cast is still legal and still offered — this is a
        // refusal of the COLLIDING variant only, never a blanket "Bog Down
        // is uncastable under Drought".
        expect(moves.length).toBeGreaterThan(0);
        expect(
            moves.every((m) => m.kind === "cast-spell" && !m.kickerPayments)
        ).toBe(true);
    });

    it("proves the premise: announceCast's own prelude gate (game.ts) DOES reject the payment the enumerator used to offer here", () => {
        const state = board();
        const def = getCardByName("Bog Down");
        const player = getPlayer(state, BOT);
        const cardInHand = player.hand[0];
        expect(() =>
            assertKickerAnnouncementLegal(
                state,
                def,
                cardInHand,
                player,
                { kicker: 1 },
                "hand",
                def.additionalCosts
            )
        ).toThrow(
            "This spell's kicker cost cannot be paid alongside its other additional costs"
        );
    });

    it("enumerateKickerVariants itself refuses the kicked payment on this board", () => {
        const state = board();
        const def = getCardByName("Bog Down");
        const card = getPlayer(state, BOT).hand[0];
        const variants = enumerateKickerVariants(
            state,
            getPlayer(state, BOT),
            def,
            card
        );
        expect(variants).toEqual([undefined]);
    });

    it("without Drought on the battlefield, the SAME kicked Bog Down cast IS offered (the collision, not Kicker itself, is what's refused)", () => {
        const state = makeState({
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
                        ...lands(SWAMP, 3, "swp"),
                        ...lands(FOREST, 2, "for"),
                    ],
                }),
                makePlayer(OPP),
            ],
            activePlayerId: BOT,
            priorityPlayerId: BOT,
        });
        const moves = castMoves(state, "bogdown");
        expect(
            moves.some((m) => m.kind === "cast-spell" && m.kickerPayments)
        ).toBe(true);
    });
});

describe("AC #5 — the bot CHOOSES to pay when paying is right (Burst Lightning root-move decision)", () => {
    // Hill Giant is a vanilla 3/3: unkicked Burst Lightning's 2 damage does
    // NOT kill it, kicked's 4 does. The mana has nothing else to do this
    // turn (Burst Lightning is the only card in hand), so kicking strictly
    // dominates — same card, same turn, opponent's only creature dies
    // instead of surviving. A deterministic single scenario + a root-move
    // assertion (`.claude/rules/gre-development.md` / bot-slice doctrine),
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
