// CR 702.66b / 601.2g (issue #1661) — the search leaf must model delve's
// graveyard-exile payment. `enumerateMoves` (moves.ts) discounts a delve
// cast's `tapPlan` by the number of graveyard cards it assumes get exiled,
// but the emitted `Move` never records which/how many cards that was — so a
// search leaf that only replays `tapPlan` (both `applyMoveForSearch`, the
// greedy 1-ply sandbox, and `applyMoveInSearch`, the actual ISMCTS tree leaf)
// previously evaluated a delve cast as costing NOTHING from the graveyard.
// That over-rates Treasure Cruise and leaves phantom fuel for a later
// graveyard-cost play in the same rollout (escape, flashback, another delve
// cast) to illegally reuse.
//
// See `applyDelveExileForSearch` (`convex/gre/applyMove.ts`), shared by both
// leaves.
import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import { applyMoveForSearch } from "../applyMove";
import { applyMoveInSearch } from "../search";
import { enumerateMoves } from "../moves";
import { delveEligibleCards } from "../payWith";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import type { Move } from "../moves";
import type { GameState } from "../state";

const TREASURE_CRUISE = getCardByName("Treasure Cruise").id; // {7}{U}, delve
const ISLAND = getCardByName("Island").id;
const MOUNTAIN = getCardByName("Mountain").id;

/** `n` cards in `BOT`'s graveyard as delve fuel — plain vanilla cards, delve
 *  has no colour/type filter (CR 702.66a). */
function fuel(n: number, ownerId: string) {
    return Array.from({ length: n }, (_, i) =>
        makeInstance(MOUNTAIN, {
            id: `gy${i}`,
            controllerId: ownerId,
            ownerId,
            zone: "graveyard",
        })
    );
}

/** One untapped Island — exactly enough to pay Treasure Cruise's {U} pip and
 *  nothing toward its {7} generic, so the generic portion is FULLY forced
 *  onto delve (`genericManaShortfall` sees zero leftover mana). With a
 *  7-card graveyard this makes the delve count deterministic: exactly 7. */
function oneIsland(id: string, ownerId: string) {
    return makeInstance(ISLAND, { id, controllerId: ownerId });
}

/** `n` untapped Islands, for the partial/zero-delve fixtures below — plain
 *  colourless-producing mana sources, no tap-plan ambiguity. */
function islands(n: number, ownerId: string) {
    return Array.from({ length: n }, (_, i) =>
        makeInstance(ISLAND, { id: `isle${i}`, controllerId: ownerId })
    );
}

function findCastMove(moves: Move[], cardInstanceId: string) {
    return moves.find(
        (m) => m.kind === "cast-spell" && m.cardInstanceId === cardInstanceId
    );
}

describe("applyMoveForSearch — delve pays graveyard, not free mana (issue #1661)", () => {
    it("shrinks the simulated graveyard by the delved card count", () => {
        const BOT = "p2";
        const cruise = makeInstance(TREASURE_CRUISE, {
            id: "cruise1",
            controllerId: BOT,
            ownerId: BOT,
            zone: "hand",
        });
        const bot = makePlayer(BOT, {
            hand: [cruise],
            graveyard: fuel(7, BOT),
            battlefield: [oneIsland("isle1", BOT)],
        });
        const state = makeState({
            players: [makePlayer("p1"), bot],
            activePlayerId: BOT,
            priorityPlayerId: BOT,
            phase: "PRECOMBAT_MAIN",
        });

        const moves = enumerateMoves(state, BOT);
        const castMove = findCastMove(moves, cruise.id);
        expect(castMove).toBeDefined();
        expect(castMove?.kind).toBe("cast-spell");

        const next = applyMoveForSearch(state, BOT, castMove!);
        const nextBot = next.players.find((p) => p.id === BOT)!;

        // The whole 7-card graveyard was the forced minimum delve (1 lone
        // Island covers only the {U} pip, nothing toward the {7} generic) —
        // every one of those 7 cards should have left for exile. The ONE
        // card left in the graveyard afterward is Treasure Cruise itself,
        // landing there normally once `applyMoveForSearch` resolves it off
        // the stack (a sorcery goes to its owner's graveyard on resolution,
        // CR 608.2m) — not leftover delve fuel.
        expect(nextBot.graveyard.map((c) => c.id)).toEqual([cruise.id]);
        expect(nextBot.exile).toHaveLength(7);
        expect(nextBot.exile.map((c) => c.id).sort()).toEqual(
            fuel(7, BOT)
                .map((c) => c.id)
                .sort()
        );

        // The original (pre-move) state must be untouched — applyMoveForSearch
        // clones before mutating.
        expect(bot.graveyard).toHaveLength(7);
    });
});

describe("applyMoveInSearch — delve pays graveyard, not free mana (issue #1661)", () => {
    it("shrinks the simulated graveyard by the delved card count, in place", () => {
        const BOT = "p2";
        const cruise = makeInstance(TREASURE_CRUISE, {
            id: "cruise1",
            controllerId: BOT,
            ownerId: BOT,
            zone: "hand",
        });
        const bot = makePlayer(BOT, {
            hand: [cruise],
            graveyard: fuel(7, BOT),
            battlefield: [oneIsland("isle1", BOT)],
        });
        const state = makeState({
            players: [makePlayer("p1"), bot],
            activePlayerId: BOT,
            priorityPlayerId: BOT,
            phase: "PRECOMBAT_MAIN",
        });

        const castMove = findCastMove(enumerateMoves(state, BOT), cruise.id)!;
        applyMoveInSearch(state, BOT, castMove);

        const botAfter = state.players.find((p) => p.id === BOT)!;
        expect(botAfter.graveyard).toHaveLength(0);
        expect(botAfter.exile).toHaveLength(7);
    });

    it("a later graveyard-cost play in the same rollout can no longer reuse the delved fuel", () => {
        const BOT = "p2";
        const cruise1 = makeInstance(TREASURE_CRUISE, {
            id: "cruise1",
            controllerId: BOT,
            ownerId: BOT,
            zone: "hand",
        });
        const cruise2 = makeInstance(TREASURE_CRUISE, {
            id: "cruise2",
            controllerId: BOT,
            ownerId: BOT,
            zone: "hand",
        });
        const bot = makePlayer(BOT, {
            hand: [cruise1, cruise2],
            graveyard: fuel(7, BOT),
            battlefield: [oneIsland("isle1", BOT)],
        });
        const state = makeState({
            players: [makePlayer("p1"), bot],
            activePlayerId: BOT,
            priorityPlayerId: BOT,
            phase: "PRECOMBAT_MAIN",
        });

        // Before anything is cast, BOTH copies see the full 7-card graveyard
        // as eligible delve fuel — each evaluated independently against the
        // still-untouched position.
        expect(delveEligibleCards(bot, cruise1.id)).toHaveLength(7);
        expect(delveEligibleCards(bot, cruise2.id)).toHaveLength(7);
        expect(
            findCastMove(enumerateMoves(state, BOT), cruise2.id)
        ).toBeDefined();

        // Cast the first copy through the real ISMCTS leaf.
        const firstCast = findCastMove(enumerateMoves(state, BOT), cruise1.id)!;
        applyMoveInSearch(state, BOT, firstCast);

        const botAfter = state.players.find((p) => p.id === BOT)!;
        expect(botAfter.graveyard).toHaveLength(0);

        // THE BUG: without the fix, the graveyard still reports 7 eligible
        // cards here (the exile never happened), so the second copy would
        // still see itself as fully delve-payable. With the fix, the fuel is
        // gone — the primitive every graveyard-cost mechanic (delve, escape,
        // flashback) queries reports zero.
        expect(delveEligibleCards(botAfter, cruise2.id)).toHaveLength(0);

        // And the second-order behavioral effect: the second copy is no
        // longer castable at all in this position (no mana AND no delve fuel
        // left) — the lone Island is spent and the graveyard is empty, where
        // it was legally castable moments ago against the pre-cast position.
        const movesAfter = enumerateMoves(state, BOT);
        expect(findCastMove(movesAfter, cruise2.id)).toBeUndefined();
    });
});

// CR 702.66b / 601.2g (issue #1661 review finding) — the three scenarios
// above are all the SAME forced-full position (1 Island + 7 fuel → delve
// exactly all 7 cards). A search leaf that wrongly exiled every eligible
// graveyard card (instead of the forced-minimum count `genericManaShortfall`
// actually computes) would pass all three identically, since "all eligible"
// and "the correct count" coincide when the correct count IS the whole
// graveyard. These two cases pin down a PARTIAL count and an OPTIONAL
// (zero) count, so an over-exiling implementation fails both.
describe("applyMoveInSearch — partial and zero-delve counts (issue #1661 review finding)", () => {
    it("3 Islands + 7 fuel: the tap plan covers 3, delve is forced for the other 5", () => {
        const BOT = "p2";
        const cruise = makeInstance(TREASURE_CRUISE, {
            id: "cruise1",
            controllerId: BOT,
            ownerId: BOT,
            zone: "hand",
        });
        const gyFuel = fuel(7, BOT);
        // Snapshot ids BEFORE the move runs: `bot.graveyard` below is the
        // SAME array reference as `gyFuel` (`makePlayer` doesn't clone), and
        // `applyMoveInSearch` mutates `state` (and therefore this array) IN
        // PLACE — slicing `gyFuel` itself after the move would read the
        // already-mutated (post-exile) array, not the original order.
        const gyFuelIds = gyFuel.map((c) => c.id);
        const bot = makePlayer(BOT, {
            hand: [cruise],
            graveyard: gyFuel,
            battlefield: islands(3, BOT),
        });
        const state = makeState({
            players: [makePlayer("p1"), bot],
            activePlayerId: BOT,
            priorityPlayerId: BOT,
            phase: "PRECOMBAT_MAIN",
        });

        // 3 Islands pay the {U} pip plus 2 of the {7} generic, so the tap
        // plan taps all 3 and the enumerator's own `genericManaShortfall`
        // forces exactly 7 - 2 = 5 cards onto delve (`moves.ts:599-623`).
        const castMove = findCastMove(enumerateMoves(state, BOT), cruise.id)!;
        expect(castMove.kind).toBe("cast-spell");
        expect(
            (castMove as Extract<Move, { kind: "cast-spell" }>).tapPlan
        ).toHaveLength(3);

        applyMoveInSearch(state, BOT, castMove);

        const botAfter = state.players.find((p) => p.id === BOT)!;
        // Exactly 5 exiled — the front 5 of the graveyard, delve's
        // deterministic pick policy (`applyDelveExileForSearch`) — and
        // exactly the other 2 left behind. An "exile everything eligible"
        // implementation would report 7 exiled / 0 remaining here and fail.
        expect(botAfter.exile.map((c) => c.id)).toEqual(gyFuelIds.slice(0, 5));
        expect(botAfter.graveyard.map((c) => c.id)).toEqual(gyFuelIds.slice(5));
        expect(botAfter.exile).toHaveLength(5);
        expect(botAfter.graveyard).toHaveLength(2);
    });

    it("8 Islands + 7 fuel: mana alone covers the cost, delve is optional and pays for nothing", () => {
        const BOT = "p2";
        const cruise = makeInstance(TREASURE_CRUISE, {
            id: "cruise1",
            controllerId: BOT,
            ownerId: BOT,
            zone: "hand",
        });
        const gyFuel = fuel(7, BOT);
        // Snapshot ids before the move for the same reason as the partial
        // case above — `gyFuel` is the live `graveyard` array reference.
        const gyFuelIds = gyFuel.map((c) => c.id);
        const bot = makePlayer(BOT, {
            hand: [cruise],
            graveyard: gyFuel,
            battlefield: islands(8, BOT),
        });
        const state = makeState({
            players: [makePlayer("p1"), bot],
            activePlayerId: BOT,
            priorityPlayerId: BOT,
            phase: "PRECOMBAT_MAIN",
        });

        // 8 Islands fully pay {7}{U} on their own (`genericManaShortfall`
        // returns 0), so `offsetGeneric.min === 0` — delve is a purely
        // tactical, never-forced choice here (CR 702.66a). The
        // deterministic search-leaf policy makes no tactical delve pick, so
        // the exile count must be exactly zero, not "some eligible cards".
        const castMove = findCastMove(enumerateMoves(state, BOT), cruise.id)!;
        expect(castMove.kind).toBe("cast-spell");

        applyMoveInSearch(state, BOT, castMove);

        const botAfter = state.players.find((p) => p.id === BOT)!;
        expect(botAfter.exile).toHaveLength(0);
        expect(botAfter.graveyard.map((c) => c.id)).toEqual(gyFuelIds);
        expect(botAfter.graveyard).toHaveLength(7);
    });
});

// ---------------------------------------------------------------------------
// CR 506.3 (issue #1944 review fixup) — both search leaves must record an
// attacker DECLARATION, not merely mark the creature attacking.
// `recordAttackerDeclared` writes the GAME-level `creatureAttackedThisTurn`
// flag that "if no creatures attacked this turn" effects (Keldon Twilight)
// read. The greedy 1-ply leaf (`applyMoveForSearch`) shipped calling
// `markAttacking` alone, so its leaves reported "no creatures attacked" the
// instant after attacking and the greedy evaluator mis-scored every such
// effect. Asserted for BOTH leaves so neither can regress independently.
// ---------------------------------------------------------------------------

/** Attacker-declaration fixture: one untapped, non-summoning-sick Grizzly Bears
 *  for `ATTACKER_SEAT`, an empty combat, phase DECLARE_ATTACKERS. */
function attackState(seat: string) {
    const bear = makeInstance(getCardByName("Grizzly Bears").id, {
        id: "bear1",
        controllerId: seat,
        ownerId: seat,
        isSummoningSick: false,
    });
    const state = makeState({
        turn: 3,
        players:
            seat === "p1"
                ? [makePlayer("p1", { battlefield: [bear] }), makePlayer("p2")]
                : [makePlayer("p1"), makePlayer(seat, { battlefield: [bear] })],
        activePlayerId: seat,
        priorityPlayerId: seat,
        phase: "DECLARE_ATTACKERS",
    });
    state.combat = {
        attackerIds: [],
        confirmed: false,
        blockerAssignments: {},
        blockersConfirmed: false,
    };
    return { state, bear };
}

const declareMove: Move = { kind: "declare-attackers", attackerIds: ["bear1"] };

describe("search leaves record an attacker DECLARATION (CR 506.3, issue #1944)", () => {
    it("applyMoveForSearch (greedy 1-ply sandbox) sets creatureAttackedThisTurn", () => {
        const { state } = attackState("p1");
        expect(state.creatureAttackedThisTurn).toBeUndefined();

        const next = applyMoveForSearch(state, "p1", declareMove);

        expect(next.creatureAttackedThisTurn).toBe(true);
        const bearAfter = next.players[0].battlefield.find(
            (c) => c.id === "bear1"
        )!;
        expect(bearAfter.hasAttackedThisTurn).toBe(true);
        // The sandbox clone must not leak the flag back into the caller's state.
        expect(state.creatureAttackedThisTurn).toBeUndefined();
    });

    it("applyMoveInSearch (ISMCTS tree leaf) sets creatureAttackedThisTurn", () => {
        const { state } = attackState("p1");
        expect(state.creatureAttackedThisTurn).toBeUndefined();

        applyMoveInSearch(state, "p1", declareMove);

        expect(state.creatureAttackedThisTurn).toBe(true);
        const bearAfter = state.players[0].battlefield.find(
            (c) => c.id === "bear1"
        )!;
        expect(bearAfter.hasAttackedThisTurn).toBe(true);
    });
});

// CR 113.6 / 702.129a (issue #2339) — a GRAVEYARD-source activation
// (Eternalize, Ashen Ghoul) has no battlefield source, so the tap-the-source
// leg of `activate-ability` finds nothing and both search leaves would leave
// the card sitting in the graveyard. Its `cost.exileThis` leg is the one part
// of the cost that changes the board, so both simulators must apply it — else
// a single rollout line can spend the SAME graveyard card N times, each
// enumeration still offering the activation it has already paid for.
describe("graveyard-source activations pay `exileThis` in the search leaves (CR 702.129a, issue #2339)", () => {
    const FANATIC = getCardByName("Fanatic of Rhonas").id; // {1}{G}, Eternalize {2}{G}{G}
    const FOREST = getCardByName("Forest").id;
    const BOT = "p1";

    /** Fanatic in the bot's graveyard, four untapped Forests (exactly the
     *  eternalize cost), a main phase with an empty stack — every gate clear. */
    function eternalizeState(): GameState {
        return makeState({
            phase: "PRECOMBAT_MAIN",
            activePlayerId: BOT,
            priorityPlayerId: BOT,
            players: [
                makePlayer(BOT, {
                    battlefield: Array.from({ length: 4 }, (_, i) =>
                        makeInstance(FOREST, {
                            id: `forest${i}`,
                            controllerId: BOT,
                            ownerId: BOT,
                        })
                    ),
                    graveyard: [
                        makeInstance(FANATIC, {
                            id: "fanatic",
                            controllerId: BOT,
                            ownerId: BOT,
                            zone: "graveyard",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
    }

    function eternalizeMove(state: GameState): Move {
        const move = enumerateMoves(state, BOT).find(
            (m) =>
                m.kind === "activate-ability" &&
                m.cardInstanceId === "fanatic" &&
                m.abilityId === "eternalize"
        );
        expect(move).toBeDefined();
        return move!;
    }

    /** Re-enumerate on the post-move position with the same player holding
     *  priority — the shape a rollout actually reaches when it keeps taking
     *  moves for the same seat. */
    function eternalizeMovesAgain(state: GameState): Move[] {
        const probe: GameState = {
            ...state,
            priorityPlayerId: BOT,
            phase: "PRECOMBAT_MAIN",
        };
        return enumerateMoves(probe, BOT).filter(
            (m) =>
                m.kind === "activate-ability" &&
                m.cardInstanceId === "fanatic" &&
                m.abilityId === "eternalize"
        );
    }

    it("applyMoveForSearch (greedy 1-ply sandbox) moves the card graveyard → exile", () => {
        const state = eternalizeState();
        const move = eternalizeMove(state);

        const next = applyMoveForSearch(state, BOT, move);
        const nextBot = next.players.find((p) => p.id === BOT)!;

        expect(nextBot.graveyard.map((c) => c.id)).toEqual([]);
        expect(nextBot.exile.map((c) => c.id)).toEqual(["fanatic"]);
        // The pure sandbox must not leak the exile back into the caller's state.
        expect(state.players[0].graveyard.map((c) => c.id)).toEqual([
            "fanatic",
        ]);
        // And the resource is genuinely spent: the same line can't eternalize
        // the same card twice.
        expect(eternalizeMovesAgain(next)).toHaveLength(0);
    });

    it("applyMoveInSearch (ISMCTS tree leaf) moves the card graveyard → exile, in place", () => {
        const state = eternalizeState();
        const move = eternalizeMove(state);

        applyMoveInSearch(state, BOT, move);
        const bot = state.players.find((p) => p.id === BOT)!;

        expect(bot.graveyard.map((c) => c.id)).toEqual([]);
        expect(bot.exile.map((c) => c.id)).toEqual(["fanatic"]);
        expect(eternalizeMovesAgain(state)).toHaveLength(0);
    });

    // The must-NOT row of the same census. Ashen Ghoul (ICE) is the OTHER
    // shipped `activateFromGraveyard` ability and its cost is plain mana —
    // exiling its source would delete the card the ability is about to
    // reanimate. Both leaves must key on `cost.exileThis`, not on
    // "the source is in a graveyard".
    it("does NOT exile a graveyard source whose ability has no `exileThis` cost (Ashen Ghoul)", () => {
        const GHOUL = getCardByName("Ashen Ghoul").id;
        const ghoulMove: Move = {
            kind: "activate-ability",
            cardInstanceId: "ghoul",
            abilityId: "ashen-ghoul-reanimate",
            targets: [],
            confirmTargets: false,
            tapPlan: [],
        };
        function ghoulState(): GameState {
            return makeState({
                phase: "UPKEEP",
                activePlayerId: BOT,
                priorityPlayerId: BOT,
                players: [
                    makePlayer(BOT, {
                        graveyard: [
                            makeInstance(GHOUL, {
                                id: "ghoul",
                                controllerId: BOT,
                                ownerId: BOT,
                                zone: "graveyard",
                            }),
                        ],
                    }),
                    makePlayer("p2"),
                ],
            });
        }

        const inPlace = ghoulState();
        applyMoveInSearch(inPlace, BOT, ghoulMove);
        expect(inPlace.players[0].graveyard.map((c) => c.id)).toEqual([
            "ghoul",
        ]);
        expect(inPlace.players[0].exile).toHaveLength(0);

        const sandbox = applyMoveForSearch(ghoulState(), BOT, ghoulMove);
        expect(sandbox.players[0].graveyard.map((c) => c.id)).toEqual([
            "ghoul",
        ]);
        expect(sandbox.players[0].exile).toHaveLength(0);
    });
});
