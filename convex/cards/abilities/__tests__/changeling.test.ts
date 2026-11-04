// Changeling (CR 702.73) through the real paths: the `getDefinition` expansion
// seam, the layer-4 derivation, the copy effect, token creation, the persisted
// snapshot and the wire projection.

import { describe, expect, it } from "vitest";
import {
    getCardByName,
    getDefinition,
    preloadDefinitions,
    withTemporaryDefinition,
} from "../..";
import { CREATURE_SUBTYPES } from "../../../oracle/grammar/shared/subtypes";
import { isDefinitionLevelKeyword } from "../../../oracle/lowerStatic";
import { projectPublicState } from "../../../gameProjections";
import { applyCopy } from "../../../gre/copy";
import { buildStateFromScenario } from "../../../gre/scenarioBuilder";
import { getEffectivePower } from "../../../gre/layers";
import { compactState, expandState } from "../../../gre/serialize";
import {
    beginApplyingStaticEffects,
    createTokenPermanents,
    type CardInstanceState,
    type GameState,
    resolveTopOfStack,
} from "../../../gre/state";
import {
    makeInstance,
    makePlayer,
    makeState,
    submitChoice,
} from "../../__tests__/setup.helper";
import { displaySubtypes } from "../changeling";

const CHANGELING = "changeling-test-creature";
const DOUBLE_FACED = "changeling-test-double-faced";
const PLAIN = "changeling-test-plain";
preloadDefinitions([
    {
        id: CHANGELING,
        name: "Changeling Test Creature",
        rarity: "common",
        manaCost: { X: 1 },
        types: ["Creature"],
        subtypes: ["Shapeshifter"],
        staticAbilities: ["changeling"],
        power: 1,
        toughness: 1,
    },
    {
        id: DOUBLE_FACED,
        name: "Changeling Test Double Faced",
        rarity: "common",
        types: ["Creature"],
        subtypes: ["Human"],
        power: 1,
        toughness: 1,
        backFace: {
            name: "Changeling Test Back",
            types: ["Creature"],
            subtypes: ["Shapeshifter"],
            staticAbilities: ["changeling"],
            power: 2,
            toughness: 2,
        },
    },
    {
        id: PLAIN,
        name: "Changeling Test Plain",
        rarity: "common",
        types: ["Creature"],
        subtypes: ["Bear"],
        power: 2,
        toughness: 2,
    },
]);

const everyType = [...CREATURE_SUBTYPES];

function board(...battlefield: CardInstanceState[]): GameState {
    return makeState({
        players: [makePlayer("p1", { battlefield }), makePlayer("p2")],
    });
}

const permanent = (state: GameState, id: string) =>
    state.players.flatMap((p) => p.battlefield).find((c) => c.id === id)!;

/** The persisted `subtypes` of the first permanent: absent when it equals the
 *  definition's line, which is what keeps a changeling's row small. */
function compactSubtypes(state: GameState): unknown {
    const compact = compactState(state) as {
        players: { battlefield: { subtypes?: unknown }[] }[];
    };
    return compact.players[0].battlefield[0].subtypes;
}

describe("Changeling is every creature type (CR 702.73a)", () => {
    it("adds every creature type to the definition, printed subtypes first", () => {
        const subtypes = getDefinition(CHANGELING).subtypes!;
        expect(subtypes[0]).toBe("Shapeshifter");
        expect(subtypes).toEqual(expect.arrayContaining(everyType));
        expect(new Set(subtypes).size).toBe(subtypes.length);
    });

    it("reaches the back face that declares it, and no other definition", () => {
        const def = getDefinition(DOUBLE_FACED);
        expect(def.subtypes).toEqual(["Human"]);
        expect(def.backFace!.subtypes).toEqual(
            expect.arrayContaining(everyType)
        );
        expect(getDefinition(PLAIN).subtypes).toEqual(["Bear"]);
    });

    it("a lord naming any creature type buffs it, and the client derives the same", () => {
        const lord = makeInstance(getCardByName("Lord of Atlantis").id, {
            id: "lord",
            controllerId: "p1",
        });
        const changeling = makeInstance(CHANGELING, { id: "changeling" });
        const plain = makeInstance(PLAIN, { id: "plain" });
        const state = board(lord, changeling, plain);
        beginApplyingStaticEffects(state, lord);

        expect(getEffectivePower(state, changeling)).toBe(2);
        expect(getEffectivePower(state, plain)).toBe(2);

        const slim = projectPublicState(state, 1, "p1").players[0].battlefield;
        const wire = slim.find((c) => c.id === "changeling")!;
        expect(wire.subtypes).toEqual(expect.arrayContaining(everyType));
        expect(getEffectivePower(state, wire as CardInstanceState)).toBe(2);
    });

    it.each(["hand", "library", "graveyard", "exile"] as const)(
        "functions in the %s (CR 604.3) and survives the persisted snapshot",
        (zone) => {
            const card = makeInstance(CHANGELING, { id: "away", zone });
            const state = makeState({
                players: [
                    makePlayer("p1", { [zone]: [card] }),
                    makePlayer("p2"),
                ],
            });
            const [restored] = (expandState(compactState(state)) as GameState)
                .players[0][zone] as CardInstanceState[];
            expect(restored.subtypes).toEqual(
                expect.arrayContaining(everyType)
            );
        }
    );

    it("a card placed by name reads the expanded line (preset scenarios)", () => {
        const bears = getCardByName("Grizzly Bears");
        withTemporaryDefinition(
            { ...bears, staticAbilities: ["changeling"] },
            () => {
                const state = buildStateFromScenario(makeState(), {
                    cards: [
                        {
                            name: "Grizzly Bears",
                            owner: "me",
                            zone: "battlefield",
                        },
                    ],
                });
                const [placed] = state.players[0].battlefield;
                expect(placed.subtypes).toEqual(
                    expect.arrayContaining(everyType)
                );
            }
        );
    });

    it("does not persist the line: the snapshot rebuilds it from the definition", () => {
        const state = board(makeInstance(CHANGELING, { id: "changeling" }));
        expect(compactSubtypes(state)).toBeUndefined();
    });
});

describe("Changeling in the layers (CR 613)", () => {
    it("a later creature-type set replaces it (CR 613.3, CR 205.1a)", () => {
        const source = makeInstance(getCardByName("Unnatural Selection").id, {
            id: "selection",
            controllerId: "p1",
        });
        const changeling = makeInstance(CHANGELING, { id: "changeling" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [source, changeling] }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });
        state.stack.push({
            ...source,
            zone: "stack",
            castById: "p1",
            abilityId: "unnatural-selection-retype",
            targets: [{ type: "permanent", id: "changeling" }],
        });
        resolveTopOfStack(state);
        submitChoice(state, ["Elf"]);

        expect(permanent(state, "changeling").subtypes).toEqual(["Elf"]);
    });

    it("losing all abilities leaves it every creature type (CR 613.6)", () => {
        const humility = makeInstance(getCardByName("Humility").id, {
            id: "humility",
            controllerId: "p1",
        });
        const changeling = makeInstance(CHANGELING, { id: "changeling" });
        const state = board(humility, changeling);
        beginApplyingStaticEffects(state, humility);

        const live = permanent(state, "changeling");
        expect(live.staticAbilities).not.toContain("changeling");
        expect(live.subtypes).toEqual(expect.arrayContaining(everyType));
    });
});

describe("Changeling on a copy or a token", () => {
    it("a copy of a changeling is every creature type (CR 707.2)", () => {
        const state = board(
            makeInstance(CHANGELING, { id: "changeling" }),
            makeInstance(PLAIN, { id: "plain" })
        );
        applyCopy(
            state,
            permanent(state, "plain"),
            permanent(state, "changeling")
        );
        expect(permanent(state, "plain").subtypes).toEqual(
            expect.arrayContaining(everyType)
        );
    });

    it('"except it has changeling" makes the copy every creature type', () => {
        const state = board(
            makeInstance(PLAIN, { id: "original" }),
            makeInstance(PLAIN, { id: "copy" })
        );
        applyCopy(
            state,
            permanent(state, "copy"),
            permanent(state, "original"),
            { additionalStaticAbilities: ["changeling"] }
        );
        const copy = permanent(state, "copy");
        expect(copy.subtypes[0]).toBe("Bear");
        expect(copy.subtypes).toEqual(expect.arrayContaining(everyType));
        expect(permanent(state, "original").subtypes).toEqual(["Bear"]);
    });

    it("a token with changeling is every creature type, and compacts to its definition", () => {
        const state = board();
        const [id] = createTokenPermanents(
            state,
            {
                name: "Shapeshifter",
                types: ["Creature"],
                subtypes: ["Shapeshifter"],
                staticAbilities: ["changeling"],
                power: 1,
                toughness: 1,
            },
            "p1",
            1
        );
        const token = permanent(state, id);
        expect(token.subtypes).toEqual(expect.arrayContaining(everyType));
        expect(compactSubtypes(state)).toBeUndefined();
        expect(
            permanent(expandState(compactState(state)) as GameState, id)
                .subtypes
        ).toEqual(token.subtypes);
    });

    it("a grant to another permanent is refused by the compiler gate", () => {
        expect(isDefinitionLevelKeyword("changeling")).toBe(true);
    });
});

describe("displaySubtypes", () => {
    it("collapses every creature type and keeps the rest of the line", () => {
        expect(displaySubtypes(["Equipment", ...everyType])).toEqual([
            "Every creature type",
            "Equipment",
        ]);
    });

    it("leaves any partial line as printed", () => {
        expect(displaySubtypes(["Elf", "Shaman"])).toEqual(["Elf", "Shaman"]);
    });
});
