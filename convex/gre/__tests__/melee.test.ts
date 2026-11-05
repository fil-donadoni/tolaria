// Melee (CR 702.121).
//
// CR 702.121a — "Whenever this creature attacks, it gets +1/+1 until end of turn
// for each opponent you attacked with a creature this combat."
// CR 702.121b — "If a creature has multiple instances of melee, each triggers
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
import { MELEE_TRIGGER, MELEE_TRIGGER_ID } from "../../cards/abilities/melee";
import { withTemporaryDefinition } from "../../cards/registry";
import type { CardDefinition, PermanentView } from "../../cards/types";
import { projectPublicState } from "../../gameProjections";
import { joinCombatAttacking, opponentsAttackedThisCombat } from "../combat";
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

const MELEE_BEAR: CardDefinition = {
    id: "test-only-melee-bear",
    rarity: "common",
    name: "Test Melee Bear",
    oracleText: "Melee",
    manaCost: { X: 1, R: 1 },
    types: ["Creature"],
    subtypes: ["Human"],
    power: 2,
    toughness: 2,
    staticAbilities: ["melee"],
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

const MELEE_ANTHEM: CardDefinition = {
    id: "test-only-melee-anthem",
    rarity: "common",
    name: "Test Melee Anthem",
    oracleText: "All Bear creatures have melee.",
    manaCost: { X: 1 },
    types: ["Artifact"],
    staticEffects: [
        {
            kind: "keyword-grant",
            applies: (target: PermanentView) =>
                target.subtypes.includes("Bear"),
            keyword: "melee",
        },
    ],
};

const PLANESWALKER_ID = "pw";

function withDefs(run: () => void): void {
    withTemporaryDefinition(MELEE_BEAR, () =>
        withTemporaryDefinition(VANILLA, () =>
            withTemporaryDefinition(MELEE_ANTHEM, run)
        )
    );
}

function creature(def: CardDefinition, id: string): CardInstanceState {
    return makeInstance(def.id, {
        id,
        controllerId: "p1",
        ownerId: "p1",
        isAttacking: true,
    });
}

function combat(
    attackers: CardInstanceState[],
    options: {
        attackTargets?: Record<string, string>;
        extra?: CardInstanceState[];
    } = {}
): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: [...attackers, ...(options.extra ?? [])],
            }),
            makePlayer("p2"),
        ],
        phase: "DECLARE_ATTACKERS",
        combat: {
            attackerIds: attackers.map((a) => a.id),
            confirmed: true,
            blockerAssignments: {},
            blockersConfirmed: false,
            attackTargets: options.attackTargets,
        },
    });
}

function meleeOnStack(state: GameState): number {
    return state.stack.filter((s) => s.triggeredAbilityId === MELEE_TRIGGER_ID)
        .length;
}

function resolveStack(state: GameState): void {
    resolveTriggerOrder(state);
    while (state.stack.length > 0) resolveTopOfStack(state);
    checkStateBasedActions(state);
}

function ptOf(state: GameState, card: CardInstanceState): [number, number] {
    return [getEffectivePower(state, card), getEffectiveToughness(state, card)];
}

describe("Melee (CR 702.121a)", () => {
    it("the body is a valid script on ATTACKERS_DECLARED", () => {
        expect(
            validateAbilityEffectScript(
                MELEE_TRIGGER,
                "Melee",
                "ATTACKERS_DECLARED"
            )
        ).toEqual([]);
    });

    it("attacking the opponent: +1/+1 until end of turn", () => {
        withDefs(() => {
            const atk = creature(MELEE_BEAR, "atk");
            const state = combat([atk]);
            emitAttackersDeclaredEvents(state);
            expect(meleeOnStack(state)).toBe(1);
            resolveStack(state);
            expect(ptOf(state, atk)).toEqual([3, 3]);
        });
    });

    it("attacking only a planeswalker: triggers, and no opponent was attacked", () => {
        withDefs(() => {
            const atk = creature(MELEE_BEAR, "atk");
            const state = combat([atk], {
                attackTargets: { atk: PLANESWALKER_ID },
            });
            emitAttackersDeclaredEvents(state);
            expect(meleeOnStack(state)).toBe(1);
            expect(state.combat?.attackedPlayerIds).toBeUndefined();
            resolveStack(state);
            expect(ptOf(state, atk)).toEqual([2, 2]);
        });
    });

    it("another creature attacking the opponent counts for the one at the planeswalker", () => {
        withDefs(() => {
            const atk = creature(MELEE_BEAR, "atk");
            const other = creature(VANILLA, "other");
            const state = combat([atk, other], {
                attackTargets: { atk: PLANESWALKER_ID },
            });
            emitAttackersDeclaredEvents(state);
            resolveStack(state);
            expect(ptOf(state, atk)).toEqual([3, 3]);
        });
    });

    it("the only creature that attacked the opponent dying in response changes nothing", () => {
        withDefs(() => {
            const atk = creature(MELEE_BEAR, "atk");
            const other = creature(VANILLA, "other");
            const state = combat([atk, other], {
                attackTargets: { atk: PLANESWALKER_ID },
            });
            emitAttackersDeclaredEvents(state);
            removePermanentTo(state, other.id, "graveyard");
            resolveStack(state);
            expect(ptOf(state, atk)).toEqual([3, 3]);
        });
    });

    it("removing it from combat in response changes nothing either", () => {
        withDefs(() => {
            const atk = creature(MELEE_BEAR, "atk");
            const other = creature(VANILLA, "other");
            const state = combat([atk, other], {
                attackTargets: { atk: PLANESWALKER_ID },
            });
            emitAttackersDeclaredEvents(state);
            const ctx = buildSpellContext(
                state,
                pushSpell(state, VANILLA.id, "p1")
            );
            ctx.removeFromCombat({ type: "permanent", id: other.id });
            state.stack.pop();
            resolveStack(state);
            expect(state.combat?.attackerIds).not.toContain(other.id);
            expect(ptOf(state, atk)).toEqual([3, 3]);
        });
    });

    it("a creature put onto the battlefield attacking never attacked (CR 508.4)", () => {
        withDefs(() => {
            const atk = creature(MELEE_BEAR, "atk");
            const state = combat([atk], {
                attackTargets: { atk: PLANESWALKER_ID },
            });
            emitAttackersDeclaredEvents(state);
            const token = makeInstance(VANILLA.id, {
                id: "token",
                controllerId: "p1",
                ownerId: "p1",
            });
            state.players[0].battlefield.push(token);
            joinCombatAttacking(state, token);
            expect(token.isAttacking).toBe(true);
            resolveStack(state);
            expect(ptOf(state, atk)).toEqual([2, 2]);
        });
    });

    it("a later combat this turn reads its own declaration", () => {
        withDefs(() => {
            const atk = creature(MELEE_BEAR, "atk");
            const state = combat([atk]);
            emitAttackersDeclaredEvents(state);
            state.stack.length = 0;
            state.combat = {
                attackerIds: [atk.id],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: false,
                attackTargets: { atk: PLANESWALKER_ID },
            };
            emitAttackersDeclaredEvents(state);
            resolveStack(state);
            expect(ptOf(state, atk)).toEqual([2, 2]);
        });
    });

    it("only an attacking melee creature triggers", () => {
        withDefs(() => {
            const home = makeInstance(MELEE_BEAR.id, {
                id: "home",
                controllerId: "p1",
                ownerId: "p1",
            });
            const state = combat([creature(VANILLA, "atk")], { extra: [home] });
            emitAttackersDeclaredEvents(state);
            expect(meleeOnStack(state)).toBe(0);
        });
    });

    it("the defending player attacked nobody", () => {
        withDefs(() => {
            const state = combat([creature(VANILLA, "atk")]);
            emitAttackersDeclaredEvents(state);
            expect(opponentsAttackedThisCombat(state, "p1")).toBe(1);
            expect(opponentsAttackedThisCombat(state, "p2")).toBe(0);
        });
    });
});

describe("Melee granted at runtime", () => {
    function anthem(id: string): CardInstanceState {
        return makeInstance(MELEE_ANTHEM.id, {
            id,
            controllerId: "p1",
            ownerId: "p1",
        });
    }

    it("a static grant makes a vanilla attacker melee", () => {
        withDefs(() => {
            const atk = creature(VANILLA, "atk");
            const source = anthem("anthem");
            const state = combat([atk], { extra: [source] });
            beginApplyingStaticEffects(state, source);
            expect(atk.staticAbilities).toContain("melee");
            emitAttackersDeclaredEvents(state);
            expect(meleeOnStack(state)).toBe(1);
            resolveStack(state);
            expect(ptOf(state, atk)).toEqual([3, 3]);
        });
    });

    it("two static grants are two instances, each triggering (CR 702.121b)", () => {
        withDefs(() => {
            const atk = creature(VANILLA, "atk");
            const first = anthem("anthem-1");
            const second = anthem("anthem-2");
            const state = combat([atk], { extra: [first, second] });
            beginApplyingStaticEffects(state, first);
            beginApplyingStaticEffects(state, second);
            emitAttackersDeclaredEvents(state);
            expect(meleeOnStack(state)).toBe(2);
            resolveStack(state);
            expect(ptOf(state, atk)).toEqual([4, 4]);
        });
    });

    it("a one-shot grant makes it melee", () => {
        withDefs(() => {
            const atk = creature(VANILLA, "atk");
            const state = combat([atk]);
            const ctx = buildSpellContext(
                state,
                pushSpell(state, VANILLA.id, "p1")
            );
            ctx.grantStaticAbilityPermanent(
                { type: "permanent", id: atk.id },
                "melee"
            );
            state.stack.length = 0;
            emitAttackersDeclaredEvents(state);
            expect(meleeOnStack(state)).toBe(1);
        });
    });

    it("a creature that lost all its abilities does not trigger (CR 613.1f)", () => {
        withDefs(() => {
            const atk = creature(MELEE_BEAR, "atk");
            const state = combat([atk]);
            const ctx = buildSpellContext(
                state,
                pushSpell(state, VANILLA.id, "p1")
            );
            ctx.loseAllAbilities({ type: "permanent", id: atk.id });
            state.stack.length = 0;
            emitAttackersDeclaredEvents(state);
            expect(meleeOnStack(state)).toBe(0);
        });
    });
});

describe("Melee on the stack", () => {
    it("a source that left the battlefield takes no pump and the stack clears", () => {
        withDefs(() => {
            const atk = creature(MELEE_BEAR, "atk");
            const state = combat([atk]);
            emitAttackersDeclaredEvents(state);
            removePermanentTo(state, atk.id, "graveyard");
            resolveStack(state);
            expect(state.stack).toHaveLength(0);
            expect(state.players[0].graveyard.map((c) => c.id)).toContain(
                atk.id
            );
        });
    });

    it("the declaration's record survives a save and load while on the stack", () => {
        withDefs(() => {
            const atk = creature(MELEE_BEAR, "atk");
            const state = combat([atk]);
            emitAttackersDeclaredEvents(state);
            const loaded = expandState(compactState(state));
            resolveStack(loaded);
            const reloaded = loaded.players[0].battlefield.find(
                (c) => c.id === atk.id
            )!;
            expect(ptOf(loaded, reloaded)).toEqual([3, 3]);
        });
    });

    it("wire: the item, the record and the attacker's P/T reach the client", () => {
        withDefs(() => {
            const atk = creature(MELEE_BEAR, "atk");
            const state = combat([atk]);
            emitAttackersDeclaredEvents(state);
            const before = projectPublicState(state, 1, "p2");
            expect(
                before.stack.find(
                    (s) => s.triggeredAbilityId === MELEE_TRIGGER_ID
                )
            ).toBeDefined();
            expect(before.combat?.attackedPlayerIds).toEqual(["p2"]);

            resolveStack(state);
            const after = projectPublicState(state, 2, "p2");
            const slim = after.players[0].battlefield.find(
                (c) => c.id === atk.id
            )!;
            expect(getEffectivePower(after, slim)).toBe(3);
            expect(getEffectiveToughness(after, slim)).toBe(3);
        });
    });
});
