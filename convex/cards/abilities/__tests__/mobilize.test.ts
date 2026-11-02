// Capability tests for the Mobilize N keyword expansion (CR 702.181,
// convex/cards/abilities/mobilize.ts, issue #2611).
//
// Drives the REAL paths: the `getDefinition` expansion seam, the trigger scan
// (`collectTriggers` off a real `ATTACKERS_DECLARED` emission), the
// interpreter's `createToken` (with the `bindAll` picks binding this keyword
// introduced) and `delayedTrigger` Ops through `resolveTopOfStack`, the
// delayed-trigger firing at the next end step (`fireDelayedTriggers`), and the
// wire projection (`projectPublicState`).

import { describe, it, expect } from "vitest";
import { preloadDefinitions, getDefinition } from "../..";
import type { CardDefinition, GameEvent } from "../../types";
import type { GameState } from "../../../gre/state";
import { resolveTopOfStack } from "../../../gre/state";
import { fireDelayedTriggers } from "../../../gre/phases";
import { collectTriggers, placeTriggersOnStack } from "../../../gre/triggers";
import { validateAbilityEffectScript } from "../../../gre/effects/validate";
import { projectPublicState } from "../../../gameProjections";
import { WARRIOR_TOKEN } from "../../sharedTokens";
import { isNamedMechanic, MECHANICS_REGISTRY } from "../../mechanicsRegistry";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../__tests__/setup.helper";
import {
    expandMobilize,
    mobilizeOracleText,
    mobilizeTrigger,
    mobilizeTriggerId,
} from "../mobilize";

/** Registers a synthetic 1/3 attacker carrying the given mobilize keyword
 *  string(s), so `getDefinition` runs it through the real expansion chain. */
function registerMobilizeCreature(
    id: string,
    staticAbilities: string[]
): string {
    preloadDefinitions([
        {
            id,
            name: `Synthetic ${id}`,
            rarity: "rare",
            manaCost: { X: 1, W: 1 },
            types: ["Creature"],
            subtypes: ["Human"],
            power: 1,
            toughness: 3,
            staticAbilities,
        } as CardDefinition,
    ]);
    return id;
}

/** p1 attacks with the mobilize creature; DECLARE_ATTACKERS, combat open. */
function boardWith(attackerCardId: string): GameState {
    const attacker = makeInstance(attackerCardId, {
        id: "atk",
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
        isTapped: true,
        hasAttackedThisTurn: true,
    });
    return makeState({
        players: [
            makePlayer("p1", { battlefield: [attacker] }),
            makePlayer("p2"),
        ],
        phase: "DECLARE_ATTACKERS",
        activePlayerId: "p1",
        combat: {
            attackerIds: [attacker.id],
            confirmed: true,
            blockerAssignments: {},
            blockersConfirmed: false,
        },
    });
}

/** Emits the real CR 508.1 event and pushes the triggers it produces. */
function declareAttackers(state: GameState): number {
    const event: GameEvent = {
        type: "ATTACKERS_DECLARED",
        attackingPlayerId: state.activePlayerId,
        attackerIds: [...state.combat!.attackerIds],
    };
    const triggers = collectTriggers(state, [event]);
    placeTriggersOnStack(state, triggers);
    return triggers.length;
}

function warriors(state: GameState) {
    return state.players[0].battlefield.filter((c) => c.isToken === true);
}

describe("Mobilize N — Mechanics Registry (CR 702.181)", () => {
    it("the numbered keyword resolves to an `implemented` row", () => {
        expect(isNamedMechanic("mobilize 2")).toBe(true);
        const row = MECHANICS_REGISTRY.find((r) => r.id === "mobilize")!;
        expect(row.status).toBe("implemented");
        expect(row.bindingPattern!.test("mobilize 2")).toBe(true);
    });
});

describe("Mobilize N — expansion (CR 702.181a)", () => {
    it("injects one attack trigger per instance, keyed on N", () => {
        const def = expandMobilize({
            id: "synthetic-mobilize-shape",
            name: "Synthetic",
            rarity: "common",
            manaCost: { X: 1 },
            types: ["Creature"],
            power: 1,
            toughness: 1,
            staticAbilities: ["mobilize 2", "mobilize 1"],
        } as CardDefinition);
        expect(def.triggeredAbilities!.map((t) => t.id)).toEqual([
            mobilizeTriggerId(2),
            mobilizeTriggerId(1),
        ]);
        expect(def.triggeredAbilities![0].oracleText).toBe(
            mobilizeOracleText(2)
        );
        // Idempotent — a second pass injects nothing.
        expect(expandMobilize(def)).toBe(def);
    });

    it("the injected body is a valid Effect Script (createToken.bindAll → delayedTrigger list capture)", () => {
        expect(
            validateAbilityEffectScript(
                mobilizeTrigger(2),
                "Mobilize 2",
                "ATTACKERS_DECLARED"
            )
        ).toEqual([]);
    });
});

describe("Mobilize N — game flow (CR 702.181a / 508.4 / 603.7a)", () => {
    const MOBILIZE_2 = registerMobilizeCreature("synthetic-mobilize-2", [
        "mobilize 2",
    ]);

    it("attacking creates N tapped, attacking 1/1 red Warriors that were never declared", () => {
        const state = boardWith(MOBILIZE_2);
        expect(getDefinition(MOBILIZE_2).triggeredAbilities).toHaveLength(1);
        expect(declareAttackers(state)).toBe(1);
        resolveTopOfStack(state);

        const tokens = warriors(state);
        expect(tokens).toHaveLength(2);
        for (const t of tokens) {
            expect(t.isToken).toBe(true);
            expect(t.isTapped).toBe(true);
            expect(t.isAttacking).toBe(true);
            expect(t.power).toBe(1);
            expect(t.toughness).toBe(1);
            // The synthesized token definition is the shared 1/1 red Warrior.
            const def = getDefinition(t.card.id);
            expect(def.name).toBe(WARRIOR_TOKEN.name);
            expect(def.subtypes).toContain("Warrior");
            expect(def.manaCost).toEqual({ R: 1 }); // colour-carrying (CR 202.2)
            // CR 508.4 — put onto the battlefield attacking, never declared:
            // "whenever a creature attacks" never saw it.
            expect(t.hasAttackedThisTurn).toBeFalsy();
            expect(state.combat!.attackerIds).toContain(t.id);
        }
    });

    it("the tokens do not themselves fire attackers-declared triggers", () => {
        const state = boardWith(MOBILIZE_2);
        declareAttackers(state);
        resolveTopOfStack(state);
        // Only the mobilize creature itself was declared; nothing new on the
        // stack after the tokens joined combat.
        expect(state.stack).toHaveLength(0);
        expect(warriors(state)).toHaveLength(2);
    });

    it("schedules ONE delayed trigger that sacrifices all N tokens at the next end step", () => {
        const state = boardWith(MOBILIZE_2);
        declareAttackers(state);
        resolveTopOfStack(state);
        const ids = warriors(state).map((t) => t.id);

        expect(state.delayedTriggers).toHaveLength(1);
        expect(state.delayedTriggers![0].timing).toBe("next-end-step");

        fireDelayedTriggers(state, "next-end-step");
        expect(state.stack).toHaveLength(1);
        resolveTopOfStack(state);

        expect(warriors(state)).toHaveLength(0);
        for (const id of ids) {
            expect(state.players[0].battlefield.some((c) => c.id === id)).toBe(
                false
            );
        }
        // The mobilize creature itself is untouched.
        expect(state.players[0].battlefield.some((c) => c.id === "atk")).toBe(
            true
        );
        expect(state.delayedTriggers ?? []).toHaveLength(0);
    });

    it("a token already gone when the end step begins is skipped; the rest are sacrificed", () => {
        const state = boardWith(MOBILIZE_2);
        declareAttackers(state);
        resolveTopOfStack(state);
        const [first] = warriors(state);
        state.players[0].battlefield = state.players[0].battlefield.filter(
            (c) => c.id !== first.id
        );
        fireDelayedTriggers(state, "next-end-step");
        resolveTopOfStack(state);
        expect(warriors(state)).toHaveLength(0);
    });

    it("the tokens reach the client as attacking permanents", () => {
        const state = boardWith(MOBILIZE_2);
        declareAttackers(state);
        resolveTopOfStack(state);
        const view = projectPublicState(state, "p2");
        const projected = view.players[0].battlefield.filter(
            (c) => c.id !== "atk"
        );
        expect(projected).toHaveLength(2);
        for (const t of projected) expect(t.isAttacking).toBe(true);
    });
});
