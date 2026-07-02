// Legends (LEG) — red per-card behaviour tests (ADR 0043 colour split;
// twin of arn/leb colour test files). Each non-trivial card gets a describe
// block citing the CR section it exercises; assertions check external
// behaviour only. Shared shims live in ./helpers; fixtures in
// convex/cards/__tests__/setup.ts.

import { describe, it, expect } from "vitest";
import { UPKEEP_C5, answerChoice, resolveTrigger } from "./helpers";
import {
    activeVolcano,
    aerathiBerserker,
    amrouKithkin,
    azureDrake,
    beastsOfBogardan,
    bloodLust,
    cavernsOfDespair,
    chainLightning,
    chromium,
    crawGiant,
    crimsonKobolds,
    crookshankKobolds,
    eternalWarrior,
    frostGiant,
    giantStrength,
    glyphOfDestruction,
    glyphOfLife,
    gravitySphere,
    hundingGjornersen,
    hyperionBlacksmith,
    immolation,
    jasmineBoreal,
    keepersOfTheFaith,
    koboldDrillSergeant,
    koboldOverlord,
    koboldTaskmaster,
    koboldsOfKherKeep,
    marhaultElsdragon,
    primordialOoze,
    spinalVillain,
    theBrute,
    wallOfEarth,
    wallOfHeat,
    wallOfOpposition,
    windsOfChange,
    wolverinePack,
} from "..";
import { projectPublicState } from "../../../../gameProjections";
import { recordBlockedAttackers } from "../../../../gre/banding";
import {
    getAttackerCap,
    getBlockerCap,
    validateAttackerEligibility,
} from "../../../../gre/combat";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { applyMayPaySubmit } from "../../../../gre/pendingChoiceSubmit";
import {
    advancePhase,
    applyAllCombatDamage,
    emitBlockersConfirmedEvents,
    finalizeCleanup,
    fireDelayedTriggers,
} from "../../../../gre/phases";
import { getLegalTargets } from "../../../../gre/rules";
import {
    applySourceStaticEffects,
    removePermanentTo,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
    type StackItem,
} from "../../../../gre/state";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { getDefinition } from "../../../index";
import {
    forest,
    grizzlyBears,
    island,
    lightningBolt,
    mountain,
} from "../../lea";

describe("Kobold Taskmaster (other Kobolds +1/+0, CR 611)", () => {
    it("buffs other Kobolds but not itself (GRE + wire)", () => {
        const lord = makeInstance(koboldTaskmaster.id, {
            id: "lord",
            controllerId: "p1",
        });
        const buddy = makeInstance(crimsonKobolds.id, {
            id: "buddy",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [lord, buddy] }),
                makePlayer("p2"),
            ],
        });
        expect(getEffectivePower(state, buddy)).toBe(1); // 0 + 1
        expect(getEffectivePower(state, lord)).toBe(1); // unchanged (other only)

        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "buddy"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(1);
    });
});

describe("Kobold Drill Sergeant (other Kobolds +0/+1 and trample, CR 611)", () => {
    it("buffs toughness and grants trample to other Kobolds (GRE + wire)", () => {
        const sergeant = makeInstance(koboldDrillSergeant.id, {
            id: "sgt",
            controllerId: "p1",
        });
        const buddy = makeInstance(crookshankKobolds.id, {
            id: "buddy",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [sergeant, buddy] }),
                makePlayer("p2"),
            ],
        });
        // Keyword grants are pushed onto matching permanents at ETB; replicate
        // that here for a hand-built board.
        applySourceStaticEffects(state, sergeant);
        expect(getEffectiveToughness(state, buddy)).toBe(2); // 1 + 1
        const live = state.players[0].battlefield.find(
            (c) => c.id === "buddy"
        )!;
        expect(live.staticAbilities).toContain("trample");

        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "buddy"
        )!;
        expect(getEffectiveToughness(projected, slim)).toBe(2);
        expect(slim.staticAbilities).toContain("trample");
    });
});

describe("Kobold Overlord (other Kobolds have first strike, CR 611/702.7)", () => {
    it("grants first strike to other Kobolds and has it itself", () => {
        expect(koboldOverlord.staticAbilities).toContain("first strike");
        const lord = makeInstance(koboldOverlord.id, {
            id: "lord",
            controllerId: "p1",
        });
        const buddy = makeInstance(koboldsOfKherKeep.id, {
            id: "buddy",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [lord, buddy] }),
                makePlayer("p2"),
            ],
        });
        applySourceStaticEffects(state, lord);
        const live = state.players[0].battlefield.find(
            (c) => c.id === "buddy"
        )!;
        expect(live.staticAbilities).toContain("first strike");

        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "buddy"
        )!;
        expect(slim.staticAbilities).toContain("first strike");
    });
});

describe("Beasts of Bogardan (+1/+1 vs nontoken white permanent, CR 611.2c)", () => {
    it("gains +1/+1 only while an opponent controls a nontoken white permanent (GRE + wire)", () => {
        const beast = makeInstance(beastsOfBogardan.id, {
            id: "beast",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [beast] }),
                makePlayer("p2"),
            ],
        });
        expect(getEffectivePower(state, beast)).toBe(3); // base, no white opp
        // White creature for the opponent (Keepers of the Faith is white).
        const whiteOpp = makeInstance(keepersOfTheFaith.id, {
            id: "wopp",
            controllerId: "p2",
        });
        state.players[1].battlefield.push(whiteOpp);
        expect(getEffectivePower(state, beast)).toBe(4); // 3 + 1
        expect(getEffectiveToughness(state, beast)).toBe(4);

        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "beast"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(4);
    });
    it("a token white permanent does not switch it on", () => {
        const beast = makeInstance(beastsOfBogardan.id, {
            id: "beast",
            controllerId: "p1",
        });
        const tokenWhite = makeInstance(keepersOfTheFaith.id, {
            id: "tok",
            controllerId: "p2",
            isToken: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [beast] }),
                makePlayer("p2", { battlefield: [tokenWhite] }),
            ],
        });
        expect(getEffectivePower(state, beast)).toBe(3);
    });
});

describe("Spinal Villain ({T}: destroy target blue creature, CR 701.7)", () => {
    it("destroys a blue creature", () => {
        const villain = makeInstance(spinalVillain.id, {
            id: "villain",
            controllerId: "p1",
        });
        const blueCreature = makeInstance(azureDrake.id, {
            id: "drake",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [villain] }),
                makePlayer("p2", { battlefield: [blueCreature] }),
            ],
        });
        state.stack.push({
            ...villain,
            zone: "stack",
            castById: "p1",
            abilityId: "spinal-villain-destroy",
            targets: [{ type: "permanent", id: "drake" }],
        } as StackItem);
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "drake")
        ).toBeUndefined();
    });
});

describe("Hyperion Blacksmith ({T}: tap or untap opponent artifact, CR 701.20)", () => {
    it("untaps a tapped opponent artifact when the controller chooses untap", () => {
        const smith = makeInstance(hyperionBlacksmith.id, {
            id: "smith",
            controllerId: "p1",
        });
        // Use a registered artifact (Ornithopter from lea, 0-cost artifact).
        const artifact = makeInstance(
            "59cc9bdb-7cf2-4795-bac7-ffff605c9eb0", // Ornithopter (artifact)
            {
                id: "arti",
                controllerId: "p2",
                ownerId: "p2",
                isTapped: true,
            }
        );
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [smith] }),
                makePlayer("p2", { battlefield: [artifact] }),
            ],
        });
        state.stack.push({
            ...smith,
            zone: "stack",
            castById: "p1",
            abilityId: "hyperion-blacksmith-tap-untap",
            targets: [{ type: "permanent", id: "arti" }],
        } as StackItem);
        resolveTopOfStack(state); // suspends on the tap/untap option choice
        answerChoice(state, ["untap"]);
        expect(
            state.players[1].battlefield.find((c) => c.id === "arti")?.isTapped
        ).toBe(false);
    });
});

describe("Wall of Opposition ({1}: +1/+0 EOT, CR 611.1)", () => {
    it("pumps power for the turn", () => {
        const wall = makeInstance(wallOfOpposition.id, {
            id: "wall",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [wall] }),
                makePlayer("p2"),
            ],
        });
        expect(getEffectivePower(state, wall)).toBe(0);
        state.stack.push({
            ...wall,
            zone: "stack",
            castById: "p1",
            abilityId: "wall-of-opposition-pump",
            targets: [],
        } as StackItem);
        resolveTopOfStack(state);
        const live = state.players[0].battlefield.find((c) => c.id === "wall")!;
        expect(getEffectivePower(state, live)).toBe(1);
    });
});

describe("Giant Strength / Immolation / Eternal Warrior auras (CR 303.4)", () => {
    function attach(auraDef: typeof giantStrength) {
        const host = makeInstance("0ddb98e8-13fe-4786-83f7-b72c56db135a", {
            id: "host",
            controllerId: "p1",
            power: 3,
            toughness: 3,
        }); // Hill Giant 3/3
        const aura = makeInstance(auraDef.id, {
            id: "aura",
            controllerId: "p1",
            attachedTo: "host",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [host, aura] }),
                makePlayer("p2"),
            ],
        });
        // Push the aura's keyword grants onto the host (ETB replication).
        applySourceStaticEffects(state, aura);
        return { state, host };
    }
    it("Giant Strength grants +2/+2 (GRE + wire)", () => {
        const { state, host } = attach(giantStrength);
        expect(getEffectivePower(state, host)).toBe(5);
        expect(getEffectiveToughness(state, host)).toBe(5);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "host"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(5);
    });
    it("Immolation grants +2/-2", () => {
        const { state, host } = attach(immolation);
        expect(getEffectivePower(state, host)).toBe(5);
        expect(getEffectiveToughness(state, host)).toBe(1);
    });
    it("Eternal Warrior grants vigilance (GRE + wire)", () => {
        const { state } = attach(eternalWarrior);
        const live = state.players[0].battlefield.find((c) => c.id === "host")!;
        expect(live.staticAbilities).toContain("vigilance");
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "host"
        )!;
        expect(slim.staticAbilities).toContain("vigilance");
    });
});

describe("The Brute (aura +1/+0 + {R}{R}{R} regenerate host, CR 303.4/701.15a)", () => {
    it("buffs the host and the activated ability shields it", () => {
        const host = makeInstance("0ddb98e8-13fe-4786-83f7-b72c56db135a", {
            id: "host",
            controllerId: "p1",
            power: 3,
            toughness: 3,
        });
        const aura = makeInstance(theBrute.id, {
            id: "aura",
            controllerId: "p1",
            attachedTo: "host",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [host, aura] }),
                makePlayer("p2"),
            ],
        });
        expect(getEffectivePower(state, host)).toBe(4); // 3 + 1
        state.stack.push({
            ...aura,
            zone: "stack",
            castById: "p1",
            abilityId: "the-brute-regenerate",
            targets: [],
        } as StackItem);
        resolveTopOfStack(state);
        const live = state.players[0].battlefield.find((c) => c.id === "host")!;
        expect(live.regenerationShields ?? 0).toBeGreaterThan(0);
    });
});

describe("Blood Lust (+4/-4 if T>=5, else +4 power / toughness to 1, CR 611.1)", () => {
    it("a high-toughness creature gets +4/-4", () => {
        const wall = makeInstance(wallOfHeat.id, {
            id: "wall",
            controllerId: "p1",
        }); // 2/6
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [wall] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, bloodLust.id, "p1", [
            { type: "permanent", id: "wall" },
        ]);
        resolveTopOfStack(state);
        const live = state.players[0].battlefield.find((c) => c.id === "wall")!;
        expect(getEffectivePower(state, live)).toBe(6); // 2 + 4
        expect(getEffectiveToughness(state, live)).toBe(2); // 6 - 4
    });
    it("a low-toughness creature's toughness drops to 1", () => {
        const giant = makeInstance("0ddb98e8-13fe-4786-83f7-b72c56db135a", {
            id: "g",
            controllerId: "p1",
            power: 3,
            toughness: 3,
        }); // 3/3
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [giant] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, bloodLust.id, "p1", [{ type: "permanent", id: "g" }]);
        resolveTopOfStack(state);
        const live = state.players[0].battlefield.find((c) => c.id === "g")!;
        expect(getEffectivePower(state, live)).toBe(7); // 3 + 4
        expect(getEffectiveToughness(state, live)).toBe(1); // 3 - (3-1)
    });
});

describe("Glyph of Destruction (Wall +10/+0 + prevent + delayed destroy, CR 611.1/615/603.7a)", () => {
    it("pumps the Wall, shields it, and schedules its destruction at the next end step", () => {
        const wall = makeInstance(wallOfEarth.id, {
            id: "wall",
            controllerId: "p1",
            isBlocking: true,
        }); // 0/6 Wall
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [wall] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, glyphOfDestruction.id, "p1", [
            { type: "permanent", id: "wall" },
        ]);
        resolveTopOfStack(state);
        const live = state.players[0].battlefield.find((c) => c.id === "wall")!;
        expect(getEffectivePower(state, live)).toBe(10); // 0 + 10
        expect((state.delayedTriggers ?? []).length).toBe(1);

        // Fire the delayed destroy at the next end step.
        fireDelayedTriggers(state, "next-end-step");
        resolveTopOfStack(state);
        expect(
            state.players[0].battlefield.find((c) => c.id === "wall")
        ).toBeUndefined();
    });
});

describe("Glyph of Life (delayed lifegain on attacker damage to a Wall, CR 603.7/119)", () => {
    // Build a combat: p1's Wall blocks p2's attacker. Glyph of Life resolves on
    // the Wall (p1 controls the Glyph), arming the turn-scoped lifegain.
    function setupArmedCombat(attackerPower: number) {
        const wall = makeInstance(wallOfEarth.id, {
            id: "wall",
            controllerId: "p1",
            ownerId: "p1",
            isBlocking: true,
        }); // 0/6 Wall
        const attacker = makeInstance(grizzlyBears.id, {
            id: "atk",
            controllerId: "p2",
            ownerId: "p2",
            power: attackerPower,
            isAttacking: true,
        });
        const state = makeState({
            activePlayerId: "p2",
            priorityPlayerId: "p2",
            players: [
                makePlayer("p1", { battlefield: [wall], life: 20 }),
                makePlayer("p2", { battlefield: [attacker], life: 20 }),
            ],
            phase: "COMBAT_DAMAGE",
            combat: {
                attackerIds: ["atk"],
                confirmed: true,
                blockerAssignments: { wall: ["atk"] },
                blockersConfirmed: true,
            },
        });
        // p1 casts Glyph of Life targeting the Wall.
        pushSpell(state, glyphOfLife.id, "p1", [
            { type: "permanent", id: "wall" },
        ]);
        resolveTopOfStack(state);
        return state;
    }

    it("is a {W} Instant targeting a Wall creature", () => {
        expect(glyphOfLife.manaCost).toEqual({ W: 1 });
        expect(glyphOfLife.types).toEqual(["Instant"]);
        expect(glyphOfLife.targetRequirement).toEqual({
            type: "Creature",
            count: 1,
            subtypeFilter: "Wall",
        });
    });

    it("only lists Wall creatures as legal targets (CR 205.3)", () => {
        const wall = makeInstance(wallOfEarth.id, { id: "wall" });
        const bear = makeInstance(grizzlyBears.id, { id: "bear" }); // not a Wall
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [wall, bear] }),
                makePlayer("p2"),
            ],
        });
        const legal = getLegalTargets(
            state,
            glyphOfLife.targetRequirement!,
            [],
            "p1"
        )
            .filter((t) => t.type === "permanent")
            .map((t) => t.id);
        expect(legal).toContain("wall");
        expect(legal).not.toContain("bear");
    });

    it("arms a turn-scoped lifegain on resolution (CR 603.7)", () => {
        const state = setupArmedCombat(3);
        expect(state.damageTriggeredLifegain).toHaveLength(1);
        expect(state.damageTriggeredLifegain![0].instanceId).toBe("wall");
        expect(state.damageTriggeredLifegain![0].controllerId).toBe("p1");
    });

    it("gains the controller life equal to attacker combat damage to the Wall (CR 119)", () => {
        const state = setupArmedCombat(3);
        applyAllCombatDamage(state, { atk: { wall: 3 } });
        // Attacker (power 3) deals 3 to the 0/6 Wall → p1 gains 3 life.
        expect(state.players[0].life).toBe(23);
        // Wall survives (3 < 6 toughness).
        expect(
            state.players[0].battlefield.find((c) => c.id === "wall")
        ).toBeDefined();
    });

    it("does NOT gain life from a non-attacking (blocker) source", () => {
        // p1's Wall is the ATTACKER's blocker, but here we flip roles: the
        // damage to the watched permanent comes from a creature that is NOT in
        // combat.attackerIds. Set up the Wall as a watched attacker-side
        // creature being hit by a blocker.
        const wall = makeInstance(wallOfEarth.id, {
            id: "wall",
            controllerId: "p1",
            ownerId: "p1",
            power: 0,
            toughness: 6,
            staticAbilities: [], // strip defender so it can attack
            isAttacking: true,
        });
        const blocker = makeInstance(grizzlyBears.id, {
            id: "blk",
            controllerId: "p2",
            ownerId: "p2",
            power: 4,
            isBlocking: true,
        });
        const state = makeState({
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            players: [
                makePlayer("p1", { battlefield: [wall], life: 20 }),
                makePlayer("p2", { battlefield: [blocker], life: 20 }),
            ],
            phase: "COMBAT_DAMAGE",
            combat: {
                attackerIds: ["wall"],
                confirmed: true,
                blockerAssignments: { blk: ["wall"] },
                blockersConfirmed: true,
            },
        });
        pushSpell(state, glyphOfLife.id, "p1", [
            { type: "permanent", id: "wall" },
        ]);
        resolveTopOfStack(state);
        applyAllCombatDamage(state, {});
        // The blocker (id "blk", NOT in attackerIds) dealt 4 to the watched
        // Wall — that is a non-attacker source, so NO life is gained.
        expect(state.players[0].life).toBe(20);
    });

    it("ends at end of turn — the watch is cleared at CLEANUP (CR 514.2)", () => {
        const state = setupArmedCombat(3);
        expect(state.damageTriggeredLifegain).toHaveLength(1);
        state.phase = "CLEANUP";
        finalizeCleanup(state);
        expect(state.damageTriggeredLifegain).toBeUndefined();
    });
});

describe("Active Volcano (modal: destroy blue / return Island, CR 700.2)", () => {
    it("return-island mode bounces an Island to hand", () => {
        const isl = makeInstance(island.id, {
            id: "isl",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [isl] }),
            ],
        });
        const item = pushSpell(state, activeVolcano.id, "p1", [
            { type: "permanent", id: "isl" },
        ]);
        item.chosenModeId = "return-island";
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "isl")
        ).toBeUndefined();
        expect(state.players[1].hand.some((c) => c.id === "isl")).toBe(true);
    });
    it("destroy-blue mode destroys a blue permanent", () => {
        const drake = makeInstance(azureDrake.id, {
            id: "drake",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [drake] }),
            ],
        });
        const item = pushSpell(state, activeVolcano.id, "p1", [
            { type: "permanent", id: "drake" },
        ]);
        item.chosenModeId = "destroy-blue";
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "drake")
        ).toBeUndefined();
    });
});

describe("Winds of Change (each player shuffles hand into library, redraws, CR 701.20/121.1)", () => {
    it("each player ends with the same hand size after the swap", () => {
        const h1 = [
            makeInstance(lightningBolt.id, { id: "h1a", zone: "hand" }),
            makeInstance(lightningBolt.id, { id: "h1b", zone: "hand" }),
        ];
        const l1 = [
            makeInstance(mountain.id, { id: "l1a", zone: "library" }),
            makeInstance(mountain.id, { id: "l1b", zone: "library" }),
            makeInstance(mountain.id, { id: "l1c", zone: "library" }),
        ];
        const h2 = [makeInstance(forest.id, { id: "h2a", zone: "hand" })];
        const l2 = [
            makeInstance(forest.id, { id: "l2a", zone: "library" }),
            makeInstance(forest.id, { id: "l2b", zone: "library" }),
        ];
        const state = makeState({
            players: [
                makePlayer("p1", { hand: h1, library: l1 }),
                makePlayer("p2", { hand: h2, library: l2 }),
            ],
        });
        pushSpell(state, windsOfChange.id, "p1");
        resolveTopOfStack(state);
        // Same count back (old hand size); total cards per player preserved.
        expect(state.players[0].hand).toHaveLength(2);
        expect(state.players[1].hand).toHaveLength(1);
        expect(
            state.players[0].hand.length + state.players[0].library.length
        ).toBe(5);
        expect(
            state.players[1].hand.length + state.players[1].library.length
        ).toBe(3);
    });
});

describe("Gravity Sphere (World — all creatures lose flying, CR 702.9)", () => {
    it("carries the World supertype as data", () => {
        expect(gravitySphere.supertypes).toEqual(["World"]);
        expect(gravitySphere.types).toEqual(["Enchantment"]);
    });

    it("removes flying from every creature, regardless of controller (wire format)", () => {
        const gs = makeInstance(gravitySphere.id, {
            id: "gs",
            controllerId: "p1",
        });
        const mine = makeInstance(azureDrake.id, {
            id: "mine",
            controllerId: "p1",
            staticAbilities: ["flying"],
        });
        const theirs = makeInstance(azureDrake.id, {
            id: "theirs",
            controllerId: "p2",
            ownerId: "p2",
            staticAbilities: ["flying"],
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [gs, mine] }),
                makePlayer("p2", { battlefield: [theirs] }),
            ],
        });
        applySourceStaticEffects(state, gs);

        expect(
            state.players[0].battlefield.find((c) => c.id === "mine")!
                .staticAbilities
        ).not.toContain("flying");
        expect(
            state.players[1].battlefield.find((c) => c.id === "theirs")!
                .staticAbilities
        ).not.toContain("flying");

        const projected = projectPublicState(state, 1, "p1");
        const slimTheirs = projected.players[1].battlefield.find(
            (c) => c.id === "theirs"
        )!;
        expect(slimTheirs.staticAbilities).not.toContain("flying");
    });
});

// ──────────────────────────────────────────────────────────────────────────
// C3 — Rampage N (CR 702.23) — issue #380.
//
// Exercised through the REAL combat path: `emitBlockersConfirmedEvents` emits
// one BLOCKERS_CONFIRMED per attacker-blocker pair and pushes the matching
// triggers via `collectTriggers`, then `resolveTopOfStack` resolves the single
// deduped Rampage trigger. That proves both the per-pair dedupe (one fire per
// becoming-blocked) and the resolution-time blocker count (CR 702.23b).
// ──────────────────────────────────────────────────────────────────────────
describe("Rampage N (CR 702.23)", () => {
    /** p1 fields the Rampage `attacker`; p2 fields `blockerCount` blockers, all
     *  assigned to it, at DECLARE_BLOCKERS. Returns the live state plus the
     *  attacker instance for buff assertions. */
    function setupRampageCombat(
        def: { id: string },
        blockerCount: number
    ): { state: GameState; attacker: CardInstanceState } {
        const attacker = makeInstance(def.id, {
            id: "rampager",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const blockerIds = Array.from(
            { length: blockerCount },
            (_, i) => `blk${i}`
        );
        const blockers = blockerIds.map((id) =>
            makeInstance(grizzlyBears.id, {
                id,
                controllerId: "p2",
                ownerId: "p2",
                isBlocking: true,
            })
        );
        const blockerAssignments: Record<string, string[]> = {};
        for (const id of blockerIds) blockerAssignments[id] = ["rampager"];
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [attacker] }),
                makePlayer("p2", { battlefield: blockers }),
            ],
            phase: "DECLARE_BLOCKERS",
            combat: {
                attackerIds: ["rampager"],
                confirmed: true,
                blockerAssignments,
                blockersConfirmed: true,
            },
        });
        recordBlockedAttackers(state);
        return { state, attacker };
    }

    it("Aerathi Berserker (rampage 3) carries the keyword + factory trigger", () => {
        expect(aerathiBerserker.staticAbilities).toContain("rampage 3");
        expect(aerathiBerserker.triggeredAbilities?.[0].id).toBe("rampage-3");
        expect(aerathiBerserker.triggeredAbilities?.[0].event).toBe(
            "BLOCKERS_CONFIRMED"
        );
    });

    it("all seven Rampage cards carry the keyword + a rampageTrigger", () => {
        const cards: { def: typeof frostGiant; n: number }[] = [
            { def: aerathiBerserker, n: 3 },
            { def: frostGiant, n: 2 },
            { def: crawGiant, n: 2 },
            { def: wolverinePack, n: 2 },
            { def: chromium, n: 2 },
            { def: hundingGjornersen, n: 1 },
            { def: marhaultElsdragon, n: 1 },
        ];
        for (const { def, n } of cards) {
            expect(def.staticAbilities).toContain(`rampage ${n}`);
            const trig = def.triggeredAbilities?.find(
                (t) => t.id === `rampage-${n}`
            );
            expect(trig).toBeDefined();
            expect(trig!.event).toBe("BLOCKERS_CONFIRMED");
        }
    });

    it("blocked by ONE creature: no bonus (CR 702.23a — beyond the first)", () => {
        const { state } = setupRampageCombat(frostGiant, 1);
        emitBlockersConfirmedEvents(state);
        // Exactly one Rampage trigger fires (one pair, one fire).
        expect(
            state.stack.filter((s) => s.triggeredAbilityId === "rampage-2")
        ).toHaveLength(1);
        resolveTopOfStack(state);
        const atk = state.players[0].battlefield.find(
            (c) => c.id === "rampager"
        )!;
        expect(getEffectivePower(state, atk)).toBe(4); // base 4/4, no boost
        expect(getEffectiveToughness(state, atk)).toBe(4);
    });

    it("blocked by THREE: fires ONCE, +2N/+2N (CR 702.23a-b)", () => {
        const { state } = setupRampageCombat(frostGiant, 3);
        emitBlockersConfirmedEvents(state);
        // Three pairs are emitted but the dedupe collapses Rampage to one fire.
        expect(
            state.stack.filter((s) => s.triggeredAbilityId === "rampage-2")
        ).toHaveLength(1);
        resolveTopOfStack(state);
        const atk = state.players[0].battlefield.find(
            (c) => c.id === "rampager"
        )!;
        // rampage 2 × (3 − 1) = +4/+4 → base 4/4 becomes 8/8.
        expect(getEffectivePower(state, atk)).toBe(8);
        expect(getEffectiveToughness(state, atk)).toBe(8);
    });

    it("rampage 3 scales: blocked by THREE → +6/+6 (Aerathi Berserker)", () => {
        const { state } = setupRampageCombat(aerathiBerserker, 3);
        emitBlockersConfirmedEvents(state);
        resolveTopOfStack(state);
        const atk = state.players[0].battlefield.find(
            (c) => c.id === "rampager"
        )!;
        // base 2/4, rampage 3 × (3 − 1) = +6/+6 → 8/10.
        expect(getEffectivePower(state, atk)).toBe(8);
        expect(getEffectiveToughness(state, atk)).toBe(10);
    });

    it("blocker removed BEFORE resolution lowers the bonus (CR 702.23b)", () => {
        const { state } = setupRampageCombat(frostGiant, 3);
        emitBlockersConfirmedEvents(state);
        // A blocker dies (e.g. to a removal spell) after blocks are declared but
        // before the Rampage trigger resolves: it no longer counts.
        removePermanentTo(state, "blk2", "graveyard");
        resolveTopOfStack(state);
        const atk = state.players[0].battlefield.find(
            (c) => c.id === "rampager"
        )!;
        // Now only two live blockers → +2 × (2 − 1) = +2/+2 → 6/6.
        expect(getEffectivePower(state, atk)).toBe(6);
        expect(getEffectiveToughness(state, atk)).toBe(6);
    });

    it("boost wears off at end of turn (CR 514.2 cleanup)", () => {
        const { state } = setupRampageCombat(frostGiant, 3);
        emitBlockersConfirmedEvents(state);
        resolveTopOfStack(state);
        const atkBefore = state.players[0].battlefield.find(
            (c) => c.id === "rampager"
        )!;
        expect(getEffectivePower(state, atkBefore)).toBe(8);
        // Walk to the next turn's cleanup so the until-end-of-turn buff expires.
        state.phase = "COMBAT_DAMAGE";
        for (
            let i = 0;
            i < 12 && getEffectivePower(state, atkBefore) > 4;
            i++
        ) {
            advancePhase(state);
        }
        const atkAfter = state.players[0].battlefield.find(
            (c) => c.id === "rampager"
        )!;
        expect(getEffectivePower(state, atkAfter)).toBe(4);
        expect(getEffectiveToughness(state, atkAfter)).toBe(4);
    });

    it("wire format: pumped P/T survives projectPublicState (CR 611 visible)", () => {
        const { state } = setupRampageCombat(frostGiant, 3);
        emitBlockersConfirmedEvents(state);
        resolveTopOfStack(state);
        const atk = state.players[0].battlefield.find(
            (c) => c.id === "rampager"
        )!;
        expect(getEffectivePower(state, atk)).toBe(8);
        expect(getEffectiveToughness(state, atk)).toBe(8);
        // Re-run the assertion against the projected (slim) state.
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "rampager"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(8);
        expect(getEffectiveToughness(projected, slim)).toBe(8);
    });
});

describe("Primordial Ooze (upkeep +1/+1 then pay {X} or tap + X damage, CR 122 / 117.3a)", () => {
    function setup(existing = 0) {
        const ooze = makeInstance(primordialOoze.id, {
            id: "ooze",
            controllerId: "p1",
            counters: existing > 0 ? { "+1/+1": existing } : undefined,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [ooze] }),
                makePlayer("p2"),
            ],
        });
        return { state, ooze };
    }

    it("declining the {X} payment taps the Ooze and deals X damage to its controller", () => {
        const { state, ooze } = setup(1); // becomes 2 after the upkeep counter
        resolveTrigger(state, ooze, "primordial-ooze-upkeep", UPKEEP_C5("p1"));
        // X = 2 (+1/+1 counters after the upkeep bump).
        answerChoice(state, ["decline"]);
        expect(ooze.counters?.["+1/+1"]).toBe(2);
        expect(ooze.isTapped).toBe(true);
        expect(state.players[0].life).toBe(18); // 20 - 2
    });

    it("attacks each combat if able (CR 508.1d)", () => {
        expect(
            primordialOoze.staticEffects?.some(
                (e) => e.kind === "attack-requirement"
            )
        ).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// C9 — Global combat caps + conditional attack restriction (#386)
// ─────────────────────────────────────────────────────────────────────────────

describe("Caverns of Despair (CR 508.1a / 509.1a — global combat caps)", () => {
    it("has the correct definition shape", () => {
        expect(cavernsOfDespair.supertypes).toEqual(["World"]);
        expect(cavernsOfDespair.types).toEqual(["Enchantment"]);
        expect(cavernsOfDespair.manaCost).toEqual({ X: 2, R: 2 });
    });

    it("imposes no cap when not on the battlefield", () => {
        const state = makeState();
        expect(getAttackerCap(state)).toBeUndefined();
        expect(getBlockerCap(state)).toBeUndefined();
    });

    it("caps declared attackers and blockers at two when in play (CR 508.1a / 509.1a)", () => {
        const caverns = makeInstance(cavernsOfDespair.id, {
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [caverns] }),
                makePlayer("p2"),
            ],
        });
        expect(getAttackerCap(state)).toBe(2);
        expect(getBlockerCap(state)).toBe(2);
    });

    it("third attacker is illegal under the cap; first two are legal", () => {
        const caverns = makeInstance(cavernsOfDespair.id, {
            controllerId: "p2",
        });
        const mk = () =>
            makeInstance(amrouKithkin.id, {
                controllerId: "p1",
                isSummoningSick: false,
            });
        const [a, b, c] = [mk(), mk(), mk()];
        const state = makeState({
            phase: "DECLARE_ATTACKERS",
            players: [
                makePlayer("p1", { battlefield: [a, b, c] }),
                makePlayer("p2", { battlefield: [caverns] }),
            ],
        });
        const cap = getAttackerCap(state)!;
        // Simulate the mutation's count check: 0 and 1 already-declared pass,
        // 2 already-declared (declaring the third) fails.
        expect(0 < cap).toBe(true);
        expect(1 < cap).toBe(true);
        expect(2 < cap).toBe(false);
        // The creatures themselves are individually eligible (the cap is the
        // only blocker, applied on count, not per-creature legality).
        expect(validateAttackerEligibility(a, [], state).eligible).toBe(true);
    });

    it("definition survives projection carrying the World supertype", () => {
        const caverns = makeInstance(cavernsOfDespair.id, {
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [caverns] }),
                makePlayer("p2"),
            ],
        });
        const projected = projectPublicState(state, 1, "p1");
        // The cap is still recognised after the wire format strips card.card to
        // { id } — the engine re-hydrates the definition from the registry.
        expect(getAttackerCap(projected as unknown as typeof state)).toBe(2);
        expect(getBlockerCap(projected as unknown as typeof state)).toBe(2);
    });
});

// ---------------------------------------------------------------------------
// Chain Lightning — 3 damage to any target, then the damaged player / that
// permanent's controller may pay {R}{R} to copy this spell and retarget the
// copy (CR 119 damage, CR 608.2 stepped resolution, CR 707.12 "copy this
// spell"). Exercises the `copyResolvingSpell` + may-pay primitives end to end.
// ---------------------------------------------------------------------------
describe("Chain Lightning (CR 119 / 608.2 / 707.12)", () => {
    type Targets = NonNullable<StackItem["targets"]>;

    // Mirrors finalizeTargetSelection's "copy-retarget" branch in
    // convex/game.ts: writes the chosen targets onto the spell copy and clears
    // the prompt. Pure helper so the test needs no Convex context (mirrors the
    // Fork tests in lea.test.ts).
    function applyCopyRetarget(state: GameState, newTargets: Targets): void {
        const pt = state.pendingTarget!;
        const copy = state.stack.find((s) => s.id === pt.cardInstanceId);
        if (copy) copy.targets = newTargets;
        state.pendingTarget = undefined;
    }

    it("definition: {R} sorcery dealing 3 to any target (Scryfall)", () => {
        expect(chainLightning.manaCost).toEqual({ R: 1 });
        expect(chainLightning.types).toEqual(["Sorcery"]);
        expect(chainLightning.targetRequirement).toEqual({
            type: "any",
            count: 1,
        });
        expect(getDefinition(chainLightning.id)).toBe(chainLightning);
    });

    it("deals 3 damage to a player target (CR 119.3)", () => {
        const state = makeState();
        pushSpell(state, chainLightning.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        resolveTopOfStack(state); // step 0 damage → step 1 suspends on may-pay

        expect(state.players[1].life).toBe(17);
        // The damaged player (p2) is offered the {R}{R} may-pay.
        const head = state.pendingChoices?.[0];
        expect(head?.kind).toBe("may-pay");
        expect(head?.playerId).toBe("p2");
        expect(head?.cost).toEqual({ R: 2 });
    });

    it("offers the may-pay to the controller even when the damage kills the permanent (CR 608.2h)", () => {
        // 3 damage destroys a 1-toughness target inline (CR 704.5g); the
        // chooser ("that permanent's controller") must be recovered by
        // last-known information, not read off the now-empty battlefield —
        // otherwise resolution throws and the mutation rolls back, freezing
        // the game.
        const victim = makeInstance(
            "5712e87a-2381-4f5b-a853-6973841f9bf1", // Faerie, 2/1
            {
                id: "victim",
                controllerId: "p2",
                ownerId: "p2",
                zone: "battlefield",
            }
        );
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [victim] }),
            ],
        });
        pushSpell(state, chainLightning.id, "p1", [
            { type: "permanent", id: "victim" },
        ]);

        expect(() => resolveTopOfStack(state)).not.toThrow();

        // The creature died to the damage.
        expect(
            state.players[1].battlefield.find((c) => c.id === "victim")
        ).toBeUndefined();
        expect(
            state.players[1].graveyard.find((c) => c.id === "victim")
        ).toBeDefined();
        // The {R}{R} may-pay is offered to the dead permanent's controller (p2).
        const head = state.pendingChoices?.[0];
        expect(head?.kind).toBe("may-pay");
        expect(head?.playerId).toBe("p2");
    });

    it("declining the may-pay does nothing further (CR 707.12)", () => {
        const state = makeState();
        pushSpell(state, chainLightning.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        resolveTopOfStack(state);
        // p2 declines.
        applyMayPaySubmit(state, { playerId: "p2", accept: false });

        expect(state.players[1].life).toBe(17); // only the original 3
        expect(state.stack).toHaveLength(0); // no copy was made
        expect(state.pendingTarget).toBeUndefined();
        // The real card went to its owner's graveyard.
        expect(
            state.players[0].graveyard.map((c) => (c.card as { id: string }).id)
        ).toEqual([chainLightning.id]);
    });

    it("paying {R}{R} copies the spell; the copy retargets and deals 3 more", () => {
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", {
                    manaPool: { W: 0, U: 0, B: 0, R: 2, G: 0, C: 0 },
                }),
            ],
        });
        pushSpell(state, chainLightning.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(17);

        // p2 (the damaged player) pays {R}{R} from their pool.
        applyMayPaySubmit(state, { playerId: "p2", accept: true });
        expect(state.players[1].manaPool.R).toBe(0); // cost was paid

        // Chain Lightning itself is gone; a copy controlled by p2 awaits a
        // (new) target. p2 — who paid — chooses (CR 707.12b/c).
        const pt = state.pendingTarget!;
        expect(pt.kind).toBe("copy-retarget");
        expect(pt.playerId).toBe("p2");
        const copy = state.stack.find((s) => s.id === pt.cardInstanceId)!;
        expect(copy.isCopy).toBe(true);
        expect(copy.controllerId).toBe("p2");
        expect((copy.card as { id: string }).id).toBe(chainLightning.id);

        // p2 points the copy at p1; resolve it. The copy's own may-pay then
        // suspends (p1 may chain again) — decline it.
        applyCopyRetarget(state, [{ type: "player", id: "p1" }]);
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(17); // p1 took the copy's 3
        expect(state.pendingChoices?.[0]?.playerId).toBe("p1"); // p1 may chain
        applyMayPaySubmit(state, { playerId: "p1", accept: false });

        expect(state.stack).toHaveLength(0);
        // Only the original real card is in a graveyard; the copy ceased to
        // exist (CR 707.12 / 112.5).
        const allGy = [
            ...state.players[0].graveyard,
            ...state.players[1].graveyard,
        ];
        expect(allGy.some((c) => c.id === copy.id)).toBe(false);
    });

    it("the copy can chain again when its damaged player pays (CR 707.12)", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    manaPool: { W: 0, U: 0, B: 0, R: 2, G: 0, C: 0 },
                }),
                makePlayer("p2", {
                    manaPool: { W: 0, U: 0, B: 0, R: 2, G: 0, C: 0 },
                }),
            ],
        });
        pushSpell(state, chainLightning.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        resolveTopOfStack(state);

        // First link: p2 pays, retargets the copy at p1.
        applyMayPaySubmit(state, { playerId: "p2", accept: true });
        applyCopyRetarget(state, [{ type: "player", id: "p1" }]);
        resolveTopOfStack(state); // copy deals 3 to p1 → p1's may-pay suspends
        expect(state.players[0].life).toBe(17);

        // Second link: p1 pays and chains again, back at p2.
        const head = state.pendingChoices?.[0];
        expect(head?.playerId).toBe("p1");
        applyMayPaySubmit(state, { playerId: "p1", accept: true });
        const pt = state.pendingTarget!;
        expect(pt.playerId).toBe("p1"); // p1 controls this copy now
        applyCopyRetarget(state, [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state); // second copy deals 3 to p2

        expect(state.players[1].life).toBe(14); // 17 - 3 from the chain
        applyMayPaySubmit(state, { playerId: "p2", accept: false });
        expect(state.stack).toHaveLength(0);
    });

    it("permanent target: the controller (not the caster) is offered the pay", () => {
        // jasmineBoreal is a 4/5 — survives 3 and stays on the battlefield so
        // its controller can be asked to pay.
        const jasmine = makeInstance(jasmineBoreal.id, {
            id: "jasmine",
            controllerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [jasmine] }),
            ],
        });
        pushSpell(state, chainLightning.id, "p1", [
            { type: "permanent", id: "jasmine" },
        ]);
        resolveTopOfStack(state);

        // CR 119.3 — "that permanent's controller" (p2), not the caster (p1).
        const head = state.pendingChoices?.[0];
        expect(head?.kind).toBe("may-pay");
        expect(head?.playerId).toBe("p2");
        // The 4/5 survived the 3 damage.
        const onField = state.players[1].battlefield.find(
            (c) => c.id === "jasmine"
        )!;
        expect(onField.damageMarked ?? 0).toBe(3);
    });

    it("wire format: the may-pay prompt survives projectPublicState", () => {
        const state = makeState();
        pushSpell(state, chainLightning.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        resolveTopOfStack(state);
        // The damaged player p2 sees the pending may-pay through the projection.
        const projected = projectPublicState(state, 1, "p2");
        const head = projected.pendingChoices?.[0];
        expect(head?.kind).toBe("may-pay");
        expect(head?.playerId).toBe("p2");
        expect(head?.cost).toEqual({ R: 2 });
    });
});
