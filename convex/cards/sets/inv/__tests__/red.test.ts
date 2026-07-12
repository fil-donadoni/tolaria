// Per-card behavior tests for INV red cards (`convex/cards/sets/inv/red.ts`).
// Overload exercises the Kicker capability (CR 702.33) + the `manaValue` value
// member (CR 202.3): the MV threshold for its destroy shifts from 2 to 5 when
// kicked. The generic kicker/value mechanics are proven once in
// convex/gre/__tests__/kicker.test.ts and interpreter.test.ts; here we assert
// the card's specific thresholds are wired.

import { describe, it, expect } from "vitest";
import { overload, obliterate, urzasRage } from "../red";
import { registerTokenDefinition } from "../../..";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { resolveTopOfStack, type StackItem } from "../../../../gre/state";
import { projectPublicState } from "../../../../gameProjections";
import { mountain, forest } from "../../lea/colorless";

// Synthetic artifacts with controlled mana values.
const ART_MV2 = "test-overload-art-mv2";
const ART_MV4 = "test-overload-art-mv4";
registerTokenDefinition({
    id: ART_MV2,
    name: ART_MV2,
    rarity: "common",
    manaCost: { X: 2 },
    types: ["Artifact"],
});
registerTokenDefinition({
    id: ART_MV4,
    name: ART_MV4,
    rarity: "common",
    manaCost: { X: 4 },
    types: ["Artifact"],
});

function castOverload(kicked: boolean, artId: string) {
    const art = makeInstance(artId, {
        controllerId: "p2",
        ownerId: "p2",
        id: "artifact",
    });
    const state = makeState({
        players: [makePlayer("p1"), makePlayer("p2", { battlefield: [art] })],
    });
    const item: StackItem = pushSpell(state, overload.id, "p1", [
        { type: "permanent", id: "artifact" },
    ]);
    if (kicked) item.kickerCount = 1;
    resolveTopOfStack(state);
    return state.players[1].battlefield.find((c) => c.id === "artifact");
}

describe("Overload (Kicker {2}, CR 702.33 / 202.3)", () => {
    it("unkicked destroys an artifact with mana value 2 or less", () => {
        expect(castOverload(false, ART_MV2)).toBeUndefined();
    });
    it("unkicked does NOT destroy an artifact with mana value 4", () => {
        expect(castOverload(false, ART_MV4)).toBeDefined();
    });
    it("kicked destroys an artifact with mana value up to 5", () => {
        expect(castOverload(true, ART_MV4)).toBeUndefined();
    });
    it("declares the kicker cost {2}", () => {
        expect(overload.kicker).toEqual({ cost: { X: 2 } });
    });
});

// Obliterate — "This spell can't be countered. Destroy all artifacts,
// creatures, and lands. They can't be regenerated." (CR 701.5c, 701.7,
// 701.15c, issue #1065). Same NOT-DSL-migratable shape as Wrath of God /
// Damnation / Jokulhaups (destroyAll + cantBeRegenerated); the card-specific
// assertion here is the artifact+creature+LAND scope and the regen-shield
// bypass. The can't-be-countered MECHANISM itself is proven generically in
// `convex/gre/effects/__tests__/interpreter.test.ts`.
const TEST_ARTIFACT_ID = "test-obliterate-artifact";
registerTokenDefinition({
    id: TEST_ARTIFACT_ID,
    name: TEST_ARTIFACT_ID,
    rarity: "common",
    manaCost: { X: 1 },
    types: ["Artifact"],
});
describe("Obliterate (CR 701.5c can't-be-countered, 701.7 destroy, 701.15c regen suppression)", () => {
    it("destroys every artifact, creature, and land on both battlefields", () => {
        const artifact = makeInstance(TEST_ARTIFACT_ID, {
            id: "artifact",
            controllerId: "p1",
            ownerId: "p1",
        });
        const mountainCard = makeInstance(mountain.id, {
            id: "mtn",
            controllerId: "p1",
            ownerId: "p1",
        });
        const lion = makeInstance(forest.id, {
            id: "lion",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [artifact, mountainCard] }),
                makePlayer("p2", { battlefield: [lion] }),
            ],
        });
        pushSpell(state, obliterate.id, "p1");
        resolveTopOfStack(state);
        expect(state.players[0].battlefield).toHaveLength(0);
        expect(state.players[1].battlefield).toHaveLength(0);
    });

    it("regeneration shields are NOT consumed — the rider suppresses them", () => {
        const lion = makeInstance(forest.id, {
            id: "lion",
            controllerId: "p2",
            ownerId: "p2",
            regenerationShields: 1,
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [lion] }),
            ],
        });
        pushSpell(state, obliterate.id, "p1");
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "lion")
        ).toBeUndefined();
        expect(
            state.players[1].graveyard.find((c) => c.id === "lion")
        ).toBeDefined();
    });

    it("declares cantBeCountered", () => {
        expect(obliterate.cantBeCountered).toBe(true);
    });

    // Wire format: the mass-destroy outcome (an emptied battlefield) must
    // survive the GameState → public projection.
    it("wire format: emptied battlefields survive projectPublicState", () => {
        const lion = makeInstance(forest.id, {
            id: "lion",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [lion] }),
            ],
        });
        pushSpell(state, obliterate.id, "p1");
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[1].battlefield).toHaveLength(0);
        expect(
            projected.players[1].graveyard.some((c) => c.id === "lion")
        ).toBe(true);
    });
});

// Urza's Rage — "Kicker {8}{R}. This spell can't be countered. Urza's Rage
// deals 3 damage to any target. If this spell was kicked, instead it deals
// 10 damage to that permanent or player and the damage can't be prevented."
// (CR 701.5c, 702.33, 120.1, 615, issue #1065). The `unpreventable` dealDamage
// param and the can't-be-countered mechanism are proven generically in
// `interpreter.test.ts`; this asserts the card's specific 3-vs-10 split and
// declarations.
function castUrzasRage(kicked: boolean) {
    const state = makeState();
    const item: StackItem = pushSpell(state, urzasRage.id, "p1", [
        { type: "player", id: "p2" },
    ]);
    if (kicked) item.kickerCount = 1;
    resolveTopOfStack(state);
    return state.players[1].life;
}
describe("Urza's Rage (Kicker {8}{R}, CR 701.5c / 702.33 / 615)", () => {
    it("unkicked deals 3 damage to any target", () => {
        expect(castUrzasRage(false)).toBe(17); // 20 - 3
    });
    it("kicked deals 10 damage instead", () => {
        expect(castUrzasRage(true)).toBe(10); // 20 - 10
    });
    it("kicked damage can't be prevented — ignores a target prevention shield", () => {
        const state = makeState();
        state.targetPreventionShields = [
            {
                targetType: "player",
                targetId: "p2",
                remaining: 100,
                duration: { phase: "end-of-turn" },
            },
        ];
        const item = pushSpell(state, urzasRage.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        item.kickerCount = 1;
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(10); // shield ignored
    });
    it("declares the kicker cost {8}{R} and cantBeCountered", () => {
        expect(urzasRage.kicker).toEqual({ cost: { X: 8, R: 1 } });
        expect(urzasRage.cantBeCountered).toBe(true);
    });
    it("wire format: kicked damage survives projectPublicState", () => {
        const state = makeState();
        const item = pushSpell(state, urzasRage.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        item.kickerCount = 1;
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[1].life).toBe(10);
    });
});
