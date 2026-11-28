// "Until end of turn, you don't lose this mana as steps and phases end" — the
// `"end-of-turn"` member of `ManaPersistence` (CR 500.5 / 514.2).
//
// `oracle/__tests__/manaLifetime.test.ts` proves the Oracle sentence lowers to
// `addMana … persistsUntil: "end-of-turn"`. It cannot prove the engine KEEPS
// the mana, so this file compiles the real Oracle row, registers it, fires the
// attack trigger through the real trigger scan and stack, then walks the REAL
// `advancePhase` to the end of the turn. Ordinary mana floats beside the unit
// at every step: without it, "spared correctly" and "never emptied at all"
// would read the same.

import { describe, expect, it } from "vitest";
import { registerTokenDefinition } from "../../cards";
import type { CardDefinition, GameEvent } from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { compileCard } from "../../oracle/compile";
import { oracleCard } from "../../oracle/__tests__/oracle.fixture";
import { projectPublicState } from "../../gameProjections";
import { advancePhase } from "../phases";
import {
    manaPersistenceSurvives,
    resolveTopOfStack,
    type GameState,
} from "../state";
import { collectTriggers, placeTriggersOnStack } from "../triggers";
import type { Phase } from "../types";

const BRAZEN_COLLECTOR_TEXT =
    "First strike\nWhenever this creature attacks, add {R}. Until end of turn, you don't lose this mana as steps and phases end.";

function registerBrazenCollector(): CardDefinition {
    const outcome = compileCard(
        oracleCard({
            name: "Brazen Collector",
            manaCost: "{1}{R}",
            typeLine: "Creature — Raccoon Rogue",
            oracleText: BRAZEN_COLLECTOR_TEXT,
            power: "2",
            toughness: "1",
        })
    );
    if (outcome.state === "unparsed")
        throw new Error(`unparsed: ${JSON.stringify(outcome.gaps)}`);
    const definition = {
        ...outcome.definition,
        id: "test-mana-lifetime-brazen-collector",
        rarity: "uncommon" as const,
    } as CardDefinition;
    registerTokenDefinition(definition);
    return definition;
}

const COLLECTOR = registerBrazenCollector();

function attackingBoard(): GameState {
    const attacker = makeInstance(COLLECTOR.id, {
        id: "atk",
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
    });
    return makeState({
        players: [
            makePlayer("p1", { battlefield: [attacker] }),
            makePlayer("p2"),
        ],
        phase: "DECLARE_ATTACKERS",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        combat: {
            attackerIds: [attacker.id],
            confirmed: true,
            blockerAssignments: {},
            blockersConfirmed: false,
        },
    });
}

/** CR 508.1 — the real attack event, its triggers stacked and resolved. */
function declareAttackersAndResolve(state: GameState): void {
    const event: GameEvent = {
        type: "ATTACKERS_DECLARED",
        attackingPlayerId: state.activePlayerId,
        attackerIds: [...state.combat!.attackerIds],
    };
    placeTriggersOnStack(state, collectTriggers(state, [event]));
    while (state.stack.length > 0) resolveTopOfStack(state);
}

/** Red held in the lifetime-tagged bucket only. */
function persistentRed(state: GameState): number {
    return (state.players[0].restrictedMana ?? []).reduce(
        (n, u) =>
            u.color === "R" && u.persistsUntil === "end-of-turn"
                ? n + u.amount
                : n,
        0
    );
}

describe("end-of-turn mana lifetime (CR 500.5 / 514.2)", () => {
    it("`manaPersistenceSurvives` spares every boundary of the turn except the cleanup step's exit", () => {
        const spared: Phase[] = [
            "UNTAP",
            "UPKEEP",
            "DRAW",
            "PRECOMBAT_MAIN",
            "BEGINNING_OF_COMBAT",
            "DECLARE_ATTACKERS",
            "DECLARE_BLOCKERS",
            "FIRST_STRIKE_DAMAGE",
            "COMBAT_DAMAGE",
            "END_OF_COMBAT",
            "POSTCOMBAT_MAIN",
            "END_STEP",
        ];
        for (const phase of spared)
            expect(manaPersistenceSurvives("end-of-turn", phase)).toBe(true);
        expect(manaPersistenceSurvives("end-of-turn", "CLEANUP")).toBe(false);
    });

    it("the compiled attack trigger's mana outlives combat, the second main phase and the end step, and empties as cleanup ends", () => {
        const state = attackingBoard();
        declareAttackersAndResolve(state);
        expect(persistentRed(state)).toBe(1);

        // CR 500.5 — ordinary mana beside it empties at the very next
        // boundary; the tagged unit does not.
        state.players[0].manaPool.R = 2;
        advancePhase(state);
        expect(state.players[0].manaPool.R).toBe(0);
        expect(persistentRed(state)).toBe(1);

        while (state.phase !== "END_STEP") advancePhase(state);
        expect(persistentRed(state)).toBe(1);

        // CR 514.2 — the "until end of turn" effect ends in cleanup (a step
        // with no priority here, so one advance crosses it into the next
        // turn); the pool empties as that step ends. Which of the two exits
        // empties it is `manaPersistenceSurvives`'s, pinned above.
        const traversed = advancePhase(state);
        expect(traversed).toContain("CLEANUP");
        expect(persistentRed(state)).toBe(0);
        expect(state.players[0].restrictedMana).toBeUndefined();
    });

    it("projectPublicState carries the unit and its lifetime to the client", () => {
        const state = attackingBoard();
        declareAttackersAndResolve(state);
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[0].restrictedMana).toEqual([
            { color: "R", amount: 1, persistsUntil: "end-of-turn" },
        ]);
    });
});
