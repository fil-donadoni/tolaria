// SOS — per-card behavior tests for red cards in
// `convex/cards/sets/sos/red.ts` (set split by colour, ADR 0043).

import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { resolveTopOfStack } from "../../../../gre/state";
import { getLegalTargets, NO_TARGETING_SOURCE } from "../../../../gre/rules";

import type { GameState } from "../../../../gre/state";
import { getDefinition } from "../../../index";

// ADR 0046 — a per-card test resolves its subject through the REGISTRY seam,
// never by importing the set module's export.
const IMPRACTICAL_JOKE_ID = "39a816b4-39b8-421c-b828-68db901d34b7";
const impracticalJoke = getDefinition(IMPRACTICAL_JOKE_ID)!;

// Ironroot Treefolk — 3/5, so it SURVIVES the 3 damage and the assertion is
// about the damage landing rather than about state-based actions.
const TREEFOLK_ID = "b93c5869-7777-44bb-967a-e9439b25ced4";
const LIGHTNING_BOLT_ID = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a";

/** p2 has a creature behind a 100-point prevention shield; p1 holds the Joke. */
function jokeBoard(): GameState {
    const state = makeState({
        players: [
            makePlayer("p1"),
            makePlayer("p2", {
                battlefield: [
                    makeInstance(TREEFOLK_ID, {
                        id: "victim",
                        controllerId: "p2",
                        ownerId: "p2",
                    }),
                ],
            }),
        ],
    });
    state.targetPreventionShields = [
        {
            targetType: "permanent",
            targetId: "victim",
            remaining: 100,
            duration: { phase: "end-of-turn" },
        },
        {
            targetType: "player",
            targetId: "p2",
            remaining: 100,
            duration: { phase: "end-of-turn" },
        },
    ];
    return state;
}

describe("Impractical Joke — 'Damage can't be prevented this turn' (CR 615.12)", () => {
    it("deals its 3 damage THROUGH a prevention shield, and leaves the shield unspent", () => {
        const state = jokeBoard();
        pushSpell(state, impracticalJoke.id, "p1", [
            { type: "permanent", id: "victim" },
        ]);
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "victim")!
                .damageMarked
        ).toBe(3);
        // CR 615.12's last sentence — the shield was never reduced.
        expect(state.targetPreventionShields?.[0]?.remaining).toBe(100);
    });

    it("the same shield DOES prevent an unaccompanied Bolt (the contrast case)", () => {
        const state = jokeBoard();
        pushSpell(state, LIGHTNING_BOLT_ID, "p1", [
            { type: "permanent", id: "victim" },
        ]);
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "victim")!
                .damageMarked
        ).toBeUndefined();
    });

    // CR 601.2c — "up to one target": zero targets is a legal announcement, and
    // the sentence BEFORE the damage still resolves. The Op order is the card.
    it("resolves with ZERO targets: the lock is still armed, nothing is damaged", () => {
        const state = jokeBoard();
        pushSpell(state, impracticalJoke.id, "p1", []);
        resolveTopOfStack(state);
        expect(state.damageUnpreventableThisTurn).toBe(true);
        expect(
            state.players[1].battlefield.find((c) => c.id === "victim")!
                .damageMarked
        ).toBeUndefined();
        // …and the lock it armed is game-scoped, so a LATER burn spell the same
        // turn goes through the player's shield too.
        pushSpell(state, LIGHTNING_BOLT_ID, "p1", [
            { type: "player", id: "p2" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(17);
    });

    // Issue #3073's bug class — "target creature or planeswalker" encoded as
    // `type: ["any"]` would offer a PLAYER. The requirement is the authority the
    // client's picker and the bot's enumerator both read, so it is asserted
    // through `getLegalTargets` rather than off the literal.
    it("offers creatures and planeswalkers only — never a player", () => {
        const state = jokeBoard();
        const legal = getLegalTargets(
            state,
            impracticalJoke.targetRequirement!,
            NO_TARGETING_SOURCE,
            "p1"
        );
        expect(legal.map((t) => t.id)).toEqual(["victim"]);
        expect(legal.some((t) => t.type === "player")).toBe(false);
    });
});
