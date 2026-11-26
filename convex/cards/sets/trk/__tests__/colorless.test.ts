// Per-card behavior tests for colorless cards in
// `convex/cards/sets/trk/colorless.cards.ts` (split by colour per ADR 0043).
//
// Deep Space 9 is the tracer for the `forEach { set: "bound", filter }`
// simultaneous return from exile (CR 110.4a, CR 608.2c) — "put all permanent
// cards exiled this way onto the battlefield" — and for the compiled
// `enters-or-upkeep` head (CR 603.2). Both are driven through the real trigger
// scan and the real stack; the station striation through the layer system.

import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../../__tests__/setup.helper";
import { resolveTopOfStack } from "../../../../gre/state";
import type { GameState } from "../../../../gre/state";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import {
    collectTriggers,
    placeTriggersOnStack,
} from "../../../../gre/triggers";
import type { GameEvent } from "../../../types";
import { CHARGE_COUNTER } from "../../../abilities/station";
import { deepSpace9 as deepSpace9Factory } from "../colorless.cards";

const deepSpace9 = deepSpace9Factory();

const BEARS = "ce2d603a-3231-4a8c-bf39-1617586ea870"; // creature
const FOREST = "6f1c8cb0-38eb-408b-94e8-16db83999b3b"; // land
const BOLT = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a"; // instant
const MEMNITE = "469cc4e0-49c0-4009-97ea-28e44addec69"; // artifact creature

function card(cardId: string, id: string, extra = {}) {
    return makeInstance(cardId, {
        id,
        controllerId: "p1",
        ownerId: "p1",
        ...extra,
    });
}

function board(
    opts: { charge?: number; exile?: ReturnType<typeof card>[] } = {}
): GameState {
    return makeState({
        phase: "UPKEEP",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", {
                battlefield: [
                    card(deepSpace9.id, "ds9", {
                        // CR 613.7a — began applying as it entered.
                        staticSeq: 1,
                        ...(opts.charge
                            ? { counters: { [CHARGE_COUNTER]: opts.charge } }
                            : {}),
                    }),
                    card(BEARS, "standing-bear"),
                ],
                // `library[0]` is the top.
                library: [
                    card(BEARS, "lib-bears"),
                    card(BOLT, "lib-bolt"),
                    card(FOREST, "lib-forest"),
                    card(MEMNITE, "lib-memnite"),
                    card(BEARS, "lib-fifth"),
                ],
                exile: opts.exile ?? [],
            }),
            makePlayer("p2"),
        ],
    });
}

const ENTERED: GameEvent = {
    type: "PERMANENT_ENTERED",
    instanceId: "ds9",
    controllerId: "p1",
    cardId: deepSpace9.id,
    types: ["Artifact"],
};

function fireAndResolve(state: GameState, event: GameEvent): void {
    const triggers = collectTriggers(state, [event]);
    expect(triggers).toHaveLength(1);
    placeTriggersOnStack(state, triggers);
    resolveTopOfStack(state);
}

const ids = (zone: { id: string }[]) => zone.map((c) => c.id).sort();

describe("Deep Space 9 — exile the top four, put the permanent cards onto the battlefield (CR 110.4a, CR 608.2c)", () => {
    it("on entering: the permanent cards among the top four enter, the instant stays exiled", () => {
        const state = board();
        fireAndResolve(state, ENTERED);
        const p1 = state.players[0];
        expect(ids(p1.battlefield)).toEqual(
            [
                "ds9",
                "standing-bear",
                "lib-bears",
                "lib-forest",
                "lib-memnite",
            ].sort()
        );
        expect(ids(p1.exile)).toEqual(["lib-bolt"]);
        // Only four were exiled: the fifth card is still on top.
        expect(p1.library.map((c) => c.id)).toEqual(["lib-fifth"]);
    });

    it("fires at the beginning of YOUR upkeep, never the opponent's (CR 603.2b)", () => {
        const state = board();
        expect(
            collectTriggers(state, [
                { type: "PHASE_BEGIN", phase: "UPKEEP", activePlayerId: "p2" },
            ])
        ).toHaveLength(0);
        fireAndResolve(state, {
            type: "PHASE_BEGIN",
            phase: "UPKEEP",
            activePlayerId: "p1",
        });
        expect(state.players[0].battlefield).toHaveLength(5);
    });

    it("a permanent card already in exile is not 'exiled this way' and stays there (CR 608.2c)", () => {
        const state = board({ exile: [card(MEMNITE, "old-memnite")] });
        fireAndResolve(state, ENTERED);
        expect(ids(state.players[0].exile)).toEqual(
            ["lib-bolt", "old-memnite"].sort()
        );
    });
});

describe("Deep Space 9 — 9+ | Creatures you control get +3/+3 (CR 721.2a)", () => {
    it("pumps your creatures only at nine or more charge counters", () => {
        const low = board({ charge: 8 });
        const bearLow = low.players[0].battlefield[1];
        expect(getEffectivePower(low, bearLow)).toBe(2);
        const high = board({ charge: 9 });
        const bearHigh = high.players[0].battlefield[1];
        expect(getEffectivePower(high, bearHigh)).toBe(5);
        expect(getEffectiveToughness(high, bearHigh)).toBe(5);
    });
});
