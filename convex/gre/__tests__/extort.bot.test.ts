// CR 702.101a — the Bot's seam on extort: the payment owes taps. The pool is empty
// when the trigger resolves (CR 608.2g lets the payer tap first), so an accept with
// no tap plan is an accept the Bot can never make.
import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import { preloadDefinitions } from "../../cards";
import { withTemporaryDefinition } from "../../cards/registry";
import { mountain, plains } from "../../cards/sets/lea/colorless.cards";
import type { CardDefinition } from "../../cards/types";
import { choiceCandidates } from "../ai/choiceCandidates";
import { dslRealizedAbilityValueById } from "../cardValue";
import type { Move } from "../moves";
import { applyMoveInSearch } from "../search";
import {
    emitSpellCastEvent,
    processPendingActionTriggers,
    resolveTopOfStack,
    type GameState,
} from "../state";
import { darkRitual } from "../../cards/sets/lea/black.cards";

preloadDefinitions([plains(), mountain()]);

const EXTORTER: CardDefinition = {
    id: "extort-bot-test-creature",
    name: "Extort Bot Tester",
    rarity: "common",
    manaCost: { W: 1 },
    types: ["Creature"],
    power: 1,
    toughness: 1,
    staticAbilities: ["extort"],
};

function atThePayment(landId: string): GameState {
    const state = makeState({
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", {
                battlefield: [
                    makeInstance(EXTORTER.id, {
                        id: "x",
                        controllerId: "p1",
                        ownerId: "p1",
                    }),
                    makeInstance(landId, {
                        id: "land",
                        controllerId: "p1",
                        ownerId: "p1",
                    }),
                ],
            }),
            makePlayer("p2"),
        ],
    });
    emitSpellCastEvent(state, pushSpell(state, darkRitual().id, "p1"));
    processPendingActionTriggers(state);
    resolveTopOfStack(state);
    return state;
}

const keys = (state: GameState) =>
    choiceCandidates(state, state.pendingChoices![0]).map((c) => c.key);

describe("extort, Bot choice surface (CR 702.101a / 608.2g)", () => {
    it("offers the accept, planning the tap, when an untapped land makes the colour", () => {
        withTemporaryDefinition(EXTORTER, () => {
            const state = atThePayment(plains().id);
            expect(state.players[0].manaPool.W).toBe(0);
            const accept = choiceCandidates(
                state,
                state.pendingChoices![0]
            ).find((c) => c.key === "may-pay:yes");
            expect(accept?.move).toMatchObject({
                kind: "may-pay",
                accept: true,
                tapPlan: [{ cardInstanceId: "land" }],
            });
        });
    });

    it("offers only the decline when no source makes either colour", () => {
        withTemporaryDefinition(EXTORTER, () => {
            expect(keys(atThePayment(mountain().id))).toEqual(["may-pay:no"]);
        });
    });

    it("the planned accept plays through the search's applier and drains", () => {
        withTemporaryDefinition(EXTORTER, () => {
            const state = atThePayment(plains().id);
            const accept = choiceCandidates(
                state,
                state.pendingChoices![0]
            ).find((c) => c.key === "may-pay:yes")!;
            applyMoveInSearch(state, "p1", accept.move as Move);
            expect(state.players.map((p) => p.life)).toEqual([21, 19]);
            expect(
                state.players[0].battlefield.find((c) => c.id === "land")
                    ?.isTapped
            ).toBe(true);
            expect(state.players[0].manaPool.W).toBe(0);
        });
    });

    it("prices the printed trigger above nothing", () => {
        withTemporaryDefinition(EXTORTER, () => {
            expect(dslRealizedAbilityValueById(EXTORTER.id)).toBeGreaterThan(0);
        });
    });
});
