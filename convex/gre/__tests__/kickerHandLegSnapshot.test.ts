// CR 702.33a / 118.8 / 608.2h / 614.1c (issue #2008) — Dralnu's Pet: "Kicker—
// {2}{B}, Discard a creature card. If this creature was kicked, it enters with
// flying and with X +1/+1 counters on it, where X is the discarded card's mana
// value."
//
// Drives the REAL cast commit (`tryAutoCommitPendingCast` over the parked
// `pendingCast` a Kicker hand leg produces), then `resolveTopOfStack`, so the
// snapshot written at commit is what the entry replacement reads — and the
// wire format (`projectPublicState`) still shows the counters.

import { describe, expect, it } from "vitest";
import { tryAutoCommitPendingCast } from "../../game";
import { projectPublicState } from "../../gameProjections";
import { dralnusPet } from "../../cards/sets/pls/blue.cards";
import { grizzlyBears, serraAngel } from "../../cards/sets/lea/index.cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { resolveTopOfStack, type GameState } from "../state";

function castPet(opts: { kicked: boolean; discard: "bears" | "angel" }) {
    const pet = makeInstance(dralnusPet().id, {
        id: "pet",
        zone: "hand",
        controllerId: "p1",
        ownerId: "p1",
    });
    const bears = makeInstance(grizzlyBears().id, {
        id: "bears",
        zone: "hand",
        controllerId: "p1",
        ownerId: "p1",
    });
    const angel = makeInstance(serraAngel().id, {
        id: "angel",
        zone: "hand",
        controllerId: "p1",
        ownerId: "p1",
    });
    const state: GameState = makeState({
        players: [
            makePlayer("p1", {
                hand: [pet, bears, angel],
                manaPool: { U: 2, B: 1, C: 4 },
            }),
            makePlayer("p2"),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
    });
    state.pendingCast = {
        playerId: "p1",
        cardInstanceId: "pet",
        manaCost: opts.kicked ? { U: 2, B: 1, C: 3, X: 0 } : { U: 2, C: 1 },
        tappedLandIds: [],
        ...(opts.kicked
            ? {
                  kickerPayments: { kicker: 1 },
                  alternativeCostHandChoice: {
                      action: "discard" as const,
                      requirements: [
                          { filter: { type: "Creature" }, count: 1 },
                      ],
                      excludeInstanceId: "pet",
                      pickedCardIds: [opts.discard],
                  },
              }
            : {}),
    };
    return state;
}

describe("Dralnu's Pet — Kicker hand-leg snapshot (issue #2008)", () => {
    it.each([
        ["bears", 2],
        ["angel", 5],
    ] as const)(
        "kicked, discarding %s → flying and %d +1/+1 counters",
        (discard, mv) => {
            const state = castPet({ kicked: true, discard });
            expect(tryAutoCommitPendingCast(state, "p1")).not.toBeNull();
            const item = state.stack.find((s) => s.id === "pet")!;
            expect(item.additionalSacrificeSnapshot?.cardInstanceId).toBe(
                discard
            );
            expect(item.additionalSacrificeSnapshot?.mv).toBe(mv);
            expect(state.players[0].graveyard.map((c) => c.id)).toContain(
                discard
            );

            resolveTopOfStack(state);
            const live = state.players[0].battlefield.find(
                (c) => c.id === "pet"
            )!;
            expect(live.counters?.["+1/+1"]).toBe(mv);
            expect(live.staticAbilities).toContain("flying");

            const view = projectPublicState(state, "p2");
            const seen = view.players[0].battlefield.find(
                (c) => c.id === "pet"
            );
            expect(seen?.counters?.["+1/+1"]).toBe(mv);
        }
    );

    it("unkicked → plain 2/2: no counters, no flying, no snapshot", () => {
        const state = castPet({ kicked: false, discard: "bears" });
        expect(tryAutoCommitPendingCast(state, "p1")).not.toBeNull();
        expect(
            state.stack.find((s) => s.id === "pet")?.additionalSacrificeSnapshot
        ).toBeUndefined();
        resolveTopOfStack(state);
        const live = state.players[0].battlefield.find((c) => c.id === "pet")!;
        expect(live.counters?.["+1/+1"] ?? 0).toBe(0);
        expect(live.staticAbilities ?? []).not.toContain("flying");
    });
});
