// NEM — green card behavior tests (ADR 0043 per-colour split). Blastoderm is
// the launch vehicle for Fading (CR 702.32), a new keyword mechanism expanded
// implicitly at the getDefinition seam (ADR 0054), so it earns full hand-written
// GRE + wire coverage: ETB counter injection, the upkeep clock, and the
// remove-or-sacrifice endgame.

import { describe, it, expect } from "vitest";
import { blastoderm, deepForestHermit } from "..";
import { forest } from "../../lea/colorless";
import { resolveTopOfStack } from "../../../../gre/state";
import { projectPublicState } from "../../../../gameProjections";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import type {
    CardInstanceState,
    GameState,
    StackItem,
} from "../../../../gre/state";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";

/** A PHASE_BEGIN upkeep trigger event for `activePlayerId`. */
const UPKEEP = (activePlayerId: string): StackItem["triggerEvent"] =>
    ({
        type: "PHASE_BEGIN" as const,
        phase: "UPKEEP" as const,
        activePlayerId,
    }) as StackItem["triggerEvent"];

/** Resolves a source's triggered ability by pushing a synthetic trigger stack
 *  item (mirroring the engine's `buildTriggerItem`) and resolving it. */
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

describe("Blastoderm (Shroud + Fading 3, CR 702.18 / 702.32)", () => {
    it("declares shroud + fading 3 as decorative keywords and a self-guard", () => {
        expect(blastoderm.staticAbilities).toEqual(["shroud", "fading 3"]);
        expect(blastoderm.power).toBe(5);
        expect(blastoderm.toughness).toBe(5);
        expect(blastoderm.staticEffects?.[0]).toMatchObject({
            kind: "permanent-guard",
            cantBeTargeted: true,
        });
    });

    it("enters with three fade counters (CR 702.32a, ADR 0054 ETB injection)", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        pushSpell(state, blastoderm.id, "p1");
        resolveTopOfStack(state);
        const derm = onBattlefield(state, state.players[0].battlefield[0].id)!;
        expect(derm.card).toMatchObject({ id: blastoderm.id });
        expect(derm.counters).toEqual({ fade: 3 });
    });

    it("removes one fade counter at each of the controller's upkeeps (CR 702.32b)", () => {
        const derm = makeInstance(blastoderm.id, {
            id: "derm",
            controllerId: "p1",
            ownerId: "p1",
            counters: { fade: 3 },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [derm] }),
                makePlayer("p2"),
            ],
        });

        resolveTrigger(state, derm, "fading", UPKEEP("p1"));
        expect(onBattlefield(state, "derm")?.counters).toEqual({ fade: 2 });

        resolveTrigger(
            state,
            onBattlefield(state, "derm")!,
            "fading",
            UPKEEP("p1")
        );
        expect(onBattlefield(state, "derm")?.counters).toEqual({ fade: 1 });

        resolveTrigger(
            state,
            onBattlefield(state, "derm")!,
            "fading",
            UPKEEP("p1")
        );
        // CR 122.6 — the map entry is dropped when it hits zero.
        expect(onBattlefield(state, "derm")?.counters).toBeUndefined();
    });

    it("sacrifices itself at the upkeep it can't remove a fade counter (CR 702.32b)", () => {
        const derm = makeInstance(blastoderm.id, {
            id: "derm",
            controllerId: "p1",
            ownerId: "p1",
            counters: undefined, // depleted — no fade counters left
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [derm] }),
                makePlayer("p2"),
            ],
        });

        resolveTrigger(state, derm, "fading", UPKEEP("p1"));

        expect(onBattlefield(state, "derm")).toBeUndefined();
        expect(state.players[0].graveyard.some((c) => c.id === "derm")).toBe(
            true
        );
    });

    it("wire format: fade counters survive projectPublicState (counters visible)", () => {
        const derm = makeInstance(blastoderm.id, {
            id: "derm",
            controllerId: "p1",
            ownerId: "p1",
            counters: { fade: 2 },
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [derm],
                    library: [
                        makeInstance(forest.id, { id: "f", zone: "library" }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "derm"
        )!;
        expect(slim.counters).toEqual({ fade: 2 });
    });
});

describe("Deep Forest Hermit (Vanishing 3 + Squirrel factory/anthem, CR 702.63 / 111 / 613)", () => {
    it("declares vanishing 3, the ETB Squirrel trigger, and the Squirrel anthem", () => {
        expect(deepForestHermit.staticAbilities).toEqual(["vanishing 3"]);
        expect(deepForestHermit.subtypes).toEqual(["Elf", "Druid"]);
        expect(deepForestHermit.power).toBe(1);
        expect(deepForestHermit.toughness).toBe(1);
        expect(deepForestHermit.triggeredAbilities?.[0].id).toBe(
            "deep-forest-hermit-squirrels"
        );
        expect(deepForestHermit.staticEffects?.[0]).toMatchObject({
            kind: "pt-buff",
            power: 1,
            toughness: 1,
        });
    });

    it("enters with three time counters (Vanishing 3 seam injection, ADR 0054)", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        pushSpell(state, deepForestHermit.id, "p1");
        resolveTopOfStack(state);
        const hermit = state.players[0].battlefield.find(
            (c) => c.card.id === deepForestHermit.id
        )!;
        expect(hermit.counters).toEqual({ time: 3 });
    });

    it("creates four 1/1 green Squirrel tokens on ETB, each buffed to 2/2 by the anthem (CR 111 / 613.4c)", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        pushSpell(state, deepForestHermit.id, "p1");
        // Resolve the creature spell — it enters and the ETB Squirrel trigger
        // is collected onto the stack (CR 603.6a).
        resolveTopOfStack(state);
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].triggeredAbilityId).toBe(
            "deep-forest-hermit-squirrels"
        );
        // Resolve the ETB trigger — four Squirrels enter.
        resolveTopOfStack(state);

        const tokens = state.players[0].battlefield.filter(
            (c) => c.isToken && c.subtypes.includes("Squirrel")
        );
        expect(tokens).toHaveLength(4);
        for (const sq of tokens) {
            // Base 1/1 + anthem +1/+1 = 2/2 (the anthem's own source is present).
            expect(getEffectivePower(state, sq)).toBe(2);
            expect(getEffectiveToughness(state, sq)).toBe(2);
        }
    });

    it("wire format: Squirrel tokens read as 2/2 after projectPublicState (anthem survives the wire)", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        pushSpell(state, deepForestHermit.id, "p1");
        resolveTopOfStack(state); // spell resolves, ETB trigger stacks
        resolveTopOfStack(state); // ETB trigger resolves, tokens enter

        const projected = projectPublicState(state, 1, "p1");
        const slimTokens = projected.players[0].battlefield.filter(
            (c) => c.isToken && c.subtypes.includes("Squirrel")
        );
        expect(slimTokens).toHaveLength(4);
        for (const sq of slimTokens) {
            expect(getEffectivePower(projected, sq)).toBe(2);
            expect(getEffectiveToughness(projected, sq)).toBe(2);
        }
    });
});
