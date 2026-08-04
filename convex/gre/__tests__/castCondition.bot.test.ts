// Bot-side row of the cast-legality consumer census for the card-level self
// cast condition (`CardDefinition.castCondition`, CR 601.3a, issue #2102).
//
// `enumerateMoves` is the Bot's (and the client-side Brain's) view of what is
// playable. It reaches cast legality only through `getLegalActions`, which
// calls the shared `castProhibitionReason` — so the ONE declaration on the card
// must already suppress the Bot's cast move. This file exists to prove that
// coupling rather than assume it: a server-only fix would leave the Bot
// enumerating an illegal cast and stalling when the mutation rejects it.
//
// Lives in the BOT suite because `convex/gre/moves` is a bot-only module
// (`scripts/__tests__/bot-suite-boundary.test.ts`).

import { describe, it, expect } from "vitest";
import { enumerateMoves } from "../moves";
import { blizzard, snowCoveredForest } from "../../cards/sets/ice";
import { mountain } from "../../cards/sets/lea";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import type { CardInstanceState } from "../state";

function land(cardId: string, id: string): CardInstanceState {
    return makeInstance(cardId, {
        id,
        controllerId: "p1",
        ownerId: "p1",
        types: ["Land"],
    });
}

function stateWith(battlefield: CardInstanceState[]) {
    const blizzardInHand = makeInstance(blizzard.id, {
        id: "blizzard-hand",
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
    });
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield,
                hand: [blizzardInHand],
                manaPool: { W: 5, U: 5, B: 5, R: 5, G: 5, C: 5 },
            }),
            makePlayer("p2", {}),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        phase: "PRECOMBAT_MAIN",
    });
}

function castsBlizzard(battlefield: CardInstanceState[]): boolean {
    return enumerateMoves(stateWith(battlefield), "p1").some(
        (m) => m.kind === "cast-spell" && m.cardInstanceId === "blizzard-hand"
    );
}

describe("Bot move enumeration honours a card's cast condition (CR 601.3a)", () => {
    it("does NOT enumerate the cast without a snow land", () => {
        expect(castsBlizzard([])).toBe(false);
        // Nor is a plain (non-snow) land enough — CR 205.4a.
        expect(castsBlizzard([land(mountain.id, "mtn")])).toBe(false);
    });

    it("enumerates the cast once a snow land is controlled", () => {
        expect(castsBlizzard([land(snowCoveredForest.id, "snow")])).toBe(true);
    });
});
