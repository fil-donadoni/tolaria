// Per-card behavior tests for INV red cards (`convex/cards/sets/inv/red.ts`).
// Overload exercises the Kicker capability (CR 702.33) + the `manaValue` value
// member (CR 202.3): the MV threshold for its destroy shifts from 2 to 5 when
// kicked. The generic kicker/value mechanics are proven once in
// convex/gre/__tests__/kicker.test.ts and interpreter.test.ts; here we assert
// the card's specific thresholds are wired.

import { describe, it, expect } from "vitest";
import {
    overload,
    obliterate,
    urzasRage,
    kavuScout,
    collapsingBorders,
    tribalFlames,
} from "../red";
import { registerTokenDefinition } from "../../..";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import {
    resolveTopOfStack,
    type GameState,
    type StackItem,
} from "../../../../gre/state";
import { projectPublicState } from "../../../../gameProjections";
import { mountain, forest, plains, island, swamp } from "../../lea/colorless";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";

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

// ---------------------------------------------------------------------------
// Domain cluster (parent PRD #1063, issue #1066). `{ domain: { of } }` and
// `winGame` each carry their own permanent interpreter test
// (`convex/gre/effects/__tests__/interpreter.test.ts`); the tests below wire
// each RED card to that shared value member / the `pt-cda` construct.
// ---------------------------------------------------------------------------

describe("Tribal Flames (CR 120.1 damage — X = Domain, issue #1066)", () => {
    it("deals damage equal to the controller's Domain to any target", () => {
        const lands = [plains, island, swamp].map((def, i) =>
            makeInstance(def.id, {
                id: `tf-land-${i}`,
                controllerId: "p1",
                ownerId: "p1",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: lands }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, tribalFlames.id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(17); // 20 - 3
    });
});

describe("Kavu Scout (CR 604.3 CDA — +1/+0 per Domain, issue #1066)", () => {
    it("gets +1/+0 for each basic land type controlled (printed 0/2 base)", () => {
        const scout = makeInstance(kavuScout.id, {
            id: "scout",
            controllerId: "p1",
            ownerId: "p1",
        });
        const lands = [plains, island].map((def, i) =>
            makeInstance(def.id, {
                id: `ks-land-${i}`,
                controllerId: "p1",
                ownerId: "p1",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [scout, ...lands] }),
                makePlayer("p2"),
            ],
        });
        expect(getEffectivePower(state, scout)).toBe(2); // 0 + 2
        expect(getEffectiveToughness(state, scout)).toBe(2); // unchanged
    });

    it("CDA P/T survives the wire projection (mandatory)", () => {
        const scout = makeInstance(kavuScout.id, {
            id: "scout",
            controllerId: "p1",
            ownerId: "p1",
        });
        const lands = [plains, island, swamp, mountain, forest].map((def, i) =>
            makeInstance(def.id, {
                id: `ks-wire-land-${i}`,
                controllerId: "p1",
                ownerId: "p1",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [scout, ...lands] }),
                makePlayer("p2"),
            ],
        });
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "scout"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(5); // 0 + 5 (max Domain)
        expect(getEffectiveToughness(projected, slim)).toBe(2);
    });
});

describe("Collapsing Borders (CR 603.6a each-player upkeep — Domain, issue #1066)", () => {
    /** Pushes Collapsing Borders' upkeep trigger onto the stack as if it had
     *  fired on `activePlayerId`'s upkeep (mirrors the manual
     *  triggeredAbilityId/triggerEvent push idiom, `clu/__tests__/red.test.ts`). */
    function fireUpkeep(
        state: GameState,
        borders: ReturnType<typeof makeInstance>,
        activePlayerId: string
    ) {
        state.stack.push({
            ...borders,
            zone: "stack",
            castById: borders.controllerId,
            triggeredAbilityId: "collapsing-borders-upkeep",
            triggerSourceId: borders.id,
            triggerEvent: {
                type: "PHASE_BEGIN",
                phase: "UPKEEP",
                activePlayerId,
            },
            targets: [],
        });
        resolveTopOfStack(state);
    }

    it("that player gains life = THEIR OWN Domain, then takes 3 damage — on p2's upkeep", () => {
        const borders = makeInstance(collapsingBorders.id, {
            id: "borders",
            controllerId: "p1",
            ownerId: "p1",
        });
        // p2 controls 2 basic land types; p1 (the enchantment's controller)
        // controls none — proving the read is the SCOPED (upkeep) player's
        // Domain, not the controller's.
        const p2Lands = [plains, island].map((def, i) =>
            makeInstance(def.id, {
                id: `cb-p2-land-${i}`,
                controllerId: "p2",
                ownerId: "p2",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [borders] }),
                makePlayer("p2", { battlefield: p2Lands }),
            ],
        });
        fireUpkeep(state, borders, "p2");
        // 20 + 2 (Domain) - 3 (Collapsing Borders damage) = 19
        expect(state.players[1].life).toBe(19);
        expect(state.players[0].life).toBe(20); // p1 untouched this upkeep
    });

    it("fires symmetrically on the controller's OWN upkeep too", () => {
        const borders = makeInstance(collapsingBorders.id, {
            id: "borders",
            controllerId: "p1",
            ownerId: "p1",
        });
        const p1Lands = [plains].map((def, i) =>
            makeInstance(def.id, {
                id: `cb-p1-land-${i}`,
                controllerId: "p1",
                ownerId: "p1",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [borders, ...p1Lands] }),
                makePlayer("p2"),
            ],
        });
        fireUpkeep(state, borders, "p1");
        // 20 + 1 (Domain) - 3 = 18
        expect(state.players[0].life).toBe(18);
        expect(state.players[1].life).toBe(20);
    });
});
