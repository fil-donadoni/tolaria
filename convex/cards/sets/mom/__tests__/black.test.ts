import { describe, it, expect } from "vitest";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { getCardByName } from "../../../index";
import type {
    CardInstanceState,
    GameState,
    StackItem,
} from "../../../../gre/state";
import { resolveTopOfStack } from "../../../../gre/state";
import { projectPublicState } from "../../../../gameProjections";
import { consumingAetherborn } from "../black";

// Consuming Aetherborn — {3}{B} Creature, 2/2. "Backup 1 (When this creature
// enters, put a +1/+1 counter on target creature. If that's another
// creature, it gains the following ability until end of turn.) Lifelink"
// (CR 702.165, issue #1315). The first catalogue card proving the Backup
// keyword end-to-end: a SIMPLE Backup card on purpose — its only granted
// ability is the single already-implemented keyword `lifelink`, so
// `backupTrigger(1, ["lifelink"])` is the entire triggered-ability body, no
// other unshipped mechanic involved. `targetIsAnother`'s own generic
// construct proof (self vs. other branches, wire format) lives in
// `convex/gre/effects/__tests__/interpreter.test.ts`; this file is the
// per-card convention (`.claude/rules/gre-development.md` § Card testing
// convention) — pin the definition and exercise it once through the real
// card, incl. the wire format a board-visible counter/grant needs.
function backupEtbOnStack(
    state: GameState,
    source: CardInstanceState,
    targets: StackItem["targets"]
): StackItem {
    const trig: StackItem = {
        ...source,
        id: "aetherborn-trig",
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
        targets,
    };
    state.stack.push(trig);
    return trig;
}

describe("Consuming Aetherborn (CR 702.165 Backup, issue #1315)", () => {
    it("pins the definition — backup 1 + lifelink, targeted ETB trigger", () => {
        expect(consumingAetherborn.staticAbilities).toEqual([
            "backup 1",
            "lifelink",
        ]);
        const etb = consumingAetherborn.triggeredAbilities?.find(
            (a) => a.id === "backup-1"
        );
        expect(etb).toBeDefined();
        expect(etb?.targetRequirement).toEqual({
            type: "Creature",
            count: 1,
        });
    });

    it("self-target: puts a +1/+1 counter, does not re-grant its own lifelink", () => {
        const source = makeInstance(consumingAetherborn.id, {
            id: "aetherborn1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [source] }),
                makePlayer("p2"),
            ],
        });
        backupEtbOnStack(state, source, [
            { type: "permanent", id: "aetherborn1" },
        ]);
        resolveTopOfStack(state);
        const after = state.players[0].battlefield.find(
            (c) => c.id === "aetherborn1"
        )!;
        expect(after.counters?.["+1/+1"]).toBe(1);
        // CR 702.165a — "If that's ANOTHER creature" is false on self: no
        // grant is tracked (lifelink was already printed, not re-granted).
        expect(after.grantedStaticAbilities ?? []).toHaveLength(0);
    });

    it("other-target: puts a +1/+1 counter AND grants lifelink until end of turn (wire format)", () => {
        const grizzlyBears = getCardByName("Grizzly Bears"); // vanilla 2/2, no lifelink
        const source = makeInstance(consumingAetherborn.id, {
            id: "aetherborn2",
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
        backupEtbOnStack(state, source, [
            { type: "permanent", id: "bearTarget" },
        ]);
        resolveTopOfStack(state);
        const granted = state.players[0].battlefield.find(
            (c) => c.id === "bearTarget"
        )!;
        expect(granted.counters?.["+1/+1"]).toBe(1);
        // CR 702.165a — the target gains lifelink (Consuming Aetherborn's own
        // printed ability) until end of turn — Grizzly Bears has no lifelink
        // of its own.
        expect(granted.staticAbilities).toContain("lifelink");
        expect(granted.grantedStaticAbilities).toHaveLength(1);
        // Wire format — both the counter and the granted keyword are
        // board-visible; `projectPublicState` must not strip either.
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "bearTarget"
        )!;
        expect(slim.staticAbilities).toContain("lifelink");
        expect(slim.counters?.["+1/+1"]).toBe(1);
    });
});
