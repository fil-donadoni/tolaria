// Dethrone (CR 702.105).
//
// CR 702.105a — "Whenever this creature attacks the player with the most life or
// tied for most life, put a +1/+1 counter on this creature."
// CR 702.105b — "If a creature has multiple instances of dethrone, each triggers
// separately."
//
// The trigger is derived from the live keyword multiset, so every board here goes
// through the production path: `emitAttackersDeclaredEvents` → the trigger scan →
// the stack → `resolveTopOfStack`.

import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
    resolveTriggerOrder,
} from "../../cards/__tests__/setup.helper";
import {
    DETHRONE_TRIGGER,
    DETHRONE_TRIGGER_ID,
} from "../../cards/abilities/dethrone";
import { withTemporaryDefinition } from "../../cards/registry";
import type { CardDefinition, PermanentView } from "../../cards/types";
import { projectPublicState } from "../../gameProjections";
import { validateAbilityEffectScript } from "../effects/validate";
import { getEffectivePower, getEffectiveToughness } from "../layers";
import { emitAttackersDeclaredEvents } from "../phases";
import { checkStateBasedActions } from "../sba";
import { compactState, expandState } from "../serialize";
import {
    beginApplyingStaticEffects,
    buildSpellContext,
    removePermanentTo,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
} from "../state";

const DETHRONER: CardDefinition = {
    id: "test-only-dethroner",
    rarity: "common",
    name: "Test Dethroner",
    oracleText: "Dethrone",
    manaCost: { X: 2, R: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Warrior"],
    power: 2,
    toughness: 1,
    staticAbilities: ["dethrone"],
};

const VANILLA: CardDefinition = {
    id: "test-only-vanilla",
    rarity: "common",
    name: "Test Vanilla",
    oracleText: "",
    manaCost: { X: 1, G: 1 },
    types: ["Creature"],
    subtypes: ["Bear"],
    power: 2,
    toughness: 2,
};

const DETHRONE_ANTHEM: CardDefinition = {
    id: "test-only-dethrone-anthem",
    rarity: "common",
    name: "Test Dethrone Anthem",
    oracleText: "All Bear creatures have dethrone.",
    manaCost: { X: 1 },
    types: ["Artifact"],
    staticEffects: [
        {
            kind: "keyword-grant",
            applies: (target: PermanentView) =>
                target.subtypes.includes("Bear"),
            keyword: "dethrone",
        },
    ],
};

function withDefs(run: () => void): void {
    withTemporaryDefinition(DETHRONER, () =>
        withTemporaryDefinition(VANILLA, () =>
            withTemporaryDefinition(DETHRONE_ANTHEM, run)
        )
    );
}

function attackerOf(def: CardDefinition): CardInstanceState {
    return makeInstance(def.id, {
        id: "atk",
        controllerId: "p1",
        ownerId: "p1",
    });
}

function combat(
    attacker: CardInstanceState,
    life: { attacker: number; defender: number },
    options: {
        attackTargets?: Record<string, string>;
        defenderBattlefield?: CardInstanceState[];
        attackerExtra?: CardInstanceState[];
    } = {}
): GameState {
    attacker.isAttacking = true;
    return makeState({
        players: [
            makePlayer("p1", {
                life: life.attacker,
                battlefield: [attacker, ...(options.attackerExtra ?? [])],
            }),
            makePlayer("p2", {
                life: life.defender,
                battlefield: options.defenderBattlefield ?? [],
            }),
        ],
        phase: "DECLARE_ATTACKERS",
        combat: {
            attackerIds: [attacker.id],
            confirmed: true,
            blockerAssignments: {},
            blockersConfirmed: false,
            attackTargets: options.attackTargets,
        },
    });
}

function dethroneOnStack(state: GameState): number {
    return state.stack.filter(
        (s) => s.triggeredAbilityId === DETHRONE_TRIGGER_ID
    ).length;
}

function resolveStack(state: GameState): void {
    resolveTriggerOrder(state);
    while (state.stack.length > 0) resolveTopOfStack(state);
    checkStateBasedActions(state);
}

function ptOf(state: GameState, card: CardInstanceState): [number, number] {
    return [getEffectivePower(state, card), getEffectiveToughness(state, card)];
}

describe("Dethrone (CR 702.105a)", () => {
    it("the body is a valid script on ATTACKERS_DECLARED", () => {
        expect(
            validateAbilityEffectScript(
                DETHRONE_TRIGGER,
                "Dethrone",
                "ATTACKERS_DECLARED"
            )
        ).toEqual([]);
    });

    it("the defending player has the most life: a +1/+1 counter", () => {
        withDefs(() => {
            const atk = attackerOf(DETHRONER);
            const state = combat(atk, { attacker: 10, defender: 20 });
            emitAttackersDeclaredEvents(state);
            expect(dethroneOnStack(state)).toBe(1);
            resolveStack(state);
            expect(atk.counters?.["+1/+1"]).toBe(1);
            expect(ptOf(state, atk)).toEqual([3, 2]);
        });
    });

    it("tied for most life still triggers", () => {
        withDefs(() => {
            const state = combat(attackerOf(DETHRONER), {
                attacker: 20,
                defender: 20,
            });
            emitAttackersDeclaredEvents(state);
            expect(dethroneOnStack(state)).toBe(1);
        });
    });

    it("the attacker's controller has the most life: no trigger", () => {
        withDefs(() => {
            const state = combat(attackerOf(DETHRONER), {
                attacker: 21,
                defender: 20,
            });
            emitAttackersDeclaredEvents(state);
            expect(dethroneOnStack(state)).toBe(0);
        });
    });

    it("attacking a planeswalker is not attacking the player (CR 508.3a)", () => {
        withDefs(() => {
            const walker = makeInstance(VANILLA.id, {
                id: "pw",
                controllerId: "p2",
                ownerId: "p2",
            });
            const state = combat(
                attackerOf(DETHRONER),
                { attacker: 10, defender: 20 },
                {
                    attackTargets: { atk: walker.id },
                    defenderBattlefield: [walker],
                }
            );
            emitAttackersDeclaredEvents(state);
            expect(dethroneOnStack(state)).toBe(0);
        });
    });

    it("another attacker's target does not change this creature's own defender", () => {
        withDefs(() => {
            const atk = attackerOf(DETHRONER);
            const state = combat(
                atk,
                { attacker: 10, defender: 20 },
                { attackTargets: { other: "pw" } }
            );
            emitAttackersDeclaredEvents(state);
            expect(dethroneOnStack(state)).toBe(1);
        });
    });

    it("only an attacking dethroner triggers", () => {
        withDefs(() => {
            const home = makeInstance(DETHRONER.id, {
                id: "home",
                controllerId: "p1",
                ownerId: "p1",
            });
            const state = combat(
                attackerOf(VANILLA),
                { attacker: 10, defender: 20 },
                { attackerExtra: [home] }
            );
            emitAttackersDeclaredEvents(state);
            expect(dethroneOnStack(state)).toBe(0);
        });
    });
});

describe("Dethrone granted at runtime", () => {
    it("a static grant makes a vanilla attacker dethrone", () => {
        withDefs(() => {
            const atk = attackerOf(VANILLA);
            const anthem = makeInstance(DETHRONE_ANTHEM.id, {
                id: "anthem",
                controllerId: "p1",
                ownerId: "p1",
            });
            const state = combat(
                atk,
                { attacker: 10, defender: 20 },
                { attackerExtra: [anthem] }
            );
            beginApplyingStaticEffects(state, anthem);
            expect(atk.staticAbilities).toContain("dethrone");
            emitAttackersDeclaredEvents(state);
            expect(dethroneOnStack(state)).toBe(1);
        });
    });

    it("a one-shot grant makes it dethrone", () => {
        withDefs(() => {
            const atk = attackerOf(VANILLA);
            const state = combat(atk, { attacker: 10, defender: 20 });
            const ctx = buildSpellContext(
                state,
                pushSpell(state, VANILLA.id, "p1")
            );
            ctx.grantStaticAbilityPermanent(
                { type: "permanent", id: atk.id },
                "dethrone"
            );
            state.stack.length = 0;
            emitAttackersDeclaredEvents(state);
            expect(dethroneOnStack(state)).toBe(1);
        });
    });

    it("each instance triggers separately (CR 702.105b)", () => {
        withDefs(() => {
            const atk = attackerOf(DETHRONER);
            atk.staticAbilities = ["dethrone", "dethrone"];
            const state = combat(atk, { attacker: 20, defender: 20 });
            emitAttackersDeclaredEvents(state);
            expect(dethroneOnStack(state)).toBe(2);
            resolveStack(state);
            expect(atk.counters?.["+1/+1"]).toBe(2);
        });
    });

    it("a creature that lost all its abilities does not trigger (CR 613.1f)", () => {
        withDefs(() => {
            const atk = attackerOf(DETHRONER);
            const state = combat(atk, { attacker: 10, defender: 20 });
            const ctx = buildSpellContext(
                state,
                pushSpell(state, VANILLA.id, "p1")
            );
            ctx.loseAllAbilities({ type: "permanent", id: atk.id });
            state.stack.length = 0;
            emitAttackersDeclaredEvents(state);
            expect(dethroneOnStack(state)).toBe(0);
        });
    });
});

describe("Dethrone on the stack", () => {
    it("a life change in response does not stop the counter (CR 603.4 does not apply)", () => {
        withDefs(() => {
            const atk = attackerOf(DETHRONER);
            const state = combat(atk, { attacker: 10, defender: 20 });
            emitAttackersDeclaredEvents(state);
            state.players[0].life = 30;
            resolveStack(state);
            expect(atk.counters?.["+1/+1"]).toBe(1);
        });
    });

    it("a source that left the battlefield takes no counter and the stack clears", () => {
        withDefs(() => {
            const atk = attackerOf(DETHRONER);
            const state = combat(atk, { attacker: 10, defender: 20 });
            emitAttackersDeclaredEvents(state);
            removePermanentTo(state, atk.id, "graveyard");
            resolveStack(state);
            expect(state.stack).toHaveLength(0);
            expect(state.players[0].graveyard.map((c) => c.id)).toContain(
                atk.id
            );
            expect(
                state.players[0].graveyard.find((c) => c.id === atk.id)
                    ?.counters?.["+1/+1"] ?? 0
            ).toBe(0);
        });
    });

    it("survives a save and load while on the stack", () => {
        withDefs(() => {
            const atk = attackerOf(VANILLA);
            const state = combat(atk, { attacker: 10, defender: 20 });
            const ctx = buildSpellContext(
                state,
                pushSpell(state, VANILLA.id, "p1")
            );
            ctx.grantStaticAbilityPermanent(
                { type: "permanent", id: atk.id },
                "dethrone"
            );
            state.stack.length = 0;
            emitAttackersDeclaredEvents(state);
            const loaded = expandState(compactState(state));
            resolveStack(loaded);
            const reloaded = loaded.players[0].battlefield.find(
                (c) => c.id === atk.id
            )!;
            expect(reloaded.counters?.["+1/+1"]).toBe(1);
        });
    });

    it("wire: the item and the attacker's P/T reach the client", () => {
        withDefs(() => {
            const atk = attackerOf(DETHRONER);
            const state = combat(atk, { attacker: 10, defender: 20 });
            emitAttackersDeclaredEvents(state);
            const before = projectPublicState(state, 1, "p2");
            expect(
                before.stack.find(
                    (s) => s.triggeredAbilityId === DETHRONE_TRIGGER_ID
                )
            ).toBeDefined();

            resolveStack(state);
            const after = projectPublicState(state, 2, "p2");
            const slim = after.players[0].battlefield.find(
                (c) => c.id === atk.id
            )!;
            expect(getEffectivePower(after, slim)).toBe(3);
            expect(getEffectiveToughness(after, slim)).toBe(2);
        });
    });
});
