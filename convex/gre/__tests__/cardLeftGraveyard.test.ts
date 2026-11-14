// CARD_LEFT_GRAVEYARD (issue #9423, CR 603.10a / 603.2c) — the trigger event
// for "whenever an instant or sorcery card leaves your graveyard" (Murktide
// Regent).
//
// Two claims, one per describe:
//   1. EMISSION — every graveyard exit emits one event per card, from the same
//      chokepoint that keeps the per-turn tally (`noteGraveyardDeparture`), so
//      the event count and the tally can never disagree. The census walked
//      here is the chokepoint's own: `moveCard`, `removeFromZone` (a cast),
//      `exileFaceDownCard`, `exileCardFromGraveyard`, both reanimation
//      funnels, and the whole-graveyard bulk sweep.
//   2. TRIGGER — `cardLeftGraveyardTrigger` fires once per qualifying card
//      (CR 603.2c), reads the card as it last existed in the graveyard and
//      skips a source that was not on the battlefield when the card left
//      (CR 603.10a look-back).
import { describe, it, expect } from "vitest";
import {
    buildSpellContext,
    exileCardFromGraveyard,
    exileFaceDownCard,
    flushPendingEvents,
    moveCard,
    processPendingActionTriggers,
    removeFromZone,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
} from "../state";
import { collectTriggers } from "../triggers";
import { getCardByName, getDefinition } from "../../cards";
import { withTemporaryDefinition } from "../../cards/registry";
import { cardLeftGraveyardTrigger } from "../../cards/abilities/triggers/cardLeftGraveyardTrigger";
import type {
    CardDefinition,
    CardLeftGraveyardEvent,
    GameEvent,
} from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";

const BOLT = getCardByName("Lightning Bolt").id; // Instant
const CRUISE = getCardByName("Treasure Cruise").id; // Sorcery
const BEARS = getCardByName("Grizzly Bears").id; // Creature

/** A Murktide-shaped creature: "Whenever an instant or sorcery card leaves your
 *  graveyard, put a +1/+1 counter on this creature." */
const WATCHER_ID = "test-9423-graveyard-watcher";
function watcher(): CardDefinition {
    return {
        ...getDefinition(BEARS),
        id: WATCHER_ID,
        name: "Graveyard Watcher (test)",
        triggeredAbilities: [
            cardLeftGraveyardTrigger({
                id: "watcher-grow",
                oracleText:
                    "Whenever an instant or sorcery card leaves your graveyard, put a +1/+1 counter on this creature.",
                graveyard: "yours",
                cardTypes: ["Instant", "Sorcery"],
                effects: [
                    {
                        op: "counters",
                        action: "add",
                        counter: "+1/+1",
                        target: { ref: "$source" },
                        count: 1,
                    },
                ],
            }),
        ],
    };
}

function card(
    defId: string,
    id: string,
    ownerId: string,
    zone: CardInstanceState["zone"]
): CardInstanceState {
    return makeInstance(defId, { id, controllerId: ownerId, ownerId, zone });
}

function board(
    p1: { graveyard?: CardInstanceState[]; battlefield?: CardInstanceState[] },
    p2Graveyard: CardInstanceState[] = []
): GameState {
    return makeState({
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        phase: "PRECOMBAT_MAIN",
        players: [
            makePlayer("p1", {
                graveyard: p1.graveyard ?? [],
                battlefield: p1.battlefield ?? [],
            }),
            makePlayer("p2", { graveyard: p2Graveyard }),
        ],
    });
}

function departures(events: readonly GameEvent[]): CardLeftGraveyardEvent[] {
    return events.filter(
        (e): e is CardLeftGraveyardEvent => e.type === "CARD_LEFT_GRAVEYARD"
    );
}

function spellCtx(state: GameState) {
    state.stack.push({
        ...card(BOLT, `ctx-${state.stack.length}`, "p1", "stack"),
        castById: "p1",
    });
    return buildSpellContext(state, state.stack[state.stack.length - 1]);
}

describe("CARD_LEFT_GRAVEYARD emission (issue #9423, CR 400.7)", () => {
    it("moveCard emits one event naming the destination and the graveyard types", () => {
        for (const to of ["exile", "hand", "library", "battlefield"] as const) {
            const state = board({
                graveyard: [card(BOLT, "b", "p1", "graveyard")],
            });
            moveCard(state.players[0], "b", "graveyard", to, state);
            const [ev, ...rest] = departures(state.pendingEvents ?? []);
            expect(rest).toHaveLength(0);
            expect(ev).toMatchObject({
                ownerId: "p1",
                cardInstanceId: "b",
                cardId: BOLT,
                toZone: to,
                types: ["Instant"],
            });
        }
    });

    it("a move that never leaves the graveyard emits nothing", () => {
        const state = board({});
        state.players[0].hand.push(card(BOLT, "h", "p1", "hand"));
        moveCard(state.players[0], "h", "hand", "graveyard");
        expect(departures(state.pendingEvents ?? [])).toHaveLength(0);
    });

    it("a cast from the graveyard emits with toZone stack (removeFromZone)", () => {
        const state = board({
            graveyard: [card(CRUISE, "c", "p1", "graveyard")],
        });
        removeFromZone(state, state.players[0], "c", "graveyard", "p1");
        expect(departures(state.pendingEvents ?? [])).toMatchObject([
            { cardInstanceId: "c", toZone: "stack", types: ["Sorcery"] },
        ]);
    });

    it("the face-down exile and the exile-cost primitive emit too", () => {
        const state = board({
            graveyard: [
                card(BOLT, "a", "p1", "graveyard"),
                card(BOLT, "b", "p1", "graveyard"),
            ],
        });
        exileFaceDownCard(
            state.players[0],
            "a",
            "graveyard",
            "p1",
            "face-down-exile",
            state
        );
        exileCardFromGraveyard(state, state.players[0], "b");
        expect(
            departures(state.pendingEvents ?? []).map((e) => [
                e.cardInstanceId,
                e.toZone,
            ])
        ).toEqual([
            ["a", "exile"],
            ["b", "exile"],
        ]);
    });

    it("the bulk sweep emits one event PER CARD, never one per sweep (CR 603.2c)", () => {
        const state = board({
            graveyard: [
                card(BOLT, "a", "p1", "graveyard"),
                card(CRUISE, "b", "p1", "graveyard"),
                card(BEARS, "c", "p1", "graveyard"),
            ],
        });
        spellCtx(state).putGraveyardOnBottomOfLibrary("p1");
        const evs = departures(state.pendingEvents ?? []);
        expect(evs.map((e) => e.cardInstanceId).sort()).toEqual([
            "a",
            "b",
            "c",
        ]);
        expect(evs.every((e) => e.toZone === "library")).toBe(true);
    });

    it("the event count equals the tally on every path", () => {
        const state = board({
            graveyard: ["a", "b", "c", "d", "e"].map((id) =>
                card(BEARS, id, "p1", "graveyard")
            ),
        });
        const ctx = spellCtx(state);
        moveCard(state.players[0], "a", "graveyard", "exile", state);
        ctx.returnToBattlefield("p1", "b", "graveyard");
        ctx.returnCardSetToBattlefield([
            { playerId: "p1", cardInstanceId: "c" },
            { playerId: "p1", cardInstanceId: "d" },
        ]);
        ctx.putGraveyardOnBottomOfLibrary("p1");
        expect(departures(state.pendingEvents ?? [])).toHaveLength(
            state.players[0].leftGraveyardThisTurn ?? 0
        );
        expect(state.players[0].leftGraveyardThisTurn).toBe(5);
    });

    it("a simultaneous set return names its whole cohort on each departure (CR 603.10a)", () => {
        const state = board(
            { graveyard: [card(BEARS, "a", "p1", "graveyard")] },
            [card(BEARS, "z", "p2", "graveyard")]
        );
        spellCtx(state).returnCardSetToBattlefield([
            { playerId: "p1", cardInstanceId: "a" },
            { playerId: "p2", cardInstanceId: "z" },
        ]);
        const evs = departures(state.pendingEvents ?? []);
        expect(evs.map((e) => e.ownerId)).toEqual(["p1", "p2"]);
        for (const e of evs) expect(e.battlefieldCohort).toEqual(["a", "z"]);
    });

    it("a single reanimation carries no cohort", () => {
        const state = board({
            graveyard: [card(BEARS, "a", "p1", "graveyard")],
        });
        spellCtx(state).returnToBattlefield("p1", "a", "graveyard");
        const [ev] = departures(state.pendingEvents ?? []);
        expect(ev.toZone).toBe("battlefield");
        expect(ev.battlefieldCohort).toBeUndefined();
    });
});

describe("cardLeftGraveyardTrigger (issue #9423, CR 603.10a / 603.2c)", () => {
    function triggersFor(state: GameState): number {
        return collectTriggers(state, flushPendingEvents(state)).filter(
            (t) => t.triggeredAbilityId === "watcher-grow"
        ).length;
    }

    it("fires once per instant or sorcery card that leaves YOUR graveyard", () => {
        withTemporaryDefinition(watcher(), () => {
            const state = board(
                {
                    battlefield: [card(WATCHER_ID, "w", "p1", "battlefield")],
                    graveyard: [
                        card(BOLT, "i", "p1", "graveyard"),
                        card(CRUISE, "s", "p1", "graveyard"),
                        card(BEARS, "k", "p1", "graveyard"),
                    ],
                },
                [card(BOLT, "opp-i", "p2", "graveyard")]
            );
            // Both qualifying cards, the creature card, and an opponent's instant.
            spellCtx(state).putGraveyardOnBottomOfLibrary("p1");
            moveCard(state.players[1], "opp-i", "graveyard", "exile", state);
            expect(triggersFor(state)).toBe(2);
        });
    });

    it("judges the card by its graveyard types, whatever it became (a cast)", () => {
        withTemporaryDefinition(watcher(), () => {
            const state = board({
                battlefield: [card(WATCHER_ID, "w", "p1", "battlefield")],
                graveyard: [card(CRUISE, "s", "p1", "graveyard")],
            });
            const spell = removeFromZone(
                state,
                state.players[0],
                "s",
                "graveyard",
                "p1"
            );
            // The new object on the stack no longer reads as a graveyard card.
            spell.types = [];
            expect(triggersFor(state)).toBe(1);
        });
    });

    it("a source that left the graveyard itself does not see its own departure", () => {
        const def = watcher();
        const anyCard: CardDefinition = {
            ...def,
            triggeredAbilities: [
                cardLeftGraveyardTrigger({
                    id: "watcher-grow",
                    oracleText: "Whenever a card leaves your graveyard, …",
                    graveyard: "yours",
                    effects: [],
                }),
            ],
        };
        withTemporaryDefinition(anyCard, () => {
            const state = board({
                graveyard: [
                    card(WATCHER_ID, "w1", "p1", "graveyard"),
                    card(WATCHER_ID, "w2", "p1", "graveyard"),
                ],
            });
            // Single reanimation: w1 was not on the battlefield as it left.
            spellCtx(state).returnToBattlefield("p1", "w1", "graveyard");
            expect(triggersFor(state)).toBe(0);
            // Now w1 IS on the battlefield; w2 and the bear leave together,
            // so only w1 sees them — w2 is in the cohort.
            state.players[0].graveyard.push(
                card(BEARS, "k", "p1", "graveyard")
            );
            spellCtx(state).returnCardSetToBattlefield([
                { playerId: "p1", cardInstanceId: "w2" },
                { playerId: "p1", cardInstanceId: "k" },
            ]);
            expect(triggersFor(state)).toBe(2);
        });
    });

    it("a token is not a card (CR 108.2b)", () => {
        withTemporaryDefinition(watcher(), () => {
            const token = {
                ...card(BOLT, "t", "p1", "graveyard"),
                isToken: true,
            };
            const state = board({
                battlefield: [card(WATCHER_ID, "w", "p1", "battlefield")],
                graveyard: [token],
            });
            moveCard(state.players[0], "t", "graveyard", "exile", state);
            expect(triggersFor(state)).toBe(0);
        });
    });

    it("resolves to a +1/+1 counter on the source", () => {
        withTemporaryDefinition(watcher(), () => {
            const state = board({
                battlefield: [card(WATCHER_ID, "w", "p1", "battlefield")],
                graveyard: [card(BOLT, "i", "p1", "graveyard")],
            });
            exileCardFromGraveyard(state, state.players[0], "i");
            processPendingActionTriggers(state);
            expect(state.stack).toHaveLength(1);
            resolveTopOfStack(state);
            const w = state.players[0].battlefield.find((c) => c.id === "w")!;
            expect(w.counters?.["+1/+1"]).toBe(1);
        });
    });
});
