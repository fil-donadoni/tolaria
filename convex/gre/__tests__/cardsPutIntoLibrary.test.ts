// CARDS_PUT_INTO_LIBRARY emission (issue #3242, CR 603.2c) — the choke points
// in `gre/state.ts` and their batching. "Whenever one or more cards are put into
// a library from anywhere" (Wan Shi Tong, All-Knowing) triggers once per event,
// and one resolving instruction is one event however many cards it moves. This
// suite proves every route into a library emits, that each instruction emits
// once, and that the non-routes — a library-internal reorder (the official Wan
// Shi Tong ruling) and game setup — emit nothing.
import { describe, it, expect, beforeAll } from "vitest";
import {
    buildSpellContext,
    flushPendingEvents,
    resolveTopOfStack,
    withCardsPutIntoLibraryBatch,
    type CardInstanceState,
    type GameState,
} from "../state";
import { registerTokenDefinition } from "../../cards";
import type { GameEvent } from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup";
import {
    applyMulliganBottomChoice,
    makeMulliganState,
    recordDeclaration,
} from "../mulligan";
import type { Phase } from "../types";
import { wanShiTongAllKnowing } from "../../cards/sets/tla/blue";

const CREATURE_ID = "test-library-entry-creature";
const SORCERY_ID = "test-library-entry-sorcery";
const SWEEP_ID = "test-library-entry-sweep";
const WAN_SHI_TONG_SPIRITS = "wan-shi-tong-all-knowing-library-spirits";
// Time Spiral (USG 103) — a `resolveSteps` card: its first step calls
// `ctx.moveZone` hand→library and graveyard→library for each player.
const TIME_SPIRAL_ID = "f3d62dbd-63db-4ac9-950f-9852627f23f2";

beforeAll(() => {
    registerTokenDefinition({
        id: CREATURE_ID,
        name: "Test Library Entry Creature",
        rarity: "common",
        types: ["Creature"],
        power: 2,
        toughness: 2,
    });
    registerTokenDefinition({
        id: SORCERY_ID,
        name: "Test Library Entry Sorcery",
        rarity: "common",
        types: ["Sorcery"],
    });
    // One Op that moves several cards one at a time (the `fromZones` sweep
    // loops `moveCardById`) — the shape only the interpreter's per-Op batch
    // folds into one event.
    registerTokenDefinition({
        id: SWEEP_ID,
        name: "Test Library Entry Sweep",
        rarity: "common",
        types: ["Sorcery"],
        effects: [
            {
                op: "moveZone",
                player: "controller",
                fromZones: ["graveyard", "hand"],
                filter: { type: "Creature" },
                to: "library",
            },
        ],
    });
});

function creature(
    id: string,
    ownerId: string,
    zone: CardInstanceState["zone"],
    controllerId = ownerId
): CardInstanceState {
    return makeInstance(CREATURE_ID, { id, ownerId, controllerId, zone });
}

function libraryEvents(
    events: GameEvent[]
): Extract<GameEvent, { type: "CARDS_PUT_INTO_LIBRARY" }>[] {
    return events.filter(
        (e): e is Extract<GameEvent, { type: "CARDS_PUT_INTO_LIBRARY" }> =>
            e.type === "CARDS_PUT_INTO_LIBRARY"
    );
}

function contextFor(state: GameState) {
    return buildSpellContext(state, pushSpell(state, SORCERY_ID, "p1"));
}

describe("CARDS_PUT_INTO_LIBRARY emission (issue #3242, CR 603.2c)", () => {
    it("a battlefield permanent put into its OWNER's library is one event from the battlefield", () => {
        const stolen = creature("stolen", "p2", "battlefield", "p1");
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [stolen] }),
                makePlayer("p2", {
                    library: [creature("l1", "p2", "library")],
                }),
            ],
        });
        contextFor(state).putIntoLibraryFromBattlefield(
            { type: "permanent", id: "stolen" },
            2
        );
        expect(state.players[1].library.map((c) => c.id)).toEqual([
            "l1",
            "stolen",
        ]);
        const events = libraryEvents(flushPendingEvents(state));
        expect(events).toHaveLength(1);
        expect(events[0].cards).toEqual([
            {
                cardInstanceId: "stolen",
                cardId: CREATURE_ID,
                fromZone: "battlefield",
                ownerId: "p2",
            },
        ]);
    });

    it("moveCardsById: three graveyard cards into a library are ONE event carrying three cards", () => {
        const graveyard = ["g1", "g2", "g3"].map((id) =>
            creature(id, "p1", "graveyard")
        );
        const state = makeState({
            players: [makePlayer("p1", { graveyard }), makePlayer("p2")],
        });
        contextFor(state).moveCardsById(
            "p1",
            ["g1", "g2", "g3"],
            "graveyard",
            "library"
        );
        const events = libraryEvents(flushPendingEvents(state));
        expect(events).toHaveLength(1);
        expect(events[0].cards.map((c) => c.cardInstanceId)).toEqual([
            "g1",
            "g2",
            "g3",
        ]);
        expect(events[0].cards.every((c) => c.fromZone === "graveyard")).toBe(
            true
        );
    });

    it("a whole graveyard put on the bottom (a shuffle-in, decided to count) is one event", () => {
        const graveyard = ["g1", "g2"].map((id) =>
            creature(id, "p1", "graveyard")
        );
        const state = makeState({
            players: [makePlayer("p1", { graveyard }), makePlayer("p2")],
        });
        contextFor(state).putGraveyardOnBottomOfLibrary("p1");
        const events = libraryEvents(flushPendingEvents(state));
        expect(events).toHaveLength(1);
        expect(events[0].cards).toHaveLength(2);
    });

    it("a hand card put on top of its library is one event from the hand", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { hand: [creature("h1", "p1", "hand")] }),
                makePlayer("p2"),
            ],
        });
        contextFor(state).moveHandCardToLibraryTop("p1", "h1");
        const events = libraryEvents(flushPendingEvents(state));
        expect(events).toHaveLength(1);
        expect(events[0].cards[0]).toMatchObject({
            cardInstanceId: "h1",
            fromZone: "hand",
        });
    });

    it("a countered spell put on top of its owner's library is one event from the stack", () => {
        const state = makeState();
        const countered = pushSpell(state, SORCERY_ID, "p2");
        const ctx = buildSpellContext(
            state,
            pushSpell(state, SORCERY_ID, "p1")
        );
        ctx.counter({ type: "spell", id: countered.id }, "library-top");
        expect(state.players[1].library[0].id).toBe(countered.id);
        const events = libraryEvents(flushPendingEvents(state));
        expect(events).toHaveLength(1);
        expect(events[0].cards[0]).toMatchObject({
            cardInstanceId: countered.id,
            fromZone: "stack",
            ownerId: "p2",
        });
    });

    it("reordering cards already in a library emits nothing (scry, surveil, a shuffle — the Wan Shi Tong ruling)", () => {
        const library = ["l1", "l2", "l3"].map((id) =>
            creature(id, "p1", "library")
        );
        const state = makeState({
            players: [makePlayer("p1", { library }), makePlayer("p2")],
        });
        const ctx = contextFor(state);
        ctx.putLibraryCardsOnTop("p1", ["l3"]);
        ctx.shuffleLibrary("p1");
        expect(libraryEvents(flushPendingEvents(state))).toHaveLength(0);
    });

    it("an open batch folds every entry into one event; unbatched moves are one event each", () => {
        const graveyard = ["g1", "g2", "g3", "g4"].map((id) =>
            creature(id, "p1", "graveyard")
        );
        const state = makeState({
            players: [makePlayer("p1", { graveyard }), makePlayer("p2")],
        });
        const ctx = contextFor(state);
        withCardsPutIntoLibraryBatch(state, () => {
            ctx.moveCardById("p1", "g1", "graveyard", "library");
            // A nested batch joins the outer one.
            ctx.withCardsPutIntoLibraryBatch(() =>
                ctx.moveCardById("p1", "g2", "graveyard", "library")
            );
        });
        ctx.moveCardById("p1", "g3", "graveyard", "library");
        ctx.moveCardById("p1", "g4", "graveyard", "library");
        const events = libraryEvents(flushPendingEvents(state));
        expect(events.map((e) => e.cards.map((c) => c.cardInstanceId))).toEqual(
            [["g1", "g2"], ["g3"], ["g4"]]
        );
    });

    it("a mulligan put-back (game setup, CR 103.5) emits nothing", () => {
        const buildPlayer = (id: string) => {
            const library = Array.from({ length: 20 }, (_, i) =>
                creature(`${id}-card-${i}`, id, "library")
            );
            const hand = library
                .splice(0, 7)
                .map((c) => ({ ...c, zone: "hand" as const }));
            return makePlayer(id, { hand, library });
        };
        const state = makeState({
            players: [buildPlayer("p1"), buildPlayer("p2")],
            phase: "MULLIGAN" as Phase,
            rngSeed: 1,
            rngCounter: 0,
        });
        state.mulligan = makeMulliganState(state);
        recordDeclaration(state, "p1", "mull");
        recordDeclaration(state, "p2", "keep");
        recordDeclaration(state, "p1", "keep");
        flushPendingEvents(state);
        applyMulliganBottomChoice(state, [state.players[0].hand[0].id]);
        expect(libraryEvents(flushPendingEvents(state))).toHaveLength(0);
    });

    it("a resolveSteps closure step is one instruction too: Time Spiral's four zone moves trigger a library watcher ONCE", () => {
        const watcher = makeInstance(wanShiTongAllKnowing.id, {
            id: "watcher",
            controllerId: "p1",
            ownerId: "p1",
        });
        const deck = (owner: string) =>
            Array.from({ length: 10 }, (_, i) =>
                creature(`${owner}-lib-${i}`, owner, "library")
            );
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [watcher],
                    hand: [creature("h1", "p1", "hand")],
                    graveyard: [creature("g1", "p1", "graveyard")],
                    library: deck("p1"),
                }),
                makePlayer("p2", {
                    hand: [creature("h2", "p2", "hand")],
                    graveyard: [creature("g2", "p2", "graveyard")],
                    library: deck("p2"),
                }),
            ],
        });
        pushSpell(state, TIME_SPIRAL_ID, "p1");
        resolveTopOfStack(state);
        const triggers = state.stack.filter(
            (item) => item.triggeredAbilityId === WAN_SHI_TONG_SPIRITS
        );
        expect(triggers).toHaveLength(1);
    });

    it("one Effect Script Op is one instruction: a three-card sweep triggers a library watcher ONCE", () => {
        const watcher = makeInstance(wanShiTongAllKnowing.id, {
            id: "watcher",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [watcher],
                    graveyard: [
                        creature("g1", "p1", "graveyard"),
                        creature("g2", "p1", "graveyard"),
                    ],
                    hand: [creature("h1", "p1", "hand")],
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, SWEEP_ID, "p1");
        resolveTopOfStack(state);
        expect(state.players[0].library).toHaveLength(3);
        const triggers = state.stack.filter(
            (item) => item.triggeredAbilityId === WAN_SHI_TONG_SPIRITS
        );
        expect(triggers).toHaveLength(1);
    });
});
