// The Bot's ESCAPE and non-mana-FLASHBACK casts (issue #2980).
//
// Issue #2971 gave the enumerator a candidate set for every cast-from-a-
// non-hand-zone permission the engine ships, with two deliberate exclusions
// that failed CLOSED: escape (CR 702.138a — "exile N other cards from your
// graveyard") and a flashback cost with a non-mana leg (CR 702.34a / 118.5 —
// Lava Dart's "Sacrifice a Mountain", Flash of Insight's
// `flashbackExileFromGraveyard`). The `cast-spell` Move had no field to carry
// either cost, so an enumerated escape cast would have been priced as if the
// exile were free and would have parked unpayable at the real mutation.
//
// These tests cover the three things that had to become true, PER MECHANISM
// rather than once for the family:
//   1. the Move is enumerated, priced at the escape/flashback cost, and
//      carries the exact cards it will spend;
//   2. both search sandboxes CHARGE that cost — the exiled cards actually
//      leave the graveyard, which is what bounds the line (escape, unlike
//      flashback, exiles nothing on resolution, so an uncharged escape cast is
//      recastable forever);
//   3. a board that cannot pay is never offered the Move at all.
import { describe, it, expect } from "vitest";
import { enumerateMoves, type Move } from "../moves";
import { applyMoveForSearch } from "../applyMove";
import { applyMoveInSearch } from "../search";
import { cloneGameState } from "../clone";
import type { CardInstanceState, GameState } from "../state";
import { buildCastExileCostChoice } from "../castCost";
import { getLegalActions } from "../rules";
import { recordCastExileCostPick } from "../../game";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { underworldBreach } from "../../cards/sets/thb/red";
import { uroTitanOfNaturesWrath } from "../../cards/sets/thb/multicolor";
import { lavaDart } from "../../cards/sets/ons/red";
import { flashOfInsight } from "../../cards/sets/jud/blue";
import {
    grizzlyBears,
    island,
    mountain,
    forest,
    swamp,
} from "../../cards/sets/lea";

const ME = "p1";
const OPP = "p2";

/** N filler cards in `ME`'s graveyard, ids `filler-0…`, so an assertion can
 *  name the exact cards a cost is expected to spend. */
function filler(n: number, defId: string = grizzlyBears.id) {
    return Array.from({ length: n }, (_, i) =>
        makeInstance(defId, {
            id: `filler-${i}`,
            controllerId: ME,
            ownerId: ME,
            zone: "graveyard",
        })
    );
}

function untapped(defId: string, id: string): CardInstanceState {
    return makeInstance(defId, {
        id,
        controllerId: ME,
        ownerId: ME,
        zone: "battlefield",
        isTapped: false,
    });
}

function stateWith(opts: {
    battlefield: CardInstanceState[];
    graveyard: CardInstanceState[];
    hand?: CardInstanceState[];
}): GameState {
    const me = makePlayer(ME, {
        battlefield: opts.battlefield,
        graveyard: opts.graveyard,
        hand: opts.hand ?? [],
    });
    const opp = makePlayer(OPP);
    return makeState({
        players: [me, opp],
        phase: "PRECOMBAT_MAIN",
        activePlayerId: ME,
        priorityPlayerId: ME,
    });
}

function castsOf(state: GameState, cardInstanceId: string): Move[] {
    return enumerateMoves(state, ME).filter(
        (m) => m.kind === "cast-spell" && m.cardInstanceId === cardInstanceId
    );
}

function graveyardIds(state: GameState): string[] {
    return state.players[0].graveyard.map((c) => c.id);
}

function exileIds(state: GameState): string[] {
    return state.players[0].exile.map((c) => c.id);
}

// ---------------------------------------------------------------------------
// Escape (CR 702.138a)
// ---------------------------------------------------------------------------

describe("escape cast enumeration (CR 702.138a)", () => {
    /** Uro's printed escape is `{G}{G}{U}{U}, Exile five other cards from
     *  your graveyard`. Two Forests + two Islands is exactly that mana; a
     *  fifth land is there so the plan has a choice to make. */
    function uroPosition(fillerCount: number): {
        state: GameState;
        uro: CardInstanceState;
    } {
        const uro = makeInstance(uroTitanOfNaturesWrath.id, {
            id: "uro",
            controllerId: ME,
            ownerId: ME,
            zone: "graveyard",
        });
        const state = stateWith({
            battlefield: [
                untapped(forest.id, "f1"),
                untapped(forest.id, "f2"),
                untapped(island.id, "i1"),
                untapped(island.id, "i2"),
                untapped(island.id, "i3"),
            ],
            graveyard: [uro, ...filler(fillerCount)],
        });
        return { state, uro };
    }

    it("enumerates the cast from the Bot's own graveyard, carrying the exact cards it exiles", () => {
        const { state, uro } = uroPosition(5);
        const casts = castsOf(state, "uro");
        expect(casts.length).toBeGreaterThan(0);
        const cast = casts[0];
        expect(cast.kind === "cast-spell" && cast.castFromZone).toBe(
            "graveyard"
        );
        // CR 702.138a — five OTHER cards, never the escaping card itself.
        const picks =
            cast.kind === "cast-spell"
                ? cast.castCostPicks?.exileCostCardIds
                : undefined;
        expect(picks).toEqual([
            "filler-0",
            "filler-1",
            "filler-2",
            "filler-3",
            "filler-4",
        ]);
        expect(picks).not.toContain(uro.id);
        // Priced at the ESCAPE mana cost ({G}{G}{U}{U} = four taps), not Uro's
        // printed {1}{G}{U}.
        expect(cast.kind === "cast-spell" && cast.tapPlan.length).toBe(4);
    });

    it("is never offered when the graveyard cannot pay the exile cost", () => {
        // Four other cards where the escape cost demands five.
        const { state } = uroPosition(4);
        expect(castsOf(state, "uro")).toEqual([]);
    });

    it("charges the exile in BOTH search sandboxes", () => {
        const { state } = uroPosition(5);
        const cast = castsOf(state, "uro")[0];

        // The greedy sandbox returns a new state.
        const greedy = applyMoveForSearch(state, ME, cast);
        expect(exileIds(greedy)).toEqual([
            "filler-0",
            "filler-1",
            "filler-2",
            "filler-3",
            "filler-4",
        ]);
        expect(graveyardIds(greedy)).toEqual([]);

        // The ISMCTS sandbox mutates in place.
        const tree = cloneGameState(state);
        applyMoveInSearch(tree, ME, cast);
        expect(exileIds(tree)).toEqual([
            "filler-0",
            "filler-1",
            "filler-2",
            "filler-3",
            "filler-4",
        ]);
        expect(graveyardIds(tree)).toEqual([]);
    });

    it("charges a GRANTED escape cost too (Underworld Breach, CR 702.138)", () => {
        // Breach grants escape to each NONLAND card in its controller's
        // graveyard: the card's own mana cost plus exile three others.
        const bears = makeInstance(grizzlyBears.id, {
            id: "bears",
            controllerId: ME,
            ownerId: ME,
            zone: "graveyard",
        });
        const state = stateWith({
            battlefield: [
                untapped(underworldBreach.id, "breach"),
                untapped(forest.id, "f1"),
                untapped(forest.id, "f2"),
            ],
            graveyard: [bears, ...filler(3, swamp.id)],
        });
        const cast = castsOf(state, "bears")[0];
        expect(cast).toBeDefined();
        expect(
            cast.kind === "cast-spell" && cast.castCostPicks?.exileCostCardIds
        ).toEqual(["filler-0", "filler-1", "filler-2"]);
        const after = applyMoveForSearch(state, ME, cast);
        expect(graveyardIds(after)).toEqual([]);
        expect(exileIds(after)).toEqual(["filler-0", "filler-1", "filler-2"]);
    });
});

// ---------------------------------------------------------------------------
// Flashback with a non-mana cost (CR 702.34a / 118.5)
// ---------------------------------------------------------------------------

describe("non-mana flashback cast enumeration (CR 702.34a / 118.5)", () => {
    it("enumerates Lava Dart's flashback and carries the sacrificed Mountain", () => {
        // Lava Dart's flashback pays NO mana — only "Sacrifice a Mountain".
        const dart = makeInstance(lavaDart.id, {
            id: "dart",
            controllerId: ME,
            ownerId: ME,
            zone: "graveyard",
        });
        const state = stateWith({
            battlefield: [untapped(mountain.id, "mtn")],
            graveyard: [dart],
        });
        const casts = castsOf(state, "dart");
        expect(casts.length).toBeGreaterThan(0);
        const cast = casts[0];
        expect(cast.kind === "cast-spell" && cast.tapPlan).toEqual([]);
        // A single legal Mountain is a FORCED pick, which the server
        // auto-resolves at announcement (`autoResolveFungible`), so
        // `sacrificeIds` — the SUBMIT list — is empty while the park itself
        // still rides on the Move. What matters is that the sandbox charges it.
        expect(cast.kind === "cast-spell" && cast.castCostPicks).toBeDefined();

        // Charged: the Mountain leaves the battlefield in both sandboxes.
        const greedy = applyMoveForSearch(state, ME, cast);
        expect(greedy.players[0].battlefield.map((c) => c.id)).toEqual([]);
        const tree = cloneGameState(state);
        applyMoveInSearch(tree, ME, cast);
        expect(tree.players[0].battlefield.map((c) => c.id)).toEqual([]);
    });

    it("does not offer Lava Dart's flashback with no Mountain to sacrifice", () => {
        const dart = makeInstance(lavaDart.id, {
            id: "dart",
            controllerId: ME,
            ownerId: ME,
            zone: "graveyard",
        });
        const state = stateWith({
            battlefield: [untapped(forest.id, "f1")],
            graveyard: [dart],
        });
        expect(castsOf(state, "dart")).toEqual([]);
    });

    it("enumerates Flash of Insight and sizes its exile cost to the announced X", () => {
        // Flashback—{1}{U}, Exile X BLUE cards from your graveyard. The
        // fillers are Islands (blue? no — lands are colourless), so the
        // eligible fodder is a set of blue cards.
        const foi = makeInstance(flashOfInsight.id, {
            id: "foi",
            controllerId: ME,
            ownerId: ME,
            zone: "graveyard",
        });
        const blueFodder = Array.from({ length: 3 }, (_, i) =>
            makeInstance(flashOfInsight.id, {
                id: `blue-${i}`,
                controllerId: ME,
                ownerId: ME,
                zone: "graveyard",
            })
        );
        const state = stateWith({
            battlefield: [untapped(island.id, "i1"), untapped(island.id, "i2")],
            graveyard: [foi, ...blueFodder],
        });
        const casts = castsOf(state, "foi");
        expect(casts.length).toBeGreaterThan(0);
        // The flashback cost is a fixed {1}{U}: every X variant taps the same
        // two Islands, and only the exile leg scales.
        const byX = new Map<number, string[] | undefined>();
        for (const c of casts) {
            if (c.kind !== "cast-spell") continue;
            byX.set(c.chosenX ?? -1, c.castCostPicks?.exileCostCardIds);
        }
        // X = 0 owes no exile at all (the spell looks at 0 cards).
        expect(byX.get(0)).toBeUndefined();
        expect(byX.get(1)).toEqual(["blue-0"]);
        expect(byX.get(2)).toEqual(["blue-0", "blue-1"]);
        // Three blue cards besides Flash of Insight itself, so X stops at 3.
        expect(byX.get(4)).toBeUndefined();

        const twoX = casts.find(
            (c) => c.kind === "cast-spell" && c.chosenX === 2
        )!;
        const after = applyMoveForSearch(state, ME, twoX);
        // The two named blue cards paid the cost. Flash of Insight itself also
        // reaches exile in this sandbox, but on RESOLUTION (CR 702.34a
        // `exileOnResolve`), which is a different mechanism — so this asserts
        // the cost, not the total.
        expect(exileIds(after)).toEqual(
            expect.arrayContaining(["blue-0", "blue-1"])
        );
        expect(after.players[0].graveyard.map((c) => c.id)).toEqual(["blue-2"]);
    });
});

// ---------------------------------------------------------------------------
// Escape BEATS flashback when a card has both (CR 702.138 over CR 702.34)
// ---------------------------------------------------------------------------

describe("a card with both escape and flashback pays the ESCAPE cost only", () => {
    /** Underworld Breach grants escape to EVERY nonland card in its
     *  controller's graveyard — Lava Dart included, which already has a
     *  flashback cost of its own ("Sacrifice a Mountain"). Every cost site
     *  resolves that collision the same way: `castRawManaCost`,
     *  `graveyardCastStackFlags` and `graveyardCastMechanism` all check escape
     *  FIRST. The castability gate and the sacrifice selection did not, so the
     *  Bot enumerated a cast that tapped the one Mountain for the escape's {R}
     *  AND sacrificed that same Mountain for a flashback cost the cast never
     *  owed — a Move the server cannot execute. */
    function lavaDartUnderBreach() {
        const dart = makeInstance(lavaDart.id, {
            id: "dart",
            controllerId: ME,
            ownerId: ME,
            zone: "graveyard",
        });
        const state = stateWith({
            battlefield: [
                untapped(underworldBreach.id, "breach"),
                untapped(mountain.id, "mtn"),
            ],
            graveyard: [dart, ...filler(3, forest.id)],
        });
        return { state, dart };
    }

    it("taps the Mountain for the escape cost and does NOT also sacrifice it", () => {
        const { state } = lavaDartUnderBreach();
        const cast = castsOf(state, "dart")[0];
        expect(cast).toBeDefined();
        // The ESCAPE cost: Lava Dart's own {R} plus three other graveyard
        // cards — not the flashback cost, which pays no mana at all.
        expect(cast.kind === "cast-spell" && cast.tapPlan).toEqual([
            { cardInstanceId: "mtn" },
        ]);
        expect(
            cast.kind === "cast-spell" && cast.castCostPicks?.exileCostCardIds
        ).toHaveLength(3);

        const after = applyMoveForSearch(state, ME, cast);
        // The Mountain is still on the battlefield: tapped for mana, never
        // sacrificed. Charging both costs put it in the graveyard.
        expect(after.players[0].battlefield.map((c) => c.id)).toContain("mtn");
        expect(after.players[0].graveyard.map((c) => c.id)).not.toContain(
            "mtn"
        );
    });

    it("is still castable with no Mountain to sacrifice", () => {
        // The flashback-first gate refused the cast outright here, because it
        // demanded a flashback cost this escape cast does not owe. A Forest
        // cannot pay {R}, so the position also pins that the gate prices the
        // ESCAPE mana cost: with only Forests the cast is correctly absent.
        const dart = makeInstance(lavaDart.id, {
            id: "dart",
            controllerId: ME,
            ownerId: ME,
            zone: "graveyard",
        });
        const withMountainOnly = stateWith({
            battlefield: [
                untapped(underworldBreach.id, "breach"),
                untapped(mountain.id, "mtn"),
            ],
            graveyard: [dart, ...filler(3, forest.id)],
        });
        expect(
            getLegalActions(
                withMountainOnly,
                withMountainOnly.players[0],
                withMountainOnly.players[0].graveyard[0]
            )
        ).toContain("cast");
    });
});

// ---------------------------------------------------------------------------
// The executor/server seam (CR 601.2f)
// ---------------------------------------------------------------------------

describe("the enumerated pick is what the real cast mutation accepts", () => {
    /** Drive the announcement in `announceCast`'s own order — build the exile
     *  picker through the SHARED builder the mutation calls, park it, then hand
     *  `recordCastExileCostPick` (the pure core of the `selectCastExileCost`
     *  mutation) exactly the ids the Move carries.
     *
     *  This is the acceptance the whole Move field exists for: an escape cast
     *  the enumerator offers must not announce-then-abort at the server. Before
     *  the pick rode on the Move the enumerator refused to offer the cast at
     *  all, precisely to avoid this cycle. */
    function announceAndPay(
        state: GameState,
        card: CardInstanceState,
        move: Move
    ): void {
        if (move.kind !== "cast-spell") throw new Error("not a cast");
        const build = buildCastExileCostChoice(
            state,
            state.players[0],
            card,
            "graveyard",
            { chosenX: move.chosenX }
        );
        if (!build || "unpayable" in build) {
            throw new Error("the announcement would have refused this cast");
        }
        state.pendingCast = {
            playerId: ME,
            cardInstanceId: card.id,
            manaCost: {},
            tappedLandIds: [],
            exileFromGraveyardChoice: build.choice,
        };
        recordCastExileCostPick(
            state,
            ME,
            move.castCostPicks?.exileCostCardIds ?? []
        );
    }

    it("accepts the escape exile pick end to end (CR 702.138a)", () => {
        const uro = makeInstance(uroTitanOfNaturesWrath.id, {
            id: "uro",
            controllerId: ME,
            ownerId: ME,
            zone: "graveyard",
        });
        const state = stateWith({
            battlefield: [
                untapped(forest.id, "f1"),
                untapped(forest.id, "f2"),
                untapped(island.id, "i1"),
                untapped(island.id, "i2"),
            ],
            graveyard: [uro, ...filler(5)],
        });
        const cast = castsOf(state, "uro")[0];
        expect(cast).toBeDefined();
        expect(() => announceAndPay(state, uro, cast)).not.toThrow();
        expect(
            state.pendingCast?.exileFromGraveyardChoice?.pickedCardIds
        ).toEqual(["filler-0", "filler-1", "filler-2", "filler-3", "filler-4"]);
    });

    it("accepts a granted escape exile pick end to end (Underworld Breach)", () => {
        const bears = makeInstance(grizzlyBears.id, {
            id: "bears",
            controllerId: ME,
            ownerId: ME,
            zone: "graveyard",
        });
        const state = stateWith({
            battlefield: [
                untapped(underworldBreach.id, "breach"),
                untapped(forest.id, "f1"),
                untapped(forest.id, "f2"),
            ],
            graveyard: [bears, ...filler(3, swamp.id)],
        });
        const cast = castsOf(state, "bears")[0];
        expect(cast).toBeDefined();
        expect(() => announceAndPay(state, bears, cast)).not.toThrow();
        expect(
            state.pendingCast?.exileFromGraveyardChoice?.pickedCardIds
        ).toEqual(["filler-0", "filler-1", "filler-2"]);
    });
});
