// Granted persist (CR 702.79a) and undying (CR 702.93a): the trigger comes from the
// live keyword multiset, and because it is a leaves-the-battlefield ability it looks
// back at the multiset the permanent left with (CR 603.10a).

import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
    resolveTriggerOrder,
} from "../../cards/__tests__/setup.helper";
import { withTemporaryDefinition } from "../../cards/registry";
import type { CardDefinition, PermanentView } from "../../cards/types";
import { projectPublicState } from "../../gameProjections";
import { compactState, expandState } from "../serialize";
import {
    beginApplyingStaticEffects,
    buildSpellContext,
    processPendingActionTriggers,
    removePermanentTo,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
} from "../state";

const vanilla: CardDefinition = {
    id: "test-only-vanilla",
    rarity: "common",
    name: "Test Vanilla",
    manaCost: { C: 2 },
    types: ["Creature"],
    subtypes: ["Bear"],
    power: 2,
    toughness: 2,
};

const printedUndying: CardDefinition = {
    ...vanilla,
    id: "test-only-printed-undying",
    name: "Test Printed Undying",
    staticAbilities: ["undying"],
};

function grantSpell(keyword: string): CardDefinition {
    return {
        id: `test-only-gain-${keyword}`,
        rarity: "common",
        name: `Test Gain ${keyword}`,
        manaCost: { B: 1 },
        types: ["Instant"],
        targetRequirement: { type: "Creature", count: 1 },
        effects: [
            {
                op: "grantAbility",
                target: { target: 0 },
                ability: keyword,
                duration: { phase: "end-of-turn" },
            },
        ],
    };
}

const undyingAura: CardDefinition = {
    id: "test-only-undying-aura",
    rarity: "common",
    name: "Test Undying Aura",
    manaCost: { B: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],

    staticEffects: [
        {
            kind: "keyword-grant",
            applies: (target: PermanentView, source: PermanentView) =>
                source.attachedTo === target.id,
            keyword: "undying",
        },
    ],
};

const undyingAnthem: CardDefinition = {
    id: "test-only-undying-anthem",
    rarity: "common",
    name: "Test Undying Anthem",
    manaCost: { C: 3 },
    types: ["Artifact"],
    staticEffects: [
        {
            kind: "keyword-grant",
            applies: (target: PermanentView) =>
                target.subtypes.includes("Bear"),
            keyword: "undying",
        },
    ],
};

const DEFS = [
    vanilla,
    printedUndying,
    grantSpell("undying"),
    grantSpell("persist"),
    undyingAura,
    undyingAnthem,
];

function withDefs(run: () => void, defs = DEFS): void {
    const [head, ...rest] = defs;
    if (!head) return run();
    withTemporaryDefinition(head, () => withDefs(run, rest));
}

function mine(def: CardDefinition, id: string): CardInstanceState {
    return makeInstance(def.id, {
        id,
        controllerId: "p1",
        ownerId: "p1",
        isSummoningSick: false,
    });
}

function board(cards: CardInstanceState[]): GameState {
    return makeState({
        players: [
            makePlayer("p1", { battlefield: cards }),
            makePlayer("p2", { battlefield: [] }),
        ],
    });
}

function cast(state: GameState, keyword: string, targetId: string): void {
    pushSpell(state, `test-only-gain-${keyword}`, "p1", [
        { type: "permanent", id: targetId },
    ]);
    resolveTopOfStack(state);
}

function destroy(state: GameState, id: string): void {
    removePermanentTo(state, id, "graveyard", "destroy");
    processPendingActionTriggers(state);
    resolveTriggerOrder(state);
}

function onStack(state: GameState, abilityId: string): number {
    return state.stack.filter((s) => s.triggeredAbilityId === abilityId).length;
}

function drain(state: GameState): void {
    resolveTriggerOrder(state);
    while (state.stack.length > 0) resolveTopOfStack(state);
}

function onBattlefield(state: GameState, id: string) {
    return state.players[0].battlefield.find((c) => c.id === id);
}

describe("A one-shot grant (CR 702.93a, CR 702.79a)", () => {
    it("gains undying, dies: returns with a +1/+1 counter and without the grant", () => {
        withDefs(() => {
            const state = board([mine(vanilla, "bear")]);
            cast(state, "undying", "bear");
            destroy(state, "bear");
            expect(onStack(state, "undying")).toBe(1);
            drain(state);
            const back = onBattlefield(state, "bear")!;
            expect(back.counters).toEqual({ "+1/+1": 1 });
            expect(back.staticAbilities).not.toContain("undying");
            expect(back.keywordsAtLeave).toBeUndefined();
        });
    });

    it("gains persist, dies: returns with a -1/-1 counter", () => {
        withDefs(() => {
            const state = board([mine(vanilla, "bear")]);
            cast(state, "persist", "bear");
            destroy(state, "bear");
            expect(onStack(state, "persist")).toBe(1);
            drain(state);
            expect(onBattlefield(state, "bear")?.counters).toEqual({
                "-1/-1": 1,
            });
        });
    });

    it("gains undying with a +1/+1 counter on it: stays dead (CR 603.4)", () => {
        withDefs(() => {
            const bear = mine(vanilla, "bear");
            bear.counters = { "+1/+1": 1 };
            const state = board([bear]);
            cast(state, "undying", "bear");
            destroy(state, "bear");
            expect(onStack(state, "undying")).toBe(0);
        });
    });

    it("no grant, no keyword: no trigger", () => {
        withDefs(() => {
            const state = board([mine(vanilla, "bear")]);
            destroy(state, "bear");
            expect(onStack(state, "undying")).toBe(0);
        });
    });

    it("exiled instead of dying: no trigger", () => {
        withDefs(() => {
            const state = board([mine(vanilla, "bear")]);
            cast(state, "undying", "bear");
            removePermanentTo(state, "bear", "exile", "destroy");
            processPendingActionTriggers(state);
            expect(onStack(state, "undying")).toBe(0);
        });
    });
});

describe("The look-back reads the multiset it left with (CR 603.10a)", () => {
    it("an Aura's grant counts, though the Aura stops applying on the way out", () => {
        withDefs(() => {
            const aura = mine(undyingAura, "aura");
            aura.attachedTo = "bear";
            const state = board([mine(vanilla, "bear"), aura]);
            beginApplyingStaticEffects(state, aura);
            expect(onBattlefield(state, "bear")?.staticAbilities).toContain(
                "undying"
            );
            destroy(state, "bear");
            expect(onStack(state, "undying")).toBe(1);
        });
    });

    it("an anthem's grant counts, and the returned creature has it again", () => {
        withDefs(() => {
            const anthem = mine(undyingAnthem, "anthem");
            const state = board([mine(vanilla, "bear"), anthem]);
            beginApplyingStaticEffects(state, anthem);
            destroy(state, "bear");
            expect(onStack(state, "undying")).toBe(1);
            drain(state);
            expect(onBattlefield(state, "bear")?.staticAbilities).toContain(
                "undying"
            );
        });
    });

    it("printed and granted are two instances; the second finds no card (CR 400.7)", () => {
        withDefs(() => {
            const state = board([mine(printedUndying, "bear")]);
            cast(state, "undying", "bear");
            destroy(state, "bear");
            expect(onStack(state, "undying")).toBe(2);
            drain(state);
            expect(onBattlefield(state, "bear")?.counters).toEqual({
                "+1/+1": 1,
            });
        });
    });

    it("a printed undying that lost all its abilities stays dead (CR 613.1f)", () => {
        withDefs(() => {
            const bear = mine(printedUndying, "bear");
            const state = board([bear]);
            const ctx = buildSpellContext(
                state,
                pushSpell(state, vanilla.id, "p1")
            );
            ctx.loseAllAbilities({ type: "permanent", id: bear.id });
            state.stack.length = 0;
            destroy(state, "bear");
            expect(onStack(state, "undying")).toBe(0);
        });
    });
});

describe("Granted undying on the stack", () => {
    it("survives a save and load, and still finds the ability at resolution", () => {
        withDefs(() => {
            const state = board([mine(vanilla, "bear")]);
            cast(state, "undying", "bear");
            destroy(state, "bear");
            const loaded = expandState(compactState(state));
            expect(onStack(loaded, "undying")).toBe(1);
            drain(loaded);
            expect(onBattlefield(loaded, "bear")?.counters).toEqual({
                "+1/+1": 1,
            });
        });
    });

    it("wire: the item and the returned counter reach the client", () => {
        withDefs(() => {
            const state = board([mine(vanilla, "bear")]);
            cast(state, "undying", "bear");
            destroy(state, "bear");
            const before = projectPublicState(state, 1, "p2");
            expect(
                before.stack.find((s) => s.triggeredAbilityId === "undying")
            ).toBeDefined();
            drain(state);
            const after = projectPublicState(state, 2, "p2");
            const slim = after.players[0].battlefield.find(
                (c) => c.id === "bear"
            )!;
            expect(slim.counters).toEqual({ "+1/+1": 1 });
        });
    });
});
