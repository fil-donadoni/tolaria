// CARD_LEFT_GRAVEYARD full path (issue #9423, CR 603.10a / 603.2c / 702.66):
// GRE → game.ts → wire.
//
// A delve cast is the graveyard exit a real game reaches most often (Murktide
// Regent's own deck: Treasure Cruise / Murktide delve, then grow). This drives
// the exact functions the `announceCast` / `selectCastExileCost` mutations
// call — `recordCastExileCostPick` and `tryAutoCommitPendingCast` — with a
// Murktide-shaped watcher on the battlefield, and checks that:
//   - each exiled instant/sorcery card triggers the watcher ONCE (CR 603.2c),
//     the creature card fuel not at all;
//   - the triggers reach the client projection with their ability id, which
//     is what the stack UI looks the ability text up by.
import { describe, it, expect } from "vitest";
import { recordCastExileCostPick, tryAutoCommitPendingCast } from "../game";
import {
    processPendingActionTriggers,
    resolveTopOfStack,
    type PendingCast,
} from "../gre/state";
import { projectPublicState } from "../gameProjections";
import { getCardByName, getDefinition } from "../cards";
import { withTemporaryDefinition } from "../cards/registry";
import { cardLeftGraveyardTrigger } from "../cards/abilities/triggers/cardLeftGraveyardTrigger";
import type { CardDefinition } from "../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../cards/__tests__/setup.helper";

const TREASURE_CRUISE = getCardByName("Treasure Cruise").id; // {7}{U}, delve
const BOLT = getCardByName("Lightning Bolt").id; // Instant
const BEARS = getCardByName("Grizzly Bears").id; // Creature
const ISLAND = getCardByName("Island").id;

const WATCHER_ID = "test-9423-delve-watcher";
function watcher(): CardDefinition {
    return {
        ...getDefinition(BEARS),
        id: WATCHER_ID,
        name: "Delve Watcher (test)",
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

function p1(
    defId: string,
    id: string,
    zone: "hand" | "graveyard" | "battlefield"
) {
    return makeInstance(defId, { id, controllerId: "p1", ownerId: "p1", zone });
}

/** Treasure Cruise parked on `pendingCast` with its delve picker open, two
 *  instants and a creature card in the graveyard, the watcher in play. */
function parkedDelve() {
    const state = makeState({
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        phase: "PRECOMBAT_MAIN",
        players: [
            makePlayer("p1", {
                hand: [p1(TREASURE_CRUISE, "cruise", "hand")],
                battlefield: [
                    p1(WATCHER_ID, "w", "battlefield"),
                    p1(ISLAND, "isle", "battlefield"),
                ],
                graveyard: [
                    p1(BOLT, "i1", "graveyard"),
                    p1(BOLT, "i2", "graveyard"),
                    p1(BEARS, "k", "graveyard"),
                ],
            }),
            makePlayer("p2"),
        ],
    });
    const pendingCast: PendingCast = {
        playerId: "p1",
        cardInstanceId: "cruise",
        manaCost: { X: 7, U: 1 },
        tappedLandIds: [],
        exileFromGraveyardChoice: {
            count: 0,
            excludeInstanceId: "cruise",
            offsetGeneric: { min: 0, max: 3 },
        },
    };
    state.pendingCast = pendingCast;
    state.players[0].manaPool = { W: 0, U: 5, B: 0, R: 0, G: 0, C: 0 };
    return state;
}

describe("CARD_LEFT_GRAVEYARD — delve cast through game.ts (issue #9423)", () => {
    it("each exiled instant triggers the watcher once; the creature card does not", () => {
        withTemporaryDefinition(watcher(), () => {
            const state = parkedDelve();
            recordCastExileCostPick(state, "p1", ["i1", "i2", "k"]);
            tryAutoCommitPendingCast(state, "p1");
            expect(state.players[0].graveyard).toHaveLength(0);

            processPendingActionTriggers(state);
            const triggers = state.stack.filter(
                (s) => s.triggeredAbilityId === "watcher-grow"
            );
            expect(triggers).toHaveLength(2);

            // Wire: the triggers cross the projection with their ability id.
            const view = projectPublicState(state, 1, "p1");
            const wired = view.stack.filter(
                (s) => s.triggeredAbilityId === "watcher-grow"
            );
            expect(wired).toHaveLength(2);

            resolveTopOfStack(state);
            resolveTopOfStack(state);
            const w = state.players[0].battlefield.find((c) => c.id === "w")!;
            expect(w.counters?.["+1/+1"]).toBe(2);
        });
    });
});
