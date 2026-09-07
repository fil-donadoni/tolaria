// MOC red — per-colour card behavior tests (ADR 0043 parallel test file).
//
// Death-Greeter's Champion composes ONLY already-exercised constructs:
// `dashTrigger` (proven by the synthetic probe in
// `convex/gre/__tests__/dash.test.ts`) and `backupTrigger` (proven by
// Consuming Aetherborn, `mom/black.ts`). This file pins the CARD — the
// definition + both triggers wired together — not the underlying machinery.

import { describe, it, expect } from "vitest";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { resolveTopOfStack } from "../../../../gre/state";
import type {
    CardInstanceState,
    GameState,
    StackItem,
} from "../../../../gre/state";
import { continuousEffectsInLayer } from "../../../../gre/continuousEffects";
import { getDefinition } from "../../../index";

const deathGreetersChampion = getDefinition(
    "7cb2b582-1c45-4bb2-8aef-59a71a5a9e94"
);

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
    it("self-target: puts a +1/+1 counter, does not re-grant its own double strike", () => {
        const source = makeInstance(deathGreetersChampion.id, {
            id: "champ1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [source] }),
                makePlayer("p2"),
            ],
        });
        pushBackupEtb(state, source, "champ1");
        const after = state.players[0].battlefield.find(
            (c) => c.id === "champ1"
        )!;
        expect(after.counters?.["+1/+1"]).toBe(1);
        expect(
            continuousEffectsInLayer(state, 6).filter(
                (e) =>
                    e.affected.kind === "instances" &&
                    e.affected.instanceIds.includes(after.id)
            )
        ).toHaveLength(0);
    });

    it("other-target: puts a +1/+1 counter AND grants double strike until end of turn", () => {
        const grizzlyBears = getDefinition(
            "ce2d603a-3231-4a8c-bf39-1617586ea870"
        );
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
        expect(
            continuousEffectsInLayer(state, 6).filter(
                (e) =>
                    e.affected.kind === "instances" &&
                    e.affected.instanceIds.includes(granted.id)
            )[0].payload
        ).toEqual({
            kind: "keyword-grant",
            keyword: "double strike",
        });
    });

    it("dash: entering dashed grants haste and schedules a next-end-step return", () => {
        const source = makeInstance(deathGreetersChampion.id, {
            id: "champ3",
            controllerId: "p1",
            ownerId: "p1",
            dashed: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [source] }),
                makePlayer("p2"),
            ],
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
        expect(
            continuousEffectsInLayer(state, 6)
                .filter(
                    (e) =>
                        e.affected.kind === "instances" &&
                        e.affected.instanceIds.includes(after.id)
                )
                .some(
                    (e) =>
                        e.payload.kind === "keyword-grant" &&
                        e.payload.keyword === "haste"
                )
        ).toBe(true);
        expect(state.delayedTriggers ?? []).toHaveLength(1);
    });
});
