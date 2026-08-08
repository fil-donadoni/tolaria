// VOW — multicolor card behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import { bloodtitheHarvester } from "../multicolor";
import { grizzlyBears } from "../../lea/green";
import { resolveTopOfStack } from "../../../../gre/state";
import { collectTriggers } from "../../../../gre/triggers";
import { getDefinition, registerTokenDefinition } from "../../../index";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { projectPublicState } from "../../../../gameProjections";
import type { StackItem } from "../../../../gre/state";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";

/** Registers a minimal synthetic "Artifact — Blood" definition (id-only —
 *  these tests only need the SUBTYPE `count` filter Bloodtithe Harvester's
 *  pump reads, not the token's own activated ability). Idempotent, like the
 *  real `registerTokenDefinition`. */
function registerTestBlood(id: string): string {
    registerTokenDefinition({
        id,
        name: id,
        rarity: "common",
        types: ["Artifact"],
        subtypes: ["Blood"],
    });
    return id;
}

function harvesterEntered(instanceId: string, controllerId: string) {
    return {
        type: "PERMANENT_ENTERED" as const,
        instanceId,
        controllerId,
        cardId: bloodtitheHarvester.id,
        types: ["Creature"] as const,
    };
}

describe("Bloodtithe Harvester (CR 603.6a self-ETB, 111/701.7 token, 602.5b/602.3b sorcery-speed sac, 613.4c -X/-X pump — issue #1309)", () => {
    it("ETB creates a Blood token with its real sac-discard-draw ability", () => {
        const harvester = makeInstance(bloodtitheHarvester.id, {
            id: "harvester-1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [harvester] }),
                makePlayer("p2"),
            ],
        });

        const triggers = collectTriggers(state, [
            harvesterEntered("harvester-1", "p1"),
        ]);
        expect(triggers).toHaveLength(1);
        state.stack.push(...triggers);
        resolveTopOfStack(state);

        const blood = state.players[0].battlefield.find((c) => c.isToken);
        expect(blood).toBeDefined();
        expect(blood!.subtypes).toContain("Blood");
        const bloodDef = getDefinition((blood!.card as { id: string }).id);
        expect(bloodDef.activatedAbilities?.[0]?.id).toBe(
            "sacrifice-discard-draw"
        );
    });

    it("{T}, Sacrifice: target creature gets -X/-X where X is TWICE the controller's Blood count", () => {
        const harvester = makeInstance(bloodtitheHarvester.id, {
            id: "harvester-1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        // Two Blood tokens already under the controller — X = 2 * 2 = 4.
        const blood1 = makeInstance(registerTestBlood("test-blood-1a"), {
            id: "blood-1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const blood2 = makeInstance(registerTestBlood("test-blood-2a"), {
            id: "blood-2",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const victim = makeInstance(grizzlyBears.id, {
            id: "victim-1",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [harvester, blood1, blood2],
                }),
                makePlayer("p2", { battlefield: [victim] }),
            ],
        });

        expect(getEffectivePower(state, victim)).toBe(2);
        expect(getEffectiveToughness(state, victim)).toBe(2);

        // {T}, Sacrifice this creature already paid (CR 602.1) — push the
        // ability directly onto the stack with its announced target, mirroring
        // `activateAbility`'s commit (Dauthi Voidwalker's test pattern,
        // mh2/__tests__/black.test.ts).
        state.players[0].battlefield = state.players[0].battlefield.filter(
            (c) => c.id !== "harvester-1"
        );
        state.stack.push({
            ...harvester,
            zone: "stack",
            castById: "p1",
            abilityId: "bloodtithe-harvester-sac",
            targets: [{ type: "permanent", id: "victim-1" }],
        } as StackItem);
        resolveTopOfStack(state);

        expect(getEffectivePower(state, victim)).toBe(-2); // 2 - 4
        expect(getEffectiveToughness(state, victim)).toBe(-2); // 2 - 4
    });

    it("with zero Blood tokens, the pump is -0/-0 (a legal, inert activation)", () => {
        const harvester = makeInstance(bloodtitheHarvester.id, {
            id: "harvester-1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const victim = makeInstance(grizzlyBears.id, {
            id: "victim-1",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [harvester] }),
                makePlayer("p2", { battlefield: [victim] }),
            ],
        });

        state.players[0].battlefield = state.players[0].battlefield.filter(
            (c) => c.id !== "harvester-1"
        );
        state.stack.push({
            ...harvester,
            zone: "stack",
            castById: "p1",
            abilityId: "bloodtithe-harvester-sac",
            targets: [{ type: "permanent", id: "victim-1" }],
        } as StackItem);
        resolveTopOfStack(state);

        expect(getEffectivePower(state, victim)).toBe(2);
        expect(getEffectiveToughness(state, victim)).toBe(2);
    });

    it("wire format: the Blood token and the -X/-X pump survive projectPublicState", () => {
        const harvester = makeInstance(bloodtitheHarvester.id, {
            id: "harvester-1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const blood1 = makeInstance(registerTestBlood("test-blood-1b"), {
            id: "blood-1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const victim = makeInstance(grizzlyBears.id, {
            id: "victim-1",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [harvester, blood1] }),
                makePlayer("p2", { battlefield: [victim] }),
            ],
        });

        // ETB half, wire-checked.
        const triggers = collectTriggers(state, [
            harvesterEntered("harvester-1", "p1"),
        ]);
        state.stack.push(...triggers);
        resolveTopOfStack(state);
        const blood2 = state.players[0].battlefield.find(
            (c) => c.isToken && c.id !== "blood-1"
        )!;
        expect(blood2).toBeDefined();

        // Activated-ability half, wire-checked: X = 2 * 2 Blood = -4/-4.
        state.players[0].battlefield = state.players[0].battlefield.filter(
            (c) => c.id !== "harvester-1"
        );
        state.stack.push({
            ...harvester,
            zone: "stack",
            castById: "p1",
            abilityId: "bloodtithe-harvester-sac",
            targets: [{ type: "permanent", id: "victim-1" }],
        } as StackItem);
        resolveTopOfStack(state);

        const projected = projectPublicState(state, 1, "p1");
        const slimBlood = projected.players[0].battlefield.find(
            (c) => c.id === blood2.id
        )!;
        expect(slimBlood.subtypes).toContain("Blood");
        const slimVictim = projected.players[1].battlefield.find(
            (c) => c.id === "victim-1"
        )!;
        expect(getEffectivePower(projected, slimVictim)).toBe(-2); // 2 - 4
        expect(getEffectiveToughness(projected, slimVictim)).toBe(-2);
    });
});
