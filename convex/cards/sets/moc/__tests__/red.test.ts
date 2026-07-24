// MOC red — per-colour card behavior tests (ADR 0043 parallel test file).
//
// Death-Greeter's Champion composes ONLY already-exercised constructs:
// `dashTrigger` (proven by the synthetic probe in
// `convex/gre/__tests__/dash.test.ts`) and `backupTrigger` (proven by
// Consuming Aetherborn, `mom/black.ts`). This file pins the CARD — the
// definition + both triggers wired together — not the underlying machinery.

import { describe, it, expect } from "vitest";
import { deathGreetersChampion } from "../red";
import { getCardByName } from "../../../index";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { resolveTopOfStack } from "../../../../gre/state";
import type {
    CardInstanceState,
    GameState,
    StackItem,
} from "../../../../gre/state";

function pushBackupEtb(
    state: GameState,
    source: CardInstanceState,
    targetId: string
) {
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        triggeredAbilityId: "backup-1",
        triggerSourceId: source.id,
        triggerEvent: {
            type: "PERMANENT_ENTERED",
            instanceId: source.id,
            controllerId: source.controllerId,
            types: ["Creature"],
        } as StackItem["triggerEvent"],
        targets: [{ type: "permanent", id: targetId }],
    });
    resolveTopOfStack(state);
}

describe("Death-Greeter's Champion (Dash + Backup 1 + double strike, CR 702.109/702.165, issue #1527)", () => {
    it("is a {2}{R} 2/1 Creature — Human Warrior with a dash mana leg and its own double strike", () => {
        expect(deathGreetersChampion.manaCost).toEqual({ X: 2, R: 1 });
        expect(deathGreetersChampion.power).toBe(2);
        expect(deathGreetersChampion.toughness).toBe(1);
        expect(deathGreetersChampion.staticAbilities).toEqual([
            "backup 1",
            "double strike",
        ]);
        expect(deathGreetersChampion.dash).toEqual({
            id: "dash",
            description: "Dash {3}{R}",
            mana: { X: 3, R: 1 },
        });
    });

    it("self-target: puts a +1/+1 counter, does not re-grant its own double strike", () => {
        const source = makeInstance(deathGreetersChampion.id, {
            id: "champ1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [makePlayer("p1", { battlefield: [source] }), makePlayer("p2")],
        });
        pushBackupEtb(state, source, "champ1");
        const after = state.players[0].battlefield.find(
            (c) => c.id === "champ1"
        )!;
        expect(after.counters?.["+1/+1"]).toBe(1);
        expect(after.grantedStaticAbilities ?? []).toHaveLength(0);
    });

    it("other-target: puts a +1/+1 counter AND grants double strike until end of turn", () => {
        const grizzlyBears = getCardByName("Grizzly Bears");
        const source = makeInstance(deathGreetersChampion.id, {
            id: "champ2",
            controllerId: "p1",
            ownerId: "p1",
        });
        const bear = makeInstance(grizzlyBears.id, {
            id: "bearTarget",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [source, bear] }),
                makePlayer("p2"),
            ],
        });
        pushBackupEtb(state, source, "bearTarget");
        const granted = state.players[0].battlefield.find(
            (c) => c.id === "bearTarget"
        )!;
        expect(granted.counters?.["+1/+1"]).toBe(1);
        expect(granted.staticAbilities).toContain("double strike");
        expect(granted.grantedStaticAbilities?.[0]?.ability).toBe(
            "double strike"
        );
    });

    it("dash: entering dashed grants haste and schedules a next-end-step return", () => {
        const source = makeInstance(deathGreetersChampion.id, {
            id: "champ3",
            controllerId: "p1",
            ownerId: "p1",
            dashed: true,
        });
        const state = makeState({
            players: [makePlayer("p1", { battlefield: [source] }), makePlayer("p2")],
        });
        state.stack.push({
            ...source,
            zone: "stack",
            castById: "p1",
            triggeredAbilityId: "dash-haste-and-return",
            triggerSourceId: source.id,
            triggerEvent: {
                type: "PERMANENT_ENTERED",
                instanceId: source.id,
                controllerId: "p1",
                types: ["Creature"],
            } as StackItem["triggerEvent"],
            targets: [],
        });
        resolveTopOfStack(state);
        const after = state.players[0].battlefield.find(
            (c) => c.id === "champ3"
        )!;
        expect(after.grantedStaticAbilities?.some((g) => g.ability === "haste")).toBe(
            true
        );
        expect(state.delayedTriggers ?? []).toHaveLength(1);
    });
});
