// otj (Outlaws of Thunder Junction) — colorless behavior tests (ADR 0043
// colour split).
//
// Lavaspur Boots (issue #1530, parent PRD #1525) locks the one genuinely NEW
// composition this cluster introduces: a `triggered-grant` static effect
// (Energy Flux / The Tabernacle precedent) scoped by `AURA_AFFECTS_HOST`
// (an attach relationship) instead of a battlefield-wide filter, granting the
// fully-tested `wardAbility()` triggered ability to an EQUIPPED creature. The
// `wardAbility` factory's own matches()/target-resolution/effects shape is
// already the permanent test suite of `abilities/__tests__/ward.test.ts`
// (issue #1312) — this file only proves the GRANT reaches the right `self`
// (the host, not the Equipment) end-to-end through the real equip → target →
// trigger path.

import { describe, it, expect } from "vitest";
import { lavaspurBoots } from "../colorless";
import { registerTokenDefinition } from "../../..";
import { grizzlyBears } from "../../lea/green";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import {
    type CardInstanceState,
    type GameState,
    type StackItem,
    resolveTopOfStack,
    emitBecameTargetEvents,
    processPendingActionTriggers,
} from "../../../../gre/state";
import { applyMayPaySubmit } from "../../../../gre/pendingChoiceSubmit";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { projectPublicState } from "../../../../gameProjections";

// A synthetic targeted-removal instant — the opponent's targeted spell side
// of the ward scenario (mirrors `abilities/__tests__/ward.test.ts`'s own
// REMOVAL_ID fixture).
const REMOVAL_ID = "test-lavaspur-removal";
registerTokenDefinition({
    id: REMOVAL_ID,
    name: REMOVAL_ID,
    rarity: "common",
    manaCost: { X: 1, B: 1 },
    types: ["Instant"],
    targetRequirement: { type: "Creature", count: 1 },
    effects: [{ op: "destroy", target: { target: 0 } }],
});

function equipBootsTo(
    state: GameState,
    bootsId: string,
    targetId: string
): void {
    const boots = state.players
        .flatMap((p) => p.battlefield)
        .find((c) => c.id === bootsId)!;
    state.stack.push({
        ...boots,
        zone: "stack",
        castById: boots.controllerId,
        abilityId: "lavaspur-boots-equip",
        targets: [{ type: "permanent", id: targetId }],
    } as StackItem);
    resolveTopOfStack(state);
}

function setup(): {
    state: GameState;
    boots: CardInstanceState;
    bear: CardInstanceState;
} {
    const boots = makeInstance(lavaspurBoots.id, {
        id: "boots1",
        controllerId: "p1",
        ownerId: "p1",
    });
    const bear = makeInstance(grizzlyBears.id, {
        id: "bear1",
        controllerId: "p1",
        ownerId: "p1",
    });
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [boots, bear] }),
            makePlayer("p2"),
        ],
    });
    return {
        state,
        boots: state.players[0].battlefield[0],
        bear: state.players[0].battlefield[1],
    };
}

describe("Lavaspur Boots (OTJ #243, issue #1530)", () => {
    it("definition sanity — cost, types, equip cost, static grants", () => {
        expect(lavaspurBoots.manaCost).toEqual({ generic: 1 });
        expect(lavaspurBoots.types).toEqual(["Artifact"]);
        expect(lavaspurBoots.subtypes).toEqual(["Equipment"]);
        const equip = lavaspurBoots.activatedAbilities![0];
        expect(equip.cost).toEqual({ mana: { generic: 1 } });
        expect(equip.sorcerySpeedOnly).toBe(true);
        expect(equip.resolve).toBeUndefined();

        const buff = lavaspurBoots.staticEffects?.find(
            (e) => e.kind === "pt-buff"
        ) as { power: number; toughness: number };
        expect(buff).toEqual(
            expect.objectContaining({ power: 1, toughness: 0 })
        );
        const grants = (lavaspurBoots.staticEffects ?? [])
            .filter((e) => e.kind === "keyword-grant")
            .map((e) => (e as { keyword: string }).keyword);
        expect(grants).toEqual(["haste", "ward {1}"]);
        const trigGrant = lavaspurBoots.staticEffects?.find(
            (e) => e.kind === "triggered-grant"
        ) as { abilityId: string };
        expect(trigGrant.abilityId).toBe("lavaspur-boots-ward");
        expect(lavaspurBoots.triggeredGrantTemplates).toHaveLength(1);
        expect(lavaspurBoots.triggeredGrantTemplates![0].id).toBe(
            "lavaspur-boots-ward"
        );
    });

    it("grants +1/+0, haste and the ward reminder to the equipped creature", () => {
        const { state } = setup();
        equipBootsTo(state, "boots1", "bear1");
        const bear = state.players[0].battlefield.find(
            (c) => c.id === "bear1"
        )!;
        expect(
            state.players[0].battlefield.find((c) => c.id === "boots1")!
                .attachedTo
        ).toBe("bear1");
        expect(getEffectivePower(state, bear)).toBe(3); // 2 + 1
        expect(getEffectiveToughness(state, bear)).toBe(2); // 2 + 0
        expect(bear.staticAbilities).toContain("haste");
        expect(bear.staticAbilities).toContain("ward {1}");
    });

    it("Ward e2e: an opponent's targeted removal on the equipped creature triggers the GRANTED ward — declining counters the spell", () => {
        const { state } = setup();
        equipBootsTo(state, "boots1", "bear1");

        const spell = {
            ...makeInstance(REMOVAL_ID, {
                id: "removal1",
                controllerId: "p2",
                ownerId: "p2",
                zone: "stack",
            }),
            castById: "p2",
            targets: [{ type: "permanent" as const, id: "bear1" }],
        } as StackItem;
        state.stack.push(spell);
        emitBecameTargetEvents(state, spell.targets!, "p2", spell.id);
        processPendingActionTriggers(state);

        // The granted trigger is on the stack above the removal spell, with
        // `self` correctly resolved to the EQUIPPED CREATURE (not the boots).
        const wardTrig = state.stack[state.stack.length - 1];
        expect(wardTrig.triggeredAbilityId).toBe("lavaspur-boots-ward");
        expect(wardTrig.triggerSourceId).toBe("bear1");
        expect(wardTrig.targets).toEqual([{ type: "spell", id: "removal1" }]);

        expect(resolveTopOfStack(state)).toBeNull(); // suspended on may-pay
        expect(state.pendingChoices?.[0]?.kind).toBe("may-pay");
        expect(state.pendingChoices?.[0]?.playerId).toBe("p2");
        applyMayPaySubmit(state, { playerId: "p2", accept: false });

        // The removal spell is countered (CR 701.5a) — the equipped bear
        // survives, still equipped.
        expect(state.stack).toHaveLength(0);
        expect(
            state.players[1].graveyard.some((c) => c.id === "removal1")
        ).toBe(true);
        expect(state.players[0].battlefield.some((c) => c.id === "bear1")).toBe(
            true
        );
    });

    it("Ward e2e: paying the ward cost lets the removal resolve and destroy the equipped creature", () => {
        const { state } = setup();
        equipBootsTo(state, "boots1", "bear1");
        state.players[1].manaPool = { C: 1 };

        const spell = {
            ...makeInstance(REMOVAL_ID, {
                id: "removal2",
                controllerId: "p2",
                ownerId: "p2",
                zone: "stack",
            }),
            castById: "p2",
            targets: [{ type: "permanent" as const, id: "bear1" }],
        } as StackItem;
        state.stack.push(spell);
        emitBecameTargetEvents(state, spell.targets!, "p2", spell.id);
        processPendingActionTriggers(state);

        resolveTopOfStack(state); // suspends on may-pay
        applyMayPaySubmit(state, { playerId: "p2", accept: true });
        expect(state.players[1].manaPool.C ?? 0).toBe(0); // {1} generic paid

        // Ward trigger resolved without countering — the removal spell is
        // back on top of the stack and now resolves normally.
        expect(state.stack).toHaveLength(1);
        resolveTopOfStack(state);
        expect(state.players[0].battlefield.some((c) => c.id === "bear1")).toBe(
            false
        );
        expect(state.players[0].graveyard.some((c) => c.id === "bear1")).toBe(
            true
        );
    });

    it("an UNEQUIPPED creature has no ward — targeting it fires no trigger", () => {
        const { state } = setup();
        // boots1 is NOT attached this time.
        const spell = {
            ...makeInstance(REMOVAL_ID, {
                id: "removal3",
                controllerId: "p2",
                ownerId: "p2",
                zone: "stack",
            }),
            castById: "p2",
            targets: [{ type: "permanent" as const, id: "bear1" }],
        } as StackItem;
        state.stack.push(spell);
        emitBecameTargetEvents(state, spell.targets!, "p2", spell.id);
        processPendingActionTriggers(state);
        // No ward trigger raised — the removal spell is still alone on top.
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].id).toBe("removal3");
    });

    it("the P/T buff and haste grant survive projection (wire format)", () => {
        const { state } = setup();
        equipBootsTo(state, "boots1", "bear1");
        const projected = projectPublicState(state, 1, "p1");
        const slimBear = projected.players[0].battlefield.find(
            (c) => c.id === "bear1"
        )!;
        expect(getEffectivePower(projected, slimBear)).toBe(3);
        expect(getEffectiveToughness(projected, slimBear)).toBe(2);
        expect(slimBear.staticAbilities).toContain("haste");
    });
});
