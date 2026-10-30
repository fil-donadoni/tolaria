// CR 614.1a — "If a source you control would deal noncombat damage to a
// creature an opponent controls, put that many -1/-1 counters on that creature
// instead." (Soul-Scar Mage, issue #7201), declared as
// `CardDefinition.damageAsCounters` and expanded into a `"damage"` replacement.
// The damage is REPLACED, never dealt — unlike wither/infect (CR 702.80a /
// 702.90c, `infectWither.test.ts`), where damage is dealt as counters and
// lifelink / DAMAGE_DEALT still follow. Driven through the real damage sinks.

import { describe, expect, it } from "vitest";
import {
    expandDefinition,
    withTemporaryDefinition,
} from "../../cards/registry";
import type { CardDefinition, CardType } from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { projectPublicState } from "../../gameProjections";
import { applyAllCombatDamage } from "../phases";
import { buildSpellContext } from "../state";
import type { CardInstanceState, GameState, StackItem } from "../state";

const MAGE: CardDefinition = {
    id: "test-damage-as-counters-mage",
    name: "Test Scar Mage",
    rarity: "rare",
    types: ["Creature"],
    power: 1,
    toughness: 2,
    oracleText:
        "If a source you control would deal noncombat damage to a creature an opponent controls, put that many -1/-1 counters on that creature instead.",
    damageAsCounters: { counterType: "-1/-1", noncombatOnly: true },
};

function creature(
    id: string,
    controllerId: string,
    overrides: Partial<CardInstanceState> = {}
): CardInstanceState {
    return {
        id,
        card: { id: `def-${id}` },
        types: ["Creature"] as CardType[],
        subtypes: [],
        power: 4,
        toughness: 4,
        staticAbilities: [],
        controllerId,
        ownerId: controllerId,
        zone: "battlefield",
        isTapped: false,
        ...overrides,
    };
}

/** p1 controls the Mage (unless `mageController` says otherwise) and a 4/4;
 *  p2 controls a 4/4. Returns a p1-cast spell item as the damage source. */
function setup(
    opts: {
        mageController?: string;
        spellController?: string;
        spellStatics?: string[];
    } = {}
): { state: GameState; item: StackItem } {
    const mage = makeInstance(MAGE.id, {
        id: "mage",
        controllerId: opts.mageController ?? "p1",
        ownerId: opts.mageController ?? "p1",
    });
    const mine = creature("mine", "p1");
    const theirs = creature("theirs", "p2");
    const p1Field = [mine];
    const p2Field = [theirs];
    ((opts.mageController ?? "p1") === "p1" ? p1Field : p2Field).push(mage);
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: p1Field }),
            makePlayer("p2", { battlefield: p2Field }),
        ],
    });
    const spellController = opts.spellController ?? "p1";
    const item: StackItem = {
        ...creature("shock", spellController, {
            types: ["Instant"] as CardType[],
            zone: "stack",
            staticAbilities: opts.spellStatics ?? [],
        }),
        castById: spellController,
        targets: [],
    };
    return { state, item };
}

function perm(state: GameState, id: string): CardInstanceState {
    return state.players
        .flatMap((p) => p.battlefield)
        .find((c) => c.id === id)!;
}

function damageEvents(state: GameState): number {
    return (state.pendingEvents ?? []).filter((e) => e.type === "DAMAGE_DEALT")
        .length;
}

const withMage = <T>(fn: () => T): T => withTemporaryDefinition(MAGE, fn);

describe("damage as counters (CR 614.1a)", () => {
    it("expands into one damage replacement classed 'other' and drops the field", () => {
        const expanded = expandDefinition(MAGE);
        expect(expanded.damageAsCounters).toBeUndefined();
        expect(
            expanded.replacementEffects!.map((r) => [
                r.id,
                r.eventKind,
                r.damageEffectKind,
            ])
        ).toEqual([["test-scar-mage-damage-as-counters", "damage", "other"]]);
    });

    it("turns noncombat damage from your source to an opponent's creature into -1/-1 counters", () =>
        withMage(() => {
            const { state, item } = setup();
            buildSpellContext(state, item).dealDamage(
                { type: "permanent", id: "theirs" },
                3
            );
            const theirs = perm(state, "theirs");
            expect(theirs.counters).toEqual({ "-1/-1": 3 });
            expect(theirs.damageMarked ?? 0).toBe(0);
            // The damage is replaced, never dealt: no DAMAGE_DEALT event.
            expect(damageEvents(state)).toBe(0);
        }));

    it("never gains life for a lifelink source — no damage is dealt", () =>
        withMage(() => {
            const { state, item } = setup({ spellStatics: ["lifelink"] });
            buildSpellContext(state, item).dealDamage(
                { type: "permanent", id: "theirs" },
                2
            );
            expect(perm(state, "theirs").counters).toEqual({ "-1/-1": 2 });
            expect(state.players[0].life).toBe(20);
        }));

    it("still applies to damage that can't be prevented (not a prevention effect)", () =>
        withMage(() => {
            const { state, item } = setup();
            buildSpellContext(state, item).dealDamage(
                { type: "permanent", id: "theirs" },
                2,
                true // CR 615.12 — unpreventable
            );
            expect(perm(state, "theirs").counters).toEqual({ "-1/-1": 2 });
            expect(perm(state, "theirs").damageMarked ?? 0).toBe(0);
        }));

    it("leaves damage to your own creature marked", () =>
        withMage(() => {
            const { state, item } = setup();
            buildSpellContext(state, item).dealDamage(
                { type: "permanent", id: "mine" },
                2
            );
            expect(perm(state, "mine").counters).toBeUndefined();
            expect(perm(state, "mine").damageMarked).toBe(2);
        }));

    it("leaves damage from an opponent's source alone", () =>
        withMage(() => {
            const { state, item } = setup({ spellController: "p2" });
            buildSpellContext(state, item).dealDamage(
                { type: "permanent", id: "theirs" },
                2
            );
            expect(perm(state, "theirs").counters).toBeUndefined();
            expect(perm(state, "theirs").damageMarked).toBe(2);
        }));

    it("leaves damage to a player alone", () =>
        withMage(() => {
            const { state, item } = setup();
            buildSpellContext(state, item).dealDamage(
                { type: "player", id: "p2" },
                3
            );
            expect(state.players[1].life).toBe(17);
        }));

    it("leaves combat damage alone (noncombat only)", () =>
        withMage(() => {
            const { state } = setup();
            state.phase = "COMBAT_DAMAGE";
            state.activePlayerId = "p1";
            state.combat = {
                attackerIds: ["mine"],
                confirmed: true,
                blockerAssignments: { theirs: ["mine"] },
                blockedAttackerIds: ["mine"],
                blockersConfirmed: true,
                damageConfirmed: false,
            } as unknown as GameState["combat"];
            applyAllCombatDamage(state, { mine: { theirs: 3 } });
            expect(perm(state, "theirs").counters).toBeUndefined();
            expect(perm(state, "theirs").damageMarked).toBe(3);
        }));

    it("projects the counters through the public state (wire format)", () =>
        withMage(() => {
            const { state, item } = setup();
            buildSpellContext(state, item).dealDamage(
                { type: "permanent", id: "theirs" },
                1
            );
            const projected = projectPublicState(state, 1, "p1");
            const slim = projected.players[1].battlefield.find(
                (c) => c.id === "theirs"
            )!;
            expect(slim.counters).toEqual({ "-1/-1": 1 });
            expect(slim.damageMarked ?? 0).toBe(0);
        }));
});
