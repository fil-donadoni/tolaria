// Gravestorm (CR 702.69): the per-turn tally `removePermanentTo` keeps, the
// cast-copy trigger that reads it as it resolves (CR 608.2h), each instance
// triggering separately, save/load, the wire projection and the compiler's
// verdict on the keyword line.

import { beforeAll, describe, expect, it } from "vitest";
import {
    makeInstance,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import { preloadDefinitions } from "../../cards";
import { grizzlyBears } from "../../cards/sets/lea/index.cards";
import { solRing } from "../../cards/sets/lea/colorless.cards";
import { grapeshot } from "../../cards/sets/tsp/index.cards";
import type { CardDefinition } from "../../cards/types";
import { projectPublicState } from "../../gameProjections";
import { oracleCard } from "../../oracle/__tests__/oracle.fixture";
import { compileCard } from "../../oracle/compile";
import { advancePhase } from "../phases";
import { compactState, expandState } from "../serialize";
import {
    emitSpellCastEvent,
    removePermanentTo,
    resolveTopOfStack,
    type GameState,
    type StackItem,
} from "../state";

const GRAVESTORM_SPELL = "synthetic-gravestorm-spell";
const DOUBLE_GRAVESTORM_SPELL = "synthetic-double-gravestorm-spell";

beforeAll(() => {
    const spell = (id: string, staticAbilities: string[]) =>
        ({
            ...grapeshot(),
            id,
            name: `Synthetic ${id}`,
            staticAbilities,
        }) as CardDefinition;
    preloadDefinitions([
        spell(GRAVESTORM_SPELL, ["gravestorm"]),
        spell(DOUBLE_GRAVESTORM_SPELL, ["gravestorm", "gravestorm"]),
    ]);
});

function putOnBattlefield(
    state: GameState,
    cardId: string,
    id: string,
    extra: Parameters<typeof makeInstance>[1] = {}
): string {
    state.players[0].battlefield.push(
        makeInstance(cardId, {
            id,
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            ...extra,
        })
    );
    return id;
}

function bury(state: GameState, count: number): void {
    for (let i = 0; i < count; i++) {
        const id = putOnBattlefield(state, grizzlyBears().id, `bears-${i}`);
        removePermanentTo(state, id, "graveyard");
    }
}

function castGravestormSpell(
    state: GameState,
    cardId = GRAVESTORM_SPELL
): StackItem {
    const spell = pushSpell(state, cardId, "p1", [
        { type: "player", id: "p2" },
    ]);
    emitSpellCastEvent(state, spell);
    return spell;
}

function triggers(state: GameState): StackItem[] {
    return state.stack.filter((s) => s.triggeredAbilityId === "gravestorm");
}

/** Resolves the top trigger through every per-copy retarget prompt, declining
 *  each (a copy keeps the original's target), and returns the copies made. */
function resolveTriggerDecliningRetargets(state: GameState): number {
    const before = state.stack.length;
    const trigger = state.stack[state.stack.length - 1];
    expect(trigger.triggeredAbilityId).toBe("gravestorm");
    while (state.stack.includes(trigger)) {
        resolveTopOfStack(state);
        state.pendingTarget = undefined;
    }
    return state.stack.length - (before - 1);
}

describe("Gravestorm's tally (CR 702.69a)", () => {
    it("counts a noncreature permanent, which `deathsThisTurn` does not", () => {
        const state = makeState();
        const ring = putOnBattlefield(state, solRing().id, "ring");
        removePermanentTo(state, ring, "graveyard");
        expect(state.permanentsToGraveyardThisTurn).toBe(1);
        expect(state.deathsThisTurn).toBeUndefined();
    });

    it("counts a token: it reaches the graveyard before it ceases to exist (CR 111.7)", () => {
        const state = makeState();
        const token = putOnBattlefield(state, grizzlyBears().id, "token", {
            isToken: true,
        });
        removePermanentTo(state, token, "graveyard");
        expect(state.permanentsToGraveyardThisTurn).toBe(1);
    });

    it("does not count a departure to any other zone", () => {
        const state = makeState();
        const bears = putOnBattlefield(state, grizzlyBears().id, "bears");
        removePermanentTo(state, bears, "hand");
        const ring = putOnBattlefield(state, solRing().id, "ring");
        removePermanentTo(state, ring, "exile");
        expect(state.permanentsToGraveyardThisTurn).toBeUndefined();
    });

    it("does not count a graveyard departure a replacement sends to exile (CR 122.1h)", () => {
        const state = makeState();
        const bears = putOnBattlefield(state, grizzlyBears().id, "bears", {
            counters: { finality: 1 },
        });
        removePermanentTo(state, bears, "graveyard");
        expect(state.players[0].exile.map((c) => c.id)).toContain(bears);
        expect(state.permanentsToGraveyardThisTurn).toBeUndefined();
    });

    it("counts a permanent owned by either player, the table's total", () => {
        const state = makeState();
        bury(state, 1);
        state.players[1].battlefield.push(
            makeInstance(solRing().id, {
                id: "their-ring",
                controllerId: "p2",
                ownerId: "p2",
                zone: "battlefield",
            })
        );
        removePermanentTo(state, "their-ring", "graveyard");
        expect(state.permanentsToGraveyardThisTurn).toBe(2);
    });

    it("resets at the start of each turn", () => {
        const state = makeState({ phase: "END_STEP", turn: 1 });
        state.permanentsToGraveyardThisTurn = 3;
        advancePhase(state);
        expect(state.turn).toBe(2);
        expect(state.permanentsToGraveyardThisTurn).toBeUndefined();
    });
});

describe("Gravestorm's trigger (CR 702.69a)", () => {
    it("copies the spell once per permanent put into a graveyard this turn", () => {
        const state = makeState();
        bury(state, 2);
        castGravestormSpell(state);
        expect(triggers(state)).toHaveLength(1);
        expect(resolveTriggerDecliningRetargets(state)).toBe(2);
    });

    it("a zero count still uses the stack and copies nothing: no intervening if", () => {
        const state = makeState();
        castGravestormSpell(state);
        expect(triggers(state)).toHaveLength(1);
        expect(resolveTriggerDecliningRetargets(state)).toBe(0);
        expect(triggers(state)).toHaveLength(0);
    });

    it("counts a permanent put into a graveyard after the cast (CR 608.2h)", () => {
        const state = makeState();
        bury(state, 1);
        castGravestormSpell(state);
        const response = putOnBattlefield(state, solRing().id, "ring");
        removePermanentTo(state, response, "graveyard");
        expect(resolveTriggerDecliningRetargets(state)).toBe(2);
    });

    it("determines the count only once: a departure during a retarget does not add a copy (CR 608.2h)", () => {
        const state = makeState();
        bury(state, 2);
        castGravestormSpell(state);
        const trigger = triggers(state)[0];
        resolveTopOfStack(state);
        expect(state.pendingTarget).toBeDefined();
        const response = putOnBattlefield(state, solRing().id, "ring");
        removePermanentTo(state, response, "graveyard");
        expect(state.permanentsToGraveyardThisTurn).toBe(3);
        state.pendingTarget = undefined;
        expect(trigger.castCopiesRemaining).toBe(1);
        while (state.stack.includes(trigger)) {
            resolveTopOfStack(state);
            state.pendingTarget = undefined;
        }
        // The original plus exactly two copies.
        expect(state.stack).toHaveLength(3);
    });

    it("still copies when the original spell left the stack before the trigger resolved", () => {
        const state = makeState();
        bury(state, 1);
        const spell = castGravestormSpell(state);
        state.stack = state.stack.filter((s) => s.id !== spell.id);
        expect(resolveTriggerDecliningRetargets(state)).toBe(1);
    });

    it("a copy is not cast, so it neither re-triggers nor moves the spell count (CR 707.10)", () => {
        const state = makeState();
        bury(state, 2);
        castGravestormSpell(state);
        resolveTriggerDecliningRetargets(state);
        expect(triggers(state)).toHaveLength(0);
        expect(state.spellsCastThisTurn).toBe(1);
    });

    it("each instance triggers separately (CR 702.69b)", () => {
        const state = makeState();
        bury(state, 2);
        castGravestormSpell(state, DOUBLE_GRAVESTORM_SPELL);
        expect(triggers(state)).toHaveLength(2);
        expect(resolveTriggerDecliningRetargets(state)).toBe(2);
        // The first trigger's copies sit above the second trigger (CR 405.2).
        state.stack.splice(-2);
        expect(resolveTriggerDecliningRetargets(state)).toBe(2);
    });

    it("an unresolved trigger keeps its deferred read through a save and load", () => {
        const state = makeState();
        bury(state, 1);
        castGravestormSpell(state);
        const round = expandState(compactState(state));
        expect(round.permanentsToGraveyardThisTurn).toBe(1);
        expect(triggers(round)[0].castCopyCountReadOnResolution).toBe(true);
        const ring = putOnBattlefield(round, solRing().id, "ring");
        removePermanentTo(round, ring, "graveyard");
        expect(resolveTriggerDecliningRetargets(round)).toBe(2);
    });

    it("ships the trigger and its copy-count hint on the wire, without the snapshot", () => {
        const state = makeState();
        bury(state, 2);
        castGravestormSpell(state);
        const projected = projectPublicState(state, 1, "p1");
        const wire = projected.stack.find(
            (s) => s.triggeredAbilityId === "gravestorm"
        );
        expect(wire?.castCopiesRemaining).toBe(2);
        expect(wire?.castCopySnapshot).toBeUndefined();
    });
});

describe("Gravestorm in the compiler", () => {
    it("compiles Bitter Ordeal ready, the keyword in `staticAbilities`", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Bitter Ordeal",
                typeLine: "Sorcery",
                manaCost: "{2}{B}",
                power: undefined,
                toughness: undefined,
                oracleText:
                    "Search target player's library for a card and exile it. Then that player shuffles.\nGravestorm (When you cast this spell, copy it for each permanent put into a graveyard this turn. You may choose new targets for the copies.)",
            })
        );
        expect(outcome.state).toBe("ready");
        if (outcome.state !== "ready") return;
        expect(outcome.definition.staticAbilities).toEqual(["gravestorm"]);
    });
});
