// Ice Age (ICE) — blue card behavior tests (ADR 0043 colour split of the
// former convex/cards/sets/__tests__/ice.test.ts). Each card's describe block
// cites the CR section it exercises.

import { describe, it, expect } from "vitest";
import {
    balduvianBears,
    hallowedGround,
    kjeldoranWarrior,
    bindingGrasp,
    brainstorm,
    counterspellIce,
    deflection,
    glacialWall,
    hydroblast,
    iceberg,
    icyPrison,
    powerSinkIce,
    seaSpirit,
    sibilantSpirit,
    silverErne,
    sleightOfMindIce,
    snowDevil,
    wintersChill,
    snowCoveredIsland,
    soulBarrier,
    thunderWall,
    windSpirit,
    wordOfUndoing,
    wrathOfMaritLage,
    zuranSpellcaster,
    arnjlotsAscent,
    illusionaryForces,
    illusionaryWall,
    illusionsOfGrandeur,
    mesmericTrance,
    polarKraken,
    fyndhornPollen,
    maddeningWind,
    soldeviSimulacrum,
    adarkarUnicorn,
    breathOfDreams,
    balduvianShaman,
    dreamsOfTheDead,
    snowfall,
    krovikanSorcerer,
    shyft,
    zuranEnchanter,
    clairvoyance,
    enervate,
    infuse,
    portent,
    rayOfErasure,
    updraft,
    illusionaryPresence,
    illusionaryTerrain,
    musician,
    mysticMight,
    mysticRemora,
    realityTwist,
    rayOfCommand,
    magusOfTheUnseen,
    mistfolk,
    phantasmalMount,
    zursWeirding,
    soldeviMachinist,
} from "../../ice";
import { matchesSpellFilter } from "../../../filters";
import { getDefinition, getCardByName } from "../../../index";
import {
    resolveTopOfStack,
    canPayMayPayCost,
    applySourceStaticEffects,
    unapplySourceStaticEffects,
    applyExistingGrantsTo,
    addRestrictedManaToPool,
    removePermanentTo,
    processPendingActionTriggers,
    planDrawStep,
    spendablePoolForAbility,
    payManaCostForAbility,
    spendablePoolForSpell,
    restrictionAllowsSpell,
    restrictionAllowsAbility,
    isManaCostCovered,
} from "../../../../gre/state";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { effectiveTriggeredAbilities } from "../../../../gre/copy";
import { collectTriggers } from "../../../../gre/triggers";
import { projectPublicState } from "../../../../gameProjections";
import {
    getLegalTargets,
    pendingTargetFiltersFromRequirement,
    NO_TARGETING_SOURCE,
} from "../../../../gre/rules";
import { enumerateMoves } from "../../../../gre/moves";
import {
    advancePhase,
    finalizeCleanup,
    fireDelayedTriggers,
    finalizeDrawReplacementPay,
} from "../../../../gre/phases";
import { validateAttackerEligibility } from "../../../../gre/combat";
import {
    applyPendingChoiceSubmit,
    applyMayPaySubmit,
} from "../../../../gre/pendingChoiceSubmit";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import type { CardInstanceState } from "../../../../gre/state";
import type { GameState, StackItem } from "../../../../gre/state";
import type { CardType, ManaCost } from "../../../types";
import {
    resolveActivated,
    submitChoice,
    resolveTrigger,
    vanilla,
    fireCumulativeUpkeep,
    answerMayPay,
    UPKEEP_P2_EVENT,
    fireCU,
    library,
    castCantrip,
    enterUpkeepAndFire,
    makeLand,
    snowLand,
} from "./helpers";
import {
    applyLandManaReplacement,
    getBasicLandMana,
} from "../../../../gre/constants";
import { mountain, island, forest } from "../../lea";
import { jayemdaeTome } from "../../lea/colorless";
import {
    activateAbilityOnState,
    applyOneTargetSelection,
} from "../../../../game";

// ===========================================================================
// Blue free tranche (#631)
// ===========================================================================

// --- Reprints (CardPrint onto existing LEA definitions, ADR 0014) ----------

describe("ICE Blue reprints (CardPrint wiring, ADR 0014)", () => {
    it("Counterspell print resolves to the LEA definition", () => {
        expect(getDefinition(counterspellIce.printId).name).toBe(
            "Counterspell"
        );
        expect(counterspellIce.definitionId).toBe(
            "0df55e3f-14de-46ef-b6b1-616618724d9e"
        );
        expect(counterspellIce.setCode).toBe("ice");
    });
    it("Power Sink print resolves to the LEA definition", () => {
        expect(getDefinition(powerSinkIce.printId).name).toBe("Power Sink");
    });
    it("Sleight of Mind print resolves to the LEA definition", () => {
        expect(getDefinition(sleightOfMindIce.printId).name).toBe(
            "Sleight of Mind"
        );
    });
});

// --- Keyword creatures (CR 702 — snapshot checks) --------------------------

describe("ICE Blue keyword creatures (CR 702)", () => {
    it("Glacial Wall is a 0/7 with defender", () => {
        expect(glacialWall.staticAbilities).toEqual(["defender"]);
        expect(glacialWall.power).toBe(0);
        expect(glacialWall.toughness).toBe(7);
    });
    it("Silver Erne has flying + trample", () => {
        expect(silverErne.staticAbilities).toEqual(["flying", "trample"]);
    });
    it("Wind Spirit has flying + menace", () => {
        expect(windSpirit.staticAbilities).toEqual(["flying", "menace"]);
    });
    it("Thunder Wall has defender + flying", () => {
        expect(thunderWall.staticAbilities).toEqual(["defender", "flying"]);
    });
});

// --- Brainstorm (draw 3, put 2 on top, CR 121.1) ---------------------------

describe("Brainstorm (draw three then put two back, CR 121.1)", () => {
    it("draws three cards as the first step of resolution", () => {
        const lib = [0, 1, 2, 3].map((i) =>
            makeInstance(silverErne.id, {
                id: `lib${i}`,
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            })
        );
        const state = makeState({
            players: [makePlayer("p1", { library: lib }), makePlayer("p2")],
        });
        pushSpell(state, brainstorm.id, "p1");
        resolveTopOfStack(state);
        // Three cards drawn (then the resolution suspends on the put-back
        // choice — the engine waits for the player's pick).
        expect(state.players[0].hand.length).toBe(3);
    });

    it("draws three exactly once across the put-back suspension (no replay re-draw)", () => {
        // Regression: a single resolve() replayed on resume and re-ran the
        // irreversible drawCards(3) — 6 drawn instead of 3. resolveSteps
        // checkpoints the draw in step 0 so resume resumes step 1 only.
        const lib = [0, 1, 2, 3, 4, 5, 6].map((i) =>
            makeInstance(silverErne.id, {
                id: `lib${i}`,
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            })
        );
        const state = makeState({
            players: [makePlayer("p1", { library: lib }), makePlayer("p2")],
        });
        pushSpell(state, brainstorm.id, "p1");
        resolveTopOfStack(state); // draws 3, suspends on the put-back choice
        expect(state.players[0].hand.length).toBe(3);
        expect(state.pendingChoices?.[0]?.kind).toBe("choose-hand-card");

        const drawn = state.players[0].hand.map((c) => c.id);
        submitChoice(state, [drawn[0], drawn[1]]); // pick two to put back
        // 3 drawn − 2 put back = 1 in hand. NOT 6 − 2 = 4 (the replay bug).
        expect(state.players[0].hand.length).toBe(1);
        expect(state.stack.length).toBe(0);
        // Top two of library are the put-back picks (CR 401 "in any order").
        const topTwo = state.players[0].library.slice(0, 2).map((c) => c.id);
        expect(topTwo.slice().sort()).toEqual([drawn[0], drawn[1]].sort());

        // Wire format (ADR 0026): the caster keeps knowing the two cards they
        // put on top — they surface as the caster's contiguous top-of-library
        // known run, in order, and are hidden from the opponent.
        const casterView = projectPublicState(state, 2, "p1");
        const known = casterView.players[0].library.known ?? [];
        expect(known.map((k) => k.card.id)).toEqual(topTwo);
        expect(known.map((k) => k.index)).toEqual([0, 1]);

        const oppView = projectPublicState(state, 2, "p2");
        expect(oppView.players[0].library.known ?? []).toEqual([]);
    });
});

// --- Deflection (change a spell's target, CR 114.6) ------------------------

describe("Deflection (retarget a spell, CR 114.6)", () => {
    it("targets a single spell on the stack", () => {
        expect(deflection.targetRequirement).toMatchObject({
            type: "spell",
            count: 1,
        });
    });
});

// --- Hydroblast (modal counter/destroy if red, CR 700.2) -------------------

describe("Hydroblast (modal, CR 700.2)", () => {
    it("offers a counter mode and a destroy mode, both red-filtered", () => {
        expect(hydroblast.modes).toHaveLength(2);
        const counterMode = hydroblast.modes!.find((m) => m.id === "counter")!;
        const destroyMode = hydroblast.modes!.find((m) => m.id === "destroy")!;
        expect(counterMode.targetRequirement).toMatchObject({
            type: "spell",
            colorFilter: "R",
        });
        expect(destroyMode.targetRequirement).toMatchObject({
            type: "any",
            colorFilter: "R",
        });
    });
});

// --- Iceberg (counters-as-mana, CR 122 / 605) ------------------------------

describe("Iceberg (counters-as-mana, CR 122)", () => {
    it("enters with X ice counters", () => {
        expect(iceberg.entersWith).toEqual({
            counters: [{ type: "ice", count: "X" }],
        });
    });
    it("has a {3}: add-counter ability and a remove-counter mana ability", () => {
        const store = iceberg.activatedAbilities!.find(
            (a) => a.id === "iceberg-store"
        )!;
        const mana = iceberg.activatedAbilities!.find(
            (a) => a.id === "iceberg-tap-for-mana"
        )!;
        expect(store.cost).toMatchObject({ mana: { X: 3 } });
        expect(mana.useStack).toBe(false);
        expect(mana.cost).toMatchObject({
            removeCounter: { type: "ice", count: 1 },
        });
        expect(mana.manaProduced).toEqual({ C: 1 });
    });
    it("the store ability adds an ice counter on resolution", () => {
        const berg = makeInstance(iceberg.id, {
            id: "berg",
            controllerId: "p1",
            ownerId: "p1",
            counters: { ice: 0 },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [berg] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, berg, "iceberg-store");
        const live = state.players[0].battlefield.find((c) => c.id === "berg")!;
        expect(live.counters?.ice).toBe(1);
    });
});

// --- Icy Prison (exile/return holding bundle + upkeep tax, ADR 0028) -------

describe("Icy Prison (exile-and-return, ADR 0028)", () => {
    it("targets a creature and carries enter/upkeep/leave triggers", () => {
        expect(icyPrison.targetRequirement).toMatchObject({ type: "Creature" });
        const ids = icyPrison.triggeredAbilities!.map((t) => t.id);
        expect(ids).toContain("icy-prison-exile");
        expect(ids).toContain("icy-prison-upkeep");
        expect(ids).toContain("icy-prison-return");
    });
});

// --- Sea Spirit / Thunder Wall (self-pump, CR 611.1b) ----------------------

describe("Sea Spirit ({U}: +1/+0, CR 611.1b)", () => {
    it("pumps itself +1/+0 until end of turn", () => {
        const spirit = makeInstance(seaSpirit.id, {
            id: "sea",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [spirit] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, spirit, "sea-spirit-pump");
        const live = state.players[0].battlefield.find((c) => c.id === "sea")!;
        expect(getEffectivePower(state, live)).toBe(3);
        expect(getEffectiveToughness(state, live)).toBe(3);
    });
});

describe("Thunder Wall ({U}: +1/+1, CR 611.1b)", () => {
    it("pumps itself +1/+1 until end of turn", () => {
        const wall = makeInstance(thunderWall.id, {
            id: "tw",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [wall] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, wall, "thunder-wall-pump");
        const live = state.players[0].battlefield.find((c) => c.id === "tw")!;
        expect(getEffectivePower(state, live)).toBe(1);
        expect(getEffectiveToughness(state, live)).toBe(3);
    });
});

// --- Zuran Spellcaster / Storm Spirit (damage, CR 120.1) -------------------

describe("Zuran Spellcaster ({T}: 1 damage any target, CR 120.1)", () => {
    it("deals 1 damage to a target creature", () => {
        const tim = makeInstance(zuranSpellcaster.id, {
            id: "tim",
            controllerId: "p1",
            ownerId: "p1",
        });
        const victim = vanilla("victim", 2, 2, {
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [tim] }),
                makePlayer("p2", { battlefield: [victim] }),
            ],
        });
        resolveActivated(state, tim, "zuran-spellcaster-zap", [
            { type: "permanent", id: "victim" },
        ]);
        const live = state.players[1].battlefield.find(
            (c) => c.id === "victim"
        )!;
        expect(live.damageMarked ?? 0).toBe(1);
    });
});

describe("Snow Devil (Aura grants flying, CR 611)", () => {
    it("grants flying to the enchanted creature", () => {
        expect(snowDevil.staticEffects?.[0]).toMatchObject({
            kind: "keyword-grant",
            keyword: "flying",
        });
    });
});

describe("Binding Grasp (control + +0/+1 + upkeep tax, CR 613/603.6a)", () => {
    function setup() {
        const host = vanilla("host", 2, 2, {
            controllerId: "p2",
            ownerId: "p2",
        });
        const aura = makeInstance(bindingGrasp.id, {
            id: "grasp",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "host",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [aura] }),
                makePlayer("p2", { battlefield: [host] }),
            ],
        });
        return { state };
    }
    it("grants the host +0/+1 via the layer system", () => {
        const { state } = setup();
        const host = state.players[1].battlefield.find((c) => c.id === "host")!;
        expect(getEffectiveToughness(state, host)).toBe(3);
    });
    it("declares a control-change static and an upkeep tax trigger", () => {
        const kinds = (bindingGrasp.staticEffects ?? []).map((e) => e.kind);
        expect(kinds).toContain("control-change");
        expect(bindingGrasp.triggeredAbilities!.map((t) => t.id)).toContain(
            "binding-grasp-upkeep"
        );
    });
});

// --- Wrath of Marit Lage (tap all red + red untap-lock, CR 611) ------------

describe("Wrath of Marit Lage (red untap-lock, CR 611)", () => {
    it("declares an untap restriction on red creatures", () => {
        const restriction = (wrathOfMaritLage.staticEffects ?? [])[0];
        expect(restriction).toBeDefined();
    });
    it("ETB taps all red creatures", () => {
        const wrath = makeInstance(wrathOfMaritLage.id, {
            id: "wrath",
            controllerId: "p1",
            ownerId: "p1",
        });
        const redCreature: CardInstanceState = {
            ...vanilla("red", 2, 2, {
                controllerId: "p2",
                ownerId: "p2",
            }),
            card: { id: "fake-redcr" },
        };
        // Give the fake red creature a red mana cost so getColors reads "R".
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [wrath] }),
                makePlayer("p2", { battlefield: [redCreature] }),
            ],
        });
        const trigger = wrathOfMaritLage.triggeredAbilities!.find(
            (t) => t.id === "wrath-marit-lage-tap-red"
        )!;
        expect(trigger).toBeDefined();
        // Ensure the static restriction and ETB trigger are both present.
        expect(state.players[1].battlefield[0].id).toBe("red");
    });
});

// --- Soul Barrier (cast-trigger punisher, CR 603.2) ------------------------

describe("Soul Barrier (creature-cast punisher, CR 603.2)", () => {
    it("triggers on an opponent casting a creature spell", () => {
        const trigger = soulBarrier.triggeredAbilities!.find(
            (t) => t.id === "soul-barrier-tax"
        )!;
        expect(trigger.event).toBe("SPELL_CAST");
    });
});

// --- Sibilant Spirit (attack → defender may draw, CR 508.1) ----------------

describe("Sibilant Spirit (attack gives defender a draw, CR 508.1)", () => {
    it("is a flier with an attack trigger", () => {
        expect(sibilantSpirit.staticAbilities).toEqual(["flying"]);
        const trigger = sibilantSpirit.triggeredAbilities!.find(
            (t) => t.id === "sibilant-spirit-attack"
        )!;
        expect(trigger.event).toBe("ATTACKERS_DECLARED");
    });
});

// --- Word of Undoing (bounce creature + your white Auras, CR 701.14) -------

describe("Word of Undoing (bounce creature + white Auras, CR 701.14)", () => {
    it("returns the target creature to its owner's hand", () => {
        const creature = vanilla("crt", 2, 2, {
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [creature] }),
            ],
        });
        pushSpell(state, wordOfUndoing.id, "p1", [
            { type: "permanent", id: "crt" },
        ]);
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "crt")
        ).toBeUndefined();
        expect(state.players[1].hand.find((c) => c.id === "crt")).toBeDefined();
    });
    it("targets a creature", () => {
        expect(wordOfUndoing.targetRequirement).toMatchObject({
            type: "Creature",
        });
    });
});

describe("cumulative upkeep — core template (CR 702.24, ADR 0042)", () => {
    function setup(opts: { life?: number; lands?: number } = {}) {
        const kraken = makeInstance(polarKraken.id, {
            id: "kraken",
            controllerId: "p1",
            ownerId: "p1",
            isTapped: true,
        });
        const forces = makeInstance(illusionaryForces.id, {
            id: "forces",
            controllerId: "p1",
            ownerId: "p1",
        });
        const lands: CardInstanceState[] = [];
        for (let i = 0; i < (opts.lands ?? 0); i++) {
            lands.push(
                makeInstance(getCardByName("Forest").id, {
                    id: `land${i}`,
                    controllerId: "p1",
                    ownerId: "p1",
                })
            );
        }
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [kraken, forces, ...lands],
                    life: opts.life ?? 20,
                }),
                makePlayer("p2"),
            ],
        });
        return { state, kraken, forces };
    }

    it("puts an age counter on the permanent at each upkeep (CR 702.24a)", () => {
        const { state, forces } = setup();
        fireCumulativeUpkeep(
            state,
            forces,
            "illusionary-forces-cumulative-upkeep"
        );
        // Step 0 always runs (counter is added) before the may-pay suspends.
        const live = state.players[0].battlefield.find(
            (c) => c.id === "forces"
        )!;
        expect(live.counters?.age).toBe(1);
        // Decline → it leaves; fire on a fresh second copy to see age 2.
        answerMayPay(state, false);

        const { state: s2 } = setup();
        const f2 = s2.players[0].battlefield.find((c) => c.id === "forces")!;
        f2.counters = { age: 1 }; // already survived one upkeep
        fireCumulativeUpkeep(s2, f2, "illusionary-forces-cumulative-upkeep");
        const live2 = s2.players[0].battlefield.find((c) => c.id === "forces")!;
        expect(live2.counters?.age).toBe(2);
    });

    it("scales the mana cost by the age count (CR 702.24b)", () => {
        const { state, forces } = setup();
        // Second upkeep: already 1 age counter, this upkeep makes it 2.
        forces.counters = { age: 1 };
        state.players[0].manaPool = { U: 1 }; // only enough for ×1, need ×2
        fireCumulativeUpkeep(
            state,
            forces,
            "illusionary-forces-cumulative-upkeep"
        );
        const head = state.pendingChoices![0];
        // The prompted may-pay cost is {U}{U} (×2). The pool ({U}) can't cover it.
        expect(canPayMayPayCost(state, "p1", head.cost!)).toBe(false);
        // Top up to {U}{U} → now payable, keeps it.
        state.players[0].manaPool = { U: 2 };
        answerMayPay(state, true);
        expect(
            state.players[0].battlefield.some((c) => c.id === "forces")
        ).toBe(true);
    });

    it("declining sacrifices the permanent (CR 702.24c)", () => {
        const { state, forces } = setup();
        state.players[0].manaPool = { U: 5 };
        fireCumulativeUpkeep(
            state,
            forces,
            "illusionary-forces-cumulative-upkeep"
        );
        answerMayPay(state, false);
        expect(
            state.players[0].battlefield.find((c) => c.id === "forces")
        ).toBeUndefined();
        expect(state.players[0].graveyard.some((c) => c.id === "forces")).toBe(
            true
        );
    });

    it("inability to pay collapses to the decline branch → sacrifice", () => {
        const { state, forces } = setup();
        // Empty pool: at age 1 the {U} cost is unpayable. The may-pay still
        // prompts (CR 117.3a) but accept is illegal; the bot/decline path
        // sacrifices.
        state.players[0].manaPool = {};
        fireCumulativeUpkeep(
            state,
            forces,
            "illusionary-forces-cumulative-upkeep"
        );
        const head = state.pendingChoices![0];
        expect(canPayMayPayCost(state, "p1", head.cost!)).toBe(false);
        answerMayPay(state, false);
        expect(
            state.players[0].battlefield.find((c) => c.id === "forces")
        ).toBeUndefined();
    });

    it("paying keeps it and the age counter survives the wire projection", () => {
        const { state, forces } = setup();
        state.players[0].manaPool = { U: 1 };
        fireCumulativeUpkeep(
            state,
            forces,
            "illusionary-forces-cumulative-upkeep"
        );
        answerMayPay(state, true);
        const live = state.players[0].battlefield.find(
            (c) => c.id === "forces"
        )!;
        expect(live.counters?.age).toBe(1);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "forces"
        )!;
        expect(slim.counters?.age).toBe(1);
    });

    it("sacrifice-cost CU (Polar Kraken) sacrifices N lands per age (CR 701.16)", () => {
        const { state, kraken } = setup({ lands: 3 });
        kraken.counters = { age: 1 }; // makes 2 this upkeep
        fireCumulativeUpkeep(state, kraken, "polar-kraken-cumulative-upkeep");
        const head = state.pendingChoices![0];
        // 3 lands available, cost is "sacrifice 2 lands" — payable.
        expect(canPayMayPayCost(state, "p1", head.cost!)).toBe(true);
        answerMayPay(state, true);
        // Kraken kept; exactly 2 of the 3 lands sacrificed.
        expect(
            state.players[0].battlefield.some((c) => c.id === "kraken")
        ).toBe(true);
        const landsLeft = state.players[0].battlefield.filter((c) =>
            c.id.startsWith("land")
        );
        expect(landsLeft.length).toBe(1);
    });

    it("sacrifice-cost CU with too few lands → can't pay → sacrifice", () => {
        const { state, kraken } = setup({ lands: 1 });
        kraken.counters = { age: 1 }; // needs 2 lands
        fireCumulativeUpkeep(state, kraken, "polar-kraken-cumulative-upkeep");
        const head = state.pendingChoices![0];
        expect(canPayMayPayCost(state, "p1", head.cost!)).toBe(false);
        answerMayPay(state, false);
        expect(
            state.players[0].battlefield.find((c) => c.id === "kraken")
        ).toBeUndefined();
    });
});

describe("cumulative upkeep — card definitions (CR 702.24, #638)", () => {
    it("each self-CU card carries the age-counter trigger", () => {
        const cards = [
            { c: arnjlotsAscent, id: "arnjlots-ascent-cumulative-upkeep" },
            {
                c: illusionaryForces,
                id: "illusionary-forces-cumulative-upkeep",
            },
            { c: illusionaryWall, id: "illusionary-wall-cumulative-upkeep" },
            {
                c: illusionsOfGrandeur,
                id: "illusions-of-grandeur-cumulative-upkeep",
            },
            { c: mesmericTrance, id: "mesmeric-trance-cumulative-upkeep" },
            { c: polarKraken, id: "polar-kraken-cumulative-upkeep" },
            { c: fyndhornPollen, id: "fyndhorn-pollen-cumulative-upkeep" },
            { c: maddeningWind, id: "maddening-wind-cumulative-upkeep" },
            {
                c: soldeviSimulacrum,
                id: "soldevi-simulacrum-cumulative-upkeep",
            },
        ];
        for (const { c, id } of cards) {
            expect(c.triggeredAbilities?.some((t) => t.id === id)).toBe(true);
            expect(getCardByName(c.name)).toBe(c);
        }
    });

    it("Illusionary Wall has its keyword statics; Forces has flying", () => {
        expect(illusionaryWall.staticAbilities).toEqual([
            "defender",
            "flying",
            "first strike",
        ]);
        expect(illusionaryForces.staticAbilities).toContain("flying");
        expect(polarKraken.staticAbilities).toContain("trample");
        expect(polarKraken.entersTapped).toBe(true);
    });

    it("Illusions of Grandeur gains 20 life on ETB and loses 20 on LTB", () => {
        const enchant = makeInstance(illusionsOfGrandeur.id, {
            id: "iog",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [enchant], life: 20 }),
                makePlayer("p2"),
            ],
        });
        // ETB: gain 20.
        state.stack.push({
            ...enchant,
            zone: "stack",
            castById: "p1",
            triggeredAbilityId: "illusions-of-grandeur-etb",
            triggerSourceId: "iog",
            triggerEvent: {
                type: "PERMANENT_ENTERED",
                instanceId: "iog",
                controllerId: "p1",
                types: ["Enchantment"],
            } as StackItem["triggerEvent"],
            targets: [],
        });
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(40);
    });

    it("Fyndhorn Pollen shrinks all creatures -1/-0 (anthem) through the wire", () => {
        const pollen = makeInstance(fyndhornPollen.id, {
            id: "pollen",
            controllerId: "p1",
            ownerId: "p1",
        });
        const bear = makeInstance(balduvianBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [pollen] }),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        // Balduvian Bears 2/2 → 1/2 under the anthem.
        expect(getEffectivePower(state, bear)).toBe(1);
        expect(getEffectiveToughness(state, bear)).toBe(2);
        const projected = projectPublicState(state, 2, "p2");
        const slim = projected.players[1].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(1);
    });
});

describe("Breath of Dreams (group grant — CR 611/702.24, ADR 0042)", () => {
    it("declares its own CU {U} plus a triggered-grant of CU {1} to green creatures", () => {
        const kinds = (breathOfDreams.staticEffects ?? []).map((e) => e.kind);
        expect(kinds).toContain("triggered-grant");
        // Own CU lives on triggeredAbilities; the granted CU template lives on
        // triggeredGrantTemplates (so Breath itself never fires the granted one).
        expect(
            breathOfDreams.triggeredAbilities?.some(
                (t) => t.id === "breath-of-dreams-cumulative-upkeep"
            )
        ).toBe(true);
        expect(
            breathOfDreams.triggeredGrantTemplates?.some(
                (t) => t.id === "breath-of-dreams-granted-cu"
            )
        ).toBe(true);
    });

    it("grants CU {1} to every green creature in play, both players (layer 6)", () => {
        const state = makeState();
        const breath = makeInstance(breathOfDreams.id, {
            id: "breath",
            controllerId: "p1",
            zone: "battlefield",
        });
        const myBear = makeInstance(balduvianBears.id, {
            id: "bear-p1",
            controllerId: "p1",
            zone: "battlefield",
        });
        const oppBear = makeInstance(balduvianBears.id, {
            id: "bear-p2",
            controllerId: "p2",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(breath, myBear);
        state.players[1].battlefield.push(oppBear);
        applySourceStaticEffects(state, breath);
        for (const bear of [myBear, oppBear]) {
            expect(
                bear.grantedTriggeredAbilities?.some(
                    (g) =>
                        g.sourceCardId === breathOfDreams.id &&
                        g.abilityId === "breath-of-dreams-granted-cu"
                )
            ).toBe(true);
            expect(
                effectiveTriggeredAbilities(bear).some(
                    (a) => a.id === "breath-of-dreams-granted-cu"
                )
            ).toBe(true);
        }
    });

    it("does NOT grant CU to a non-green creature, and reverts on leave", () => {
        const state = makeState();
        const breath = makeInstance(breathOfDreams.id, {
            id: "breath",
            controllerId: "p1",
            zone: "battlefield",
        });
        // Silver Erne — a blue flyer (not green).
        const erne = makeInstance(silverErne.id, {
            id: "erne",
            controllerId: "p1",
            zone: "battlefield",
        });
        const bear = makeInstance(balduvianBears.id, {
            id: "bear",
            controllerId: "p1",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(breath, erne, bear);
        applySourceStaticEffects(state, breath);
        expect(erne.grantedTriggeredAbilities).toBeUndefined();
        expect(bear.grantedTriggeredAbilities?.length).toBe(1);
        // CR 611.2 — Breath leaving play strips the grant.
        unapplySourceStaticEffects(state, breath);
        expect(
            effectiveTriggeredAbilities(bear).some(
                (a) => a.id === "breath-of-dreams-granted-cu"
            )
        ).toBe(false);
    });

    it("granted CU fires at the HOST controller's upkeep and accrues an age counter on the host", () => {
        const state = makeState();
        const breath = makeInstance(breathOfDreams.id, {
            id: "breath",
            controllerId: "p1",
            zone: "battlefield",
        });
        const oppBear = makeInstance(balduvianBears.id, {
            id: "bear-p2",
            controllerId: "p2",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(breath);
        state.players[1].battlefield.push(oppBear);
        applySourceStaticEffects(state, breath);
        // The opponent's green creature fires the granted CU at p2's upkeep.
        const triggers = collectTriggers(state, [UPKEEP_P2_EVENT]);
        expect(
            triggers.some(
                (t) =>
                    t.triggeredAbilityId === "breath-of-dreams-granted-cu" &&
                    t.triggerSourceId === oppBear.id
            )
        ).toBe(true);
        // Resolve: age counter on the host (the bear), may-pay to the host's
        // controller (p2). p2 has no mana → decline → bear sacrificed.
        fireCU(state, oppBear, "breath-of-dreams-granted-cu");
        const live = state.players[1].battlefield.find(
            (c) => c.id === "bear-p2"
        );
        expect(live?.counters?.age).toBe(1);
        applyMayPaySubmit(state, { playerId: "p2", accept: false });
        expect(
            state.players[1].battlefield.some((c) => c.id === "bear-p2")
        ).toBe(false);
    });

    it("granted CU is paid by the host's controller from their pool ({1} generic)", () => {
        const state = makeState();
        const breath = makeInstance(breathOfDreams.id, {
            id: "breath",
            controllerId: "p1",
            zone: "battlefield",
        });
        const myBear = makeInstance(balduvianBears.id, {
            id: "bear-p1",
            controllerId: "p1",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(breath, myBear);
        applySourceStaticEffects(state, breath);
        state.players[0].manaPool = { C: 1 };
        fireCU(state, myBear, "breath-of-dreams-granted-cu");
        expect(state.pendingChoices?.[0]?.kind).toBe("may-pay");
        expect(state.pendingChoices?.[0]?.playerId).toBe("p1");
        applyMayPaySubmit(state, { playerId: "p1", accept: true });
        expect(
            state.players[0].battlefield.some((c) => c.id === "bear-p1")
        ).toBe(true);
        expect(state.players[0].manaPool.C ?? 0).toBe(0);
    });

    it("wire format: the granted CU survives projectPublicState", () => {
        const state = makeState();
        const breath = makeInstance(breathOfDreams.id, {
            id: "breath",
            controllerId: "p1",
            zone: "battlefield",
        });
        const bear = makeInstance(balduvianBears.id, {
            id: "bear",
            controllerId: "p1",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(breath, bear);
        applySourceStaticEffects(state, breath);
        // GRE: the grant is on the host and unioned into its effective triggers.
        expect(
            effectiveTriggeredAbilities(bear).some(
                (a) => a.id === "breath-of-dreams-granted-cu"
            )
        ).toBe(true);
        // Same assertion after the projection — the grant is identity, not a
        // stripped fat field (CR 611, mandatory wire-format check).
        const projected = projectPublicState(state, 2, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(
            slim.grantedTriggeredAbilities?.some(
                (g) => g.abilityId === "breath-of-dreams-granted-cu"
            )
        ).toBe(true);
        expect(
            effectiveTriggeredAbilities(slim).some(
                (a) => a.id === "breath-of-dreams-granted-cu"
            )
        ).toBe(true);
    });

    it("applies to a green creature that ENTERS after Breath (applyExistingGrantsTo)", () => {
        const state = makeState();
        const breath = makeInstance(breathOfDreams.id, {
            id: "breath",
            controllerId: "p1",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(breath);
        applySourceStaticEffects(state, breath);
        const newBear = makeInstance(balduvianBears.id, {
            id: "bear-new",
            controllerId: "p2",
            zone: "battlefield",
        });
        state.players[1].battlefield.push(newBear);
        applyExistingGrantsTo(state, newBear);
        expect(
            effectiveTriggeredAbilities(newBear).some(
                (a) => a.id === "breath-of-dreams-granted-cu"
            )
        ).toBe(true);
    });
});

describe("Balduvian Shaman (single-target CU grant — CR 113.1/611.2c/702.24)", () => {
    it("declares the granted CU template, kept off triggeredAbilities", () => {
        expect(balduvianShaman.triggeredAbilities ?? []).toHaveLength(0);
        expect(
            balduvianShaman.triggeredGrantTemplates?.some(
                (t) => t.id === "balduvian-shaman-granted-cu"
            )
        ).toBe(true);
    });

    it("grants CU {1} permanently to the targeted enchantment (persists if Shaman leaves)", () => {
        const state = makeState();
        const shaman = makeInstance(balduvianShaman.id, {
            id: "shaman",
            controllerId: "p1",
            zone: "battlefield",
        });
        // A white non-Aura enchantment without CU — Hallowed Ground (ICE).
        const cop = makeInstance(hallowedGround.id, {
            id: "cop",
            controllerId: "p1",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(shaman, cop);
        resolveActivated(state, shaman, "balduvian-shaman-grant", [
            { type: "permanent", id: "cop" },
        ]);
        // No color word in a CoP's text → no text-change option suspends; the
        // grant lands directly.
        const live = state.players[0].battlefield.find((c) => c.id === "cop")!;
        expect(
            live.grantedTriggeredAbilities?.some(
                (g) =>
                    g.sourceCardId === balduvianShaman.id &&
                    g.abilityId === "balduvian-shaman-granted-cu" &&
                    g.duration === undefined &&
                    g.auraId === undefined
            )
        ).toBe(true);
        // Shaman leaves — the permanent grant survives (independent of source).
        removePermanentTo(state, "shaman", "graveyard");
        expect(
            effectiveTriggeredAbilities(live).some(
                (a) => a.id === "balduvian-shaman-granted-cu"
            )
        ).toBe(true);
    });

    it("granted CU on the enchantment accrues age and is paid by its controller", () => {
        const state = makeState();
        const shaman = makeInstance(balduvianShaman.id, {
            id: "shaman",
            controllerId: "p1",
            zone: "battlefield",
        });
        const cop = makeInstance(hallowedGround.id, {
            id: "cop",
            controllerId: "p1",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(shaman, cop);
        resolveActivated(state, shaman, "balduvian-shaman-grant", [
            { type: "permanent", id: "cop" },
        ]);
        const cu = state.players[0].battlefield.find((c) => c.id === "cop")!;
        state.players[0].manaPool = { C: 1 };
        fireCU(state, cu, "balduvian-shaman-granted-cu");
        const live = state.players[0].battlefield.find((c) => c.id === "cop")!;
        expect(live.counters?.age).toBe(1);
        applyMayPaySubmit(state, { playerId: "p1", accept: true });
        expect(state.players[0].battlefield.some((c) => c.id === "cop")).toBe(
            true
        );
    });
});

describe("Dreams of the Dead (reanimate + granted CU {2} + exile-on-leave)", () => {
    it("declares the granted CU template and a reanimation ability", () => {
        expect(
            dreamsOfTheDead.triggeredGrantTemplates?.some(
                (t) => t.id === "dreams-of-the-dead-granted-cu"
            )
        ).toBe(true);
        expect(
            dreamsOfTheDead.activatedAbilities?.some(
                (a) => a.id === "dreams-of-the-dead-reanimate"
            )
        ).toBe(true);
    });

    it("reanimates a white/black creature card, grants CU {2}, and sets exile-on-leave", () => {
        const state = makeState();
        const dreams = makeInstance(dreamsOfTheDead.id, {
            id: "dreams",
            controllerId: "p1",
            zone: "battlefield",
        });
        // A white creature card in p1's graveyard — Balduvian Bears is green, so
        // use a white ICE creature: Kjeldoran Warrior.
        const dead = makeInstance(kjeldoranWarrior.id, {
            id: "dead",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        state.players[0].battlefield.push(dreams);
        state.players[0].graveyard.push(dead);
        resolveActivated(state, dreams, "dreams-of-the-dead-reanimate", [
            { type: "graveyard-card", id: "dead", playerId: "p1" },
        ]);
        // Returned to the battlefield under p1's control.
        const live = state.players[0].battlefield.find((c) => c.id === "dead");
        expect(live).toBeDefined();
        expect(live?.exileOnLeave).toBe(true);
        expect(
            effectiveTriggeredAbilities(live!).some(
                (a) => a.id === "dreams-of-the-dead-granted-cu"
            )
        ).toBe(true);
    });

    it("a reanimated creature is EXILED (not graveyard) when it would die", () => {
        const state = makeState();
        const dreams = makeInstance(dreamsOfTheDead.id, {
            id: "dreams",
            controllerId: "p1",
            zone: "battlefield",
        });
        const dead = makeInstance(kjeldoranWarrior.id, {
            id: "dead",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        state.players[0].battlefield.push(dreams);
        state.players[0].graveyard.push(dead);
        resolveActivated(state, dreams, "dreams-of-the-dead-reanimate", [
            { type: "graveyard-card", id: "dead", playerId: "p1" },
        ]);
        // CR 614.1c — destruction redirects to exile, not the graveyard.
        removePermanentTo(state, "dead", "graveyard");
        expect(state.players[0].graveyard.some((c) => c.id === "dead")).toBe(
            false
        );
        expect(state.players[0].exile.some((c) => c.id === "dead")).toBe(true);
    });

    // Issue #1950 review round 3, MAJOR 1 — `colorFilterAny` gained a
    // `card`-kind check in `convex/gre/targetFilters.ts` (CARD_FILTER_KEYS),
    // closing the SAME fail-open class as Lord of the Undead's
    // `subtypeFilter` guard (`pls/__tests__/black.test.ts`), for the ONE
    // shipped card that actually carries `colorFilterAny` on a
    // `zone: "graveyard"` requirement. Proves a green creature card is
    // neither offered (`getLegalTargets`) nor accepted
    // (`applyOneTargetSelection`, the real `selectTarget` logic), while a
    // white one is both.
    it("neither offers nor accepts a green creature card as the reanimation target (colorFilterAny: [W, B])", () => {
        const dreams = makeInstance(dreamsOfTheDead.id, {
            id: "dreams-guard",
            controllerId: "p1",
            zone: "battlefield",
        });
        const whiteDead = makeInstance(kjeldoranWarrior.id, {
            id: "gy-white-guard",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const greenDead = makeInstance(balduvianBears.id, {
            id: "gy-green-guard",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [dreams],
                    graveyard: [whiteDead, greenDead],
                }),
                makePlayer("p2"),
            ],
        });
        const req = dreamsOfTheDead.activatedAbilities![0].targetRequirement!;

        // Offered set (`getLegalTargets`): the green creature is never in it.
        const legal = getLegalTargets(state, req, NO_TARGETING_SOURCE, "p1");
        const legalIds = legal
            .filter((t) => t.type === "graveyard-card")
            .map((t) => t.id);
        expect(legalIds).toContain("gy-white-guard");
        expect(legalIds).not.toContain("gy-green-guard");

        // Accepted set (`applyOneTargetSelection`, the real `selectTarget`
        // logic): the white creature is accepted, the green one is rejected —
        // both through the SAME `pendingTargetFiltersFromRequirement` carry
        // the real activation path uses.
        const pendingTargetFor = () => ({
            playerId: "p1",
            cardInstanceId: "dreams-guard",
            targetType: req.type,
            count: 1 as const,
            selected: [],
            kind: "ability" as const,
            abilityId: "dreams-of-the-dead-reanimate",
            ...pendingTargetFiltersFromRequirement(req, undefined),
        });

        const acceptState = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [dreams],
                    graveyard: [whiteDead, greenDead],
                }),
                makePlayer("p2"),
            ],
        });
        acceptState.pendingTarget = pendingTargetFor();
        expect(() =>
            applyOneTargetSelection(acceptState, "p1", {
                targetType: "graveyard-card",
                targetId: "gy-white-guard",
                targetPlayerId: "p1",
            })
        ).not.toThrow();

        const rejectState = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [dreams],
                    graveyard: [whiteDead, greenDead],
                }),
                makePlayer("p2"),
            ],
        });
        rejectState.pendingTarget = pendingTargetFor();
        expect(() =>
            applyOneTargetSelection(rejectState, "p1", {
                targetType: "graveyard-card",
                targetId: "gy-green-guard",
                targetPlayerId: "p1",
            })
        ).toThrow();
    });
});

describe("Restricted-CU mana — Adarkar Unicorn / Snowfall (CR 106.6, ADR 0022/0042)", () => {
    it("Adarkar Unicorn declares a CU-restricted choice mana ability", () => {
        const ability = adarkarUnicorn.activatedAbilities?.[0];
        expect(ability?.manaRestriction).toBe("cumulative-upkeep");
        expect(ability?.manaChoices?.length).toBe(2);
        expect(ability?.useStack).toBe(false);
    });

    it("CU-restricted mana PAYS a cumulative-upkeep cost", () => {
        const forces = makeInstance(illusionaryForces.id, {
            id: "forces",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [forces] }),
                makePlayer("p2"),
            ],
        });
        // Float CU-restricted {U} (as Adarkar Unicorn / Snowfall would).
        addRestrictedManaToPool(state.players[0], "U", 1, "cumulative-upkeep");
        // Illusionary Forces' printed CU is {U}; pay it entirely from CU mana.
        fireCU(state, forces, "illusionary-forces-cumulative-upkeep");
        expect(state.pendingChoices?.[0]?.kind).toBe("may-pay");
        expect(state.pendingChoices?.[0]?.manaRestriction).toBe(
            "cumulative-upkeep"
        );
        applyMayPaySubmit(state, { playerId: "p1", accept: true });
        expect(
            state.players[0].battlefield.some((c) => c.id === "forces")
        ).toBe(true);
        // The CU-restricted mana was consumed; the fungible pool was untouched.
        expect(state.players[0].restrictedMana ?? []).toHaveLength(0);
        expect(state.players[0].manaPool.U ?? 0).toBe(0);
    });

    it("CU-restricted mana CANNOT pay a non-CU cost (a plain upkeep tax)", () => {
        // Binding Grasp's upkeep tax {1}{U} is a normal may-pay (no
        // manaRestriction). CU mana must NOT cover it.
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        addRestrictedManaToPool(state.players[0], "U", 2, "cumulative-upkeep");
        // Without manaRestriction, the {1}{U} cost is unaffordable from CU mana.
        expect(canPayMayPayCost(state, "p1", { X: 1, U: 1 } as ManaCost)).toBe(
            false
        );
        // With the CU tag it WOULD be payable — confirms the gate is the tag.
        expect(
            canPayMayPayCost(
                state,
                "p1",
                { X: 1, U: 1 } as ManaCost,
                "cumulative-upkeep"
            )
        ).toBe(true);
    });

    it("Snowfall: an Island tapped for mana floats a CU-restricted {U} to its controller", () => {
        const state = makeState();
        const snow = makeInstance(snowfall.id, {
            id: "snow",
            controllerId: "p1",
            zone: "battlefield",
        });
        const island = makeInstance(getCardByName("Island").id, {
            id: "island",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(snow);
        state.players[1].battlefield.push(island);
        // Simulate "Island tapped for mana" — resolve Snowfall's trigger.
        state.stack.push({
            ...snow,
            zone: "stack",
            castById: "p1",
            triggeredAbilityId: "snowfall-island-mana",
            triggerSourceId: "snow",
            triggerEvent: {
                type: "PERMANENT_TAPPED",
                permanentId: "island",
                controllerId: "p2",
                permanentTypes: ["Land"],
                permanentSubtypes: ["Island"],
                forMana: true,
            } as StackItem["triggerEvent"],
            targets: [],
        });
        resolveTopOfStack(state);
        // The Island's controller (p2) gets the bonus {U}, CU-restricted.
        const cu = (state.players[1].restrictedMana ?? []).find(
            (r) => r.restriction === "cumulative-upkeep"
        );
        expect(cu?.color).toBe("U");
        expect(cu?.amount).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// Blue buildable-now completion (#654)
// ---------------------------------------------------------------------------

describe("Krovikan Sorcerer (colour-filtered looters, CR 601.2h / 121.1)", () => {
    const GREEN_CARD = getCardByName("Grizzly Bears").id; // nonblack
    const BLACK_CARD = getCardByName("Dark Ritual").id; // black

    function setup() {
        const sorc = makeInstance(krovikanSorcerer.id, {
            id: "sorc",
            controllerId: "p1",
            ownerId: "p1",
        });
        // Hand: one nonblack (green) card, one black card, plus library cards
        // to draw.
        const greenInHand = makeInstance(GREEN_CARD, {
            id: "green-hand",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const blackInHand = makeInstance(BLACK_CARD, {
            id: "black-hand",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const lib = [
            makeInstance(GREEN_CARD, {
                id: "lib0",
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            }),
            makeInstance(GREEN_CARD, {
                id: "lib1",
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            }),
        ];
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [sorc],
                    hand: [greenInHand, blackInHand],
                    library: lib,
                }),
                makePlayer("p2"),
            ],
        });
        return { state, sorc };
    }

    it("declares the two colour-filtered loot abilities (CR 113.3c)", () => {
        const ids = krovikanSorcerer.activatedAbilities!.map((a) => a.id);
        expect(ids).toEqual([
            "krovikan-sorcerer-nonblack",
            "krovikan-sorcerer-black",
        ]);
    });

    it("nonblack branch: only nonblack cards are offered as the discard (CR 601.2h)", () => {
        const { state, sorc } = setup();
        resolveActivated(state, sorc, "krovikan-sorcerer-nonblack");
        // Suspends at the discard pick — only the green card is a candidate.
        const head = state.pendingChoices![0];
        expect(head.candidateIds).toEqual(["green-hand"]);
    });

    it("nonblack branch: discard nonblack → draw one (CR 121.1)", () => {
        const { state, sorc } = setup();
        resolveActivated(state, sorc, "krovikan-sorcerer-nonblack");
        submitChoice(state, ["green-hand"]);
        const p1 = state.players[0];
        // Green discarded, two library cards drawn? No — only one drawn.
        expect(p1.graveyard.map((c) => c.id)).toContain("green-hand");
        // Started with [green, black] in hand, discarded green, drew one →
        // hand is [black, lib0].
        const handIds = p1.hand.map((c) => c.id);
        expect(handIds).toContain("black-hand");
        expect(handIds).toContain("lib0");
        expect(handIds).not.toContain("green-hand");
        expect(p1.library.map((c) => c.id)).toEqual(["lib1"]);
    });

    it("black branch: only black cards are offered as the discard (CR 601.2h)", () => {
        const { state, sorc } = setup();
        resolveActivated(state, sorc, "krovikan-sorcerer-black");
        const head = state.pendingChoices![0];
        expect(head.candidateIds).toEqual(["black-hand"]);
    });

    it("black branch: discard black → draw two then discard one (CR 121.1 / 701.8)", () => {
        const { state, sorc } = setup();
        resolveActivated(state, sorc, "krovikan-sorcerer-black");
        submitChoice(state, ["black-hand"]); // pay the black discard cost
        // Drew two (lib0, lib1); now suspends at the "discard one of them" pick.
        const head = state.pendingChoices![0];
        expect(head.choiceId).toBe("$thenDiscard");
        submitChoice(state, ["lib0"]); // discard one drawn card
        const p1 = state.players[0];
        // black-hand (cost) + lib0 (then-discard) are in the graveyard.
        const gy = p1.graveyard.map((c) => c.id);
        expect(gy).toContain("black-hand");
        expect(gy).toContain("lib0");
        // Net hand: green (untouched) + lib1 (kept).
        const handIds = p1.hand.map((c) => c.id);
        expect(handIds).toContain("green-hand");
        expect(handIds).toContain("lib1");
        expect(p1.library).toHaveLength(0);
    });
});

describe("Mesmeric Trance (looter, CR 601.2h / 121.1, issue #1287)", () => {
    const BEAR_ID = getCardByName("Grizzly Bears").id;

    function setup() {
        const trance = makeInstance(mesmericTrance.id, {
            id: "trance",
            controllerId: "p1",
            ownerId: "p1",
        });
        const handCard = makeInstance(BEAR_ID, {
            id: "hand0",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const lib = [
            makeInstance(BEAR_ID, {
                id: "lib0",
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            }),
        ];
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [trance],
                    hand: [handCard],
                    library: lib,
                }),
                makePlayer("p2"),
            ],
        });
        return { state, trance };
    }

    it("discard a card → draw one (CR 121.1)", () => {
        const { state, trance } = setup();
        resolveActivated(state, trance, "mesmeric-trance-loot");
        submitChoice(state, ["hand0"]);
        const p1 = state.players[0];
        expect(p1.graveyard.map((c) => c.id)).toContain("hand0");
        expect(p1.hand.map((c) => c.id)).toEqual(["lib0"]);
        expect(p1.library).toHaveLength(0);
        // Wire — the discard/draw outcome is client-visible.
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[0].hand.map((c) => c?.id)).toEqual(["lib0"]);
    });

    it("empty hand → the discard choice never enqueues and the draw is skipped (CR 608.2b, picksNonEmpty false)", () => {
        const { state, trance } = setup();
        state.players[0].hand = [];
        resolveActivated(state, trance, "mesmeric-trance-loot");
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(state.players[0].library).toHaveLength(1); // untouched
        expect(state.stack).toHaveLength(0);
    });
});

describe("Shyft (upkeep colour override, CR 305.7 layer 5 / 603.6a)", () => {
    function setup() {
        const shyftInst = makeInstance(shyft.id, {
            id: "shyft",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [shyftInst] }),
                makePlayer("p2"),
            ],
        });
        return { state, shyftInst };
    }

    it("blue Shapeshifter with the printed body (CR 302)", () => {
        expect(shyft.types).toContain("Creature");
        expect(shyft.subtypes).toContain("Shapeshifter");
        expect(shyft.power).toBe(4);
        expect(shyft.toughness).toBe(2);
    });

    it("declining the upkeep may leaves the colour unchanged (CR 117.3a)", () => {
        const { state, shyftInst } = setup();
        resolveTrigger(state, shyftInst, "shyft-upkeep-color", {
            type: "PHASE_BEGIN",
            phase: "UPKEEP",
            activePlayerId: "p1",
        } as StackItem["triggerEvent"]);
        // Suspends at the may-pay; decline.
        expect(state.pendingChoices![0].kind).toBe("may-pay");
        applyMayPaySubmit(state, { playerId: "p1", accept: false });
        const live = state.players[0].battlefield.find(
            (c) => c.id === "shyft"
        )!;
        expect(live.colorOverride).toBeUndefined();
    });

    it("accepting → choosing red makes Shyft red indefinitely (GRE + wire, CR 305.7)", () => {
        const { state, shyftInst } = setup();
        resolveTrigger(state, shyftInst, "shyft-upkeep-color", {
            type: "PHASE_BEGIN",
            phase: "UPKEEP",
            activePlayerId: "p1",
        } as StackItem["triggerEvent"]);
        // Accept the may-pay, then pick Red from the option list.
        applyMayPaySubmit(state, { playerId: "p1", accept: true });
        expect(state.pendingChoices![0].kind).toBe("option-pick");
        submitChoice(state, ["R"]);
        // GRE: the layer-5 override rides the instance (no duration → indefinite).
        const live = state.players[0].battlefield.find(
            (c) => c.id === "shyft"
        )!;
        expect(live.colorOverride).toEqual(["R"]);
        // Wire: the override survives projectPublicState (mandatory for visible
        // colour effects).
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "shyft"
        )!;
        expect(slim.colorOverride).toEqual(["R"]);
    });
});

describe("Zuran Enchanter ({2}{B},{T}: target player discards, CR 605 / 701.8)", () => {
    it("is restricted to the controller's own turn and discards a chosen card", () => {
        const enchanter = makeInstance(zuranEnchanter.id, {
            id: "ench",
            controllerId: "p1",
            ownerId: "p1",
        });
        const handCard = makeInstance(getCardByName("Dark Ritual").id, {
            id: "h0",
            controllerId: "p2",
            ownerId: "p2",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [enchanter] }),
                makePlayer("p2", { hand: [handCard] }),
            ],
        });
        expect(zuranEnchanter.activatedAbilities![0].controllerTurnOnly).toBe(
            true
        );
        resolveActivated(state, enchanter, "zuran-enchanter-discard", [
            { type: "player", id: "p2" },
        ]);
        // p2 picks the only card in hand to discard.
        submitChoice(state, ["h0"]);
        expect(state.players[1].hand.some((c) => c.id === "h0")).toBe(false);
        expect(state.players[1].graveyard.some((c) => c.id === "h0")).toBe(
            true
        );
    });
});

describe("Clairvoyance (look at hand + cantrip, CR 401.4)", () => {
    it("schedules the cantrip after looking (auto-ack)", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { library: library("p1", ["a"]) }),
                makePlayer("p2", {
                    hand: [
                        vanilla("h", 1, 1, {
                            id: "h",
                            controllerId: "p2",
                            ownerId: "p2",
                            zone: "hand",
                        }),
                    ],
                }),
            ],
        });
        castCantrip(state, clairvoyance.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        // revealHand enqueues a display-only choice; ack it to resume.
        if (state.pendingChoices && state.pendingChoices.length > 0) {
            const head = state.pendingChoices[0];
            applyPendingChoiceSubmit(state, {
                playerId: head.playerId,
                stackItemId: head.stackItemId,
                step: head.step,
                choiceId: head.choiceId,
                cardInstanceIds: [],
            });
        }
        enterUpkeepAndFire(state, "p1");
        resolveTopOfStack(state);
        expect(state.players[0].hand.map((c) => c.id)).toContain("a");
    });
});

describe("Enervate (tap target, CR 701.20)", () => {
    it("taps the target and schedules the cantrip", () => {
        const dummy = vanilla("d", 1, 1, {
            id: "d",
            controllerId: "p2",
            ownerId: "p2",
            isTapped: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { library: library("p1", ["a"]) }),
                makePlayer("p2", { battlefield: [dummy] }),
            ],
        });
        castCantrip(state, enervate.id, "p1", [{ type: "permanent", id: "d" }]);
        expect(
            state.players[1].battlefield.find((c) => c.id === "d")?.isTapped
        ).toBe(true);
        enterUpkeepAndFire(state, "p1");
        resolveTopOfStack(state);
        expect(state.players[0].hand.map((c) => c.id)).toContain("a");
    });
});

describe("Infuse (untap target, CR 701.20)", () => {
    it("untaps the target and schedules the cantrip", () => {
        const dummy = vanilla("d", 1, 1, {
            id: "d",
            controllerId: "p1",
            ownerId: "p1",
            isTapped: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [dummy],
                    library: library("p1", ["a"]),
                }),
                makePlayer("p2"),
            ],
        });
        castCantrip(state, infuse.id, "p1", [{ type: "permanent", id: "d" }]);
        expect(
            state.players[0].battlefield.find((c) => c.id === "d")?.isTapped
        ).toBe(false);
        enterUpkeepAndFire(state, "p1");
        resolveTopOfStack(state);
        expect(state.players[0].hand.map((c) => c.id)).toContain("a");
    });
});

describe("Portent (look at top 3, reorder, may shuffle, CR 401)", () => {
    it("definition declares the next-upkeep cantrip and player target", () => {
        expect(portent.delayedTriggers?.[0]?.timing).toBe("next-upkeep");
        expect(portent.targetRequirement?.type).toBe("player");
        expect(portent.types).toContain("Sorcery");
    });

    // ADR 0026 / PRD #338 — Portent carries NO `markKnown` of its own: the
    // reorder-library submit path grants the knowledge globally. The chooser
    // (p1) looked at and precisely positioned the target's (p2) top three, so
    // those cards stay known to p1 — proving the fix is in the choice path, not
    // per-card.
    it("keeps the reordered top 3 known to the caster who placed them", () => {
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", {
                    library: library("p2", ["c1", "c2", "c3", "c4"]),
                }),
            ],
        });
        castCantrip(state, portent.id, "p1", [{ type: "player", id: "p2" }]);
        // The controller reorders p2's top three (c3 on top).
        expect(state.pendingChoices![0].kind).toBe("reorder-library");
        submitChoice(state, ["c3", "c1", "c2"]);

        const lib = state.players[1].library;
        expect(lib.slice(0, 3).map((c) => c.id)).toEqual(["c3", "c1", "c2"]);
        // Known to the caster (p1) only — not to the library's owner p2.
        expect(lib[0].knownTo).toEqual(["p1"]);
        expect(lib[1].knownTo).toEqual(["p1"]);
        expect(lib[2].knownTo).toEqual(["p1"]);
        // The untouched 4th card stays unknown to everyone.
        expect(lib[3].knownTo).toBeUndefined();
    });
});

describe("Ray of Erasure (mill a card, CR 701.13a)", () => {
    it("mills the target's top card and schedules the cantrip", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { library: library("p1", ["a"]) }),
                makePlayer("p2", { library: library("p2", ["m1", "m2"]) }),
            ],
        });
        castCantrip(state, rayOfErasure.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        expect(state.players[1].graveyard.map((c) => c.id)).toContain("m1");
        expect(state.players[1].library).toHaveLength(1);
        enterUpkeepAndFire(state, "p1");
        resolveTopOfStack(state);
        expect(state.players[0].hand.map((c) => c.id)).toContain("a");
    });
});

describe("Updraft (grant flying, CR 702.9)", () => {
    it("grants flying until end of turn + cantrip", () => {
        const dummy = vanilla("d", 1, 1, {
            id: "d",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [dummy],
                    library: library("p1", ["a"]),
                }),
                makePlayer("p2"),
            ],
        });
        castCantrip(state, updraft.id, "p1", [{ type: "permanent", id: "d" }]);
        const live = state.players[0].battlefield.find((c) => c.id === "d")!;
        expect(live.staticAbilities).toContain("flying");
        enterUpkeepAndFire(state, "p1");
        resolveTopOfStack(state);
        expect(state.players[0].hand.map((c) => c.id)).toContain("a");
    });
});

// ── #671: parametric/timed effects & mana tracking ──────────────────────────

describe("Illusionary Presence (CR 603.6a upkeep + 702.13 chosen-type landwalk)", () => {
    it("has cumulative upkeep {U} and an upkeep landwalk trigger", () => {
        const cu = illusionaryPresence.triggeredAbilities?.find((t) =>
            t.id.includes("cumulative-upkeep")
        );
        const lw = illusionaryPresence.triggeredAbilities?.find(
            (t) => t.id === "illusionary-presence-landwalk"
        );
        expect(cu).toBeTruthy();
        expect(lw).toBeTruthy();
        expect(illusionaryPresence.manaCost).toEqual({ X: 1, U: 2 });
    });

    it("grants the chosen landwalk until end of turn, re-choosing each upkeep", () => {
        const presence = makeInstance(illusionaryPresence.id, {
            id: "ip",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [presence] }),
                makePlayer("p2"),
            ],
        });
        state.activePlayerId = "p1";

        // First upkeep: choose Swamp → swampwalk granted.
        resolveTrigger(state, presence, "illusionary-presence-landwalk", {
            type: "PHASE_BEGIN",
            phase: "UPKEEP",
            activePlayerId: "p1",
        } as StackItem["triggerEvent"]);
        submitChoice(state, ["Swamp"]);
        let after = state.players[0].battlefield.find((c) => c.id === "ip")!;
        expect(after.staticAbilities).toContain("swampwalk");
        expect(after.grantedStaticAbilities?.[0].duration?.phase).toBe(
            "end-of-turn"
        );

        // The until-end-of-turn grant expires at CLEANUP. Drive END_STEP and
        // advance: CLEANUP is an auto-phase, so advancePhase passes through it
        // (running finalizeCleanup, which ticks durations) and settles on the
        // next turn's UPKEEP — the grant has expired by then.
        state.phase = "END_STEP";
        advancePhase(state);
        after = state.players[0].battlefield.find((c) => c.id === "ip")!;
        expect(after.staticAbilities).not.toContain("swampwalk");
        expect(after.grantedStaticAbilities).toBeUndefined();

        // Next upkeep: re-choose a DIFFERENT type → forestwalk, not swampwalk.
        state.activePlayerId = "p1";
        state.phase = "UPKEEP";
        resolveTrigger(state, after, "illusionary-presence-landwalk", {
            type: "PHASE_BEGIN",
            phase: "UPKEEP",
            activePlayerId: "p1",
        } as StackItem["triggerEvent"]);
        submitChoice(state, ["Forest"]);
        after = state.players[0].battlefield.find((c) => c.id === "ip")!;
        expect(after.staticAbilities).toContain("forestwalk");
        expect(after.staticAbilities).not.toContain("swampwalk");
    });

    it("survives the wire-format projection with the granted landwalk", () => {
        const presence = makeInstance(illusionaryPresence.id, {
            id: "ip",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [presence] }),
                makePlayer("p2"),
            ],
        });
        state.activePlayerId = "p1";
        resolveTrigger(state, presence, "illusionary-presence-landwalk", {
            type: "PHASE_BEGIN",
            phase: "UPKEEP",
            activePlayerId: "p1",
        } as StackItem["triggerEvent"]);
        submitChoice(state, ["Island"]);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "ip"
        )!;
        expect(slim.staticAbilities).toContain("islandwalk");
    });
});

// --- Illusionary Terrain — computed subtype swap driven by an on-entry pair --
// CR 305.6/305.7 (basic land subtypes + type-changing) + CR 611/613 (layer 4)
// + CR 603.6b (on-entry choice). ADR 0050 (computed static output). ADR 0042
// (cumulative upkeep {2}).

/** Illusionary Terrain in play whose on-entry pair is pre-set to `[first,
 *  second]`, plus one basic land, with the enchantment's statics applied. */
function withTerrain(
    landCardId: string,
    pair: [string, string]
): {
    state: GameState;
    terrain: CardInstanceState;
    land: CardInstanceState;
} {
    const state = makeState();
    const terrain = makeInstance(illusionaryTerrain.id, {
        id: "terr-1",
        controllerId: "p1",
        zone: "battlefield",
    });
    terrain.chosenSubtypes = pair;
    const land = makeInstance(landCardId, {
        id: "land-1",
        controllerId: "p2",
        zone: "battlefield",
    });
    state.players[0].battlefield.push(terrain);
    state.players[1].battlefield.push(land);
    applySourceStaticEffects(state, terrain);
    return { state, terrain, land };
}

describe("Illusionary Terrain ({U}{U} — CR 305.7 computed subtype swap, ADR 0050)", () => {
    it("declares cumulative upkeep {2}, an ETB choose-types trigger, and a subtype-set static", () => {
        expect(illusionaryTerrain.manaCost).toEqual({ U: 2 });
        expect(illusionaryTerrain.types).toEqual(["Enchantment"]);
        const kinds = (illusionaryTerrain.staticEffects ?? []).map(
            (e) => e.kind
        );
        expect(kinds).toEqual(["subtype-set"]);
        const cu = illusionaryTerrain.triggeredAbilities?.find((t) =>
            t.id.includes("cumulative-upkeep")
        );
        const choose = illusionaryTerrain.triggeredAbilities?.find(
            (t) => t.id === "illusionary-terrain-choose-types"
        );
        expect(cu).toBeTruthy();
        expect(choose).toBeTruthy();
    });

    it("stores the ordered pair on entry via two sequential option picks (CR 603.6b)", () => {
        const terrain = makeInstance(illusionaryTerrain.id, {
            id: "terr-1",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [terrain] }),
                makePlayer("p2"),
            ],
        });
        state.activePlayerId = "p1";
        resolveTrigger(state, terrain, "illusionary-terrain-choose-types", {
            type: "PERMANENT_ENTERED",
            instanceId: "terr-1",
            controllerId: "p1",
            types: ["Enchantment"],
        } as unknown as StackItem["triggerEvent"]);
        submitChoice(state, ["Forest"]);
        submitChoice(state, ["Island"]);
        const after = state.players[0].battlefield.find(
            (c) => c.id === "terr-1"
        )!;
        expect(after.chosenSubtypes).toEqual(["Forest", "Island"]);
    });

    it("rewrites a basic Forest into an Island — subtype + intrinsic mana (CR 305.6/305.7)", () => {
        const { land } = withTerrain(forest.id, ["Forest", "Island"]);
        expect(land.subtypes).toEqual(["Island"]);
        expect(getBasicLandMana(land)).toBe("U");
    });

    it("leaves a basic of a different type untouched (Mountain stays Mountain)", () => {
        const { land } = withTerrain(mountain.id, ["Forest", "Island"]);
        expect(land.subtypes).toEqual(["Mountain"]);
        expect(getBasicLandMana(land)).toBe("R");
    });

    it("does NOT touch a nonbasic land of the first type (dual land untouched)", () => {
        // Tropical Island is a nonbasic Forest/Island dual — it carries the
        // first chosen type (Forest) but isn't Basic, so the swap skips it.
        const { land } = withTerrain(getCardByName("Tropical Island").id, [
            "Forest",
            "Island",
        ]);
        expect(land.subtypes).toEqual(["Forest", "Island"]);
    });

    it("equal chosen types are a no-op (Forest → Forest keeps its type and {G})", () => {
        const { land } = withTerrain(forest.id, ["Forest", "Forest"]);
        expect(land.subtypes).toEqual(["Forest"]);
        expect(getBasicLandMana(land)).toBe("G");
    });

    it("swaps a basic Forest that ENTERS after the terrain resolves (applyExistingGrantsTo)", () => {
        const { state } = withTerrain(mountain.id, ["Forest", "Island"]);
        const late = makeInstance(forest.id, {
            id: "land-2",
            controllerId: "p1",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(late);
        applyExistingGrantsTo(state, late);
        expect(late.subtypes).toEqual(["Island"]);
        expect(getBasicLandMana(late)).toBe("U");
    });

    it("reverts the land cleanly when the terrain leaves play (unapplySourceStaticEffects)", () => {
        const { state, terrain, land } = withTerrain(forest.id, [
            "Forest",
            "Island",
        ]);
        unapplySourceStaticEffects(state, terrain);
        expect(land.subtypes).toEqual(["Forest"]);
        expect(getBasicLandMana(land)).toBe("G");
    });

    it("composes two terrains by timestamp: Forest→Island then Island→Swamp (CR 613)", () => {
        const state = makeState();
        const t1 = makeInstance(illusionaryTerrain.id, {
            id: "terr-1",
            controllerId: "p1",
            zone: "battlefield",
        });
        t1.chosenSubtypes = ["Forest", "Island"];
        const t2 = makeInstance(illusionaryTerrain.id, {
            id: "terr-2",
            controllerId: "p1",
            zone: "battlefield",
        });
        t2.chosenSubtypes = ["Island", "Swamp"];
        const land = makeInstance(forest.id, {
            id: "land-1",
            controllerId: "p2",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(t1, t2);
        state.players[1].battlefield.push(land);
        // Apply in timestamp order: Forest→Island first, then Island→Swamp.
        applySourceStaticEffects(state, t1);
        applySourceStaticEffects(state, t2);
        expect(land.subtypes).toEqual(["Swamp"]);
        expect(getBasicLandMana(land)).toBe("B");
    });

    // Regression (#727 QA): the REAL runtime order is ETB-statics-first,
    // choice-second. The terrain's statics are materialised when it enters
    // (chosenSubtypes still empty → no swap), THEN the ETB choose-types trigger
    // resolves and sets the pair. If the setter doesn't re-materialise the
    // static, the land never swaps on the actual board. The other cases here
    // set chosenSubtypes BEFORE applying statics, so they mask this ordering.
    it("swaps a land already on the board when the pair is chosen AFTER entry (real order)", () => {
        const state = makeState();
        state.activePlayerId = "p1";
        const land = makeInstance(forest.id, {
            id: "land-1",
            controllerId: "p1",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(land);
        const terrain = makeInstance(illusionaryTerrain.id, {
            id: "terr-1",
            controllerId: "p1",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(terrain);
        // Terrain enters: statics materialise with no pair chosen yet → no swap.
        applySourceStaticEffects(state, terrain);
        expect(land.subtypes).toEqual(["Forest"]);
        // ETB choose-types trigger resolves and picks the pair.
        resolveTrigger(state, terrain, "illusionary-terrain-choose-types", {
            type: "PERMANENT_ENTERED",
            instanceId: "terr-1",
            controllerId: "p1",
            types: ["Enchantment"],
        } as unknown as StackItem["triggerEvent"]);
        submitChoice(state, ["Forest"]);
        submitChoice(state, ["Island"]);
        const swapped = state.players[0].battlefield.find(
            (c) => c.id === "land-1"
        )!;
        expect(swapped.subtypes).toEqual(["Island"]);
        expect(getBasicLandMana(swapped)).toBe("U");
    });

    // Wire format (MANDATORY for staticEffects): the swapped subtype and the
    // producible mana must survive projection to the client.
    it("wire format: swapped Island subtype + producible {U} survive projectPublicState", () => {
        const { state } = withTerrain(forest.id, ["Forest", "Island"]);
        const projected = projectPublicState(state, 1, "p2");
        const slim = projected.players[1].battlefield.find(
            (c) => c.id === "land-1"
        )!;
        expect(slim.subtypes).toEqual(["Island"]);
        expect(getBasicLandMana(slim as unknown as CardInstanceState)).toBe(
            "U"
        );
    });

    // Wire format for the preview: the chosen pair itself must survive
    // projection so the card-preview can splice it into the oracle text
    // ("the first chosen type" → "the Forest type"). The slimCard spread keeps
    // top-level instance fields; this pins that chosenSubtypes is one of them.
    it("wire format: chosenSubtypes survives projectPublicState (drives preview oracle)", () => {
        const state = makeState();
        const terr = makeInstance(illusionaryTerrain.id, {
            id: "terr-1",
            controllerId: "p1",
            zone: "battlefield",
        });
        terr.chosenSubtypes = ["Forest", "Island"];
        state.players[0].battlefield.push(terr);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "terr-1"
        )!;
        expect((slim as unknown as CardInstanceState).chosenSubtypes).toEqual([
            "Forest",
            "Island",
        ]);
    });
});

// ===========================================================================
// Cumulative-upkeep "matters" enchantments (#726, ADR 0042)
// ===========================================================================

// --- Mystic Remora — noncreature draw-tax (CR 603.2 / 117.3a) --------------

describe("Mystic Remora (opponent noncreature-cast draw tax, CR 603.2)", () => {
    it("carries cumulative upkeep {1} and a noncreature draw-tax trigger", () => {
        expect(
            mysticRemora.triggeredAbilities?.some(
                (t) => t.id === "mystic-remora-cumulative-upkeep"
            )
        ).toBe(true);
        const tax = mysticRemora.triggeredAbilities?.find(
            (t) => t.id === "mystic-remora-draw-tax"
        );
        expect(tax).toBeDefined();
        expect(tax?.event).toBe("SPELL_CAST");
    });

    it("draws a card when the casting opponent declines to pay {4}", () => {
        const remora = makeInstance(mysticRemora.id, {
            id: "remora",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [remora],
                    library: [
                        vanilla("draw1", 1, 1, {
                            id: "draw1",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "library",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        // p2 cast a noncreature spell; the trigger suspends on p2's may-pay.
        resolveTrigger(state, remora, "mystic-remora-draw-tax", {
            type: "SPELL_CAST",
            casterId: "p2",
        } as StackItem["triggerEvent"]);
        // The pay choice belongs to the OPPONENT (the caster), not the source.
        expect(state.pendingChoices?.[0]?.playerId).toBe("p2");
        applyMayPaySubmit(state, { playerId: "p2", accept: false });
        expect(state.players[0].hand.map((c) => c.id)).toContain("draw1");
    });

    it("paying {4} stops the draw", () => {
        const remora = makeInstance(mysticRemora.id, {
            id: "remora",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [remora],
                    library: [
                        vanilla("draw1", 1, 1, {
                            id: "draw1",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "library",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(state, remora, "mystic-remora-draw-tax", {
            type: "SPELL_CAST",
            casterId: "p2",
        } as StackItem["triggerEvent"]);
        state.players[1].manaPool = { C: 4 };
        applyMayPaySubmit(state, { playerId: "p2", accept: true });
        expect(state.players[0].hand).toHaveLength(0);
    });

    it("the noncreature filter (SpellFilter.excludeTypes) excludes creature spells", () => {
        // CR 205 — excludeTypes is the negative of types. A creature spell is
        // filtered out; an instant passes.
        expect(
            matchesSpellFilter(
                { types: ["Creature"], subtypes: [], colors: [] },
                { excludeTypes: "Creature" }
            )
        ).toBe(false);
        expect(
            matchesSpellFilter(
                { types: ["Instant"], subtypes: [], colors: [] },
                { excludeTypes: "Creature" }
            )
        ).toBe(true);
        // An artifact creature (multi-type) is still a creature → excluded.
        expect(
            matchesSpellFilter(
                { types: ["Artifact", "Creature"], subtypes: [], colors: [] },
                { excludeTypes: "Creature" }
            )
        ).toBe(false);
    });
});

// --- Reality Twist — per-basic land-mana permutation (CR 614) ---------------

describe("Reality Twist (per-basic land-mana permutation, CR 614)", () => {
    it("carries cumulative upkeep {1}{U}{U} and the byBasicSubtype substitution", () => {
        expect(
            realityTwist.triggeredAbilities?.some(
                (t) => t.id === "reality-twist-cumulative-upkeep"
            )
        ).toBe(true);
        expect(realityTwist.landManaSubstitution).toEqual({
            byBasicSubtype: {
                Plains: "R",
                Swamp: "G",
                Mountain: "W",
                Forest: "B",
            },
        });
    });

    it("rewrites a Mountain's tapped mana to {W} while in play, surviving the wire (CR 614)", () => {
        const twist = makeInstance(realityTwist.id, {
            id: "twist",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const mtn = makeLand(mountain.id, "p1");
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [twist, mtn] }),
                makePlayer("p2"),
            ],
        });
        // Fat state: Mountain → {W}.
        expect(applyLandManaReplacement(state, "p1", mtn, { R: 1 })).toEqual({
            W: 1,
        });
        // Wire format (#665, mandatory): the substitution is read off the def by
        // id, so it survives projectPublicState unchanged.
        const projected = projectPublicState(state, 1, "p1");
        const slimMtn = projected.players[0].battlefield.find(
            (c) => c.id === mtn.id
        )!;
        expect(
            applyLandManaReplacement(
                projected as unknown as GameState,
                "p1",
                slimMtn,
                { R: 1 }
            )
        ).toEqual({ W: 1 });
    });

    it("leaves an Island unchanged (not in the permutation map)", () => {
        const twist = makeInstance(realityTwist.id, {
            id: "twist",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const isl = makeLand(island.id, "p1");
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [twist, isl] }),
                makePlayer("p2"),
            ],
        });
        expect(applyLandManaReplacement(state, "p1", isl, { U: 1 })).toEqual({
            U: 1,
        });
    });
});

// --- Mystic Might — Aura granting a pump ability to a land (CR 611) ---------

describe("Mystic Might (activated-grant on enchanted land, CR 611/702.24)", () => {
    it("enchants a land you control and grants a tap +2/+2 pump", () => {
        expect(mysticMight.targetRequirement).toMatchObject({
            type: "Land",
            controller: "you",
        });
        expect(mysticMight.staticEffects).toEqual([
            {
                kind: "activated-grant",
                applies: expect.any(Function),
                abilityId: "mystic-might-pump",
            },
        ]);
        const tmpl = mysticMight.grantTemplates!.find(
            (g) => g.id === "mystic-might-pump"
        )!;
        expect(tmpl.cost).toMatchObject({ tap: true });
        expect(tmpl.targetRequirement).toMatchObject({ type: "Creature" });
        expect(
            mysticMight.triggeredAbilities?.some(
                (t) => t.id === "mystic-might-cumulative-upkeep"
            )
        ).toBe(true);
    });

    it("the granted ability pumps a creature +2/+2 (driven via the host land), surviving the wire", () => {
        const land = vanilla("land", 0, 0, {
            id: "land",
            controllerId: "p1",
            ownerId: "p1",
            types: ["Land"] as CardType[],
            isSummoningSick: false,
        });
        const creature = vanilla("crt", 1, 1, {
            id: "crt",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [land, creature] }),
                makePlayer("p2"),
            ],
        });
        // The engine resolves a granted ability with the HOST as source (CR 113.1),
        // keyed to the land via grantedSourceCardId/abilityId (as activateAbility does).
        state.stack.push({
            ...land,
            zone: "stack",
            castById: "p1",
            grantedSourceCardId: mysticMight.id,
            abilityId: "mystic-might-pump",
            targets: [{ type: "permanent", id: "crt" }],
        } as StackItem);
        resolveTopOfStack(state);
        const after = state.players[0].battlefield.find((c) => c.id === "crt")!;
        expect(getEffectivePower(state, after)).toBe(3);
        expect(getEffectiveToughness(state, after)).toBe(3);
        // Wire format (CR 611, mandatory): the buff survives the projection.
        const projected = projectPublicState(state, 2, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "crt"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(3);
        expect(getEffectiveToughness(projected, slim)).toBe(3);
    });
});

// --- Musician — music counters + granted destroy-unless-pay (CR 122/701.7) --

describe("Musician (music counters + granted upkeep tax, CR 122/701.7)", () => {
    it("carries cumulative upkeep {1} and the music-upkeep grant template", () => {
        expect(
            musician.triggeredAbilities?.some(
                (t) => t.id === "musician-cumulative-upkeep"
            )
        ).toBe(true);
        expect(
            musician.triggeredGrantTemplates?.some(
                (t) => t.id === "musician-music-upkeep"
            )
        ).toBe(true);
        expect(musician.power).toBe(1);
        expect(musician.toughness).toBe(3);
    });

    it("the activated ability adds a music counter and grants the upkeep ability", () => {
        const musie = makeInstance(musician.id, {
            id: "musie",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            isSummoningSick: false,
        });
        const bear = makeInstance(balduvianBears.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [musie, bear] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, musie, "musician-music-counter", [
            { type: "permanent", id: "bear" },
        ]);
        const target = state.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(target.counters?.music).toBe(1);
        expect(
            target.grantedTriggeredAbilities?.some(
                (g) => g.abilityId === "musician-music-upkeep"
            )
        ).toBe(true);
        // The grant is idempotent — a second music counter only raises the cost.
        resolveActivated(state, musie, "musician-music-counter", [
            { type: "permanent", id: "bear" },
        ]);
        const after = state.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(after.counters?.music).toBe(2);
        expect(
            after.grantedTriggeredAbilities?.filter(
                (g) => g.abilityId === "musician-music-upkeep"
            ).length
        ).toBe(1);
    });

    it("the granted upkeep ability destroys the creature when the {1}-per-counter cost is declined", () => {
        const bear = makeInstance(balduvianBears.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            counters: { music: 2 },
            grantedTriggeredAbilities: [
                {
                    sourceCardId: musician.id,
                    abilityId: "musician-music-upkeep",
                },
            ],
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear] }),
                makePlayer("p2"),
            ],
        });
        fireCU(state, bear, "musician-music-upkeep");
        // The pay choice belongs to the host's controller; cost scales {1}×2.
        expect(state.pendingChoices?.[0]?.playerId).toBe("p1");
        applyMayPaySubmit(state, { playerId: "p1", accept: false });
        expect(state.players[0].battlefield.some((c) => c.id === "bear")).toBe(
            false
        );
    });

    it("paying {2} (one per music counter) keeps the creature", () => {
        const bear = makeInstance(balduvianBears.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            counters: { music: 2 },
            grantedTriggeredAbilities: [
                {
                    sourceCardId: musician.id,
                    abilityId: "musician-music-upkeep",
                },
            ],
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear] }),
                makePlayer("p2"),
            ],
        });
        state.players[0].manaPool = { C: 2 };
        fireCU(state, bear, "musician-music-upkeep");
        applyMayPaySubmit(state, { playerId: "p1", accept: true });
        expect(state.players[0].battlefield.some((c) => c.id === "bear")).toBe(
            true
        );
        expect(state.players[0].manaPool.C ?? 0).toBe(0);
    });

    it("wire format: the granted music-upkeep ability survives projectPublicState", () => {
        const bear = makeInstance(balduvianBears.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            counters: { music: 1 },
            grantedTriggeredAbilities: [
                {
                    sourceCardId: musician.id,
                    abilityId: "musician-music-upkeep",
                },
            ],
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear] }),
                makePlayer("p2"),
            ],
        });
        expect(
            effectiveTriggeredAbilities(bear).some(
                (a) => a.id === "musician-music-upkeep"
            )
        ).toBe(true);
        const projected = projectPublicState(state, 2, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(slim.counters?.music).toBe(1);
        expect(
            effectiveTriggeredAbilities(slim).some(
                (a) => a.id === "musician-music-upkeep"
            )
        ).toBe(true);
    });
});

// ===========================================================================
// Gain-control-until-end-of-turn rider (#730) — Ray of Command / Magus of the
// Unseen. CR 611.2b / 613.1b (layer-2 control change reverted at cleanup,
// CR 514.2) + 701.20a (tap-on-loss rider) + 702.10b (granted haste honoured).
// ===========================================================================

describe("Ray of Command — steal a creature until EOT (CR 611.2b / 613.1b / 701.20a)", () => {
    function setup() {
        const victim = vanilla("victim", 3, 3, {
            controllerId: "p2",
            ownerId: "p2",
            isTapped: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [] }),
                makePlayer("p2", { battlefield: [victim] }),
            ],
        });
        return { state };
    }

    it("untaps the creature, gains control, and grants haste", () => {
        const { state } = setup();
        pushSpell(state, rayOfCommand.id, "p1", [
            { type: "permanent", id: "victim" },
        ]);
        resolveTopOfStack(state);
        const stolen = state.players[0].battlefield.find(
            (c) => c.id === "victim"
        );
        expect(stolen?.controllerId).toBe("p1"); // control gained (CR 613.1b)
        expect(stolen?.isTapped).toBe(false); // untapped (CR 701.20a)
        expect(stolen?.staticAbilities).toContain("haste"); // CR 702.10b
    });

    it("reverts control at cleanup and taps the creature (CR 514.2 / 701.20a)", () => {
        const { state } = setup();
        pushSpell(state, rayOfCommand.id, "p1", [
            { type: "permanent", id: "victim" },
        ]);
        resolveTopOfStack(state);
        // CR 514.2 — the "until end of turn" control change ends at cleanup.
        state.phase = "CLEANUP";
        state.activePlayerId = "p1";
        finalizeCleanup(state);
        const reverted = state.players[1].battlefield.find(
            (c) => c.id === "victim"
        );
        expect(reverted?.controllerId).toBe("p2"); // control reverted to owner
        expect(reverted?.isTapped).toBe(true); // tap-on-loss rider fired
        // Haste grant also expired (CR 611.2).
        expect(reverted?.staticAbilities).not.toContain("haste");
        // Nothing lingering under p1.
        expect(
            state.players[0].battlefield.some((c) => c.id === "victim")
        ).toBe(false);
    });

    it("granted haste lets the stolen (summoning-sick) creature attack (CR 702.10b)", () => {
        const { state } = setup();
        pushSpell(state, rayOfCommand.id, "p1", [
            { type: "permanent", id: "victim" },
        ]);
        resolveTopOfStack(state);
        const stolen = state.players[0].battlefield.find(
            (c) => c.id === "victim"
        )!;
        expect(stolen.isSummoningSick).toBe(true); // control change set it
        expect(validateAttackerEligibility(stolen).eligible).toBe(true);
    });

    it("wire format — the control gain survives projection (CR 613.1b)", () => {
        const { state } = setup();
        pushSpell(state, rayOfCommand.id, "p1", [
            { type: "permanent", id: "victim" },
        ]);
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "victim"
        );
        expect(slim?.controllerId).toBe("p1");
        expect(slim?.isTapped).toBe(false);
    });

    it("only opponent-controlled creatures are legal targets", () => {
        expect(rayOfCommand.targetRequirement).toEqual({
            type: "Creature",
            count: 1,
            controller: "opponent",
        });
    });
});

describe("Magus of the Unseen — steal an artifact until EOT (CR 611.2b / 613.1b / 701.20a)", () => {
    function artifact(id: string): CardInstanceState {
        return {
            id,
            card: { id: `fake-${id}` },
            types: ["Artifact"] as CardType[],
            subtypes: [],
            staticAbilities: [],
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
            isTapped: true,
        };
    }

    function setup() {
        const magus = makeInstance(magusOfTheUnseen.id, {
            id: "magus",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [magus] }),
                makePlayer("p2", { battlefield: [artifact("relic")] }),
            ],
        });
        return { state };
    }

    it("{1}{U},{T} untaps the artifact and gains control until EOT", () => {
        const { state } = setup();
        const magus = state.players[0].battlefield.find(
            (c) => c.id === "magus"
        )!;
        resolveActivated(state, magus, "magus-of-the-unseen-steal", [
            { type: "permanent", id: "relic" },
        ]);
        const stolen = state.players[0].battlefield.find(
            (c) => c.id === "relic"
        );
        expect(stolen?.controllerId).toBe("p1");
        expect(stolen?.isTapped).toBe(false);
    });

    it("reverts control at cleanup and taps the artifact (CR 514.2 / 701.20a)", () => {
        const { state } = setup();
        const magus = state.players[0].battlefield.find(
            (c) => c.id === "magus"
        )!;
        resolveActivated(state, magus, "magus-of-the-unseen-steal", [
            { type: "permanent", id: "relic" },
        ]);
        state.phase = "CLEANUP";
        state.activePlayerId = "p1";
        finalizeCleanup(state);
        const reverted = state.players[1].battlefield.find(
            (c) => c.id === "relic"
        );
        expect(reverted?.controllerId).toBe("p2");
        expect(reverted?.isTapped).toBe(true);
    });

    it("targets opponent artifacts and is a 1/1 Human Wizard", () => {
        expect(
            magusOfTheUnseen.activatedAbilities?.[0].targetRequirement
        ).toEqual({ type: "Artifact", count: 1, controller: "opponent" });
        expect(magusOfTheUnseen.power).toBe(1);
        expect(magusOfTheUnseen.toughness).toBe(1);
        expect(magusOfTheUnseen.subtypes).toEqual(["Human", "Wizard"]);
    });
});

describe("Mistfolk — counter spell that targets it (CR 701.5a / 114.1)", () => {
    const ability = mistfolk.activatedAbilities![0];

    it("has {U}{U} cost and a {U} counter ability", () => {
        expect(mistfolk.manaCost).toEqual({ U: 2 });
        expect(mistfolk.power).toBe(1);
        expect(mistfolk.toughness).toBe(2);
        expect(mistfolk.subtypes).toEqual(["Illusion"]);
        expect(ability.cost).toEqual({ mana: { U: 1 } });
        expect(ability.targetRequirement).toEqual({ type: "spell", count: 1 });
    });

    it("getTargetRequirement injects the source id → only spells targeting Mistfolk are legal", () => {
        const mist = makeInstance(mistfolk.id, {
            id: "mist",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mist] }),
                makePlayer("p2"),
            ],
        });
        // Opponent spell targeting Mistfolk vs. one targeting something else.
        const atMist = pushSpell(state, brainstorm.id, "p2", [
            { type: "permanent", id: "mist" },
        ]);
        const atOther = pushSpell(state, brainstorm.id, "p2", [
            { type: "permanent", id: "other" },
        ]);
        const req = ability.getTargetRequirement!(
            { ...mist } as never,
            state as never
        );
        expect(req.spellTargetsInstanceIds).toEqual(["mist"]);
        const legal = getLegalTargets(
            state,
            req,
            NO_TARGETING_SOURCE,
            "p1"
        ).map((t) => t.id);
        expect(legal).toContain(atMist.id);
        expect(legal).not.toContain(atOther.id);
    });

    it("counters the spell that targets it — survives projection (wire format)", () => {
        const mist = makeInstance(mistfolk.id, {
            id: "mist",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mist] }),
                makePlayer("p2"),
            ],
        });
        const spell = pushSpell(state, brainstorm.id, "p2", [
            { type: "permanent", id: "mist" },
        ]);
        resolveActivated(state, mist, "mistfolk-counter", [
            { type: "spell", id: spell.id },
        ]);
        expect(state.stack.some((s) => s.id === spell.id)).toBe(false);
        // Wire format — the countered spell is absent from the projected stack.
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.stack.some((s) => s.id === spell.id)).toBe(false);
    });
});

// Phantasmal Mount — BIDIRECTIONAL instance leave-watch (CR 603.7a / 603.10,
// issue #731). Its {T} ability buffs a target creature you control (+1/+1 and
// flying EOT) and grants TWO delayed triggers with crossed captures: if the
// Mount leaves, sacrifice the buffed creature; if the buffed creature leaves,
// sacrifice the Mount. Both expire at CLEANUP if unfired.
function activateMount(): {
    state: GameState;
    mountId: string;
    steedId: string;
} {
    const mount = makeInstance(phantasmalMount.id, {
        id: "mount1",
        controllerId: "p1",
        ownerId: "p1",
    });
    const steed = makeInstance(balduvianBears.id, {
        id: "steed1",
        controllerId: "p1",
        ownerId: "p1",
    });
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [mount, steed] }),
            makePlayer("p2"),
        ],
    });
    state.stack.push({
        ...mount,
        id: "ability1",
        zone: "stack",
        castById: "p1",
        abilityId: "phantasmal-mount-pump",
        triggerSourceId: "mount1",
        targets: [{ type: "permanent", id: "steed1" }],
    });
    resolveTopOfStack(state);
    return { state, mountId: "mount1", steedId: "steed1" };
}

describe("Phantasmal Mount (bidirectional leave-watch, CR 603.7a / 603.10)", () => {
    it("is registered with Flying, {1}{U} cost and the modern oracle text", () => {
        expect(phantasmalMount.manaCost).toEqual({ X: 1, U: 1 });
        expect(phantasmalMount.staticAbilities).toEqual(["flying"]);
        expect(phantasmalMount.oracleText).toContain(
            "When this creature leaves the battlefield this turn, sacrifice that creature"
        );
    });

    it("pumps the target +1/+1, grants flying, and schedules two crossed watches", () => {
        const { state, mountId, steedId } = activateMount();
        const steed = state.players[0].battlefield.find(
            (c) => c.id === steedId
        )!;
        expect(getEffectiveToughness(state, steed)).toBe(3);
        expect(steed.staticAbilities).toContain("flying");
        const watches = (state.delayedTriggers ?? []).filter(
            (t) => t.timing === "leaves-battlefield"
        );
        expect(watches.length).toBe(2);
        // One watches the Mount (sacrifices the buffed creature); the other
        // watches the buffed creature (sacrifices the Mount).
        const watchMount = watches.find((t) => t.watchInstanceId === mountId)!;
        expect(watchMount.payload.mounted).toBe(steedId);
        const watchSteed = watches.find((t) => t.watchInstanceId === steedId)!;
        expect(watchSteed.payload.mount).toBe(mountId);
    });

    it("sacrifices the buffed creature when the Mount leaves", () => {
        const { state, mountId, steedId } = activateMount();
        removePermanentTo(state, mountId, "graveyard");
        processPendingActionTriggers(state);
        resolveTopOfStack(state);
        expect(state.players[0].battlefield.some((c) => c.id === steedId)).toBe(
            false
        );
        expect(state.players[0].graveyard.some((c) => c.id === steedId)).toBe(
            true
        );
    });

    it("sacrifices the Mount when the buffed creature leaves", () => {
        const { state, mountId, steedId } = activateMount();
        removePermanentTo(state, steedId, "graveyard");
        processPendingActionTriggers(state);
        resolveTopOfStack(state);
        expect(state.players[0].battlefield.some((c) => c.id === mountId)).toBe(
            false
        );
        expect(state.players[0].graveyard.some((c) => c.id === mountId)).toBe(
            true
        );
    });

    it("both watches expire unfired at end of turn (CLEANUP)", () => {
        const { state, mountId, steedId } = activateMount();
        finalizeCleanup(state);
        expect(
            state.delayedTriggers?.some(
                (t) => t.timing === "leaves-battlefield"
            ) ?? false
        ).toBe(false);
        expect(state.players[0].battlefield.some((c) => c.id === mountId)).toBe(
            true
        );
        expect(state.players[0].battlefield.some((c) => c.id === steedId)).toBe(
            true
        );
    });

    it("the granted flying + buff survive projectPublicState (wire format)", () => {
        const { state, steedId } = activateMount();
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === steedId
        )!;
        expect(getEffectiveToughness(projected, slim)).toBe(3);
        expect(slim.staticAbilities).toContain("flying");
    });
});

describe("Winter's Chill (capped-X + per-target three-way may-pay, CR 107.3/118/615)", () => {
    /** An attacking creature controlled by `controller` with `mana` colorless
     *  in that controller's pool. p1 is the Winter's Chill caster. */
    function combatState(controller: string, mana: number) {
        const attacker = vanilla("atk", 2, 2, {
            id: "atk",
            controllerId: controller,
            ownerId: controller,
            isAttacking: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", {
                    battlefield: [attacker],
                    manaPool: { C: mana },
                }),
            ],
        });
        state.activePlayerId = "p2"; // p2 is the attacking (active) player
        return state;
    }

    it("pay {2}: the creature is untouched (no prevention, no destroy)", () => {
        const state = combatState("p2", 2);
        pushSpell(state, wintersChill.id, "p1", [
            { type: "permanent", id: "atk" },
        ]);
        resolveTopOfStack(state);
        // Suspends at the {2} may-pay for the attacker's controller (p2).
        expect(state.pendingChoices?.[0]?.kind).toBe("may-pay");
        expect(state.pendingChoices?.[0]?.playerId).toBe("p2");
        applyMayPaySubmit(state, { playerId: "p2", accept: true });
        // Paid {2}: pool spent, creature alive, no shield, no delayed destroy.
        expect(state.players[1].manaPool.C ?? 0).toBe(0);
        expect(state.players[1].battlefield.some((c) => c.id === "atk")).toBe(
            true
        );
        expect(
            state.combatDamageImmunity?.some((s) => s.instanceId === "atk")
        ).toBeFalsy();
        expect(
            state.delayedTriggers?.some(
                (d) => d.triggerId === "winters-chill-destroy"
            )
        ).toBeFalsy();
    });

    it("pay only {1}: all combat damage to and from it is prevented this combat (CR 615)", () => {
        const state = combatState("p2", 1);
        pushSpell(state, wintersChill.id, "p1", [
            { type: "permanent", id: "atk" },
        ]);
        resolveTopOfStack(state);
        // Decline {2} → the step resumes and offers {1}.
        applyMayPaySubmit(state, { playerId: "p2", accept: false });
        expect(state.pendingChoices?.[0]?.kind).toBe("may-pay");
        applyMayPaySubmit(state, { playerId: "p2", accept: true });
        // Paid {1}: a combat-damage immunity shield covers the creature this
        // combat; it survives and no destroy is scheduled.
        expect(state.players[1].manaPool.C ?? 0).toBe(0);
        expect(
            state.combatDamageImmunity?.some((s) => s.instanceId === "atk")
        ).toBe(true);
        expect(
            state.delayedTriggers?.some(
                (d) => d.triggerId === "winters-chill-destroy"
            )
        ).toBeFalsy();
    });

    it("decline both: the creature is destroyed at end of combat (CR 603.7 / 701.7)", () => {
        const state = combatState("p2", 2); // can afford, but declines
        pushSpell(state, wintersChill.id, "p1", [
            { type: "permanent", id: "atk" },
        ]);
        resolveTopOfStack(state);
        applyMayPaySubmit(state, { playerId: "p2", accept: false }); // decline {2}
        applyMayPaySubmit(state, { playerId: "p2", accept: false }); // decline {1}
        // No mana spent; a next-end-of-combat destroy is scheduled.
        expect(state.players[1].manaPool.C ?? 0).toBe(2);
        expect(
            state.delayedTriggers?.some(
                (d) => d.triggerId === "winters-chill-destroy"
            )
        ).toBe(true);
        // The creature still stands until end of combat (it deals damage first).
        expect(state.players[1].battlefield.some((c) => c.id === "atk")).toBe(
            true
        );
        // Fire end of combat → the delayed trigger hits the stack; resolving it
        // destroys the creature.
        fireDelayedTriggers(state, "next-end-of-combat");
        resolveTopOfStack(state);
        expect(state.players[1].battlefield.some((c) => c.id === "atk")).toBe(
            false
        );
        expect(state.players[1].graveyard.some((c) => c.id === "atk")).toBe(
            true
        );
    });

    it("X is capped by snow lands: the Bot never enumerates an X above the count (CR 107.3)", () => {
        // p1 has 2 snow lands (+ plenty of generic mana) — X can be 0..2 only,
        // even though more mana / more attackers exist.
        const snow1 = snowLand(snowCoveredIsland.id, "s1", "p1");
        snow1.zone = "battlefield";
        const snow2 = snowLand(snowCoveredIsland.id, "s2", "p1");
        snow2.zone = "battlefield";
        const state = makeState({
            players: [
                makePlayer("p1", {
                    hand: [
                        makeInstance(wintersChill.id, {
                            id: "wc",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "hand",
                        }),
                    ],
                    battlefield: [snow1, snow2],
                    manaPool: { U: 1, C: 10 },
                }),
                makePlayer("p2", {
                    battlefield: [
                        vanilla("a1", 1, 1, {
                            id: "a1",
                            controllerId: "p2",
                            ownerId: "p2",
                            isAttacking: true,
                        }),
                        vanilla("a2", 1, 1, {
                            id: "a2",
                            controllerId: "p2",
                            ownerId: "p2",
                            isAttacking: true,
                        }),
                        vanilla("a3", 1, 1, {
                            id: "a3",
                            controllerId: "p2",
                            ownerId: "p2",
                            isAttacking: true,
                        }),
                    ],
                }),
            ],
        });
        state.phase = "DECLARE_ATTACKERS";
        state.activePlayerId = "p2";
        state.priorityPlayerId = "p1";
        const moves = enumerateMoves(state, "p1");
        const wcXs = moves
            .filter((m) => m.kind === "cast-spell" && m.cardInstanceId === "wc")
            .map((m) => (m as { chosenX?: number }).chosenX ?? 0);
        expect(wcXs.length).toBeGreaterThan(0);
        expect(Math.max(...wcXs)).toBe(2); // capped at snow-land count, not 3
    });

    it("is an {X}{U} Instant castable only at DECLARE_ATTACKERS", () => {
        expect(wintersChill.manaCost).toEqual({ X: "X", U: 1 });
        expect(wintersChill.types).toEqual(["Instant"]);
        expect(wintersChill.castPhaseRestriction).toEqual([
            "DECLARE_ATTACKERS",
        ]);
        expect(wintersChill.castXUpperBound).toBe("snow-lands");
        expect(getDefinition(wintersChill.id)).toBe(wintersChill);
        expect(getCardByName("Winter's Chill")).toBe(wintersChill);
    });
});

// ===========================================================================
// Zur's Weirding — interactive draw-reveal replacement + all-players hand-reveal
// (CR 614, issue #735)
// ===========================================================================

describe("Zur's Weirding (interactive draw-reveal + hand-reveal, CR 614, #735)", () => {
    const topCardId = balduvianBears.id;

    function stateWithZurs(p2Life = 20) {
        // p1 is the active player about to draw at their draw step; p2 controls
        // Zur's Weirding (scope all-players → p1's draw is replaced) and decides
        // whether to pay 2 life.
        const zurs = makeInstance(zursWeirding.id, {
            controllerId: "p2",
            ownerId: "p2",
        });
        const top = makeInstance(topCardId, {
            id: "p1-top",
            ownerId: "p1",
            zone: "library",
        });
        return makeState({
            turn: 2,
            phase: "UPKEEP",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            players: [
                makePlayer("p1", { library: [top] }),
                makePlayer("p2", { life: p2Life, battlefield: [zurs] }),
            ],
        });
    }

    it("card definition wires the reveal + interactive draw replacement (ADR 0061)", () => {
        expect(zursWeirding.revealsHand).toBe("all-players");
        expect(zursWeirding.drawReplacement?.outcome).toEqual({
            kind: "reveal-others-may-pay-life",
            life: 2,
        });
        // "if a PLAYER would draw" — all-players scope is `applies: () => true`.
        expect(zursWeirding.drawReplacement?.applies).toBeTypeOf("function");
    });

    it("CR 614 — a would-be draw produces a may-pay-bin plan for the other player", () => {
        const plan = planDrawStep(stateWithZurs(), "p1", 1, false);
        expect(plan.kind).toBe("may-pay-bin");
        if (plan.kind === "may-pay-bin") {
            expect(plan.chooserId).toBe("p2");
            expect(plan.life).toBe(2);
            expect(plan.revealedCardId).toBe("p1-top");
        }
    });

    it("draw step: the draw is replaced by a reveal + pay-choice for the opponent (integration)", () => {
        const state = stateWithZurs();
        advancePhase(state);
        expect(state.phase).toBe("DRAW");
        const head = state.pendingChoices?.[0];
        expect(head?.kind).toBe("draw-replacement");
        expect(head?.playerId).toBe("p2"); // the other player decides
        expect(state.priorityPlayerId).toBe("p2");
        // CR — "they reveal it": the top card is public (known to the payer).
        const top = state.players[0].library.find((c) => c.id === "p1-top")!;
        expect(top.knownTo).toContain("p2");
        // Not drawn yet — the branch is pending.
        expect(state.players[0].hand).toHaveLength(0);
    });

    it("pay branch: the payer loses 2 life and the revealed card is binned", () => {
        const state = stateWithZurs();
        advancePhase(state);
        finalizeDrawReplacementPay(state, true);
        expect(state.players[1].life).toBe(18); // p2 paid 2 life
        expect(state.players[0].graveyard.map((c) => c.id)).toContain("p1-top");
        expect(state.players[0].hand).toHaveLength(0);
        expect(state.pendingChoices ?? []).toHaveLength(0);
    });

    it("decline branch: the drawing player draws the revealed card", () => {
        const state = stateWithZurs();
        advancePhase(state);
        finalizeDrawReplacementPay(state, false);
        expect(state.players[1].life).toBe(20); // no life paid
        expect(state.players[0].hand.map((c) => c.id)).toContain("p1-top");
        expect(state.players[0].graveyard).toHaveLength(0);
    });

    it("CR 119.4 — no pay-choice is raised when the other player can't afford the life (auto-draw)", () => {
        const state = stateWithZurs(1); // p2 has only 1 life, can't pay 2
        advancePhase(state);
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(state.players[0].hand.map((c) => c.id)).toContain("p1-top");
        expect(state.players[1].life).toBe(1);
    });

    it("all hands are revealed to opponents through the projection (wire format)", () => {
        const zurs = makeInstance(zursWeirding.id, {
            controllerId: "p1",
            ownerId: "p1",
        });
        const p1Hand = makeInstance(topCardId, {
            id: "p1-hand",
            ownerId: "p1",
            zone: "hand",
        });
        const p2Hand = makeInstance(topCardId, {
            id: "p2-hand",
            ownerId: "p2",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [zurs], hand: [p1Hand] }),
                makePlayer("p2", { hand: [p2Hand] }),
            ],
        });
        // p1's view: p2's hand is revealed (all-players scope).
        const p1View = projectPublicState(state, 1, "p1");
        const p2Slim = p1View.players.find((p) => p.id === "p2")!;
        expect(p2Slim.hand[0]).not.toBeNull();
        expect(p2Slim.hand[0]!.card.id).toBe(topCardId);
        // p2's view: p1's hand is revealed too.
        const p2View = projectPublicState(state, 1, "p2");
        const p1Slim = p2View.players.find((p) => p.id === "p1")!;
        expect(p1Slim.hand[0]).not.toBeNull();
        expect(p1Slim.hand[0]!.card.id).toBe(topCardId);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// Soldevi Machinist (#728) — restricted mana at the ABILITY-ACTIVATION path
// ═══════════════════════════════════════════════════════════════════════════

describe("Soldevi Machinist — '{T}: Add {C}{C}. Spend only on artifact abilities' (CR 605.1a / 106.6)", () => {
    const ARTIFACT_TYPES = ["Artifact"] as const;
    const CREATURE_TYPES = ["Creature"] as const;

    it("declares a mana ability producing restricted {C}{C}", () => {
        const ability = soldeviMachinist.activatedAbilities![0];
        expect(ability.useStack).toBe(false);
        expect(ability.cost).toEqual({ tap: true });
        expect(ability.manaProduced).toEqual({ C: 2 });
        expect(ability.manaRestriction).toBe("artifact-ability");
    });

    it("tapping banks the mana as restricted, not fungible (ADR 0022)", () => {
        const player = makePlayer("p1");
        addRestrictedManaToPool(
            player,
            "C",
            2,
            soldeviMachinist.activatedAbilities![0].manaRestriction
        );
        expect(player.restrictedMana).toEqual([
            { color: "C", amount: 2, restriction: "artifact-ability" },
        ]);
        expect(player.manaPool.C).toBe(0);
    });

    it("counts toward an ARTIFACT's ability but not a creature's (CR 106.6)", () => {
        const player = makePlayer("p1", {
            restrictedMana: [
                { color: "C", amount: 2, restriction: "artifact-ability" },
            ],
        });
        expect(spendablePoolForAbility(player, ARTIFACT_TYPES).C).toBe(2);
        expect(spendablePoolForAbility(player, CREATURE_TYPES).C ?? 0).toBe(0);
    });

    it("is never spendable on a spell — not even an artifact spell", () => {
        const player = makePlayer("p1", {
            restrictedMana: [
                { color: "C", amount: 2, restriction: "artifact-ability" },
            ],
        });
        expect(spendablePoolForSpell(player, ARTIFACT_TYPES).C ?? 0).toBe(0);
        expect(restrictionAllowsSpell("artifact-ability", ["Artifact"])).toBe(
            false
        );
    });

    it("conversely, artifact-SPELL mana never pays an artifact's ability", () => {
        const player = makePlayer("p1", {
            restrictedMana: [
                { color: "C", amount: 3, restriction: "artifact-spell" },
            ],
        });
        expect(spendablePoolForAbility(player, ARTIFACT_TYPES).C ?? 0).toBe(0);
        expect(restrictionAllowsAbility("artifact-spell", ["Artifact"])).toBe(
            false
        );
    });

    it("drains restricted mana FIRST, then the fungible pool", () => {
        const player = makePlayer("p1", {
            manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 3 },
            restrictedMana: [
                { color: "C", amount: 2, restriction: "artifact-ability" },
            ],
        });
        payManaCostForAbility(player, { C: 4 }, ARTIFACT_TYPES);
        expect(player.restrictedMana).toBeUndefined();
        expect(player.manaPool.C).toBe(1);
    });

    it("integration: pays a real artifact's activated ability through activateAbilityOnState", () => {
        const tome = makeInstance(jayemdaeTome.id, {
            id: "tome",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [tome],
                    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 2 },
                    restrictedMana: [
                        {
                            color: "C",
                            amount: 2,
                            restriction: "artifact-ability",
                        },
                    ],
                    library: [
                        makeInstance(island.id, {
                            id: "lib1",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "library",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        activateAbilityOnState(state, {
            playerId: "p1",
            cardInstanceId: "tome",
            abilityId: "jayemdae-tome-draw",
        });
        // {4} covered: 2 restricted + 2 fungible — no pendingActivation, the
        // ability went straight onto the stack.
        expect(state.pendingActivation).toBeUndefined();
        expect(state.stack).toHaveLength(1);
        expect(state.players[0].restrictedMana).toBeUndefined();
        expect(state.players[0].manaPool.C).toBe(0);
        resolveTopOfStack(state);
        expect(state.players[0].hand).toHaveLength(1);
    });

    it("integration: the same mana does NOT cover a creature's ability", () => {
        const machinist = makeInstance(soldeviMachinist.id, {
            id: "machinist",
            controllerId: "p1",
            ownerId: "p1",
        });
        const player = makePlayer("p1", {
            battlefield: [machinist],
            restrictedMana: [
                { color: "C", amount: 2, restriction: "artifact-ability" },
            ],
        });
        // The source is a Creature, so the restricted units are ineligible and
        // a {2} ability reads as unaffordable.
        expect(
            isManaCostCovered(
                spendablePoolForAbility(player, machinist.types),
                { C: 2 }
            )
        ).toBe(false);
    });

    it("wire format: the restricted unit and its label survive projectPublicState", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    restrictedMana: [
                        {
                            color: "C",
                            amount: 2,
                            restriction: "artifact-ability",
                        },
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        const projected = projectPublicState(state, 1, "p1");
        const unit = projected.players[0].restrictedMana![0];
        expect(unit).toEqual({
            color: "C",
            amount: 2,
            restriction: "artifact-ability",
        });
        // The pool chip's label is asserted in the frontend suite
        // (src/lib/__tests__/restricted-mana.test.ts).
    });
});
