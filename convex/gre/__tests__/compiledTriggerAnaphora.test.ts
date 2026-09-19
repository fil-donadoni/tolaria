// Trigger-head anaphora, compiled from real Oracle text and run through the
// engine (issue #4127, CR 603.2b / 603.4 / 400.7e).
//
// "that player" and "that card" name something the HEAD printed — the player
// whose upkeep it is, the card the enchanted creature became — and the
// compiler binds them to `$event` fields. A binding to the wrong referent
// compiles to a perfectly well-formed script (the controller instead of the
// active player, the battlefield instead of the graveyard), so the assertions
// below go Oracle row → `compileCard` → the real trigger scan → the real
// stack, and each one is a PAIR: the same board with only the referent moved.

import { describe, it, expect } from "vitest";
import {
    getPlayer,
    processPendingActionTriggers,
    removePermanentTo,
    resolveTopOfStack,
    type GameState,
} from "../state";
import { checkStateBasedActions } from "../sba";
import { withTemporaryDefinition } from "../../cards/registry";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup";
import { grizzlyBears } from "../../cards/sets/lea";
import { terror } from "../../cards/sets/lea/black";
import {
    forest,
    island,
    mountain,
    plains,
    swamp,
} from "../../cards/sets/lea/colorless";
import type { CardDefinition } from "../../cards/types";
import { compileCard } from "../../oracle/compile";
import { GOLDEN_FIXTURES } from "../../oracle/grammar/fixtures";

/** The compiled definition of a golden fixture's REAL Oracle row. */
function compiled(name: string): CardDefinition {
    const fixture = GOLDEN_FIXTURES.find((f) => f.card.name === name);
    if (fixture === undefined) throw new Error(`no fixture for ${name}`);
    const outcome = compileCard(fixture.card);
    if (outcome.state !== "ready")
        throw new Error(`${name} compiled ${outcome.state}`);
    return {
        ...outcome.definition,
        id: `test-4127-${fixture.card.oracleId}`,
        rarity: "common",
    } as CardDefinition;
}

const lands = (owner: string, defs: CardDefinition[]) =>
    defs.map((def, i) =>
        makeInstance(def.id, {
            id: `${owner}-land-${i}`,
            controllerId: owner,
            ownerId: owner,
        })
    );

describe("Mask of Intolerance — 'that player' is the player whose upkeep it is (CR 603.4 / 305.6)", () => {
    const mask = compiled("Mask of Intolerance");

    /** p1 controls the Mask; `p1Lands` / `p2Lands` set each side's domain. */
    function board(p1Lands: CardDefinition[], p2Lands: CardDefinition[]) {
        return makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(mask.id, {
                            id: "mask",
                            controllerId: "p1",
                            ownerId: "p1",
                        }),
                        ...lands("p1", p1Lands),
                    ],
                }),
                makePlayer("p2", { battlefield: lands("p2", p2Lands) }),
            ],
        });
    }

    function upkeepOf(state: GameState, activePlayerId: string): void {
        state.pendingEvents = [
            ...(state.pendingEvents ?? []),
            { type: "PHASE_BEGIN", phase: "UPKEEP", activePlayerId },
        ];
        processPendingActionTriggers(state);
    }

    const FOUR = [plains, island, swamp, mountain];
    const THREE = [plains, island, swamp];

    it("deals 3 damage to the ACTIVE player when THEIR lands show four basic types", () => {
        withTemporaryDefinition(mask, () => {
            const state = board(THREE, FOUR);
            upkeepOf(state, "p2");
            expect(state.stack).toHaveLength(1);
            resolveTopOfStack(state);
            expect(getPlayer(state, "p2").life).toBe(17);
            expect(getPlayer(state, "p1").life).toBe(20);
        });
    });

    it("does not trigger on that upkeep when only the CONTROLLER's lands qualify", () => {
        // The discriminating half: the same count, on the other side. A
        // condition read off the controller (the `controls` default) fires.
        withTemporaryDefinition(mask, () => {
            const state = board(FOUR, THREE);
            upkeepOf(state, "p2");
            expect(state.stack).toHaveLength(0);
        });
    });

    it("re-checks the domain on resolution and does nothing once it drops (CR 603.4)", () => {
        withTemporaryDefinition(mask, () => {
            const state = board(THREE, [...THREE, forest]);
            upkeepOf(state, "p2");
            expect(state.stack).toHaveLength(1);
            removePermanentTo(state, "p2-land-3", "graveyard");
            resolveTopOfStack(state);
            expect(getPlayer(state, "p2").life).toBe(20);
        });
    });
});

describe("Squee's Embrace — 'that card' is the host in its owner's graveyard (CR 400.7e)", () => {
    const embrace = compiled("Squee's Embrace");

    function board(hostIsToken: boolean): GameState {
        return makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(grizzlyBears.id, {
                            id: "host",
                            controllerId: "p1",
                            ownerId: "p1",
                            ...(hostIsToken ? { isToken: true } : {}),
                        }),
                        makeInstance(grizzlyBears.id, {
                            id: "bystander",
                            controllerId: "p1",
                            ownerId: "p1",
                        }),
                        makeInstance(embrace.id, {
                            id: "embrace",
                            controllerId: "p1",
                            ownerId: "p1",
                            attachedTo: "host",
                        }),
                    ],
                }),
                makePlayer("p2", {}),
            ],
        });
    }

    /** CR 608.2 / 700.4 — a destroy spell resolves; its death events are
     *  scanned as the resolution ends (`resolveTopOfStack`), the path the
     *  hand-written Creature Bond is tested through. */
    function killWithTerror(state: GameState, id: string): void {
        pushSpell(state, terror.id, "p2", [{ type: "permanent", id }]);
        resolveTopOfStack(state);
    }

    it("returns the enchanted creature's card from the graveyard to its owner's hand", () => {
        withTemporaryDefinition(embrace, () => {
            const state = board(false);
            killWithTerror(state, "host");
            expect(state.stack.map((s) => s.triggeredAbilityId)).toEqual([
                "squee-s-embrace-trigger",
            ]);
            resolveTopOfStack(state);
            const p1 = getPlayer(state, "p1");
            expect(p1.hand.map((c) => c.id)).toContain("host");
            expect(p1.graveyard.map((c) => c.id)).not.toContain("host");
        });
    });

    it("does not trigger when a creature it does NOT enchant dies", () => {
        withTemporaryDefinition(embrace, () => {
            const state = board(false);
            killWithTerror(state, "bystander");
            expect(state.stack).toHaveLength(0);
        });
    });

    it("returns nothing for a token host, which ceased to exist (CR 704.5d)", () => {
        withTemporaryDefinition(embrace, () => {
            const state = board(true);
            killWithTerror(state, "host");
            // CR 704.3 / 704.5d — SBAs run before anyone gets priority, so the
            // token has ceased to exist before its trigger can resolve.
            checkStateBasedActions(state);
            expect(state.stack).toHaveLength(1);
            resolveTopOfStack(state);
            expect(getPlayer(state, "p1").hand).toHaveLength(0);
        });
    });
});
