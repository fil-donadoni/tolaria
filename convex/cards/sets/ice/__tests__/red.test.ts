// Ice Age (ICE) — red card behavior tests (ADR 0043 colour split of the
// former convex/cards/sets/__tests__/ice.test.ts). Each card's describe block
// cites the CR section it exercises.

import { describe, it, expect } from "vitest";
import {
    balduvianBears,
    meteorShower,
    kjeldoranKnight,
    brainstorm,
    glacialWall,
    seaSpirit,
    anarchy,
    balduvianBarbarians,
    conquer,
    curseOfMaritLage,
    flameSpirit,
    goblinSnowman,
    imposingVisage,
    incinerate,
    jokulhaups,
    karplusanYeti,
    lavaBurst,
    mountainGoat,
    orcishCannoneers,
    orcishHealer,
    orcishLumberjack,
    pyroblast,
    pyroclasm,
    sabretoothTiger,
    shatterIce,
    stoneRainIce,
    stoneSpirit,
    stonehands,
    torGiant,
    vertigo,
    wallOfLava,
    wordOfBlasting,
    melee,
    brandOfIllOmen,
    aggression,
    balduvianHydra,
    battleFrenzy,
    boneShaman,
    chaosLord,
    dwarvenArmory,
    gameOfChaos,
    goblinMutant,
    goblinSappers,
    grizzledWolverine,
    mRtonStromgald,
    mudslide,
    orcishSquatters,
    totalWar,
    flare,
    panic,
    snowCoveredMountain,
    barbarianGuides,
    goblinSkiPatrol,
    chaosMoon,
    orcishFarmer,
    errantry,
    orcishConscripts,
} from "../../ice";
import {
    validateDeclaredAttackers,
    validateDeclaredBlockers,
    collectBlockBypassCharges,
} from "../../../../gre/combat";
import { plains, mountain, forest } from "../../lea";
import {
    applyLandManaReplacement,
    getBasicLandMana,
} from "../../../../gre/constants";
import { getDefinition, getCardByName } from "../../../index";
import {
    resolveTopOfStack,
    applyExistingGrantsTo,
    refreshCounterGatedStatics,
} from "../../../../gre/state";
import { sourcePreventionShieldApplies } from "../../../../gre/state";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { effectiveTriggeredAbilities } from "../../../../gre/copy";
import { projectPublicState } from "../../../../gameProjections";
import {
    emitAttackersDeclaredEvents,
    advancePhase,
} from "../../../../gre/phases";
import { recordBlockedAttackers } from "../../../../gre/banding";
import {
    applyPendingChoiceSubmit,
    applyMayPaySubmit,
    applyRandomRevealAck,
} from "../../../../gre/pendingChoiceSubmit";
import {
    getLegalActions,
    raiseTriggerTargetSelection,
} from "../../../../gre/rules";
import { finalizeTargetSelection, toggleAttacker } from "../../../../game";
import {
    makeMutationCtx,
    runMutation,
    gameStateSeed,
    type Handler,
} from "../../../../__tests__/gameMutationHarness";
import type { Id } from "../../../../_generated/dataModel";
import { applyMeleeUnblockedRider } from "../../../../gre/banding";
import { castProhibitionReason } from "../../../castRestrictions";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import type { CardInstanceState, GameState } from "../../../../gre/state";
import type { StackItem } from "../../../../gre/state";
import type { CardType } from "../../../types";
import {
    resolveActivated,
    submitChoice,
    resolveTrigger,
    vanilla,
    PHASE_EVENT,
    library,
    castCantrip,
    enterUpkeepAndFire,
    snowLand,
    makeTargetCreature,
    makeLand,
} from "./helpers";

// ===========================================================================
// Red free tranche (#633)
// ===========================================================================

// --- Reprints (CardPrint wiring, ADR 0014) ---------------------------------

describe("ICE Red reprints (CardPrint wiring, ADR 0014)", () => {
    it("Shatter print resolves to the LEA definition", () => {
        expect(getDefinition(shatterIce.printId).name).toBe("Shatter");
        expect(shatterIce.definitionId).toBe(
            "50dc7fc1-cb6a-4c68-b993-1a25cf16226e"
        );
        expect(shatterIce.setCode).toBe("ice");
    });
    it("Stone Rain print resolves to the LEA definition", () => {
        expect(getDefinition(stoneRainIce.printId).name).toBe("Stone Rain");
        expect(stoneRainIce.definitionId).toBe(
            "57ff74cb-a2ed-4123-ac42-f72f9820049e"
        );
    });
});

// --- Vanilla / keyword creatures (CR 702 — snapshot checks) ----------------

describe("ICE Red keyword creatures (CR 702)", () => {
    it("Balduvian Barbarians is a 3/2 vanilla", () => {
        expect(balduvianBarbarians.power).toBe(3);
        expect(balduvianBarbarians.toughness).toBe(2);
        expect(balduvianBarbarians.staticAbilities ?? []).toEqual([]);
    });
    it("Tor Giant is a 3/3 vanilla", () => {
        expect(torGiant.power).toBe(3);
        expect(torGiant.toughness).toBe(3);
    });
    it("Sabretooth Tiger has first strike", () => {
        expect(sabretoothTiger.staticAbilities).toEqual(["first strike"]);
        expect(sabretoothTiger.power).toBe(2);
        expect(sabretoothTiger.toughness).toBe(1);
    });
    it("Mountain Goat has mountainwalk", () => {
        expect(mountainGoat.staticAbilities).toEqual(["mountainwalk"]);
    });
    it("Wall of Lava has defender", () => {
        expect(wallOfLava.staticAbilities).toEqual(["defender"]);
    });
});

// --- Anarchy (destroy all white permanents, CR 701.7 / 105.2) --------------

describe("Anarchy (CR 701.7 destroy by colour)", () => {
    it("destroys white permanents and spares others", () => {
        // `matchesPermanentFilter` reads the instance `colors` field (the engine
        // enriches it at read time; tests set it explicitly via spread — same
        // pattern as arn.test.ts's colour-filter cases).
        const whiteCreature = {
            ...makeInstance(kjeldoranKnight.id, {
                id: "wht",
                controllerId: "p2",
                ownerId: "p2",
            }),
            colors: ["W"] as const,
        };
        const redCreature = {
            ...makeInstance(sabretoothTiger.id, {
                id: "redc",
                controllerId: "p2",
                ownerId: "p2",
            }),
            colors: ["R"] as const,
        };
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [whiteCreature, redCreature] }),
            ],
        });
        pushSpell(state, anarchy.id, "p1");
        resolveTopOfStack(state);
        const bf = state.players[1].battlefield.map((c) => c.id);
        expect(bf).not.toContain("wht");
        expect(bf).toContain("redc");
    });
});

// --- Pyroclasm (2 damage to each creature, CR 120.3) -----------------------

describe("Pyroclasm (CR 120.3 sweep)", () => {
    it("deals 2 damage to every creature, killing the 2-toughness ones", () => {
        const small = vanilla("small", 2, 2, {
            controllerId: "p2",
            ownerId: "p2",
            card: { id: "fake-small" },
        });
        const big = vanilla("big", 4, 4, {
            controllerId: "p2",
            ownerId: "p2",
            card: { id: "fake-big" },
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [small, big] }),
            ],
        });
        pushSpell(state, pyroclasm.id, "p1");
        resolveTopOfStack(state);
        const bf = state.players[1].battlefield.map((c) => c.id);
        expect(bf).not.toContain("small");
        expect(bf).toContain("big");
    });
});

// --- Incinerate (3 damage + regen-lock, CR 120.1 / 701.15c) ----------------

describe("Incinerate (CR 120.1 damage + CR 701.15c regen-lock)", () => {
    it("deals 3 damage to a player", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2", { life: 20 })],
        });
        pushSpell(state, incinerate.id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(17);
    });
    it("kills a 3-toughness creature and locks regeneration", () => {
        const creature = vanilla("c", 3, 3, {
            controllerId: "p2",
            ownerId: "p2",
            card: { id: "fake-c" },
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [creature] }),
            ],
        });
        pushSpell(state, incinerate.id, "p1", [{ type: "permanent", id: "c" }]);
        resolveTopOfStack(state);
        expect(state.players[1].battlefield.map((c) => c.id)).not.toContain(
            "c"
        );
    });
});

// --- Lava Burst (X damage to any target, CR 120.1) -------------------------

describe("Lava Burst (CR 120.1 X damage)", () => {
    it("deals X damage to a player", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2", { life: 20 })],
        });
        const item = pushSpell(state, lavaBurst.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        item.chosenX = 4;
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(16);
    });
});

// --- Jokulhaups (destroy all artifacts/creatures/lands, CR 701.7) ----------

describe("Jokulhaups (CR 701.7 mass destruction)", () => {
    it("destroys creatures and lands", () => {
        const creature = vanilla("c", 2, 2, {
            controllerId: "p2",
            ownerId: "p2",
            card: { id: "fake-c" },
        });
        const land: CardInstanceState = {
            id: "land",
            card: { id: "fake-land" },
            types: ["Land"] as CardType[],
            subtypes: ["Mountain"],
            staticAbilities: [],
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
            isTapped: false,
        };
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [creature, land] }),
            ],
        });
        pushSpell(state, jokulhaups.id, "p1");
        resolveTopOfStack(state);
        expect(state.players[1].battlefield).toHaveLength(0);
    });
});

// --- Pyroblast (modal counter/destroy blue, mirror of Hydroblast) ----------

describe("Pyroblast (CR 700.2 modal, blue-gated)", () => {
    it("has two modes gating targets on blue via colorFilter", () => {
        expect(pyroblast.modes).toHaveLength(2);
        const counter = pyroblast.modes!.find((m) => m.id === "counter")!;
        const destroy = pyroblast.modes!.find((m) => m.id === "destroy")!;
        expect(counter.targetRequirement).toMatchObject({
            type: "spell",
            colorFilter: "U",
        });
        expect(destroy.targetRequirement).toMatchObject({
            type: "any",
            colorFilter: "U",
        });
    });
    it("destroy mode destroys a blue permanent", () => {
        // Sea Spirit is a registered blue creature → colours derive correctly.
        const bluePerm = makeInstance(seaSpirit.id, {
            id: "blue",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bluePerm] }),
            ],
        });
        state.stack.push({
            ...makeInstance(pyroblast.id, {
                controllerId: "p1",
                ownerId: "p1",
                zone: "stack",
            }),
            castById: "p1",
            chosenModeId: "destroy",
            targets: [{ type: "permanent", id: "blue" }],
        });
        resolveTopOfStack(state);
        expect(state.players[1].battlefield.map((c) => c.id)).not.toContain(
            "blue"
        );
    });
});

// --- Conquer (control aura on land, CR 613.1b layer 2) ---------------------

describe("Conquer (CR 613.1b control-change on land)", () => {
    it("declares a control-change static targeting a land", () => {
        expect(conquer.targetRequirement).toMatchObject({ type: "Land" });
        expect(conquer.staticEffects).toEqual([
            { kind: "control-change", applies: expect.any(Function) },
        ]);
    });
});

// --- Curse of Marit Lage (tap Islands + untap-lock, CR 701.20a / 611) ------

describe("Curse of Marit Lage (CR 701.20a tap + CR 611 untap-lock)", () => {
    it("declares an ETB trigger that taps all Islands", () => {
        const trigger = curseOfMaritLage.triggeredAbilities!.find(
            (t) => t.id === "curse-marit-lage-tap-islands"
        )!;
        expect(trigger).toBeDefined();
        expect(curseOfMaritLage.oracleText).toContain("tap all Islands");
    });
    it("carries an untap-restriction static on Islands", () => {
        expect(curseOfMaritLage.staticEffects).toHaveLength(1);
        expect(curseOfMaritLage.staticEffects![0].kind).toBe(
            "untap-restriction"
        );
    });
});

// --- Flame Spirit / Wall of Lava firebreathing (CR 611.1) ------------------

describe("Flame Spirit firebreathing (CR 611.1)", () => {
    it("+1/+0 until end of turn pumps power, survives projection", () => {
        const spirit = makeInstance(flameSpirit.id, {
            id: "spirit",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [spirit] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, spirit, "flame-spirit-firebreathing");
        const after = state.players[0].battlefield[0];
        expect(getEffectivePower(state, after)).toBe(3);
        // wire format: the pump survives projectPublicState.
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "spirit"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(3);
    });
});

describe("Wall of Lava firebreathing (CR 611.1)", () => {
    it("+1/+1 until end of turn, survives projection", () => {
        const wall = makeInstance(wallOfLava.id, {
            id: "wall",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [wall] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, wall, "wall-of-lava-pump");
        const after = state.players[0].battlefield[0];
        expect(getEffectivePower(state, after)).toBe(2);
        expect(getEffectiveToughness(state, after)).toBe(4);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "wall"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(2);
        expect(getEffectiveToughness(projected, slim)).toBe(4);
    });
});

// --- Stonehands (aura +0/+2 + activated pump, CR 611.1) --------------------

describe("Stonehands (CR 611.1 static + activated pump on the host)", () => {
    it("declares a +0/+2 static on the host", () => {
        expect(stonehands.staticEffects).toEqual([
            {
                kind: "pt-buff",
                applies: expect.any(Function),
                power: 0,
                toughness: 2,
            },
        ]);
    });
    it("the {R} pump buffs the enchanted creature, survives projection", () => {
        const host = vanilla("host", 2, 2, {
            controllerId: "p1",
            ownerId: "p1",
            card: { id: "fake-host" },
        });
        const aura = makeInstance(stonehands.id, {
            id: "aura",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "host",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [host, aura] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, aura, "stonehands-pump");
        const after = state.players[0].battlefield.find(
            (c) => c.id === "host"
        )!;
        expect(getEffectivePower(state, after)).toBe(3);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "host"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(3);
    });
});

// --- Imposing Visage (menace aura, CR 702.111) -----------------------------

describe("Imposing Visage (CR 702.111 menace grant)", () => {
    it("grants menace to the host via keyword-grant", () => {
        expect(imposingVisage.staticEffects).toEqual([
            {
                kind: "keyword-grant",
                applies: expect.any(Function),
                keyword: "menace",
            },
        ]);
    });
});

// --- Karplusan Yeti (fight, CR 701.12-style) -------------------------------

describe("Karplusan Yeti (mutual fight damage)", () => {
    it("deals mutual damage, killing both when lethal", () => {
        const yeti = makeInstance(karplusanYeti.id, {
            id: "yeti",
            controllerId: "p1",
            ownerId: "p1",
        });
        const foe = vanilla("foe", 3, 3, {
            controllerId: "p2",
            ownerId: "p2",
            card: { id: "fake-foe" },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [yeti] }),
                makePlayer("p2", { battlefield: [foe] }),
            ],
        });
        resolveActivated(state, yeti, "karplusan-yeti-fight", [
            { type: "permanent", id: "foe" },
        ]);
        // both are 3/3 and deal 3 to each other → both die.
        expect(state.players[0].battlefield.map((c) => c.id)).not.toContain(
            "yeti"
        );
        expect(state.players[1].battlefield.map((c) => c.id)).not.toContain(
            "foe"
        );
    });
});

// --- Orcish Cannoneers ({T}: 2 dmg any target + 3 to you) ------------------

describe("Orcish Cannoneers (CR 120.1 damage + self-damage)", () => {
    it("deals 2 to a target player and 3 to the controller", () => {
        const cannon = makeInstance(orcishCannoneers.id, {
            id: "cannon",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { life: 20, battlefield: [cannon] }),
                makePlayer("p2", { life: 20 }),
            ],
        });
        resolveActivated(state, cannon, "orcish-cannoneers-fire", [
            { type: "player", id: "p2" },
        ]);
        expect(state.players[1].life).toBe(18);
        expect(state.players[0].life).toBe(17);
    });
});

// --- Orcish Healer (regen-lock + regenerate B/G) ---------------------------

describe("Orcish Healer (CR 701.15 regen)", () => {
    it("has three abilities; regen legs gate on black-or-green targets", () => {
        const ids = orcishHealer.activatedAbilities!.map((a) => a.id);
        expect(ids).toContain("orcish-healer-regen-lock");
        expect(ids).toContain("orcish-healer-regen-br");
        expect(ids).toContain("orcish-healer-regen-rg");
        const br = orcishHealer.activatedAbilities!.find(
            (a) => a.id === "orcish-healer-regen-br"
        )!;
        expect(br.targetRequirement).toMatchObject({
            type: "Creature",
            colorFilterAny: ["B", "G"],
        });
    });
    it("the regen-lock leg flags the target as can't-be-regenerated", () => {
        const healer = makeInstance(orcishHealer.id, {
            id: "healer",
            controllerId: "p1",
            ownerId: "p1",
        });
        const foe = vanilla("foe", 2, 2, {
            controllerId: "p2",
            ownerId: "p2",
            card: { id: "fake-foe" },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [healer] }),
                makePlayer("p2", { battlefield: [foe] }),
            ],
        });
        resolveActivated(state, healer, "orcish-healer-regen-lock", [
            { type: "permanent", id: "foe" },
        ]);
        expect(state.players[1].battlefield[0].cantBeRegeneratedThisTurn).toBe(
            true
        );
    });
});

// --- Orcish Lumberjack (mana ability, sacrifice Forest) --------------------

describe("Orcish Lumberjack (CR 605.1a mana ability)", () => {
    it("is a non-stack mana ability with R/G manaChoices and a Forest cost", () => {
        const ability = orcishLumberjack.activatedAbilities![0];
        expect(ability.useStack).toBe(false);
        expect(ability.cost).toMatchObject({
            tap: true,
            sacrificeFilter: { subtypes: "Forest" },
        });
        expect(ability.manaChoices).toEqual([
            { R: 3 },
            { R: 2, G: 1 },
            { R: 1, G: 2 },
            { G: 3 },
        ]);
    });
});

// --- Stone Spirit (can't be blocked by flyers, CR 509.1b) ------------------

describe("Stone Spirit (CR 509.1b block restriction)", () => {
    it("declares an attacker-side block-restriction rejecting flyers", () => {
        const eff = stoneSpirit.staticEffects!.find(
            (e) => e.kind === "block-restriction"
        );
        expect(eff).toBeDefined();
    });
    it("the predicate rejects a flying blocker, allows a ground one", () => {
        const eff = stoneSpirit.staticEffects!.find(
            (e) => e.kind === "block-restriction"
        )! as unknown as {
            predicate: (
                self: unknown,
                opponent: { staticAbilities?: string[] }
            ) => boolean;
        };
        expect(eff.predicate({}, { staticAbilities: ["flying"] })).toBe(false);
        expect(eff.predicate({}, { staticAbilities: [] })).toBe(true);
    });
});

// --- Vertigo (2 dmg to flyer + loses flying, CR 120.1 / 611.1b) ------------

describe("Vertigo (CR 120.1 damage + CR 611.1b lose flying)", () => {
    it("targets a creature with flying", () => {
        expect(vertigo.targetRequirement).toMatchObject({
            type: "Creature",
            requireAbility: "flying",
        });
    });
    it("deals 2 damage and removes flying until end of turn", () => {
        const flyer = vanilla("flyer", 2, 4, {
            controllerId: "p2",
            ownerId: "p2",
            card: { id: "fake-flyer" },
            staticAbilities: ["flying"],
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [flyer] }),
            ],
        });
        pushSpell(state, vertigo.id, "p1", [
            { type: "permanent", id: "flyer" },
        ]);
        resolveTopOfStack(state);
        const after = state.players[1].battlefield.find(
            (c) => c.id === "flyer"
        )!;
        // 2 damage marked, flying stripped (read at the live state).
        expect((after.staticAbilities ?? []).includes("flying")).toBe(false);
    });
});

// --- Word of Blasting (destroy Wall + damage = MV, CR 701.7 / 120.1) -------

describe("Word of Blasting (CR 701.7 destroy Wall + MV damage)", () => {
    it("targets a Wall via subtypeFilter", () => {
        expect(wordOfBlasting.targetRequirement).toMatchObject({
            type: "Creature",
            subtypeFilter: "Wall",
        });
    });
    it("destroys the Wall and deals its mana value to its controller", () => {
        // Glacial Wall is a registered {2}{U} Wall (mana value 3) → both the
        // Wall subtype target and the mana-value read resolve via the registry.
        const wall = makeInstance(glacialWall.id, {
            id: "wall",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { life: 20, battlefield: [wall] }),
            ],
        });
        pushSpell(state, wordOfBlasting.id, "p1", [
            { type: "permanent", id: "wall" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[1].battlefield.map((c) => c.id)).not.toContain(
            "wall"
        );
        // mana value {2}{U} = 3 → 3 damage to the controller.
        expect(state.players[1].life).toBe(17);
    });
});

// --- Goblin Snowman (block prevent trigger + ping blocked creature) --------

describe("Goblin Snowman (CR 509.4 block trigger + ping)", () => {
    it("has a block-confirmed prevention trigger and a ping ability", () => {
        expect(goblinSnowman.triggeredAbilities).toHaveLength(1);
        expect(goblinSnowman.triggeredAbilities![0].event).toBe(
            "BLOCKERS_CONFIRMED"
        );
        expect(goblinSnowman.activatedAbilities![0].id).toBe(
            "goblin-snowman-ping"
        );
    });
});

// --- Registry parity -------------------------------------------------------

describe("ICE Red tranche registry parity", () => {
    const expected = [
        "Anarchy",
        "Balduvian Barbarians",
        "Conquer",
        "Curse of Marit Lage",
        "Flame Spirit",
        "Goblin Snowman",
        "Imposing Visage",
        "Incinerate",
        "Jokulhaups",
        "Karplusan Yeti",
        "Lava Burst",
        "Mountain Goat",
        "Orcish Cannoneers",
        "Orcish Healer",
        "Orcish Lumberjack",
        "Pyroblast",
        "Pyroclasm",
        "Sabretooth Tiger",
        "Stone Spirit",
        "Stonehands",
        "Stormbind",
        "Tor Giant",
        "Vertigo",
        "Wall of Lava",
        "Word of Blasting",
    ];
    it("registers every activated Red card by name", () => {
        for (const name of expected) {
            expect(getCardByName(name).name).toBe(name);
        }
    });
    it("registers the two Red reprints by print id", () => {
        expect(getDefinition(shatterIce.printId).name).toBe("Shatter");
        expect(getDefinition(stoneRainIce.printId).name).toBe("Stone Rain");
    });
});

describe("Aggression — Aura: first strike + trample + end-step destroy (CR 611/702/506.2)", () => {
    it("grants first strike and trample to the host (keyword-grant statics)", () => {
        const host = vanilla("host", 2, 2, {
            controllerId: "p1",
            ownerId: "p1",
        });
        const aura = makeInstance(aggression.id, {
            id: "aura",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "host",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [host, aura] }),
                makePlayer("p2"),
            ],
        });
        const live = state.players[0].battlefield.find((c) => c.id === "host")!;
        // The aura's keyword-grant statics attach to the host via the grant pass.
        applyExistingGrantsTo(state, live);
        expect(live.staticAbilities).toContain("first strike");
        expect(live.staticAbilities).toContain("trample");
        // Definition wiring: two keyword-grant statics on the host.
        const grants = (aggression.staticEffects ?? []).filter(
            (e) => e.kind === "keyword-grant"
        );
        expect(grants.map((g) => (g as { keyword: string }).keyword)).toEqual([
            "first strike",
            "trample",
        ]);
    });

    it("destroys the host at its controller's end step if it didn't attack", () => {
        const host = vanilla("host", 2, 2, {
            controllerId: "p1",
            ownerId: "p1",
            hasAttackedThisTurn: false,
        });
        const aura = makeInstance(aggression.id, {
            id: "aura",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "host",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [host, aura] }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
        });
        resolveTrigger(
            state,
            aura,
            "aggression-end-step-destroy",
            PHASE_EVENT("END_STEP", "p1")
        );
        expect(
            state.players[0].battlefield.find((c) => c.id === "host")
        ).toBeUndefined();
    });

    it("does NOT destroy the host if it attacked this turn", () => {
        const host = vanilla("host", 2, 2, {
            controllerId: "p1",
            ownerId: "p1",
            hasAttackedThisTurn: true,
        });
        const aura = makeInstance(aggression.id, {
            id: "aura",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "host",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [host, aura] }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
        });
        resolveTrigger(
            state,
            aura,
            "aggression-end-step-destroy",
            PHASE_EVENT("END_STEP", "p1")
        );
        expect(
            state.players[0].battlefield.find((c) => c.id === "host")
        ).toBeDefined();
    });

    it("enchant restriction excludes Walls (target filter)", () => {
        expect(aggression.targetRequirement).toEqual({
            type: "Creature",
            count: 1,
            excludeSubtypes: "Wall",
        });
        expect(aggression.manaCost).toEqual({ X: 2, R: 1 });
    });
});

describe("Balduvian Hydra — ETB X +1/+0, remove-counter prevent, upkeep grow (CR 122/615/602.5b)", () => {
    it("enters with X +1/+0 counters (entersWith count: X)", () => {
        expect(balduvianHydra.entersWith).toEqual({
            counters: [{ type: "+1/+0", count: "X" }],
        });
        expect(balduvianHydra.manaCost).toEqual({ X: "X", R: 2 });
    });

    it("the X counters raise effective power (layer 7d), surviving the wire", () => {
        const hydra = makeInstance(balduvianHydra.id, {
            id: "hydra",
            controllerId: "p1",
            ownerId: "p1",
            counters: { "+1/+0": 3 },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [hydra] }),
                makePlayer("p2"),
            ],
        });
        const live = state.players[0].battlefield.find(
            (c) => c.id === "hydra"
        )!;
        expect(getEffectivePower(state, live)).toBe(3); // base 0 + 3
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "hydra"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(3);
    });

    it("the upkeep grow ability is gated to your upkeep", () => {
        const grow = balduvianHydra.activatedAbilities!.find(
            (a) => a.id === "balduvian-hydra-grow"
        )!;
        expect(grow.activationPhaseRestriction).toEqual(["UPKEEP"]);
        expect(grow.controllerTurnOnly).toBe(true);
        const hydra = makeInstance(balduvianHydra.id, {
            id: "hydra",
            controllerId: "p1",
            ownerId: "p1",
            counters: { "+1/+0": 1 },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [hydra] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, hydra, "balduvian-hydra-grow");
        const live = state.players[0].battlefield.find(
            (c) => c.id === "hydra"
        )!;
        expect(live.counters?.["+1/+0"]).toBe(2);
    });
});

describe("Battle Frenzy — instant batch pump (CR 611.1)", () => {
    it("buffs green creatures +1/+1 and nongreen +1/+0", () => {
        const greenC = makeInstance(getCardByName("Balduvian Bears").id, {
            id: "green",
            controllerId: "p1",
            ownerId: "p1",
        });
        const redC = makeInstance(getCardByName("Balduvian Barbarians").id, {
            id: "red",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [greenC, redC] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, battleFrenzy.id, "p1");
        resolveTopOfStack(state);
        const g = state.players[0].battlefield.find((c) => c.id === "green")!;
        const r = state.players[0].battlefield.find((c) => c.id === "red")!;
        expect(getEffectivePower(state, g)).toBe(3); // 2/2 +1/+1
        expect(getEffectiveToughness(state, g)).toBe(3);
        expect(getEffectivePower(state, r)).toBe(4); // 3/2 +1/+0
        expect(getEffectiveToughness(state, r)).toBe(2);
    });
});

describe("Bone Shaman — grants a damage-rider regen-lock (CR 113.1 / 701.15c)", () => {
    it("the rider template locks regeneration on a creature it damages", () => {
        const shaman = makeInstance(boneShaman.id, {
            id: "shaman",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [shaman] }),
                makePlayer("p2"),
            ],
        });
        // Grant the rider to self until end of turn.
        resolveActivated(state, shaman, "bone-shaman-grant-rider");
        const live = state.players[0].battlefield.find(
            (c) => c.id === "shaman"
        )!;
        // The granted trigger is unioned into the source's effective triggers.
        const triggers = effectiveTriggeredAbilities(live);
        expect(
            triggers.some((t) => t.id === "bone-shaman-no-regen-rider")
        ).toBe(true);
    });

    it("the rider sets cant-be-regenerated on the damaged creature", () => {
        const shaman = makeInstance(boneShaman.id, {
            id: "shaman",
            controllerId: "p1",
            ownerId: "p1",
        });
        const victim = vanilla("victim", 2, 2, {
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [shaman] }),
                makePlayer("p2", { battlefield: [victim] }),
            ],
        });
        // Grant the rider first so it is unioned into the source's effective
        // triggers (the resolve path looks it up there).
        resolveActivated(state, shaman, "bone-shaman-grant-rider");
        const shamanLive = state.players[0].battlefield.find(
            (c) => c.id === "shaman"
        )!;
        const event = {
            type: "DAMAGE_DEALT" as const,
            sourceInstanceId: "shaman",
            sourceControllerId: "p1",
            target: { type: "permanent" as const, id: "victim" },
            amount: 3,
            isCombat: true,
        } as StackItem["triggerEvent"];
        resolveTrigger(state, shamanLive, "bone-shaman-no-regen-rider", event);
        const live = state.players[1].battlefield.find(
            (c) => c.id === "victim"
        )!;
        // The regen-lock flag is set on the instance (CR 701.15c).
        expect(live.cantBeRegeneratedThisTurn).toBe(true);
    });
});

describe("Chaos Lord — first strike + parity control-give + haste (CR 603.6a / 613.1b)", () => {
    it("carries first strike, and haste ONLY as a conditional grant (CR 611.2c)", () => {
        expect(chaosLord.staticAbilities).toContain("first strike");
        // "Can attack as though it had haste UNLESS it entered this turn" is a
        // CONDITIONAL permission — an unconditional `haste` keyword here would
        // let a freshly-cast 7/7 attack, which the printed card forbids.
        expect(chaosLord.staticAbilities).not.toContain("haste");
        const grant = chaosLord.staticEffects?.find(
            (e) => e.kind === "keyword-grant" && e.keyword === "haste"
        );
        expect(grant).toBeDefined();
        expect(
            (grant as { condition?: unknown } | undefined)?.condition
        ).toBeTypeOf("function");
        expect(chaosLord.manaCost).toEqual({ X: 4, R: 3 });
        expect(chaosLord.power).toBe(7);
        expect(chaosLord.toughness).toBe(7);
    });

    it("gives control to the opponent when the permanent count is even", () => {
        const lord = makeInstance(chaosLord.id, {
            id: "lord",
            controllerId: "p1",
            ownerId: "p1",
        });
        // p1 has the Lord (1) + 1 land = 2 → even total.
        const land = makeInstance(getCardByName("Mountain").id, {
            id: "mtn",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [lord, land] }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
        });
        resolveTrigger(
            state,
            lord,
            "chaos-lord-parity-control",
            PHASE_EVENT("UPKEEP", "p1")
        );
        const live =
            state.players[0].battlefield.find((c) => c.id === "lord") ??
            state.players[1].battlefield.find((c) => c.id === "lord")!;
        expect(live.controllerId).toBe("p2");
    });

    it("does NOT change control when the permanent count is odd", () => {
        const lord = makeInstance(chaosLord.id, {
            id: "lord",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [lord] }), // count 1 → odd
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
        });
        resolveTrigger(
            state,
            lord,
            "chaos-lord-parity-control",
            PHASE_EVENT("UPKEEP", "p1")
        );
        expect(
            state.players[0].battlefield.find((c) => c.id === "lord")!
                .controllerId
        ).toBe("p1");
    });
});

// Chaos Lord's "can attack as though it had haste UNLESS it entered this turn"
// (CR 508.1a / 400.7), driven through the REAL declare-attackers path — the
// registered `toggleAttacker` mutation, which is what the client calls.
//
// A predicate-level unit test would not prove this. `validateAttackerEligibility`
// (`gre/combat.ts`, CR 702.10b) reads haste off the INSTANCE's materialized
// `staticAbilities`, so a layer-6 `keyword-grant` that never reaches that array
// ships inert and functional-looking — the deathtouch/hexproof shape (#957/#958).
// Both cases below differ ONLY in the `enteredOnTurn` entry stamp.
describe("Chaos Lord — conditional haste at declare-attackers (CR 508.1a / 400.7 / 611.2c)", () => {
    const GAME_ID = "game-1" as Id<"games">;

    /** p1 in DECLARE_ATTACKERS on turn 5 holding a SUMMONING-SICK Chaos Lord
     *  that entered on `enteredOnTurn`. Sick in both scenarios (CR 302.6):
     *  freshly cast in one, stolen mid-turn by an EXTERNAL effect (Infernal
     *  Denizen / Merieke Ri Berit / Dominate — see the card comment) in the
     *  other. That is the pair the Oracle clause discriminates and plain
     *  summoning sickness cannot: both are sick, only the earlier-entered one
     *  gets the permission.
     *
     *  `refreshCounterGatedStatics` is the production sweep `saveGameState`
     *  runs before every persisted write, so the instance reaches the mutation
     *  with its conditional statics materialized exactly as in a real game. */
    function chaosLordCombatState(
        enteredOnTurn: number | undefined
    ): GameState {
        const lord = makeInstance(chaosLord.id, {
            id: "lord",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: true,
            // `undefined` stages the NO-ENTRY-STAMP shape on purpose (see the
            // fail-closed case below) — spread so the key is genuinely absent
            // rather than present-and-undefined.
            ...(enteredOnTurn !== undefined ? { enteredOnTurn } : {}),
        });
        const state = makeState({
            turn: 5,
            phase: "DECLARE_ATTACKERS",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            players: [
                makePlayer("p1", { battlefield: [lord] }),
                makePlayer("p2"),
            ],
            combat: {
                attackerIds: [],
                confirmed: false,
                blockerAssignments: {},
                blockersConfirmed: false,
            },
        });
        refreshCounterGatedStatics(state);
        return state;
    }

    const declareLordAsAttacker = (ctx: Parameters<typeof runMutation>[1]) =>
        runMutation<
            { gameId: Id<"games">; playerId: string; cardInstanceId: string },
            void
        >(
            toggleAttacker as unknown as Handler<
                {
                    gameId: Id<"games">;
                    playerId: string;
                    cardInstanceId: string;
                },
                void
            >,
            ctx,
            { gameId: GAME_ID, playerId: "p1", cardInstanceId: "lord" }
        );

    it("cannot attack the turn it entered the battlefield", async () => {
        const h = makeMutationCtx("p1", [
            gameStateSeed(chaosLordCombatState(5)),
        ]);
        expect(
            h.state().players[0].battlefield[0].staticAbilities
        ).not.toContain("haste");
        await expect(declareLordAsAttacker(h.ctx)).rejects.toThrow(
            "Creature has summoning sickness"
        );
        expect(h.state().combat!.attackerIds).toEqual([]);
    });

    it("does not pick up haste when it actually resolves onto the battlefield", () => {
        // Guards the ETB ORDERING: `applySourceStaticEffects` runs at entry,
        // and if it ran before `markEnteredThisTurn` stamped `enteredOnTurn`
        // (CR 400.7) the condition would read "unknown" and the grant would
        // stick. Cast it for real instead of hand-placing the instance.
        const state = makeState({ turn: 5, activePlayerId: "p1" });
        pushSpell(state, chaosLord.id, "p1");
        resolveTopOfStack(state);
        const lord = state.players[0].battlefield.find(
            (c) => c.card.id === chaosLord.id
        )!;
        expect(lord.enteredOnTurn).toBe(5);
        expect(lord.staticAbilities).not.toContain("haste");
        expect(lord.staticAbilities).toContain("first strike");
    });

    it("attacks while summoning sick when it entered on an EARLIER turn (post control change)", async () => {
        const h = makeMutationCtx("p1", [
            gameStateSeed(chaosLordCombatState(3)),
        ]);
        expect(h.state().players[0].battlefield[0].staticAbilities).toContain(
            "haste"
        );
        await declareLordAsAttacker(h.ctx);
        expect(h.state().combat!.attackerIds).toEqual(["lord"]);
    });

    // FAIL-CLOSED on a missing entry stamp. `enteredOnTurn` is optional, and
    // plenty of instances reach the battlefield without going through
    // `markEnteredThisTurn` (a debug-staged board, a bench fixture, any future
    // placement path). A bare `source.enteredOnTurn !== state.turn` reads
    // `undefined !== 5` as TRUE and hands the permission out on NO evidence —
    // the same "unknown treated as favourable" shape as the inert-keyword trap
    // (#957/#958), except here it grants rather than withholds. The absent
    // stamp must mean "unknown", and a permission is granted only on positive
    // evidence that the Lord entered on an earlier turn.
    it("withholds the grant from a summoning-sick Lord carrying NO entry stamp", async () => {
        const h = makeMutationCtx("p1", [
            gameStateSeed(chaosLordCombatState(undefined)),
        ]);
        const staged = h.state().players[0].battlefield[0];
        expect(staged.enteredOnTurn).toBeUndefined();
        expect(staged.staticAbilities).not.toContain("haste");
        await expect(declareLordAsAttacker(h.ctx)).rejects.toThrow(
            "Creature has summoning sickness"
        );
        expect(h.state().combat!.attackerIds).toEqual([]);
    });
});

describe("Dwarven Armory — {2}, sac a land: +2/+2 counter, any upkeep (CR 602.5b / 122)", () => {
    it("is gated to the upkeep step with a land sacrifice cost", () => {
        const ability = dwarvenArmory.activatedAbilities![0];
        expect(ability.activationPhaseRestriction).toEqual(["UPKEEP"]);
        expect(ability.controllerTurnOnly).toBeUndefined(); // ANY upkeep
        expect(ability.cost.sacrificeFilter).toEqual({ types: "Land" });
        expect(ability.targetRequirement).toEqual({
            type: "Creature",
            count: 1,
        });
    });

    it("puts a +2/+2 counter on the target creature", () => {
        const armory = makeInstance(dwarvenArmory.id, {
            id: "armory",
            controllerId: "p1",
            ownerId: "p1",
        });
        const target = vanilla("t", 1, 1, {
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [armory, target] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, armory, "dwarven-armory-counter", [
            { type: "permanent", id: "t" },
        ]);
        const live = state.players[0].battlefield.find((c) => c.id === "t")!;
        expect(live.counters?.["+2/+2"]).toBe(1);
        expect(getEffectivePower(state, live)).toBe(3);
        expect(getEffectiveToughness(state, live)).toBe(3);
    });
});

describe("Game of Chaos — coin-flip doubling life swing (CR 705.2 / 119)", () => {
    it("targets an opponent and resolves a single flip with a life swing", () => {
        expect(gameOfChaos.targetRequirement).toEqual({
            type: "player",
            count: 1,
            controller: "opponent",
        });
        const state = makeState({
            rngSeed: 1,
            players: [
                makePlayer("p1", { life: 20 }),
                makePlayer("p2", { life: 20 }),
            ],
        });
        pushSpell(state, gameOfChaos.id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        // First flip suspends on a random-reveal; ack it.
        const reveal = state.pendingChoices?.[0];
        expect(reveal?.kind).toBe("random-reveal");
        applyRandomRevealAck(state, {
            playerId: reveal!.playerId,
            stackItemId: reveal!.stackItemId,
            choiceId: reveal!.choiceId,
        });
        // The life total of exactly one player moved by 1 (stake 1, round 0).
        const p1 = state.players[0].life;
        const p2 = state.players[1].life;
        // Winner +1 / loser -1 either way: the sum is unchanged, the spread is 2.
        expect(Math.abs(p1 - p2)).toBe(2);
        // After the flip the deciding player is offered "flip again?".
        const again = state.pendingChoices?.[0];
        expect(again?.kind).toBe("option-pick");
    });

    it("stops when the decider declines the next flip", () => {
        const state = makeState({
            rngSeed: 1,
            players: [
                makePlayer("p1", { life: 20 }),
                makePlayer("p2", { life: 20 }),
            ],
        });
        pushSpell(state, gameOfChaos.id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        const reveal = state.pendingChoices![0];
        applyRandomRevealAck(state, {
            playerId: reveal.playerId,
            stackItemId: reveal.stackItemId,
            choiceId: reveal.choiceId,
        });
        const again = state.pendingChoices![0];
        expect(again.kind).toBe("option-pick");
        applyPendingChoiceSubmit(state, {
            playerId: again.playerId,
            stackItemId: again.stackItemId,
            step: again.step,
            choiceId: again.choiceId,
            cardInstanceIds: ["no"],
        });
        // Resolution complete — no further pending choices, stack empty.
        expect(state.pendingChoices?.length ?? 0).toBe(0);
        expect(state.stack.length).toBe(0);
    });
});

describe("Goblin Mutant — trample + conditional attack/block restrictions (CR 508.1c / 509.1b)", () => {
    it("can't attack while the defender has an untapped power-3+ creature", () => {
        const restriction = (goblinMutant.staticEffects ?? []).find(
            (e) => e.kind === "attack-restriction"
        );
        expect(restriction?.kind).toBe("attack-restriction");
        if (restriction?.kind === "attack-restriction") {
            const self = {} as never;
            const bigUntapped = [
                { types: ["Creature"], isTapped: false, power: 4 },
            ] as never;
            const bigTapped = [
                { types: ["Creature"], isTapped: true, power: 4 },
            ] as never;
            const small = [
                { types: ["Creature"], isTapped: false, power: 2 },
            ] as never;
            expect(restriction.predicate(self, bigUntapped)).toBe(false);
            expect(restriction.predicate(self, bigTapped)).toBe(true);
            expect(restriction.predicate(self, small)).toBe(true);
        }
        expect(goblinMutant.staticAbilities).toContain("trample");
    });

    it("can't block creatures with power 3 or greater", () => {
        const restriction = (goblinMutant.staticEffects ?? []).find(
            (e) => e.kind === "block-restriction"
        );
        expect(restriction?.kind).toBe("block-restriction");
        if (restriction?.kind === "block-restriction") {
            expect(restriction.side).toBe("blocker");
            const self = {} as never;
            expect(restriction.predicate(self, { power: 2 } as never)).toBe(
                true
            );
            expect(restriction.predicate(self, { power: 3 } as never)).toBe(
                false
            );
        }
    });
});

describe("Goblin Sappers — unblockable + end-of-combat destroy (CR 605 / 603.7a)", () => {
    it("the {R}{R} leg arms a destroy-both delayed trigger", () => {
        const sappers = makeInstance(goblinSappers.id, {
            id: "sappers",
            controllerId: "p1",
            ownerId: "p1",
        });
        const ally = vanilla("ally", 2, 2, {
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [sappers, ally] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, sappers, "goblin-sappers-rr", [
            { type: "permanent", id: "ally" },
        ]);
        const allyLive = state.players[0].battlefield.find(
            (c) => c.id === "ally"
        )!;
        expect(allyLive.cantBeBlockedThisTurn).toBe(true);
        expect(
            (state.delayedTriggers ?? []).some(
                (d) => d.triggerId === "goblin-sappers-destroy-both"
            )
        ).toBe(true);
    });

    it("the {R}{R}{R}{R} leg arms a destroy-target-only delayed trigger", () => {
        const sappers = makeInstance(goblinSappers.id, {
            id: "sappers",
            controllerId: "p1",
            ownerId: "p1",
        });
        const ally = vanilla("ally", 2, 2, {
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [sappers, ally] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, sappers, "goblin-sappers-rrrr", [
            { type: "permanent", id: "ally" },
        ]);
        expect(
            (state.delayedTriggers ?? []).some(
                (d) => d.triggerId === "goblin-sappers-destroy-target"
            )
        ).toBe(true);
    });
});

describe("Grizzled Wolverine — +2/+0 only while blocked, declare-blockers, once (CR 602.5)", () => {
    it("gates activation on the declare-blockers step, once per turn", () => {
        const ability = grizzledWolverine.activatedAbilities![0];
        expect(ability.activationPhaseRestriction).toEqual([
            "DECLARE_BLOCKERS",
        ]);
        expect(ability.oncePerTurn).toBe(true);
    });

    it("canActivate is true only when a blocker is assigned to it", () => {
        const ability = grizzledWolverine.activatedAbilities![0];
        const source = { id: "wolv" } as never;
        const blocked = {
            combat: { blockerAssignments: { blk: ["wolv"] } },
        } as never;
        const unblocked = {
            combat: { blockerAssignments: {} },
        } as never;
        expect(ability.canActivate!(source, blocked)).toBe(true);
        expect(ability.canActivate!(source, unblocked)).toBe(false);
    });

    it("the pump adds +2/+0 until end of turn", () => {
        const wolv = makeInstance(grizzledWolverine.id, {
            id: "wolv",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [wolv] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, wolv, "grizzled-wolverine-pump");
        const live = state.players[0].battlefield.find((c) => c.id === "wolv")!;
        expect(getEffectivePower(state, live)).toBe(4); // 2 +2
    });
});

describe("Márton Stromgald — per-attacker / per-blocker team pump (CR 603.6 / 611.1)", () => {
    it("attack: other attackers get +N/+N for N other attackers (real combat path)", () => {
        const marton = makeInstance(mRtonStromgald.id, {
            id: "marton",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const ally1 = vanilla("a1", 2, 2, {
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const ally2 = vanilla("a2", 1, 1, {
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [marton, ally1, ally2] }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
            phase: "DECLARE_ATTACKERS",
            combat: {
                attackerIds: ["marton", "a1", "a2"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: false,
            },
        });
        emitAttackersDeclaredEvents(state);
        const trig = state.stack.find(
            (s) => s.triggeredAbilityId === "marton-attack-pump"
        );
        expect(trig).toBeDefined();
        resolveTopOfStack(state);
        // 2 other attackers → +2/+2 each (Márton itself is excluded).
        const a1 = state.players[0].battlefield.find((c) => c.id === "a1")!;
        const a2 = state.players[0].battlefield.find((c) => c.id === "a2")!;
        const m = state.players[0].battlefield.find((c) => c.id === "marton")!;
        expect(getEffectivePower(state, a1)).toBe(4); // 2 +2
        expect(getEffectivePower(state, a2)).toBe(3); // 1 +2
        expect(getEffectivePower(state, m)).toBe(1); // unbuffed
    });
});

describe("Mudslide — non-flying untap-lock + per-upkeep pay-{2}-to-untap (CR 611 / 117.3a)", () => {
    it("declares a non-flying untap restriction with maxUntap 0", () => {
        const restriction = (mudslide.staticEffects ?? []).find(
            (e) => e.kind === "untap-restriction"
        );
        expect(restriction?.kind).toBe("untap-restriction");
    });

    it("pays {2} per chosen tapped non-flying creature to untap it", () => {
        const slide = makeInstance(mudslide.id, {
            id: "slide",
            controllerId: "p1",
            ownerId: "p1",
        });
        // A real registered non-flying creature (the pay path scans the
        // battlefield for land mana and rejects fake card ids).
        const ground = makeInstance(getCardByName("Balduvian Bears").id, {
            id: "ground",
            controllerId: "p1",
            ownerId: "p1",
            isTapped: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [slide, ground] }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
        });
        state.players[0].manaPool = { C: 2 }; // enough to pay {2}
        resolveTrigger(
            state,
            slide,
            "mudslide-untap-escape",
            PHASE_EVENT("UPKEEP", "p1")
        );
        // The trigger suspends on a may-pay for the tapped non-flying creature.
        const head = state.pendingChoices?.[0];
        expect(head?.kind).toBe("may-pay");
        applyMayPaySubmit(state, { playerId: "p1", accept: true });
        const live = state.players[0].battlefield.find(
            (c) => c.id === "ground"
        )!;
        expect(live.isTapped).toBe(false);
    });
});

// CR 603.3d — Orcish Squatters' "you may gain control of target land defending
// player controls" is a REAL target chosen when the trigger is PUT ON THE STACK
// (`targetRequirement` + `raiseTriggerTargetSelection`), not a resolution-time
// choice. The "you may" is a separate resolution-time `requestMayPay` decision.
describe("Orcish Squatters — unblocked attack steals a land (CR 603.3d / 611.2b)", () => {
    /** Puts Orcish Squatters' ATTACKER_UNBLOCKED trigger on the stack with an
     *  UN-SET target slot (`targets: undefined`) and `triggerSourceId` pinned,
     *  so `raiseTriggerTargetSelection` treats it as owing a target choice
     *  (mirrors mh3's `pheliaAttackTriggerOnStack`). */
    function squattersTriggerOnStack(
        state: GameState,
        source: CardInstanceState
    ): StackItem {
        const trig: StackItem = {
            ...source,
            id: "orcish-squatters-trig",
            zone: "stack",
            castById: source.controllerId,
            triggeredAbilityId: "orcish-squatters-steal-land",
            triggerSourceId: source.id,
            triggerEvent: {
                type: "ATTACKER_UNBLOCKED",
                attackerId: source.id,
                attackerControllerId: source.controllerId,
                attackerTypes: ["Creature"],
                attackerSubtypes: ["Orc"],
            } as StackItem["triggerEvent"],
            targets: undefined,
        };
        state.stack.push(trig);
        return trig;
    }

    it("declares the CR 603.3d target requirement: a single land an opponent controls", () => {
        expect(
            orcishSquatters.triggeredAbilities?.[0]?.targetRequirement
        ).toEqual({
            type: "Land",
            count: 1,
            controller: "opponent",
        });
    });

    it("auto-selects the sole legal defender land (CR 603.3d), then the 'you may' gains control and assigns no combat damage", () => {
        const squatters = makeInstance(orcishSquatters.id, {
            id: "sq",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const land = makeInstance(getCardByName("Mountain").id, {
            id: "land",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [squatters] }),
                makePlayer("p2", { battlefield: [land] }),
            ],
            activePlayerId: "p1",
        });
        const trig = squattersTriggerOnStack(state, squatters);
        // Exactly one legal target → auto-locked at stack placement, no choice
        // owed (CR 603.3d). raiseTriggerTargetSelection reports no pending pick.
        expect(raiseTriggerTargetSelection(state)).toBe(false);
        expect(trig.targets).toEqual([{ type: "permanent", id: "land" }]);
        // Resolution suspends on the "you may" decision; accept it.
        expect(resolveTopOfStack(state)).toBeNull();
        expect(state.pendingChoices?.[0]?.kind).toBe("may-pay");
        applyMayPaySubmit(state, { playerId: "p1", accept: true });
        const stolen =
            state.players[0].battlefield.find((c) => c.id === "land") ??
            state.players[1].battlefield.find((c) => c.id === "land")!;
        expect(stolen.controllerId).toBe("p1");
        expect(sourcePreventionShieldApplies(state, "sq", true)).toBe(true);
    });

    it("raises a player choice when 2+ defender lands are legal (CR 603.3d), then steals the chosen one", () => {
        const squatters = makeInstance(orcishSquatters.id, {
            id: "sq",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const land1 = makeInstance(getCardByName("Mountain").id, {
            id: "land1",
            controllerId: "p2",
            ownerId: "p2",
        });
        const land2 = makeInstance(getCardByName("Mountain").id, {
            id: "land2",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [squatters] }),
                makePlayer("p2", { battlefield: [land1, land2] }),
            ],
            activePlayerId: "p1",
        });
        squattersTriggerOnStack(state, squatters);
        // 2+ legal targets → a real choice is owed.
        expect(raiseTriggerTargetSelection(state)).toBe(true);
        expect(state.pendingTarget?.kind).toBe("trigger");
        state.pendingTarget!.selected = [{ type: "permanent", id: "land1" }];
        finalizeTargetSelection(
            state,
            state.pendingTarget!,
            state.pendingTarget!.playerId
        );
        // Now resolve; accept the "you may".
        expect(resolveTopOfStack(state)).toBeNull();
        expect(state.pendingChoices?.[0]?.kind).toBe("may-pay");
        applyMayPaySubmit(state, { playerId: "p1", accept: true });
        const stolen =
            state.players[0].battlefield.find((c) => c.id === "land1") ??
            state.players[1].battlefield.find((c) => c.id === "land1")!;
        expect(stolen.controllerId).toBe("p1");
        expect(
            state.players[1].battlefield.find((c) => c.id === "land2")!
                .controllerId
        ).toBe("p2");
        expect(sourcePreventionShieldApplies(state, "sq", true)).toBe(true);
    });

    it("declining the 'you may' keeps the land with its owner and combat damage intact", () => {
        const squatters = makeInstance(orcishSquatters.id, {
            id: "sq",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const land = makeInstance(getCardByName("Mountain").id, {
            id: "land",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [squatters] }),
                makePlayer("p2", { battlefield: [land] }),
            ],
            activePlayerId: "p1",
        });
        squattersTriggerOnStack(state, squatters);
        expect(raiseTriggerTargetSelection(state)).toBe(false);
        expect(resolveTopOfStack(state)).toBeNull();
        applyMayPaySubmit(state, { playerId: "p1", accept: false });
        expect(
            state.players[1].battlefield.find((c) => c.id === "land")!
                .controllerId
        ).toBe("p2");
        expect(sourcePreventionShieldApplies(state, "sq", true)).toBe(false);
    });
});

describe("Total War — attack-trigger mass destroy of stay-back creatures (CR 508.1 / 302.6)", () => {
    it("destroys untapped non-Wall non-attacking established creatures of the attacker", () => {
        const war = makeInstance(totalWar.id, {
            id: "war",
            controllerId: "p2",
            ownerId: "p2",
        });
        const attacker = vanilla("atk", 2, 2, {
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
            isSummoningSick: false,
        });
        // Stays back, untapped, established (not summoning-sick) → destroyed.
        const stayBack = vanilla("stay", 2, 2, {
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: false,
            isSummoningSick: false,
        });
        // Tapped → survives.
        const tapped = vanilla("tap", 2, 2, {
            controllerId: "p1",
            ownerId: "p1",
            isTapped: true,
            isSummoningSick: false,
        });
        // Summoning-sick (not controlled continuously) → survives.
        const fresh = vanilla("fresh", 2, 2, {
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: true,
        });
        // Wall → survives.
        const wall = vanilla("wall", 0, 4, {
            controllerId: "p1",
            ownerId: "p1",
            subtypes: ["Wall"],
            isSummoningSick: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [attacker, stayBack, tapped, fresh, wall],
                }),
                makePlayer("p2", { battlefield: [war] }),
            ],
            activePlayerId: "p1",
        });
        const event = {
            type: "ATTACKERS_DECLARED" as const,
            attackingPlayerId: "p1",
            attackerIds: ["atk"],
        } as StackItem["triggerEvent"];
        resolveTrigger(state, war, "total-war-mass-destroy", event);
        const bf = state.players[0].battlefield.map((c) => c.id);
        expect(bf).not.toContain("stay"); // destroyed
        expect(bf).toContain("atk"); // attacked → safe
        expect(bf).toContain("tap"); // tapped → safe
        expect(bf).toContain("fresh"); // summoning-sick → safe
        expect(bf).toContain("wall"); // Wall → safe
    });
});

describe("Flare (1 damage to any target + cantrip, CR 120.1)", () => {
    it("deals 1 damage to a player and cantrips", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { library: library("p1", ["a"]) }),
                makePlayer("p2", { life: 20 }),
            ],
        });
        castCantrip(state, flare.id, "p1", [{ type: "player", id: "p2" }]);
        expect(state.players[1].life).toBe(19);
        enterUpkeepAndFire(state, "p1");
        resolveTopOfStack(state);
        expect(state.players[0].hand.map((c) => c.id)).toContain("a");
    });
});

describe("Panic (target creature can't block + cantrip, CR 509.1b)", () => {
    it("declares the cast restriction", () => {
        expect(panic.castPhaseRestriction).toContain("DECLARE_ATTACKERS");
        expect(panic.castPhaseRestriction).toContain("BEGINNING_OF_COMBAT");
    });

    it("restricts the target from blocking and cantrips at next upkeep", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { library: library("p1", ["a"]) }),
                makePlayer("p2", {
                    battlefield: [
                        vanilla("wall", 0, 4, { zone: "battlefield" }),
                    ],
                }),
            ],
        });
        castCantrip(state, panic.id, "p1", [{ type: "permanent", id: "wall" }]);
        expect(
            state.players[1].battlefield.find((c) => c.id === "wall")
                ?.cantBlockThisTurn
        ).toBe(true);
        enterUpkeepAndFire(state, "p1");
        resolveTopOfStack(state);
        expect(state.players[0].hand.map((c) => c.id)).toContain("a");
    });
});

describe("Goblin Ski Patrol (CR 205.4a snow-Mountain activation gate)", () => {
    it("can only activate while controlling a snow Mountain", () => {
        const gsp = makeInstance(goblinSkiPatrol.id, {
            id: "gsp",
            controllerId: "p1",
        });
        const ability = goblinSkiPatrol.activatedAbilities![0];
        const without = makeState({
            players: [
                makePlayer("p1", { battlefield: [gsp] }),
                makePlayer("p2"),
            ],
        });
        expect(
            ability.canActivate!(without.players[0].battlefield[0], without)
        ).toBe(false);
        const withSnow = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        gsp,
                        snowLand(snowCoveredMountain.id, "sm", "p1"),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        expect(
            ability.canActivate!(withSnow.players[0].battlefield[0], withSnow)
        ).toBe(true);
    });
});

describe("Barbarian Guides (CR 702.13 chosen-type snow landwalk grant)", () => {
    it("grants snow forestwalk and schedules a next-end-step bounce", () => {
        const guides = makeInstance(barbarianGuides.id, {
            id: "guides",
            controllerId: "p1",
        });
        const target = vanilla("t", 2, 2);
        target.controllerId = "p1";
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [guides, target] }),
                makePlayer("p2"),
            ],
        });
        // Resolve the ability; auto-answers the land-type choice via the pending
        // choice flow.
        state.stack.push({
            ...guides,
            zone: "stack",
            castById: "p1",
            abilityId: "barbarian-guides-snow-landwalk",
            targets: [{ type: "permanent", id: "t" }],
        });
        resolveTopOfStack(state);
        // The land-type choice suspends resolution; answer "Forest".
        if (state.pendingChoices && state.pendingChoices.length > 0) {
            submitChoice(state, ["Forest"]);
        }
        const after = state.players[0].battlefield.find((c) => c.id === "t")!;
        expect(after.staticAbilities).toContain("snow forestwalk");
        expect(
            (state.delayedTriggers ?? []).some(
                (d) => d.triggerId === "barbarian-guides-bounce"
            )
        ).toBe(true);
    });
});

describe("Orcish Farmer (CR 305.7 / 502.1 timed land-type change to Swamp)", () => {
    function setup(): {
        state: GameState;
        farmer: CardInstanceState;
    } {
        const farmer = makeInstance(orcishFarmer.id, {
            id: "of",
            controllerId: "p1",
        });
        const targetForest = makeInstance(forest.id, {
            id: "tf",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [farmer, targetForest] }),
                makePlayer("p2"),
            ],
        });
        state.activePlayerId = "p1";
        return { state, farmer };
    }

    it("is a {1}{R}{R} 2/2 Orc with a {T} land-to-Swamp ability", () => {
        expect(orcishFarmer.manaCost).toEqual({ X: 1, R: 2 });
        expect(orcishFarmer.power).toBe(2);
        const ability = orcishFarmer.activatedAbilities?.[0];
        expect(ability?.cost).toEqual({ tap: true });
        expect(ability?.targetRequirement).toEqual({ type: "Land", count: 1 });
    });

    it("makes the target land a Swamp that taps for {B}, reverting at the controller's next untap step", () => {
        const { state } = setup();
        // The forest taps for {G} before the ability resolves.
        let land = state.players[0].battlefield.find((c) => c.id === "tf")!;
        expect(getBasicLandMana(land)).toBe("G");

        resolveActivated(
            state,
            state.players[0].battlefield[0],
            "orcish-farmer-swamp",
            [{ type: "permanent", id: "tf" }]
        );

        land = state.players[0].battlefield.find((c) => c.id === "tf")!;
        expect(land.subtypes).toEqual(["Swamp"]);
        // CR 305.6 / 605.1a — a Swamp taps for {B}.
        expect(getBasicLandMana(land)).toBe("B");
        expect(land.temporarySubtypeChange?.duration.phase).toBe("untap");

        // Advance to p1's NEXT untap step. The change is scoped to p1 (the
        // land's controller). Stage p2's END_STEP and advance: CLEANUP and UNTAP
        // are auto-phases, so a single advancePhase passes through p2's CLEANUP,
        // advanceTurn, and p1's UNTAP (where the untap-boundary tick fires),
        // settling at p1's UPKEEP.
        state.activePlayerId = "p2";
        state.phase = "END_STEP";
        advancePhase(state);
        expect(state.activePlayerId).toBe("p1");
        // Passed through p1's UNTAP — the timed change has reverted.

        land = state.players[0].battlefield.find((c) => c.id === "tf")!;
        // Reverted to a Forest tapping for {G}.
        expect(land.subtypes).toEqual(["Forest"]);
        expect(getBasicLandMana(land)).toBe("G");
        expect(land.temporarySubtypeChange).toBeUndefined();
    });

    it("survives the wire-format projection while a Swamp", () => {
        const { state } = setup();
        resolveActivated(
            state,
            state.players[0].battlefield[0],
            "orcish-farmer-swamp",
            [{ type: "permanent", id: "tf" }]
        );
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "tf"
        )!;
        expect(slim.subtypes).toEqual(["Swamp"]);
        expect(getBasicLandMana(slim)).toBe("B");
    });
});

describe("Meteor Shower ({X}{X}{R} — X+1 damage divided as you choose, CR 107.3 / 601.2d / 120.4)", () => {
    function setup(targetIds: string[]): GameState {
        return makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", {
                    battlefield: targetIds.map((id) => makeTargetCreature(id)),
                }),
            ],
        });
    }

    it("uses a doubled-X cost (xFactor 2) and a total of X+1", () => {
        expect(meteorShower.manaCost).toEqual({ X: "X", xFactor: 2, R: 1 });
        expect(meteorShower.targetRequirement?.divideAsChosen).toEqual({
            total: "X+1",
        });
    });

    it("divides X+1 (= 4 when X=3) unevenly across targets", () => {
        const state = setup(["a", "b"]);
        const item = pushSpell(state, meteorShower.id, "p1", [
            { type: "permanent", id: "a" },
            { type: "permanent", id: "b" },
        ]);
        item.chosenX = 3; // total = 4
        item.targetAmounts = { "permanent:a": 3, "permanent:b": 1 };
        resolveTopOfStack(state);
        const a = state.players[1].battlefield.find((c) => c.id === "a")!;
        const b = state.players[1].battlefield.find((c) => c.id === "b")!;
        expect(a.damageMarked).toBe(3);
        expect(b.damageMarked).toBe(1);
        expect((a.damageMarked ?? 0) + (b.damageMarked ?? 0)).toBe(4);
    });

    it("deals 1 damage with X=0 (X+1 = 1) to a single target", () => {
        const state = setup(["a"]);
        const item = pushSpell(state, meteorShower.id, "p1", [
            { type: "permanent", id: "a" },
        ]);
        item.chosenX = 0; // total = 1
        resolveTopOfStack(state);
        const a = state.players[1].battlefield.find((c) => c.id === "a")!;
        expect(a.damageMarked).toBe(1);
    });
});

describe("Chaos Moon — parity-dependent Mountain rider (CR 614/611, #665)", () => {
    function fireParity(permanentsOnBoard: number) {
        // Build a board with Chaos Moon + (permanentsOnBoard - 1) extra
        // permanents so the total permanent count hits `permanentsOnBoard`.
        const moon = makeInstance(chaosMoon.id, {
            id: "moon",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        // Goblin Ski Patrol is a red 1/1 — observe the parity P/T pump on it.
        const redCreature = makeInstance(goblinSkiPatrol.id, {
            id: "red",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const fillers: CardInstanceState[] = [];
        for (let i = 0; i < permanentsOnBoard - 2; i++) {
            fillers.push(makeLand(plains.id, "p1"));
        }
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [moon, redCreature, ...fillers],
                }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
            phase: "UPKEEP",
        });
        return { state, moon, redCreature };
    }

    it("shape: each-upkeep parity trigger, no continuous substitution", () => {
        expect(chaosMoon.types).toContain("Enchantment");
        expect(chaosMoon.manaCost).toEqual({ X: 3, R: 1 });
        expect(chaosMoon.landManaSubstitution).toBeUndefined();
        const parity = chaosMoon.triggeredAbilities?.find((t) =>
            t.id?.includes("parity")
        );
        expect(parity).toBeTruthy();
    });

    it("odd permanent count: Mountain taps for {R} plus an additional {R}, red creature +1/+1", () => {
        const { state, moon, redCreature } = fireParity(3); // odd
        resolveTrigger(state, moon, "chaos-moon-parity", {
            type: "PHASE_BEGIN" as const,
            phase: "UPKEEP" as const,
            activePlayerId: "p1",
        } as StackItem["triggerEvent"]);
        expect(state.landManaRidersThisTurn).toEqual([
            { subtype: "Mountain", color: "R", mode: "additional" },
        ]);
        const mtn = makeLand(mountain.id, "p1");
        const out = applyLandManaReplacement(state, "p1", mtn, { R: 1 });
        expect(out).toEqual({ R: 2 });
        // Red creature gets +1/+1 (1/1 → 2/2).
        const onBoard = state.players[0].battlefield.find(
            (c) => c.id === redCreature.id
        )!;
        expect(getEffectivePower(state, onBoard)).toBe(2);
        expect(getEffectiveToughness(state, onBoard)).toBe(2);
    });

    it("even permanent count: Mountain produces {C} instead of {R}, red creature -1/-1", () => {
        const { state, moon, redCreature } = fireParity(4); // even
        resolveTrigger(state, moon, "chaos-moon-parity", {
            type: "PHASE_BEGIN" as const,
            phase: "UPKEEP" as const,
            activePlayerId: "p1",
        } as StackItem["triggerEvent"]);
        expect(state.landManaRidersThisTurn).toEqual([
            { subtype: "Mountain", color: "C", mode: "override" },
        ]);
        const mtn = makeLand(mountain.id, "p1");
        const out = applyLandManaReplacement(state, "p1", mtn, { R: 1 });
        expect(out).toEqual({ C: 1 });
        // Red creature gets -1/-1 (1/1 → 0/0).
        const onBoard = state.players[0].battlefield.find(
            (c) => c.id === redCreature.id
        )!;
        expect(getEffectivePower(state, onBoard)).toBe(0);
        expect(getEffectiveToughness(state, onBoard)).toBe(0);
    });

    it("rider is keyed to Mountain only — Plains unaffected", () => {
        const { state, moon } = fireParity(3); // odd
        resolveTrigger(state, moon, "chaos-moon-parity", {
            type: "PHASE_BEGIN" as const,
            phase: "UPKEEP" as const,
            activePlayerId: "p1",
        } as StackItem["triggerEvent"]);
        const pl = makeLand(plains.id, "p1");
        const out = applyLandManaReplacement(state, "p1", pl, { W: 1 });
        expect(out).toEqual({ W: 1 });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Combat / casting-restriction primitives (#669)
// ─────────────────────────────────────────────────────────────────────────────

describe("Melee (attacker chooses blocks + untap-unblocked rider, CR 509.1)", () => {
    it("has the correct cost, type and cast window", () => {
        expect(melee.manaCost).toEqual({ X: 4, R: 1 });
        expect(melee.types).toEqual(["Instant"]);
        expect(melee.castPhaseRestriction).toEqual(["DECLARE_ATTACKERS"]);
        expect(melee.castTurnRestriction).toBe("self");
    });

    it("sets meleeCombat when it resolves during the attacker's combat", () => {
        const attacker = vanilla("atk", 2, 2, {
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [attacker] }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
            phase: "DECLARE_ATTACKERS",
            combat: {
                attackerIds: ["atk"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: false,
            },
        });
        pushSpell(state, melee.id, "p1");
        resolveTopOfStack(state);
        expect(state.meleeCombat).toBe(true);
        expect(state.stack).toHaveLength(0);
    });

    it("untaps and removes from combat every attacker left unblocked", () => {
        // Two attackers: 'blocked' becomes blocked, 'free' stays unblocked.
        const blocked = vanilla("blocked", 2, 2, {
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
            isTapped: true,
        });
        const free = vanilla("free", 3, 3, {
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
            isTapped: true,
        });
        const blocker = vanilla("blk", 1, 1, {
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [blocked, free] }),
                makePlayer("p2", { battlefield: [blocker] }),
            ],
            activePlayerId: "p1",
            phase: "DECLARE_BLOCKERS",
            meleeCombat: true,
            combat: {
                attackerIds: ["blocked", "free"],
                confirmed: true,
                blockerAssignments: { blk: ["blocked"] },
                blockersConfirmed: true,
            },
        });
        recordBlockedAttackers(state);
        applyMeleeUnblockedRider(state);
        // 'free' was unblocked → untapped + removed from combat.
        const liveFree = state.players[0].battlefield.find(
            (c) => c.id === "free"
        )!;
        expect(liveFree.isTapped).toBe(false);
        expect(liveFree.isAttacking).toBeFalsy();
        expect(state.combat!.attackerIds).not.toContain("free");
        // 'blocked' stayed: still attacking, still tapped, still in combat.
        const liveBlocked = state.players[0].battlefield.find(
            (c) => c.id === "blocked"
        )!;
        expect(liveBlocked.isAttacking).toBe(true);
        expect(state.combat!.attackerIds).toContain("blocked");
    });

    it("is a no-op for a normal (non-Melee) combat", () => {
        const free = vanilla("free", 3, 3, {
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
            isTapped: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [free] }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
            phase: "DECLARE_BLOCKERS",
            combat: {
                attackerIds: ["free"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: true,
            },
        });
        recordBlockedAttackers(state);
        applyMeleeUnblockedRider(state);
        const live = state.players[0].battlefield.find((c) => c.id === "free")!;
        // No Melee → unblocked attacker stays tapped and in combat.
        expect(live.isTapped).toBe(true);
        expect(state.combat!.attackerIds).toContain("free");
    });
});

describe("Brand of Ill Omen (enchanted creature's controller can't cast creature spells, CR 601.3a)", () => {
    function setup() {
        // p2 controls the host creature; Brand (p1-owned) enchants it.
        const host = vanilla("host", 2, 2, {
            controllerId: "p2",
            ownerId: "p2",
        });
        const brand = makeInstance(brandOfIllOmen.id, {
            id: "brand",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "host",
        });
        // A creature spell and a noncreature spell in p2's hand.
        const creatureSpell = makeInstance(balduvianBears.id, {
            id: "bears",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const noncreatureSpell = makeInstance(brainstorm.id, {
            id: "bs",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [brand] }),
                makePlayer("p2", {
                    battlefield: [host],
                    hand: [creatureSpell, noncreatureSpell],
                    manaPool: { W: 5, U: 5, B: 5, R: 5, G: 5, C: 5 },
                }),
            ],
            activePlayerId: "p2",
            priorityPlayerId: "p2",
            phase: "PRECOMBAT_MAIN",
        });
        return { state, creatureSpell, noncreatureSpell };
    }

    it("snapshot: carries a cast-restriction static effect + cumulative upkeep", () => {
        expect(brandOfIllOmen.subtypes).toContain("Aura");
        expect(
            brandOfIllOmen.staticEffects?.some(
                (e) => e.kind === "cast-restriction"
            )
        ).toBe(true);
        expect(
            brandOfIllOmen.triggeredAbilities?.some((t) =>
                t.id.includes("cumulative-upkeep")
            )
        ).toBe(true);
    });

    it("the enchanted creature's controller cannot cast a creature spell", () => {
        const { state, creatureSpell } = setup();
        const actions = getLegalActions(state, state.players[1], creatureSpell);
        expect(actions).not.toContain("cast");
    });

    it("the restriction survives the wire projection", () => {
        const { state, creatureSpell } = setup();
        // The cast gate reads `castProhibitionReason`, which scans the
        // battlefield for the Aura's `cast-restriction` static. Re-run it on the
        // projected state: the Aura's `attachedTo` and the host's controllerId
        // must survive projection or the client would wrongly enable the cast.
        expect(castProhibitionReason("p2", creatureSpell, state)).toBeDefined();
        const projected = projectPublicState(state, 1, "p2");
        expect(
            castProhibitionReason("p2", creatureSpell as never, projected)
        ).toBeDefined();
    });

    it("the same player can still cast noncreature spells", () => {
        const { state, noncreatureSpell } = setup();
        const actions = getLegalActions(
            state,
            state.players[1],
            noncreatureSpell
        );
        expect(actions).toContain("cast");
    });

    it("does not restrict the OTHER player (who doesn't control the host)", () => {
        const { state } = setup();
        // p1 controls Brand but not the host → unaffected. Give p1 a creature
        // spell in hand with priority.
        const p1Bears = makeInstance(balduvianBears.id, {
            id: "p1-bears",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        state.players[0].hand = [p1Bears];
        state.players[0].manaPool = { W: 5, U: 5, B: 5, R: 5, G: 5, C: 5 };
        state.activePlayerId = "p1";
        state.priorityPlayerId = "p1";
        const actions = getLegalActions(state, state.players[0], p1Bears);
        expect(actions).toContain("cast");
    });
});

// ===========================================================================
// Static conditional combat restrictions (#729) — Errantry, Orcish Conscripts
// ===========================================================================

// --- Errantry (CR 303.4 Aura, CR 613 layer 7c, CR 508.1c) ------------------

describe("Errantry (+3/+0 aura, 'can only attack alone', CR 508.1c)", () => {
    // Host creature controlled by the active player (p1), enchanted by Errantry.
    function setup(extraAttackerIds: string[] = []) {
        const host = vanilla("host", 2, 2, {
            controllerId: "p1",
            ownerId: "p1",
        });
        const aura = makeInstance(errantry.id, {
            id: "errantry",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "host",
        });
        const other = vanilla("other", 1, 1, {
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            activePlayerId: "p1",
            players: [
                makePlayer("p1", { battlefield: [host, aura, other] }),
                makePlayer("p2"),
            ],
            combat: {
                attackerIds: ["host", ...extraAttackerIds],
                confirmed: false,
                blockerAssignments: {},
                blockersConfirmed: false,
            },
        });
        return { state, host };
    }

    it("grants the enchanted creature +3/+0 (GRE + wire format)", () => {
        const { state } = setup();
        const live = state.players[0].battlefield.find((c) => c.id === "host")!;
        expect(getEffectivePower(state, live)).toBe(5);
        expect(getEffectiveToughness(state, live)).toBe(2);

        // CR projection — the buff must survive serialization to the client.
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "host"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(5);
        expect(getEffectiveToughness(projected, slim)).toBe(2);
    });

    it("declares a pt-buff and a declared-attack-restriction", () => {
        const kinds = (errantry.staticEffects ?? []).map((e) => e.kind);
        expect(kinds).toContain("pt-buff");
        expect(kinds).toContain("declared-attack-restriction");
    });

    it("permits the attack when the enchanted creature attacks alone", () => {
        const { state } = setup();
        expect(validateDeclaredAttackers(state).ok).toBe(true);
    });

    it("rejects the attack when another creature also attacks", () => {
        const { state } = setup(["other"]);
        const result = validateDeclaredAttackers(state);
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.reason).toMatch(/attack alone/i);
        }
    });
});

// --- Orcish Conscripts (CR 508.1c / 509.1b) --------------------------------

describe("Orcish Conscripts ('unless two others attack/block', CR 508.1c)", () => {
    function buddies(n: number, prefix: string) {
        return Array.from({ length: n }, (_, i) =>
            vanilla(`${prefix}${i}`, 1, 1, {
                controllerId: "p1",
                ownerId: "p1",
            })
        );
    }

    it("declares a declared-attack and a declared-block restriction", () => {
        const kinds = (orcishConscripts.staticEffects ?? []).map((e) => e.kind);
        expect(kinds).toContain("declared-attack-restriction");
        expect(kinds).toContain("declared-block-restriction");
    });

    it("can't attack alone or with only one other attacker", () => {
        const conscripts = makeInstance(orcishConscripts.id, {
            id: "oc",
            controllerId: "p1",
            ownerId: "p1",
        });
        const friends = buddies(2, "f");
        const make = (attackerIds: string[]) =>
            makeState({
                activePlayerId: "p1",
                players: [
                    makePlayer("p1", {
                        battlefield: [conscripts, ...friends],
                    }),
                    makePlayer("p2"),
                ],
                combat: {
                    attackerIds,
                    confirmed: false,
                    blockerAssignments: {},
                    blockersConfirmed: false,
                },
            });
        // Alone — illegal.
        expect(validateDeclaredAttackers(make(["oc"])).ok).toBe(false);
        // One other — still illegal (needs two others).
        expect(validateDeclaredAttackers(make(["oc", "f0"])).ok).toBe(false);
    });

    it("can attack once two other creatures attack", () => {
        const conscripts = makeInstance(orcishConscripts.id, {
            id: "oc",
            controllerId: "p1",
            ownerId: "p1",
        });
        const friends = buddies(2, "f");
        const state = makeState({
            activePlayerId: "p1",
            players: [
                makePlayer("p1", { battlefield: [conscripts, ...friends] }),
                makePlayer("p2"),
            ],
            combat: {
                attackerIds: ["oc", "f0", "f1"],
                confirmed: false,
                blockerAssignments: {},
                blockersConfirmed: false,
            },
        });
        expect(validateDeclaredAttackers(state).ok).toBe(true);
    });

    it("can't block unless two other creatures block", () => {
        // p1 attacks with three creatures; p2's Orcish Conscripts blocks.
        const conscripts = makeInstance(orcishConscripts.id, {
            id: "oc",
            controllerId: "p2",
            ownerId: "p2",
        });
        const otherBlockers = [
            vanilla("b0", 1, 1, { controllerId: "p2", ownerId: "p2" }),
            vanilla("b1", 1, 1, { controllerId: "p2", ownerId: "p2" }),
        ];
        const attackers = [
            vanilla("a0", 1, 1, { controllerId: "p1", ownerId: "p1" }),
            vanilla("a1", 1, 1, { controllerId: "p1", ownerId: "p1" }),
            vanilla("a2", 1, 1, { controllerId: "p1", ownerId: "p1" }),
        ];
        const make = (assignments: Record<string, string[]>) =>
            makeState({
                activePlayerId: "p1",
                players: [
                    makePlayer("p1", { battlefield: attackers }),
                    makePlayer("p2", {
                        battlefield: [conscripts, ...otherBlockers],
                    }),
                ],
                combat: {
                    attackerIds: ["a0", "a1", "a2"],
                    confirmed: true,
                    blockerAssignments: assignments,
                    blockersConfirmed: false,
                },
            });
        // Conscripts blocks alone — illegal.
        expect(validateDeclaredBlockers(make({ oc: ["a0"] })).ok).toBe(false);
        // Two other creatures also block — legal.
        const ok = validateDeclaredBlockers(
            make({ oc: ["a0"], b0: ["a1"], b1: ["a2"] })
        );
        expect(ok.ok).toBe(true);
    });
});

// --- Hipparion bypass-charge collection (CR 509.1b) ------------------------
// (Full pay-to-block path is exercised in white.test.ts; this asserts the
// red-side helper picks up the charge only when the blocked attacker is big.)

describe("collectBlockBypassCharges helper (CR 509.1b)", () => {
    it("returns no charge when no bypass restriction is involved", () => {
        const attacker = vanilla("a", 4, 4, {
            controllerId: "p1",
            ownerId: "p1",
        });
        const blocker = vanilla("b", 2, 2, {
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            activePlayerId: "p1",
            players: [
                makePlayer("p1", { battlefield: [attacker] }),
                makePlayer("p2", { battlefield: [blocker] }),
            ],
            combat: {
                attackerIds: ["a"],
                confirmed: true,
                blockerAssignments: { b: ["a"] },
                blockersConfirmed: false,
            },
        });
        expect(collectBlockBypassCharges(state)).toHaveLength(0);
    });
});
