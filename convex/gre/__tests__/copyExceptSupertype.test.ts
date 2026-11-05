// CR 707.9b / 707.3 / 500.4 / 603.3d — the three pieces of a `becomeCopy` that
// reads "Until your next turn, this creature becomes a copy of up to one target
// artifact, non-Aura enchantment, or land, except its name is X, it's a
// legendary 4/4 Human Villain creature in addition to its other types, and it
// has vigilance" (issue #8167).
//
//   - the SUPERTYPE exception is a copiable value (CR 707.9b): every reader of
//     a permanent's supertypes sees it, and a copy of the copy inherits it
//     (CR 707.3);
//   - "until your next turn" expires as the controller's next untap step
//     begins (CR 500.4), before that step's untap and phasing (CR 502.1);
//   - "up to one target" may announce none (CR 601.2c, 603.3d): the permanent
//     stays as it is and nothing else is asked.

import { describe, expect, it } from "vitest";
import { phaseTrigger } from "../../cards/abilities/triggers/phaseTrigger";
import {
    getCardByName,
    tryGetDefinition,
    withTemporaryDefinition,
} from "../../cards";
import { ATTACK_RESTRICTION_CTX } from "../../cards/attackRestrictions";
import { CAST_RESTRICTION_CTX } from "../../cards/castRestrictions";
import { controlsLandWithSupertype } from "../../cards/landwalkNegation";
import { matchesBandQuality } from "../banding";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { hasSupertypeLive, liveSupertypesOf } from "../../cards/snowReads";
import type { CardDefinition, DurationSpec } from "../../cards/types";
import {
    applyOneTargetSelection,
    cancelTriggerTargetSelection,
} from "../../game";
import { applyCopy, presentedDefId } from "../copy";
import { validateEffectScript } from "../effects/validate";
import { getEffectivePower, getEffectiveToughness } from "../layers";
import { advancePhase } from "../phases";
import { checkLegendRuleSBA, checkWorldRuleSBA } from "../sba";
import { compactState, expandState } from "../serialize";
import {
    raiseTriggerTargetSelection,
    getLegalTargets,
    NO_TARGETING_SOURCE,
} from "../rules";
import { resolveTopOfStack } from "../state";
import type { CardInstanceState, GameState } from "../state";

const LOTUS = getCardByName("Black Lotus").id; // noncreature artifact
const MEMNITE = getCardByName("Memnite").id; // artifact creature, no subtype clash
const FOREST = getCardByName("Forest").id;
const PACIFISM = getCardByName("Pacifism").id; // Aura
const BEARS = getCardByName("Grizzly Bears").id;

const NAME = "Test Absorber";
const UNTIL_YOUR_NEXT_TURN: DurationSpec = {
    phase: "untap",
    player: "controller",
};
const COPY_TEXT =
    "At the beginning of your first main phase, until your next turn, this creature becomes a copy of up to one target artifact, non-Aura enchantment, or land, except its name is Test Absorber, it's a legendary 4/4 Human Villain creature in addition to its other types, and it has vigilance.";

/** The printed body is NONLEGENDARY so a Legendary reading can only come from
 *  the exception, and so its expiry is observable. */
const ABSORBER: CardDefinition = {
    id: "test-8167-absorber",
    name: NAME,
    rarity: "rare",
    oracleText: COPY_TEXT,
    manaCost: { generic: 1, G: 1, U: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Villain"],
    power: 4,
    toughness: 4,
    triggeredAbilities: [
        phaseTrigger({
            id: "test-8167-absorb",
            oracleText: COPY_TEXT,
            phase: "PRECOMBAT_MAIN",
            scope: "your",
            targetRequirement: {
                type: ["Artifact", "Enchantment", "Land"],
                excludeSubtypes: "Aura",
                count: { min: 0, max: 1 },
            },
            effects: [
                {
                    op: "becomeCopy",
                    target: { ref: "$source" },
                    source: { target: 0 },
                    duration: UNTIL_YOUR_NEXT_TURN,
                    except: {
                        name: NAME,
                        additionalSupertypes: ["Legendary"],
                        basePower: 4,
                        baseToughness: 4,
                        additionalTypes: ["Creature"],
                        additionalSubtypes: ["Human", "Villain"],
                        additionalStaticAbilities: ["vigilance"],
                    },
                },
            ],
        }),
    ],
};

const withProbe = <T>(run: () => T): T =>
    withTemporaryDefinition(ABSORBER, run);

const permanent = (cardId: string, id: string, controllerId = "p1") =>
    makeInstance(cardId, {
        id,
        controllerId,
        ownerId: controllerId,
        isSummoningSick: false,
        types: tryGetDefinition(cardId)?.types ?? [],
        subtypes: tryGetDefinition(cardId)?.subtypes ?? [],
        power: tryGetDefinition(cardId)?.power,
        toughness: tryGetDefinition(cardId)?.toughness,
    });

/** p1's draw step, about to enter the first main phase with the probe out. */
function board(
    mine: CardInstanceState[] = [],
    theirs: CardInstanceState[] = []
): GameState {
    return makeState({
        phase: "DRAW",
        turn: 3,
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", {
                battlefield: [permanent(ABSORBER.id, "absorber"), ...mine],
            }),
            makePlayer("p2", { battlefield: theirs }),
        ],
    });
}

const find = (s: GameState, id: string): CardInstanceState =>
    s.players.flatMap((p) => p.battlefield).find((c) => c.id === id)!;

/** Enter the first main phase: the trigger goes on the stack. */
function trigger(state: GameState): void {
    advancePhase(state);
    expect(state.phase).toBe("PRECOMBAT_MAIN");
    expect(state.stack).toHaveLength(1);
}

function select(state: GameState, id: string): void {
    applyOneTargetSelection(state, "p1", {
        targetType: "permanent",
        targetId: id,
    });
}

function copyOf(id: string, ...mine: CardInstanceState[]): GameState {
    const state = board([permanent(LOTUS, "lotus"), ...mine]);
    trigger(state);
    select(state, id);
    resolveTopOfStack(state);
    return state;
}

/** Walk the phases until `activePlayerId`'s untap step has run. */
function toUntapStepOf(state: GameState, activePlayerId: string): void {
    state.stack = [];
    state.pendingTarget = undefined;
    state.pendingChoices = [];
    for (let i = 0; i < 40; i++) {
        advancePhase(state);
        if (
            state.activePlayerId === activePlayerId &&
            state.phase !== "PRECOMBAT_MAIN"
        ) {
            const entered = state.phase;
            if (entered === "UPKEEP" || entered === "UNTAP") return;
        }
    }
    throw new Error("never reached the untap step");
}

describe("copy exception: supertype as a copiable value (CR 707.9b, issue #8167)", () => {
    it("makes the copy legendary, on top of the rest of the clause", () => {
        withProbe(() => {
            const state = copyOf("lotus");
            const copy = find(state, "absorber");
            expect(presentedDefId(copy)).toBe(LOTUS);
            expect(liveSupertypesOf(copy)).toEqual(["Legendary"]);
            expect(hasSupertypeLive(copy, "Legendary")).toBe(true);
            expect(copy.copyExcept?.name).toBe(NAME);
            expect(copy.types).toEqual(["Artifact", "Creature"]);
            expect(copy.subtypes).toEqual(["Human", "Villain"]);
            expect(getEffectivePower(state, copy)).toBe(4);
            expect(getEffectiveToughness(state, copy)).toBe(4);
            expect(copy.staticAbilities).toContain("vigilance");
        });
    });

    it("keeps one Creature when the copied object already is one (CR 205.2a)", () => {
        withProbe(() => {
            const state = copyOf("memnite", permanent(MEMNITE, "memnite"));
            const copy = find(state, "absorber");
            expect(copy.types).toEqual(["Artifact", "Creature"]);
        });
    });

    it("subjects the copy to the legend rule, grouped on the excepted name (CR 704.5j)", () => {
        withProbe(() => {
            // A second copy under the same clause: both legendary, both named
            // the probe's name, neither printed legendary.
            const state = copyOf("lotus");
            state.players[0].battlefield.push(
                makeInstance(LOTUS, {
                    id: "twin",
                    controllerId: "p1",
                    ownerId: "p1",
                    copyExcept: {
                        name: NAME,
                        additionalSupertypes: ["Legendary"],
                    },
                })
            );
            expect(checkLegendRuleSBA(state)).toBe(true);
            expect(state.pendingChoices?.[0]?.kind).toBe("legend-keep");
        });
    });

    it("does not call the same pair legendary without the clause (CR 704.5j)", () => {
        withProbe(() => {
            const state = copyOf("lotus");
            state.players[0].battlefield.push(
                makeInstance(LOTUS, {
                    id: "twin",
                    controllerId: "p1",
                    ownerId: "p1",
                    copyExcept: { name: NAME },
                })
            );
            expect(checkLegendRuleSBA(state)).toBe(false);
        });
    });

    it("does not copy a P/T CDA once the clause names the P/T (CR 707.9d)", () => {
        withProbe(() => {
            const swamps = [1, 2, 3].map((i) =>
                permanent(getCardByName("Swamp").id, `swamp-${i}`)
            );
            const state = board([
                permanent(getCardByName("Nightmare").id, "cda"),
                ...swamps,
            ]);
            state.phase = "PRECOMBAT_MAIN";
            const absorber = find(state, "absorber");
            applyCopy(state, absorber, find(state, "cda"), {
                basePower: 4,
                baseToughness: 4,
            });
            expect(getEffectivePower(state, absorber)).toBe(4);
            expect(getEffectiveToughness(state, absorber)).toBe(4);
            // The copied object itself still counts its Swamps.
            expect(getEffectivePower(state, find(state, "cda"))).toBe(3);
        });
    });

    it("is inherited by a copy of the copy (CR 707.3)", () => {
        withProbe(() => {
            const state = copyOf("lotus", permanent(BEARS, "clone"));
            const clone = find(state, "clone");
            applyCopy(state, clone, find(state, "absorber"), {});
            expect(liveSupertypesOf(clone)).toEqual(["Legendary"]);
            expect(clone.copyExcept?.name).toBe(NAME);
            expect(clone.types).toEqual(["Artifact", "Creature"]);
            expect(clone.subtypes).toEqual(["Human", "Villain"]);
            expect(getEffectivePower(state, clone)).toBe(4);
            expect(clone.staticAbilities).toContain("vigilance");
        });
    });

    it("gives nothing to a copy of it while it is face down (CR 707.2)", () => {
        withProbe(() => {
            const state = copyOf("lotus", permanent(BEARS, "clone"));
            const copy = find(state, "absorber");
            copy.faceDown = true;
            expect(liveSupertypesOf(copy)).toEqual([]);
            const clone = find(state, "clone");
            applyCopy(state, clone, copy, {});
            expect(clone.copyExcept).toBeUndefined();
        });
    });

    it("is seen by the supertype readers that look at the definition", () => {
        withProbe(() => {
            const state = copyOf("forest", permanent(FOREST, "forest"));
            const copy = find(state, "absorber");
            // Legendary landwalk (CR 702.14) sees a legendary land.
            expect(
                controlsLandWithSupertype(
                    state.players[0].battlefield,
                    "Legendary"
                )
            ).toBe(true);
            // "Bands with other legendary creatures" (CR 702.22c).
            expect(matchesBandQuality(copy, { kind: "legendary" })).toBe(true);
        });
    });

    it("answers the static-effect contexts' supertype question", () => {
        withProbe(() => {
            const copy = find(copyOf("lotus"), "absorber");
            expect(ATTACK_RESTRICTION_CTX.hasSupertype(copy, "Legendary")).toBe(
                true
            );
            expect(CAST_RESTRICTION_CTX.hasSupertype(copy, "Legendary")).toBe(
                true
            );
        });
    });

    it("subjects a copy made a world permanent to the world rule (CR 704.5k)", () => {
        const world = (id: string) =>
            makeInstance(LOTUS, {
                id,
                controllerId: "p1",
                ownerId: "p1",
                copyExcept: { additionalSupertypes: ["World"] },
            });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [world("w1"), world("w2")] }),
                makePlayer("p2"),
            ],
        });
        expect(checkWorldRuleSBA(state)).toBe(true);
    });

    it("is excluded by a nonlegendary target requirement", () => {
        withProbe(() => {
            const state = copyOf("lotus", permanent(BEARS, "bears"));
            const legal = getLegalTargets(
                state,
                { type: "Creature", count: 1, excludeSupertypes: "Legendary" },
                NO_TARGETING_SOURCE,
                "p1"
            );
            expect(legal.map((t) => t.id)).toContain("bears");
            expect(legal.map((t) => t.id)).not.toContain("absorber");
        });
    });

    it("survives the snapshot, in the stamp and in the timed ledger", () => {
        withProbe(() => {
            const state = expandState(compactState(copyOf("lotus")));
            const copy = find(state, "absorber");
            expect(liveSupertypesOf(copy)).toEqual(["Legendary"]);
            expect(
                copy.timedCopyEffects?.effects[0].opts.additionalSupertypes
            ).toEqual(["Legendary"]);
            toUntapStepOf(state, "p2");
            expect(liveSupertypesOf(find(state, "absorber"))).toEqual([
                "Legendary",
            ]);
        });
    });
});

describe("copy duration: until your next turn (CR 500.4, issue #8167)", () => {
    it("outlives the opponent's turn and ends as its controller's next untap step begins", () => {
        withProbe(() => {
            const state = copyOf("lotus");
            toUntapStepOf(state, "p2");
            expect(presentedDefId(find(state, "absorber"))).toBe(LOTUS);

            toUntapStepOf(state, "p1");
            const back = find(state, "absorber");
            expect(presentedDefId(back)).toBe(ABSORBER.id);
            expect(liveSupertypesOf(back)).toEqual([]);
            expect(back.copyExcept).toBeUndefined();
            expect(back.types).toEqual(["Creature"]);
        });
    });

    it("has already ended when the untap step's phasing happens (CR 500.4 before CR 502.1)", () => {
        const phaser: CardDefinition = {
            id: "test-8167-phaser",
            name: "Test Phasing Artifact",
            rarity: "common",
            oracleText: "Phasing",
            manaCost: { generic: 1 },
            types: ["Artifact"],
            staticAbilities: ["phasing"],
        };
        withProbe(() =>
            withTemporaryDefinition(phaser, () => {
                const state = board([permanent(LOTUS, "lotus")]);
                trigger(state);
                // The copy of a phasing artifact has phasing only while it
                // lasts: expired first, it no longer phases out.
                const source = makeInstance(phaser.id, {
                    id: "ph",
                    controllerId: "p2",
                    ownerId: "p2",
                    types: ["Artifact"],
                    subtypes: [],
                    staticAbilities: ["phasing"],
                });
                state.players[1].battlefield.push(source);
                select(state, "ph");
                resolveTopOfStack(state);
                expect(find(state, "absorber").staticAbilities).toContain(
                    "phasing"
                );
                toUntapStepOf(state, "p1");
                expect(state.players[0].battlefield.map((c) => c.id)).toContain(
                    "absorber"
                );
                expect(presentedDefId(find(state, "absorber"))).toBe(
                    ABSORBER.id
                );
            })
        );
    });
});

describe('copy target: "up to one target" (CR 601.2c / 603.3d, issue #8167)', () => {
    it("offers the choice with a sole legal target, never auto-selecting it", () => {
        withProbe(() => {
            const state = board([permanent(LOTUS, "lotus")]);
            trigger(state);
            expect(state.pendingTarget?.kind).toBe("trigger");
            expect(state.pendingTarget?.count).toEqual({ min: 0, max: 1 });
        });
    });

    it("declining leaves the permanent unchanged and asks nothing more", () => {
        withProbe(() => {
            const state = board([permanent(LOTUS, "lotus")]);
            trigger(state);
            cancelTriggerTargetSelection(state);
            expect(state.stack[0].targets).toEqual([]);
            resolveTopOfStack(state);
            const same = find(state, "absorber");
            expect(presentedDefId(same)).toBe(ABSORBER.id);
            expect(same.timedCopyEffects).toBeUndefined();
            expect(same.copyExcept).toBeUndefined();
            expect(state.pendingTarget).toBeUndefined();
            expect(state.pendingChoices ?? []).toEqual([]);
        });
    });

    it("raises no prompt when only an Aura and a creature are out", () => {
        withProbe(() => {
            const state = board([
                permanent(PACIFISM, "aura"),
                permanent(BEARS, "bears"),
            ]);
            trigger(state);
            expect(raiseTriggerTargetSelection(state)).toBe(false);
            expect(state.pendingTarget).toBeUndefined();
            expect(state.stack[0].targets).toEqual([]);
            resolveTopOfStack(state);
            expect(presentedDefId(find(state, "absorber"))).toBe(ABSORBER.id);
            expect(state.pendingChoices ?? []).toEqual([]);
        });
    });
});

describe("EffectCopyExcept validation (CR 707.9b, issue #8167)", () => {
    const errorsOf = (except: unknown) =>
        validateEffectScript({
            id: "test-8167-validate",
            name: "Test Validate",
            effects: [
                {
                    op: "becomeCopy",
                    target: { target: 0 },
                    source: { target: 1 },
                    except,
                },
            ],
        } as never);

    it("accepts a name and a supertype", () => {
        expect(
            errorsOf({ name: NAME, additionalSupertypes: ["Legendary"] })
        ).toEqual([]);
    });

    it.each([
        ["an unknown supertype", { additionalSupertypes: ["Epic"] }],
        ["an empty list", { additionalSupertypes: [] }],
        ["an empty name", { name: "" }],
    ])("refuses %s", (_label, except) => {
        expect(errorsOf(except)).not.toEqual([]);
    });
});
