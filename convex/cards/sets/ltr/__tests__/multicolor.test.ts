// LTR — multicolor card tests (ADR 0043 split). Mirrors sets/ltr/multicolor.ts.

import { describe, it, expect } from "vitest";
import {
    type CardInstanceState,
    type GameState,
    type StackItem,
    resolveTopOfStack,
    payRemoveCounterCost,
} from "../../../../gre/state";
import { getLegalTargets } from "../../../../gre/rules";
import { projectPublicState } from "../../../../gameProjections";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { arwenMortalQueen } from "../multicolor";
import { grizzlyBears } from "../../lea/green";

// Mirrors the per-set `resolveActivated` shim (arn/__tests__/helpers.ts and
// every other set's local copy) — pushes an already-targeted activated
// ability directly onto the stack and resolves it, bypassing cost/targeting
// choreography (tested separately below).
function resolveActivated(
    state: GameState,
    source: CardInstanceState,
    abilityId: string,
    targets: StackItem["targets"] = []
): void {
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        abilityId,
        targets,
    });
    resolveTopOfStack(state);
}

describe("Arwen, Mortal Queen — definition (LTR, issue #1318)", () => {
    it("matches Scryfall oracle ({1}{G}{W} 2/2 Legendary Creature — Elf Noble)", () => {
        expect(arwenMortalQueen.manaCost).toEqual({ generic: 1, G: 1, W: 1 });
        expect(arwenMortalQueen.types).toEqual(["Creature"]);
        expect(arwenMortalQueen.supertypes).toEqual(["Legendary"]);
        expect(arwenMortalQueen.subtypes).toEqual(["Elf", "Noble"]);
        expect(arwenMortalQueen.power).toBe(2);
        expect(arwenMortalQueen.toughness).toBe(2);
        // No PRINTED keywords (Scryfall `keywords: []`) — lifelink/
        // indestructible are entirely CR 122.1c counter-driven.
        expect(arwenMortalQueen.staticAbilities ?? []).toEqual([]);
        expect(arwenMortalQueen.entersWith).toEqual({
            counters: [{ type: "indestructible", count: 1 }],
        });
    });
});

describe("Arwen, Mortal Queen — ETB indestructible counter (CR 122.1c, issue #1318 ETB gap)", () => {
    it("enters with an indestructible counter and gains indestructible immediately, not just after a later addCounter", () => {
        const state = makeState();
        pushSpell(state, arwenMortalQueen.id, "p1");
        resolveTopOfStack(state);
        const arwen = state.players[0].battlefield.find(
            (c) => (c.card as { id: string }).id === arwenMortalQueen.id
        )!;
        expect(arwen.counters).toEqual({ indestructible: 1 });
        expect(arwen.staticAbilities).toContain("indestructible");
        expect(arwen.grantedStaticAbilities).toContainEqual({
            ability: "indestructible",
            counterType: "indestructible",
        });

        // Wire format — the ETB grant is board-visible and must survive the
        // projection.
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === arwen.id
        )!;
        expect(slim.counters).toEqual({ indestructible: 1 });
        expect(slim.staticAbilities).toContain("indestructible");
    });
});

describe("Arwen, Mortal Queen — activated ability (CR 122.6 cost, CR 611.1b layer-6 grant, CR 122.1c counter-driven lifelink)", () => {
    it("grants the target indestructible until end of turn and puts +1/+1 + lifelink counters on both creatures", () => {
        const arwen = makeInstance(arwenMortalQueen.id, {
            id: "arwen1",
            controllerId: "p1",
            ownerId: "p1",
            counters: { indestructible: 1 },
            staticAbilities: ["indestructible"], // mirrors post-ETB state
            grantedStaticAbilities: [
                { ability: "indestructible", counterType: "indestructible" },
            ],
        });
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [arwen, bear] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, arwen, "arwen-empower", [
            { type: "permanent", id: "bear1" },
        ]);

        const afterBear = state.players[0].battlefield.find(
            (c) => c.id === "bear1"
        )!;
        const afterArwen = state.players[0].battlefield.find(
            (c) => c.id === "arwen1"
        )!;

        // "Another target creature gains indestructible until end of turn."
        expect(afterBear.staticAbilities).toContain("indestructible");
        expect(afterBear.grantedStaticAbilities).toContainEqual(
            expect.objectContaining({ ability: "indestructible" })
        );

        // "Put a +1/+1 counter and a lifelink counter on that creature" —
        // CR 122.1c: the lifelink counter grants lifelink the instant it
        // lands (the generic engine rule, `getKeywordCounterGrant`).
        expect(afterBear.counters).toEqual({ "+1/+1": 1, lifelink: 1 });
        expect(afterBear.staticAbilities).toContain("lifelink");

        // "...and a +1/+1 counter and a lifelink counter on Arwen."
        expect(afterArwen.counters).toEqual({
            indestructible: 1,
            "+1/+1": 1,
            lifelink: 1,
        });
        expect(afterArwen.staticAbilities).toContain("lifelink");

        // Wire format — every field asserted above is board-visible.
        const projected = projectPublicState(state, 1, "p1");
        const slimBear = projected.players[0].battlefield.find(
            (c) => c.id === "bear1"
        )!;
        const slimArwen = projected.players[0].battlefield.find(
            (c) => c.id === "arwen1"
        )!;
        expect(slimBear.counters).toEqual({ "+1/+1": 1, lifelink: 1 });
        expect(slimBear.staticAbilities).toContain("indestructible");
        expect(slimBear.staticAbilities).toContain("lifelink");
        expect(slimArwen.counters).toEqual({
            indestructible: 1,
            "+1/+1": 1,
            lifelink: 1,
        });
        expect(slimArwen.staticAbilities).toContain("lifelink");
    });

    it("cannot target Arwen herself (CR 603.3d 'another target creature', excludeInstanceIds via getTargetRequirement)", () => {
        const arwen = makeInstance(arwenMortalQueen.id, { id: "arwen2" });
        const bear = makeInstance(grizzlyBears.id, { id: "other" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [arwen, bear] }),
                makePlayer("p2"),
            ],
        });
        const ability = arwenMortalQueen.activatedAbilities!.find(
            (a) => a.id === "arwen-empower"
        )!;
        const req = ability.getTargetRequirement!(
            { ...arwen } as never,
            state as never
        );
        const legal = getLegalTargets(state, req, [], "p1").map((t) => t.id);
        expect(legal).toContain("other");
        expect(legal).not.toContain("arwen2");
    });
});

describe("Arwen, Mortal Queen — paying her own removeCounter cost splices the grant back out (issue #1318 cost-pay gap)", () => {
    it("spending her last indestructible counter strips indestructible", () => {
        const arwen = makeInstance(arwenMortalQueen.id, {
            id: "arwen3",
            counters: { indestructible: 1 },
            staticAbilities: ["indestructible"],
            grantedStaticAbilities: [
                { ability: "indestructible", counterType: "indestructible" },
            ],
        });
        payRemoveCounterCost(arwen, { type: "indestructible", count: 1 });
        expect(arwen.counters).toBeUndefined();
        expect(arwen.staticAbilities).not.toContain("indestructible");
        // `unapplyKeywordCounterGrant` splices the sole entry out via
        // slice/slice (pre-existing behavior, mirrored from
        // `keywordCounters.test.ts`'s `removeCounter` assertions) — an empty
        // array, not `undefined`.
        expect(arwen.grantedStaticAbilities).toEqual([]);
    });

    it("a partial removal (2 -> 1, an unusual but legal board state) leaves the grant intact", () => {
        const arwen = makeInstance(arwenMortalQueen.id, {
            id: "arwen4",
            counters: { indestructible: 2 },
            staticAbilities: ["indestructible"],
            grantedStaticAbilities: [
                { ability: "indestructible", counterType: "indestructible" },
            ],
        });
        payRemoveCounterCost(arwen, { type: "indestructible", count: 1 });
        expect(arwen.counters).toEqual({ indestructible: 1 });
        expect(arwen.staticAbilities).toContain("indestructible");
        expect(arwen.grantedStaticAbilities).toContainEqual({
            ability: "indestructible",
            counterType: "indestructible",
        });
    });
});
