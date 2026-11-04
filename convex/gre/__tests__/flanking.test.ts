// Flanking (CR 702.25, issue #3994).
//
// CR 702.25a — "Whenever this creature becomes blocked by a creature without
// flanking, the blocking creature gets -1/-1 until end of turn."
// CR 702.25b — "If a creature has multiple instances of flanking, each triggers
// separately."
//
// The trigger is derived from the live layer-6 multiset, so every board here goes
// through the production path: `emitBlockersConfirmedEvents` → the trigger scan →
// the stack → `resolveTopOfStack`. Grants go through the real SpellContext and
// static-effect seams, because a grant is what a `getDefinition` expansion misses.

import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
    resolveTriggerOrder,
} from "../../cards/__tests__/setup.helper";
import {
    FLANKING_TRIGGER,
    FLANKING_TRIGGER_ID,
} from "../../cards/abilities/flanking";
import { withTemporaryDefinition } from "../../cards/registry";
import type { CardDefinition, PermanentView } from "../../cards/types";
import { projectPublicState } from "../../gameProjections";
import { validateAbilityEffectScript } from "../effects/validate";
import { getEffectivePower, getEffectiveToughness } from "../layers";
import { recordBlockedAttackers } from "../banding";
import { emitBlockersConfirmedEvents } from "../phases";
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

const FLANKER: CardDefinition = {
    id: "test-only-flanker",
    rarity: "common",
    name: "Test Flanker",
    oracleText: "Flanking",
    manaCost: { X: 1, W: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Knight"],
    power: 2,
    toughness: 2,
    staticAbilities: ["flanking"],
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

/** Sidewinder Sliver's shape: every Bear on the battlefield has flanking. */
const FLANKING_ANTHEM: CardDefinition = {
    id: "test-only-flanking-anthem",
    rarity: "common",
    name: "Test Flanking Anthem",
    oracleText: "All Bear creatures have flanking.",
    manaCost: { X: 1 },
    types: ["Artifact"],
    staticEffects: [
        {
            kind: "keyword-grant",
            applies: (target: PermanentView) =>
                target.subtypes.includes("Bear"),
            keyword: "flanking",
        },
    ],
};

function withDefs(run: () => void): void {
    withTemporaryDefinition(FLANKER, () =>
        withTemporaryDefinition(VANILLA, () =>
            withTemporaryDefinition(FLANKING_ANTHEM, run)
        )
    );
}

function combat(
    attacker: CardInstanceState,
    blockers: CardInstanceState[],
    p1Extra: CardInstanceState[] = []
): GameState {
    attacker.isAttacking = true;
    const blockerAssignments: Record<string, string[]> = {};
    for (const b of blockers) {
        b.isBlocking = true;
        blockerAssignments[b.id] = [attacker.id];
    }
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [attacker, ...p1Extra] }),
            makePlayer("p2", { battlefield: blockers }),
        ],
        phase: "DECLARE_BLOCKERS",
        combat: {
            attackerIds: [attacker.id],
            confirmed: true,
            blockerAssignments,
            blockersConfirmed: true,
        },
    });
    recordBlockedAttackers(state);
    return state;
}

function attackerOf(def: CardDefinition): CardInstanceState {
    return makeInstance(def.id, {
        id: "atk",
        controllerId: "p1",
        ownerId: "p1",
    });
}

function blockerOf(def: CardDefinition, id = "blk"): CardInstanceState {
    return makeInstance(def.id, { id, controllerId: "p2", ownerId: "p2" });
}

function flankingOnStack(state: GameState): number {
    return state.stack.filter(
        (s) => s.triggeredAbilityId === FLANKING_TRIGGER_ID
    ).length;
}

function resolveStack(state: GameState): void {
    resolveTriggerOrder(state);
    let guard = 0;
    while (state.stack.length > 0 && guard++ < 8) resolveTopOfStack(state);
}

function ptOf(state: GameState, card: CardInstanceState): [number, number] {
    return [getEffectivePower(state, card), getEffectiveToughness(state, card)];
}

describe("Flanking (CR 702.25a)", () => {
    it("the body is a valid script on BLOCKERS_CONFIRMED", () => {
        expect(
            validateAbilityEffectScript(
                FLANKING_TRIGGER,
                "Flanking",
                "BLOCKERS_CONFIRMED"
            )
        ).toEqual([]);
    });

    it("gives the blocker without flanking -1/-1 until end of turn", () => {
        withDefs(() => {
            const blk = blockerOf(VANILLA);
            const state = combat(attackerOf(FLANKER), [blk]);
            emitBlockersConfirmedEvents(state);
            expect(flankingOnStack(state)).toBe(1);
            expect(ptOf(state, blk)).toEqual([2, 2]);
            resolveStack(state);
            expect(ptOf(state, blk)).toEqual([1, 1]);
        });
    });

    it("does not trigger on a blocker that has flanking", () => {
        withDefs(() => {
            const blk = blockerOf(FLANKER);
            const state = combat(attackerOf(FLANKER), [blk]);
            emitBlockersConfirmedEvents(state);
            expect(flankingOnStack(state)).toBe(0);
        });
    });

    it("reads the blocker's GRANTED flanking, not only a printed one", () => {
        withDefs(() => {
            const blk = blockerOf(VANILLA);
            const anthem = makeInstance(FLANKING_ANTHEM.id, {
                id: "anthem",
                controllerId: "p1",
                ownerId: "p1",
            });
            const state = combat(attackerOf(FLANKER), [blk], [anthem]);
            beginApplyingStaticEffects(state, anthem);
            expect(blk.staticAbilities).toContain("flanking");
            emitBlockersConfirmedEvents(state);
            expect(flankingOnStack(state)).toBe(0);
        });
    });

    it("double-blocked: fires per blocker without flanking, each on its own blocker", () => {
        withDefs(() => {
            const a = blockerOf(VANILLA, "a");
            const b = blockerOf(VANILLA, "b");
            const flanked = blockerOf(FLANKER, "c");
            const state = combat(attackerOf(FLANKER), [a, b, flanked]);
            emitBlockersConfirmedEvents(state);
            expect(flankingOnStack(state)).toBe(2);
            resolveStack(state);
            expect(ptOf(state, a)).toEqual([1, 1]);
            expect(ptOf(state, b)).toEqual([1, 1]);
            expect(ptOf(state, flanked)).toEqual([2, 2]);
        });
    });

    it("only the ATTACKER's flanking counts: a flanking blocker triggers nothing", () => {
        withDefs(() => {
            const atk = attackerOf(VANILLA);
            const state = combat(atk, [blockerOf(FLANKER)]);
            emitBlockersConfirmedEvents(state);
            expect(flankingOnStack(state)).toBe(0);
        });
    });

    it("a 1-toughness blocker dies before damage and the attacker stays blocked (CR 509.1h)", () => {
        withDefs(() => {
            const blk = blockerOf(VANILLA);
            blk.toughness = 1;
            const state = combat(attackerOf(FLANKER), [blk]);
            emitBlockersConfirmedEvents(state);
            resolveStack(state);
            checkStateBasedActions(state);
            expect(
                state.players[1].battlefield.some((c) => c.id === blk.id)
            ).toBe(false);
            expect(state.combat?.blockedAttackerIds).toContain("atk");
        });
    });
});

describe("Flanking granted at runtime", () => {
    it("a static grant makes a vanilla attacker flank (Sidewinder Sliver, Agility)", () => {
        withDefs(() => {
            const atk = attackerOf(VANILLA);
            const anthem = makeInstance(FLANKING_ANTHEM.id, {
                id: "anthem",
                controllerId: "p1",
                ownerId: "p1",
            });
            const nonBear = blockerOf(VANILLA);
            nonBear.subtypes = ["Elf"];
            const state = combat(atk, [nonBear], [anthem]);
            beginApplyingStaticEffects(state, anthem);
            expect(atk.staticAbilities).toContain("flanking");
            emitBlockersConfirmedEvents(state);
            expect(flankingOnStack(state)).toBe(1);
        });
    });

    it("a one-shot grant makes it flank (Jabari's Banner's grantAbility shape)", () => {
        withDefs(() => {
            const atk = attackerOf(VANILLA);
            const blk = blockerOf(VANILLA);
            const state = combat(atk, [blk]);
            const ctx = buildSpellContext(
                state,
                pushSpell(state, VANILLA.id, "p1")
            );
            ctx.grantStaticAbilityPermanent(
                { type: "permanent", id: atk.id },
                "flanking"
            );
            state.stack.length = 0;
            emitBlockersConfirmedEvents(state);
            expect(flankingOnStack(state)).toBe(1);
        });
    });

    it("each instance triggers separately (CR 702.25b)", () => {
        withDefs(() => {
            const atk = attackerOf(FLANKER);
            atk.subtypes = ["Bear"];
            const blk = blockerOf(VANILLA);
            blk.subtypes = ["Elf"];
            const anthem = makeInstance(FLANKING_ANTHEM.id, {
                id: "anthem",
                controllerId: "p1",
                ownerId: "p1",
            });
            const state = combat(atk, [blk], [anthem]);
            beginApplyingStaticEffects(state, anthem);
            expect(
                atk.staticAbilities.filter((k) => k === "flanking")
            ).toHaveLength(2);
            emitBlockersConfirmedEvents(state);
            expect(flankingOnStack(state)).toBe(2);
            blk.toughness = 5;
            resolveStack(state);
            expect(getEffectivePower(state, blk)).toBe(0);
            expect(getEffectiveToughness(state, blk)).toBe(3);
        });
    });

    it("a creature that lost all its abilities does not trigger (CR 613.1f)", () => {
        withDefs(() => {
            const atk = attackerOf(FLANKER);
            const blk = blockerOf(VANILLA);
            const state = combat(atk, [blk]);
            const ctx = buildSpellContext(
                state,
                pushSpell(state, VANILLA.id, "p1")
            );
            ctx.loseAllAbilities({ type: "permanent", id: atk.id });
            state.stack.length = 0;
            emitBlockersConfirmedEvents(state);
            expect(flankingOnStack(state)).toBe(0);
        });
    });
});

describe("Flanking on the stack", () => {
    it("still resolves after its source left and after the blocker gained flanking (CR 603.4 does not apply)", () => {
        withDefs(() => {
            const atk = attackerOf(FLANKER);
            const blk = blockerOf(VANILLA);
            const state = combat(atk, [blk]);
            emitBlockersConfirmedEvents(state);
            blk.staticAbilities = [...blk.staticAbilities, "flanking"];
            removePermanentTo(state, atk.id, "graveyard");
            resolveStack(state);
            expect(ptOf(state, blk)).toEqual([1, 1]);
        });
    });

    it("a grant-only trigger survives a save and load while on the stack", () => {
        withDefs(() => {
            const atk = attackerOf(VANILLA);
            const blk = blockerOf(VANILLA);
            const state = combat(atk, [blk]);
            const ctx = buildSpellContext(
                state,
                pushSpell(state, VANILLA.id, "p1")
            );
            ctx.grantStaticAbilityPermanent(
                { type: "permanent", id: atk.id },
                "flanking"
            );
            state.stack.length = 0;
            emitBlockersConfirmedEvents(state);
            const loaded = expandState(compactState(state));
            expect(flankingOnStack(loaded)).toBe(1);
            resolveStack(loaded);
            const loadedBlocker = loaded.players[1].battlefield[0];
            expect(ptOf(loaded, loadedBlocker)).toEqual([1, 1]);
        });
    });

    it("wire: the item and the blocker's P/T reach the client", () => {
        withDefs(() => {
            const blk = blockerOf(VANILLA);
            const state = combat(attackerOf(FLANKER), [blk]);
            emitBlockersConfirmedEvents(state);
            const before = projectPublicState(state, 1, "p2");
            const item = before.stack.find(
                (s) => s.triggeredAbilityId === FLANKING_TRIGGER_ID
            );
            expect(item).toBeDefined();

            resolveStack(state);
            const after = projectPublicState(state, 2, "p2");
            const slim = after.players[1].battlefield.find(
                (c) => c.id === blk.id
            )!;
            expect(getEffectivePower(after, slim)).toBe(1);
            expect(getEffectiveToughness(after, slim)).toBe(1);
        });
    });
});
