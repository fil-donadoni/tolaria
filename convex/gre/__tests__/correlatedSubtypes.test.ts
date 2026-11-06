// CR 205.1a / 613.1d — "If an object's card type is removed, the subtypes
// correlated with that card type will remain if they are also the subtypes of a
// card type the object currently has; otherwise, they are also removed for the
// entire time the object's card type is removed."
import { describe, expect, it } from "vitest";
import { registerTokenDefinition } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { lionSash } from "../../cards/sets/neo/white.cards";
import { grizzlyBears } from "../../cards/sets/lea/index.cards";
import type { CardType, PermanentView, StaticEffect } from "../../cards/types";
import { AURA_AFFECTS_HOST } from "../../cards/types";
import { projectPublicState } from "../../gameProjections";
import { getEffectiveColors } from "../../cards/effectiveColors";
import { withoutSubtypesOfRemovedTypes } from "../constants";
import { deriveLayers2to5, syncLayers2to5 } from "../layers2to5";
import type { LayerStateView } from "../layers";
import { checkStateBasedActions } from "../sba";
import {
    beginApplyingStaticEffects,
    type CardInstanceState,
    type GameState,
} from "../state";

const REMOVES_CREATURE = "test-correlation-removes-creature";
const ADDS_CREATURE = "test-correlation-adds-creature";
const READS_BEAR = "test-correlation-reads-bear";
const PAINTS_BEAR = "test-correlation-paints-bear";

function register(id: string, staticEffects: StaticEffect[]): void {
    registerTokenDefinition({
        id,
        name: id,
        rarity: "common",
        manaCost: { W: 1 },
        types: ["Enchantment"],
        subtypes: ["Aura"],
        staticEffects,
    });
}

const isBear = (target: PermanentView): boolean =>
    target.subtypes.includes("Bear");

register(REMOVES_CREATURE, [
    { kind: "type-remove", applies: AURA_AFFECTS_HOST, types: ["Creature"] },
]);
register(ADDS_CREATURE, [
    { kind: "type-add", applies: AURA_AFFECTS_HOST, types: ["Creature"] },
]);
register(READS_BEAR, [
    { kind: "type-add", applies: isBear, types: ["Artifact"] },
]);
register(PAINTS_BEAR, [
    { kind: "color-grant", applies: isBear, colors: ["U"] },
]);

function aura(cardId: string, id: string): CardInstanceState {
    return {
        ...makeInstance(cardId, { id, controllerId: "p1", ownerId: "p1" }),
        attachedTo: "host",
    };
}

/** A board with `host` and `auras`, the auras stamped in the order given. */
function boardWith(
    host: CardInstanceState,
    auras: readonly CardInstanceState[]
): GameState {
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [host, ...auras] }),
            makePlayer("p2"),
        ],
    });
    for (const a of auras) beginApplyingStaticEffects(state, a);
    return state;
}

const bears = (): CardInstanceState =>
    makeInstance(grizzlyBears().id, {
        id: "host",
        controllerId: "p1",
        ownerId: "p1",
    });

const derive = (state: GameState, host: CardInstanceState) =>
    deriveLayers2to5(
        state as unknown as LayerStateView,
        host as unknown as PermanentView
    );

describe("CR 205.1a — a removed card type takes its correlated subtypes", () => {
    it("a type-remove alone: a Reconfigure creature attached is an Equipment with no creature type, and is a Cat again unattached", () => {
        const sash = makeInstance(lionSash().id, {
            id: "sash",
            controllerId: "p1",
            ownerId: "p1",
        });
        const other = bears();
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [sash, other] }),
                makePlayer("p2"),
            ],
        });
        beginApplyingStaticEffects(state, sash);
        sash.attachedTo = other.id;
        checkStateBasedActions(state);
        expect(sash.types).toEqual(["Artifact"]);
        expect(sash.subtypes).toEqual(["Equipment"]);

        const wire = projectPublicState(state, 1, "p1").players[0].battlefield;
        expect(wire.find((c) => c.id === "sash")!.subtypes).toEqual([
            "Equipment",
        ]);

        sash.attachedTo = undefined;
        checkStateBasedActions(state);
        expect(sash.types).toEqual(["Artifact", "Creature"]);
        expect(sash.subtypes).toEqual(["Equipment", "Cat"]);
    });

    it("a type-line SET counts as a removal", () => {
        const host = bears();
        host.typeLineHolds = [{ types: ["Enchantment"], seq: 1 }];
        const state = boardWith(host, []);
        const derived = derive(state, host);
        expect(derived.types).toEqual(["Enchantment"]);
        expect(derived.subtypes).toEqual([]);
    });

    it("removed-then-added at a later timestamp keeps the subtypes; added-then-removed does not", () => {
        const later = bears();
        const returned = derive(
            boardWith(later, [
                aura(REMOVES_CREATURE, "remove"),
                aura(ADDS_CREATURE, "add"),
            ]),
            later
        );
        expect(returned.types).toEqual(["Creature"]);
        expect(returned.subtypes).toEqual(["Bear"]);

        const earlier = bears();
        const gone = derive(
            boardWith(earlier, [
                aura(ADDS_CREATURE, "add"),
                aura(REMOVES_CREATURE, "remove"),
            ]),
            earlier
        );
        expect(gone.types).toEqual([]);
        expect(gone.subtypes).toEqual([]);
    });

    it("a layer-4 predicate after the removal does not read the removed subtype, and one after the return does", () => {
        const removed = bears();
        expect(
            derive(
                boardWith(removed, [
                    aura(REMOVES_CREATURE, "remove"),
                    aura(READS_BEAR, "read"),
                ]),
                removed
            ).types
        ).toEqual([]);

        const returned = bears();
        expect(
            derive(
                boardWith(returned, [
                    aura(REMOVES_CREATURE, "remove"),
                    aura(ADDS_CREATURE, "add"),
                    aura(READS_BEAR, "read"),
                ]),
                returned
            ).types
        ).toEqual(["Creature", "Artifact"]);
    });

    it("a layer-5 predicate reads the line layer 4 finished with (CR 613.1e)", () => {
        const host = bears();
        const state = boardWith(host, [
            aura(PAINTS_BEAR, "paint"),
            aura(REMOVES_CREATURE, "remove"),
        ]);
        syncLayers2to5(state);
        expect(host.subtypes).toEqual([]);
        expect(host.grantedColors).toBeUndefined();
        expect(getEffectiveColors(host)).not.toContain("U");
    });
});

describe("CR 205.1a — what remains", () => {
    const after = (
        subtypes: string[],
        removed: CardType[],
        current: CardType[]
    ): string[] => withoutSubtypesOfRemovedTypes(subtypes, removed, current);

    it("a subtype that is also the subtype of a card type the object has (CR 205.3m — Creature and Kindred share theirs)", () => {
        expect(
            after(["Goblin"], ["Creature"], ["Kindred", "Enchantment"])
        ).toEqual(["Goblin"]);
    });

    it("a subtype of another card type: a land creature that stops being a land keeps its creature types (CR 205.3c)", () => {
        expect(after(["Forest", "Dryad"], ["Land"], ["Creature"])).toEqual([
            "Dryad",
        ]);
    });

    it("every family goes with its type", () => {
        expect(after(["Equipment"], ["Artifact"], ["Creature"])).toEqual([]);
        expect(after(["Saga"], ["Enchantment"], ["Land"])).toEqual([]);
        expect(after(["Kaito"], ["Planeswalker"], ["Creature"])).toEqual([]);
        expect(after(["Siege"], ["Battle"], ["Land"])).toEqual([]);
        expect(after(["Arcane"], ["Instant"], ["Creature"])).toEqual([]);
    });

    it("a subtype of a card type that has returned", () => {
        expect(after(["Bear"], ["Creature"], ["Artifact", "Creature"])).toEqual(
            ["Bear"]
        );
    });
});
