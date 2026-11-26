// Compiled player-scoped heads reach the engine as REAL triggers (issue #4582):
// "at the beginning of each opponent's upkeep" and "each player's end step"
// (CR 603.2b), "whenever a land enters" (CR 603.6a) and "whenever a player
// taps a land for mana" (CR 106.12).
//
// `oracle/__tests__/playerScopedTriggerHeads.test.ts` proves the Oracle text
// lowers to the right descriptor. It cannot prove the rebuilt ability FIRES on
// the right event and acts on the right player, so each test compiles a real
// Oracle row and drives it through the real trigger scan, stack and
// resolution.

import { describe, expect, it } from "vitest";
import { withTemporaryDefinition } from "../../cards/registry";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { forest, mountain } from "../../cards/sets/lea/colorless.cards";
import type { CardDefinition, CardType, GameEvent } from "../../cards/types";
import { compileCard } from "../../oracle/compile";
import { oracleCard } from "../../oracle/__tests__/oracle.fixture";
import { GOLDEN_FIXTURES } from "../../oracle/grammar/fixtures";
import type { OracleCard } from "../../oracle/types";
import {
    getPlayer,
    processPendingActionTriggers,
    resolveTopOfStack,
    type GameState,
} from "../state";

function compiled(card: OracleCard): CardDefinition {
    const outcome = compileCard(card);
    if (outcome.state !== "ready")
        throw new Error(`${card.name} compiled ${outcome.state}`);
    return {
        ...outcome.definition,
        id: `test-4582-${card.name}`,
        rarity: "common",
    } as CardDefinition;
}

const fixture = (name: string): OracleCard => {
    const row = GOLDEN_FIXTURES.find((f) => f.card.name === name);
    if (row === undefined) throw new Error(`no fixture for ${name}`);
    return row.card;
};

const ANKH = compiled(fixture("Ankh of Mishra"));
const TECTONIC = compiled(fixture("Tectonic Instability"));
const MANABARBS = compiled(
    oracleCard({
        name: "Manabarbs",
        manaCost: "{3}{R}",
        typeLine: "Enchantment",
        oracleText:
            "Whenever a player taps a land for mana, this enchantment deals 1 damage to that player.",
    })
);
const IRON_MAIDEN = compiled(
    oracleCard({
        name: "Iron Maiden",
        manaCost: "{3}",
        typeLine: "Artifact",
        oracleText:
            "At the beginning of each opponent's upkeep, this artifact deals X damage to that player, where X is the number of cards in their hand minus 4.",
    })
);
// CR 603.2b — the head on a body every Oracle grammar already reads: no
// corpus card printing "each player's end step" compiles yet (each refuses
// on its own body clause), so the head is pinned on this one.
const END_STEP_PINGER = compiled(
    oracleCard({
        name: "Test End Step Pinger",
        manaCost: "{3}",
        typeLine: "Artifact",
        oracleText:
            "At the beginning of each player's end step, this artifact deals 1 damage to that player.",
    })
);

const at = (def: string, id: string, controllerId: string) =>
    makeInstance(def, { id, controllerId, ownerId: controllerId });

/** p1 controls `source`; each side gets two untapped lands. */
function board(source: CardDefinition, p2Hand = 0): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                life: 20,
                battlefield: [
                    at(source.id, "source", "p1"),
                    at(forest().id, "p1-land-0", "p1"),
                    at(mountain().id, "p1-land-1", "p1"),
                ],
            }),
            makePlayer("p2", {
                life: 20,
                battlefield: [
                    at(forest().id, "p2-land-0", "p2"),
                    at(mountain().id, "p2-land-1", "p2"),
                ],
                hand: Array.from({ length: p2Hand }, (_, i) =>
                    at(forest().id, `p2-hand-${i}`, "p2")
                ),
            }),
        ],
    });
}

function fire(state: GameState, event: GameEvent): void {
    state.pendingEvents = [...(state.pendingEvents ?? []), event];
    processPendingActionTriggers(state);
}

function resolveAll(state: GameState): void {
    let guard = 0;
    while (state.stack.length > 0 && guard++ < 10) resolveTopOfStack(state);
}

const tapped = (
    controllerId: string,
    permanentTypes: CardType[],
    forMana: boolean
): GameEvent => ({
    type: "PERMANENT_TAPPED",
    permanentId: `${controllerId}-tapped`,
    controllerId,
    permanentTypes,
    permanentSubtypes: [],
    forMana,
    ...(forMana ? { manaProduced: { G: 1 } } : {}),
});

const entered = (controllerId: string, types: CardType[]): GameEvent => ({
    type: "PERMANENT_ENTERED",
    instanceId: `${controllerId}-land-0`,
    controllerId,
    types,
});

describe("compiled 'whenever a player taps a land for mana' (CR 106.12)", () => {
    it("deals 1 damage to the player who tapped the land, either player", () => {
        withTemporaryDefinition(MANABARBS, () => {
            const state = board(MANABARBS);
            fire(state, tapped("p2", ["Land"], true));
            expect(state.stack).toHaveLength(1);
            resolveAll(state);
            expect(getPlayer(state, "p2").life).toBe(19);
            expect(getPlayer(state, "p1").life).toBe(20);
            fire(state, tapped("p1", ["Land"], true));
            resolveAll(state);
            expect(getPlayer(state, "p1").life).toBe(19);
        });
    });

    it("never fires for a creature tapped for mana, nor a land tapped otherwise", () => {
        withTemporaryDefinition(MANABARBS, () => {
            const state = board(MANABARBS);
            fire(state, tapped("p2", ["Creature"], true));
            expect(state.stack).toHaveLength(0);
            fire(state, tapped("p2", ["Land"], false));
            expect(state.stack).toHaveLength(0);
        });
    });
});

describe("compiled 'whenever a land enters' (CR 603.6a)", () => {
    it("damages the ENTERING land's controller, not the source's", () => {
        withTemporaryDefinition(ANKH, () => {
            const state = board(ANKH);
            fire(state, entered("p2", ["Land"]));
            expect(state.stack).toHaveLength(1);
            resolveAll(state);
            expect(getPlayer(state, "p2").life).toBe(18);
            expect(getPlayer(state, "p1").life).toBe(20);
        });
    });

    it("never fires for a creature entering", () => {
        withTemporaryDefinition(ANKH, () => {
            const state = board(ANKH);
            fire(state, entered("p2", ["Creature"]));
            expect(state.stack).toHaveLength(0);
        });
    });

    it("taps every land of the entering land's controller and none of the other's", () => {
        withTemporaryDefinition(TECTONIC, () => {
            const state = board(TECTONIC);
            fire(state, entered("p2", ["Land"]));
            expect(state.stack).toHaveLength(1);
            resolveAll(state);
            const tappedOf = (id: string) =>
                state.players
                    .flatMap((p) => p.battlefield)
                    .find((c) => c.id === id)?.isTapped;
            expect(tappedOf("p2-land-0")).toBe(true);
            expect(tappedOf("p2-land-1")).toBe(true);
            expect(tappedOf("p1-land-0")).toBe(false);
            expect(tappedOf("p1-land-1")).toBe(false);
        });
    });
});

describe("compiled 'at the beginning of each opponent's upkeep' (CR 603.2b)", () => {
    it("fires on the opponent's upkeep, damaging that player, and never on its controller's", () => {
        withTemporaryDefinition(IRON_MAIDEN, () => {
            const state = board(IRON_MAIDEN, 6);
            fire(state, {
                type: "PHASE_BEGIN",
                phase: "UPKEEP",
                activePlayerId: "p1",
            });
            expect(state.stack).toHaveLength(0);
            fire(state, {
                type: "PHASE_BEGIN",
                phase: "UPKEEP",
                activePlayerId: "p2",
            });
            expect(state.stack).toHaveLength(1);
            resolveAll(state);
            expect(getPlayer(state, "p2").life).toBe(18);
            expect(getPlayer(state, "p1").life).toBe(20);
        });
    });
});

describe("compiled 'at the beginning of each player's end step' (CR 603.2b)", () => {
    it("fires on every player's end step, damaging the player whose step it is", () => {
        withTemporaryDefinition(END_STEP_PINGER, () => {
            const state = board(END_STEP_PINGER);
            fire(state, {
                type: "PHASE_BEGIN",
                phase: "END_STEP",
                activePlayerId: "p2",
            });
            resolveAll(state);
            expect(getPlayer(state, "p2").life).toBe(19);
            expect(getPlayer(state, "p1").life).toBe(20);
            fire(state, {
                type: "PHASE_BEGIN",
                phase: "END_STEP",
                activePlayerId: "p1",
            });
            resolveAll(state);
            expect(getPlayer(state, "p1").life).toBe(19);
        });
    });
});
