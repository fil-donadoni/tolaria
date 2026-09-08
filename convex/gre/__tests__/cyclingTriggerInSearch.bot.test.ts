// The cycling MARKER inside the Bot's own search (issue #3118, closed by
// #3206).
//
// CR 702.29c — "When you cycle this card" means "When you discard this card to
// pay an activation cost of a cycling ability", and the ONE `CARD_DISCARDED`
// event a cycling discard emits carries that provenance as
// `cause: "cycling"` (702.29d forbids a second event). The mutation path
// (`activateAbilityOnState`, `convex/game.ts`) passed the cause; the
// SEARCH-side payment (`applyActivationCostsForSearch`, `gre/applyMove.ts`)
// did not. `COST_LEG_CLAIMS.cyclingCost` declared that as a hole and called it
// LATENT — no shipped card used `cycledTrigger`. Decree of Silence is the
// first, which makes it live: the bot would price the card as a plain cantrip
// and never see the trigger it is played for.
//
// The assertion is on the SEARCH surface, through the real enumerator and the
// real search-side application — the mutation path already had its own
// coverage and would stay green through the whole defect.

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import { applyMoveForSearch } from "../applyMove";
import { applyMoveInSearch } from "../search";
import { enumerateMoves } from "../moves";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup";
import type { Move } from "../moves";
import type { GameState } from "../state";

const DECREE = getCardByName("Decree of Silence").id;
const ISLAND = getCardByName("Island").id;
const GRIZZLY_BEARS = getCardByName("Grizzly Bears").id;
const BOT = "p1";

/** Decree in the bot's hand, six untapped Islands for {4}{U}{U}, and an
 *  opponent spell on the stack so the cycling trigger has a legal target. */
function cyclingState(): GameState {
    const state = makeState({
        players: [
            makePlayer(BOT, {
                hand: [
                    makeInstance(DECREE, {
                        id: "decree",
                        controllerId: BOT,
                        ownerId: BOT,
                        zone: "hand",
                    }),
                ],
                battlefield: Array.from({ length: 6 }, (_, i) =>
                    makeInstance(ISLAND, {
                        id: `island${i}`,
                        controllerId: BOT,
                        ownerId: BOT,
                    })
                ),
                library: Array.from({ length: 10 }, (_, i) =>
                    makeInstance(ISLAND, {
                        id: `lib${i}`,
                        controllerId: BOT,
                        ownerId: BOT,
                        zone: "library",
                    })
                ),
            }),
            makePlayer("p2"),
        ],
        activePlayerId: "p2",
        priorityPlayerId: BOT,
    });
    pushSpell(state, GRIZZLY_BEARS, "p2");
    return state;
}

function cycleMove(state: GameState): Move {
    const move = enumerateMoves(state, BOT).find(
        (m) =>
            m.kind === "activate-ability" &&
            m.cardInstanceId === "decree" &&
            m.abilityId === "cycling"
    );
    // Seam 1 — the enumerator reaches the from-hand cycling ability at all.
    expect(move, "enumerateMoves offers the cycling activation").toBeDefined();
    return move!;
}

/** Every stack item that is a TRIGGERED ability of the cycled card. */
function cycledTriggersOn(state: GameState): string[] {
    return state.stack
        .filter(
            (s) => s.triggeredAbilityId === "decree-of-silence-cycled-counter"
        )
        .map((s) => s.triggeredAbilityId!);
}

describe("cycling trigger reaches the Bot's search (CR 702.29c, issue #3118)", () => {
    it("applyMoveForSearch (greedy 1-ply sandbox) fires the cycled trigger", () => {
        const state = cyclingState();
        const next = applyMoveForSearch(state, BOT, cycleMove(state));

        const bot = next.players.find((p) => p.id === BOT)!;
        expect(bot.graveyard.map((c) => c.id)).toContain("decree");
        expect(
            cycledTriggersOn(next),
            "the cycled trigger is on the stack inside the search"
        ).toHaveLength(1);
    });

    it("applyMoveInSearch (ISMCTS tree leaf) fires it too, in place", () => {
        const state = cyclingState();
        applyMoveInSearch(state, BOT, cycleMove(state));

        const bot = state.players.find((p) => p.id === BOT)!;
        expect(bot.graveyard.map((c) => c.id)).toContain("decree");
        expect(cycledTriggersOn(state)).toHaveLength(1);
    });
});
