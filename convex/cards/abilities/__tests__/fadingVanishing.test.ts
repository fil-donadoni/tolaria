// Fading / Vanishing keyword expansion (ADR 0054, CR 702.32 / 702.63). This is
// the new mechanism's permanent test suite: the implicit-expansion parser, the
// injected ETB counters + upkeep triggers, and — Vanishing's divergent half —
// the COUNTER_REMOVED-driven sacrifice trigger (CR 702.63a). Fading's end-to-end
// clock is exercised through the shipped Blastoderm, and Vanishing's through the
// shipped Deep Forest Hermit, both in nem/__tests__/green.test.ts; here we cover
// the shared parser plus the Vanishing sacrifice-trigger semantics in isolation,
// via a registered synthetic definition.

import { describe, it, expect } from "vitest";
import {
    expandFadingVanishing,
    parseFadingVanishing,
} from "../fadingVanishing";
import { registerTokenDefinition } from "../..";
import { resolveTopOfStack } from "../../../gre/state";
import type {
    CardInstanceState,
    GameState,
    StackItem,
} from "../../../gre/state";
import type { CardDefinition, GameEvent, PermanentView } from "../../types";
import { makeInstance, makePlayer, makeState } from "../../__tests__/setup";

const UPKEEP = (activePlayerId: string): StackItem["triggerEvent"] =>
    ({
        type: "PHASE_BEGIN" as const,
        phase: "UPKEEP" as const,
        activePlayerId,
    }) as StackItem["triggerEvent"];

function resolveTrigger(
    state: GameState,
    source: CardInstanceState,
    triggeredAbilityId: string,
    triggerEvent: StackItem["triggerEvent"]
): void {
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        triggeredAbilityId,
        triggerSourceId: source.id,
        triggerEvent,
        targets: [],
    });
    resolveTopOfStack(state);
}

const onBattlefield = (
    state: GameState,
    id: string
): CardInstanceState | undefined =>
    state.players.flatMap((p) => p.battlefield).find((c) => c.id === id);

describe("parseFadingVanishing (ADR 0054 keyword parser)", () => {
    it("parses fading N and vanishing N (case-insensitive)", () => {
        expect(parseFadingVanishing(["fading 3"])).toEqual({
            keyword: "fading",
            count: 3,
        });
        expect(parseFadingVanishing(["Vanishing 5"])).toEqual({
            keyword: "vanishing",
            count: 5,
        });
        expect(parseFadingVanishing(["shroud", "fading 1"])).toEqual({
            keyword: "fading",
            count: 1,
        });
    });

    it("returns null when neither keyword is present", () => {
        expect(parseFadingVanishing(undefined)).toBeNull();
        expect(parseFadingVanishing(["flying", "trample"])).toBeNull();
        // Bare "fading" without N is not the keyword (needs the count).
        expect(parseFadingVanishing(["fading"])).toBeNull();
    });
});

describe("expandFadingVanishing (ADR 0054 injection)", () => {
    const base = (staticAbilities: string[]): CardDefinition => ({
        id: "test-expand",
        name: "Test Expand",
        rarity: "common",
        manaCost: { G: 1 },
        types: ["Creature"],
        subtypes: ["Test"],
        power: 1,
        toughness: 1,
        staticAbilities,
    });

    it("injects three fade counters + a single upkeep trigger for fading", () => {
        const out = expandFadingVanishing(base(["fading 3"]));
        expect(out.entersWith?.counters).toEqual([{ type: "fade", count: 3 }]);
        expect(out.triggeredAbilities?.map((t) => t.id)).toEqual(["fading"]);
    });

    it("injects time counters + upkeep AND sacrifice triggers for vanishing", () => {
        const out = expandFadingVanishing(base(["vanishing 2"]));
        expect(out.entersWith?.counters).toEqual([{ type: "time", count: 2 }]);
        expect(out.triggeredAbilities?.map((t) => t.id)).toEqual([
            "vanishing-upkeep",
            "vanishing-last-counter",
        ]);
    });

    it("leaves a non-keyword definition untouched (same reference)", () => {
        const def = base(["flying"]);
        expect(expandFadingVanishing(def)).toBe(def);
    });

    it("preserves any pre-existing entersWith counters and triggers", () => {
        const def: CardDefinition = {
            ...base(["fading 1"]),
            entersWith: { counters: [{ type: "+1/+1", count: 2 }] },
        };
        const out = expandFadingVanishing(def);
        expect(out.entersWith?.counters).toEqual([
            { type: "+1/+1", count: 2 },
            { type: "fade", count: 1 },
        ]);
    });

    it("is idempotent — re-expanding does not double-inject", () => {
        const once = expandFadingVanishing(base(["vanishing 2"]));
        const twice = expandFadingVanishing(once);
        expect(twice.triggeredAbilities?.map((t) => t.id)).toEqual([
            "vanishing-upkeep",
            "vanishing-last-counter",
        ]);
        expect(twice.entersWith?.counters).toEqual([
            { type: "time", count: 2 },
        ]);
    });
});

// A registered synthetic vanishing creature — isolates the sacrifice-trigger
// semantics from Deep Forest Hermit's other behavior. getDefinition expands it
// at the seam, so the battlefield permanent surfaces the injected upkeep +
// sacrifice triggers.
const VANISHER_ID = "test-vanisher";
registerTokenDefinition({
    id: VANISHER_ID,
    name: "Test Vanisher",
    rarity: "common",
    manaCost: { U: 1 },
    types: ["Creature"],
    subtypes: ["Illusion"],
    power: 2,
    toughness: 2,
    staticAbilities: ["vanishing 3"],
});

describe("Vanishing sacrifice trigger (CR 702.63a, COUNTER_REMOVED)", () => {
    const sacTrigger = () =>
        expandFadingVanishing({
            id: VANISHER_ID,
            name: "x",
            rarity: "common",
            manaCost: { U: 1 },
            types: ["Creature"],
            staticAbilities: ["vanishing 3"],
        }).triggeredAbilities!.find((t) => t.id === "vanishing-last-counter")!;

    const removed = (
        counterType: string,
        remaining: number,
        instanceId = "v"
    ): GameEvent =>
        ({
            type: "COUNTER_REMOVED",
            instanceId,
            controllerId: "p1",
            counterType,
            removed: 1,
            remaining,
        }) as GameEvent;

    const self = { id: "v" } as PermanentView;

    it("fires only when the LAST time counter is removed (remaining 0)", () => {
        expect(sacTrigger().matches(removed("time", 0), self)).toBe(true);
    });

    it("does not fire while time counters remain", () => {
        expect(sacTrigger().matches(removed("time", 1), self)).toBe(false);
    });

    it("does not fire for a different counter type or a different permanent", () => {
        expect(sacTrigger().matches(removed("fade", 0), self)).toBe(false);
        expect(sacTrigger().matches(removed("time", 0, "other"), self)).toBe(
            false
        );
    });
});

describe("Vanishing end-to-end clock (CR 702.63c/d)", () => {
    it("removes a time counter each upkeep, then sacrifices when the last is removed", () => {
        const v = makeInstance(VANISHER_ID, {
            id: "v",
            controllerId: "p1",
            ownerId: "p1",
            counters: { time: 3 },
        });
        const state = makeState({
            players: [makePlayer("p1", { battlefield: [v] }), makePlayer("p2")],
        });

        resolveTrigger(state, v, "vanishing-upkeep", UPKEEP("p1"));
        expect(onBattlefield(state, "v")?.counters).toEqual({ time: 2 });

        resolveTrigger(
            state,
            onBattlefield(state, "v")!,
            "vanishing-upkeep",
            UPKEEP("p1")
        );
        expect(onBattlefield(state, "v")?.counters).toEqual({ time: 1 });

        // Last upkeep: removing the final time counter emits COUNTER_REMOVED
        // (remaining 0), which processPendingActionTriggers collects into the
        // sacrifice trigger — auto-stacked but not yet resolved.
        resolveTrigger(
            state,
            onBattlefield(state, "v")!,
            "vanishing-upkeep",
            UPKEEP("p1")
        );
        expect(onBattlefield(state, "v")?.counters).toBeUndefined();
        expect(state.stack.length).toBe(1);
        expect(state.stack[0].triggeredAbilityId).toBe(
            "vanishing-last-counter"
        );

        // Resolve the sacrifice trigger.
        resolveTopOfStack(state);
        expect(onBattlefield(state, "v")).toBeUndefined();
        expect(state.players[0].graveyard.some((c) => c.id === "v")).toBe(true);
    });
});
