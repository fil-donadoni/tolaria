// Antiquities (ATQ) — per-card behavior tests for colorless cards in
// `convex/cards/sets/atq/colorless.ts` (set split by colour, ADR 0043). Each
// non-trivial card gets a describe block citing the CR section it exercises;
// assertions check external behavior only. Shared test shims live in
// `./helpers`; fixtures in `convex/cards/__tests__/setup.ts`.

import { describe, it, expect } from "vitest";
import {
    ornithopter,
    tawnossCoffin,
    yotianSoldier,
    wallOfSpears,
    dragonEngine,
    clayStatue,
    grapeshotCatapult,
    colossusOfSardia,
    stripMine,
    obeliskOfUndoing,
    reconstruction,
    argivianArchaeologist,
    feldonsCane,
    drafnasRestoration,
    millstone,
    jalumTome,
    candelabraOfTawnos,
    urzasChalice,
    onulet,
    suChi,
    tabletOfEpityr,
    ivoryTower,
    armageddonClock,
    triskelion,
    clockworkAvian,
    mightstone,
    weakstone,
    staffOfZegon,
    mishrasFactory,
    batteringRam,
    urzasAvenger,
    amuletOfKroog,
    rakalite,
    ashnodsTransmogrant,
    mishrasWarMachine,
    ashnodsAltar,
    mishrasWorkshop,
    urzasMine,
    urzasPowerPlant,
    urzasTower,
    urzasChalice as urzasChaliceDef,
    ashnodsBattleGear,
    tawnossWeaponry,
    primalClay,
    shapeshifter,
    cursedRack,
    theRack,
    urzasMiter,
    coralHelm,
    golgothianSylex,
    rocketLauncher,
    tawnossWand,
    tetravus,
} from "..";
import { grizzlyBears, holyStrength, shatter } from "../../lea";
import { getDefinition, getInstanceManaCost } from "../../..";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import {
    isCreature,
    getActivatedManaRestriction,
    getFixedManaAmount,
    getDynamicManaProduced,
    isTapLockedBySummoningSickness,
} from "../../../../gre/constants";
import { collectTriggers } from "../../../../gre/triggers";
import { projectPublicState } from "../../../../gameProjections";
import {
    resolveTopOfStack,
    removePermanentTo,
    untapPermanent,
    processPendingActionTriggers,
    addRestrictedManaToPool,
    restrictionAllowsSpell,
    spendablePoolForSpell,
    payManaCostForSpell,
    isManaCostCovered,
    normalizeManaCost,
    type CardInstanceState,
    type GameState,
    type StackItem,
    getPlayer,
} from "../../../../gre/state";
import { buildAutoTapSources } from "../../../../gre/autoTap";
import { compactState, expandState } from "../../../../gre/serialize";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { getLegalTargets } from "../../../../gre/rules";
import { isGuardedAgainst } from "../../../../gre/permanentGuard";
import {
    validateBlockerEligibility,
    validateAttackerEligibility,
} from "../../../../gre/combat";
import {
    advancePhase,
    untapStep,
    effectiveMaxHandSize,
} from "../../../../gre/phases";
import { checkStateBasedActions } from "../../../../gre/sba";
import { applyMoveForSearch } from "../../../../gre/applyMove";
import { applyPlayLand } from "../../../../gre/playLand";
import {
    applyPendingChoiceSubmit,
    applyMayPaySubmit,
} from "../../../../gre/pendingChoiceSubmit";
import type { CardType } from "../../../types";
import {
    UPKEEP_P1,
    blockEvent,
    fireEntered,
    fireTrigger,
    getManaSubstitutionsEmpty,
    resolveActivated,
    submitChoice,
    vanilla,
} from "./helpers";

// ---------------------------------------------------------------------------
// Registry wiring — the atq set must be resolvable from the card registry
// (acceptance criterion: "atq set is registered and resolvable").
// ---------------------------------------------------------------------------

describe("ATQ set registration", () => {
    it("Ornithopter resolves from the registry by id", () => {
        expect(getDefinition(ornithopter.id).name).toBe("Ornithopter");
    });
    it("Yotian Soldier resolves from the registry by id", () => {
        expect(getDefinition(yotianSoldier.id).name).toBe("Yotian Soldier");
    });
});

// ---------------------------------------------------------------------------
// Keyword artifact creatures (CR 702 — staticAbilities; CR 301 — artifact
// creatures are both Artifact and Creature).
// ---------------------------------------------------------------------------

describe("ATQ keyword artifact creatures (CR 702 — staticAbilities)", () => {
    it("Ornithopter is a 0/2 artifact creature with flying", () => {
        expect(ornithopter.types).toEqual(
            expect.arrayContaining(["Artifact", "Creature"])
        );
        expect(ornithopter.power).toBe(0);
        expect(ornithopter.toughness).toBe(2);
        expect(ornithopter.manaCost).toEqual({});
        expect(ornithopter.staticAbilities).toContain("flying");
    });

    it("Yotian Soldier is a 1/4 artifact creature with vigilance", () => {
        expect(yotianSoldier.types).toEqual(
            expect.arrayContaining(["Artifact", "Creature"])
        );
        expect(yotianSoldier.power).toBe(1);
        expect(yotianSoldier.toughness).toBe(4);
        expect(yotianSoldier.manaCost).toEqual({ X: 3 });
        expect(yotianSoldier.staticAbilities).toContain("vigilance");
    });
});

// ---------------------------------------------------------------------------
// Wire format — both cards must survive projectPublicState. The projection
// slims `card.card` to `{ id }`, so the engine must re-derive every
// characteristic from the registry by id. These tests prove the keyword and
// creature-ness survive the wire (catches fat-field reads stripped at
// projection).
// ---------------------------------------------------------------------------

describe("ATQ walking skeleton survives projection (wire format)", () => {
    it("Ornithopter keeps flying + creature-ness after projection", () => {
        const orni = makeInstance(ornithopter.id, { id: "orni" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [orni] }),
                makePlayer("p2"),
            ],
        });

        // GRE behavior on fat state.
        expect(isCreature(orni)).toBe(true);
        expect(orni.staticAbilities).toContain("flying");

        // Same behavior survives projection.
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players
            .find((p) => p.id === "p1")!
            .battlefield.find((c) => c.id === "orni")!;
        // The slim card carries only `{ id }`; the keyword rides the instance
        // and the definition is re-resolvable from the registry by that id.
        expect(slim.card.id).toBe(ornithopter.id);
        expect(slim.staticAbilities).toContain("flying");
        expect(getDefinition(slim.card.id).staticAbilities).toContain("flying");
    });

    it("Yotian Soldier keeps vigilance + creature-ness after projection", () => {
        const yot = makeInstance(yotianSoldier.id, { id: "yot" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [yot] }),
                makePlayer("p2"),
            ],
        });

        expect(isCreature(yot)).toBe(true);
        expect(yot.staticAbilities).toContain("vigilance");

        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players
            .find((p) => p.id === "p1")!
            .battlefield.find((c) => c.id === "yot")!;
        expect(slim.card.id).toBe(yotianSoldier.id);
        expect(slim.staticAbilities).toContain("vigilance");
        expect(getDefinition(slim.card.id).staticAbilities).toContain(
            "vigilance"
        );
    });
});

// ---------------------------------------------------------------------------
// Free tranche (#273) — vanilla/keyword artifact creatures & simple permanents
// ---------------------------------------------------------------------------

describe("ATQ free-tranche registration", () => {
    it.each([
        ["Wall of Spears", wallOfSpears],
        ["Dragon Engine", dragonEngine],
        ["Clay Statue", clayStatue],
        ["Grapeshot Catapult", grapeshotCatapult],
        ["Colossus of Sardia", colossusOfSardia],
        ["Strip Mine", stripMine],
        ["Obelisk of Undoing", obeliskOfUndoing],
    ])("%s resolves from the registry by id", (name, card) => {
        expect(getDefinition(card.id).name).toBe(name);
    });
});

// ---------------------------------------------------------------------------
// Wall of Spears — defender + first strike (CR 702.3, 702.7)
// ---------------------------------------------------------------------------

describe("Wall of Spears (defender + first strike, CR 702.3 / 702.7)", () => {
    it("is a 2/3 artifact creature with defender and first strike", () => {
        expect(wallOfSpears.types).toEqual(
            expect.arrayContaining(["Artifact", "Creature"])
        );
        expect(wallOfSpears.subtypes).toEqual(["Wall"]);
        expect(wallOfSpears.power).toBe(2);
        expect(wallOfSpears.toughness).toBe(3);
        expect(wallOfSpears.manaCost).toEqual({ X: 3 });
        expect(wallOfSpears.staticAbilities).toEqual(
            expect.arrayContaining(["defender", "first strike"])
        );
    });

    it("kills a 2/2 attacker in the first-strike step before it swings back", () => {
        // Wall of Spears (2/3, first strike) blocks a 2/2 attacker. CR 510.2:
        // only first/double strike creatures deal damage in the first-strike
        // step — the Wall kills the 2/2, which then cannot deal regular damage.
        const wall = makeInstance(wallOfSpears.id, {
            id: "wall",
            controllerId: "p1",
            ownerId: "p1",
            isBlocking: true,
        });
        const attacker = vanilla("atk", 2, 2, { isAttacking: true });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [wall] }),
                makePlayer("p2", { battlefield: [attacker] }),
            ],
            activePlayerId: "p2",
            phase: "DECLARE_BLOCKERS",
            combat: {
                attackerIds: ["atk"],
                confirmed: true,
                blockerAssignments: { wall: ["atk"] },
                blockersConfirmed: true,
            },
        });

        advancePhase(state);
        expect(state.phase).toBe("FIRST_STRIKE_DAMAGE");
        // Attacker dead in the first-strike step (Wall's 2 power >= 2 tough).
        expect(
            state.players[1].battlefield.find((c) => c.id === "atk")
        ).toBeUndefined();
        // Wall survives — the dead attacker dealt no regular damage.
        advancePhase(state);
        expect(state.phase).toBe("COMBAT_DAMAGE");
        expect(
            state.players[0].battlefield.find((c) => c.id === "wall")
        ).toBeDefined();
    });

    it("keeps defender + first strike after projection (wire format)", () => {
        const wall = makeInstance(wallOfSpears.id, { id: "wall" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [wall] }),
                makePlayer("p2"),
            ],
        });
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players
            .find((p) => p.id === "p1")!
            .battlefield.find((c) => c.id === "wall")!;
        expect(slim.staticAbilities).toEqual(
            expect.arrayContaining(["defender", "first strike"])
        );
    });
});

// ---------------------------------------------------------------------------
// Dragon Engine — {2}: +1/+0 until end of turn (CR 611.1)
// ---------------------------------------------------------------------------

describe("Dragon Engine ({2}: +1/+0 EOT, CR 611.1)", () => {
    it("is a 1/3 artifact creature — Construct", () => {
        expect(dragonEngine.power).toBe(1);
        expect(dragonEngine.toughness).toBe(3);
        expect(dragonEngine.subtypes).toEqual(["Construct"]);
        expect(dragonEngine.manaCost).toEqual({ X: 3 });
    });

    it("pumps itself +1/+0 until end of turn", () => {
        const engine = makeInstance(dragonEngine.id, { id: "engine" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [engine] }),
                makePlayer("p2"),
            ],
        });
        const target = { type: "permanent" as const, id: "engine" };
        expect(getEffectivePower(state, engine)).toBe(1);

        resolveActivated(state, engine, "dragon-engine-pump", [target]);
        const live = state.players[0].battlefield.find(
            (c) => c.id === "engine"
        )!;
        expect(getEffectivePower(state, live)).toBe(2);
        expect(getEffectiveToughness(state, live)).toBe(3);
    });

    it("the +1/+0 buff survives projection (wire format)", () => {
        const engine = makeInstance(dragonEngine.id, { id: "engine" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [engine] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, engine, "dragon-engine-pump", [
            { type: "permanent", id: "engine" },
        ]);

        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players
            .find((p) => p.id === "p1")!
            .battlefield.find((c) => c.id === "engine")!;
        expect(getEffectivePower(projected, slim)).toBe(2);
        expect(getEffectiveToughness(projected, slim)).toBe(3);
    });
});

// ---------------------------------------------------------------------------
// Clay Statue — {2}: Regenerate (CR 701.15)
// ---------------------------------------------------------------------------

describe("Clay Statue ({2}: regenerate, CR 701.15)", () => {
    it("is a 3/1 artifact creature — Golem", () => {
        expect(clayStatue.power).toBe(3);
        expect(clayStatue.toughness).toBe(1);
        expect(clayStatue.subtypes).toEqual(["Golem"]);
        expect(clayStatue.manaCost).toEqual({ X: 4 });
    });

    it("stacks a regeneration shield on itself", () => {
        const statue = makeInstance(clayStatue.id, { id: "statue" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [statue] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, statue, "clay-statue-regen", [
            { type: "permanent", id: "statue" },
        ]);
        expect(
            state.players[0].battlefield.find((c) => c.id === "statue")!
                .regenerationShields
        ).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// Grapeshot Catapult — {T}: 1 damage to target creature with flying (CR 120.3)
// ---------------------------------------------------------------------------

describe("Grapeshot Catapult ({T}: 1 dmg to flyer, CR 120.3 / 702.9)", () => {
    it("is a 2/3 artifact creature — Construct", () => {
        expect(grapeshotCatapult.power).toBe(2);
        expect(grapeshotCatapult.toughness).toBe(3);
        expect(grapeshotCatapult.subtypes).toEqual(["Construct"]);
        expect(grapeshotCatapult.manaCost).toEqual({ X: 4 });
    });

    it("only a creature with flying is a legal target", () => {
        const cat = makeInstance(grapeshotCatapult.id, { id: "cat" });
        const flyer = makeInstance(ornithopter.id, {
            id: "flyer",
            controllerId: "p2",
            ownerId: "p2",
        });
        const ground = vanilla("ground", 2, 2);
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [cat] }),
                makePlayer("p2", { battlefield: [flyer, ground] }),
            ],
        });
        const req = grapeshotCatapult.activatedAbilities!.find(
            (a) => a.id === "grapeshot-catapult-bolt"
        )!.targetRequirement!;
        const legal = getLegalTargets(state, req, [], "p1");
        const ids = legal.map((t) => t.id);
        expect(ids).toContain("flyer");
        expect(ids).not.toContain("ground");
    });

    it("deals 1 damage to a 0/2 flyer (does not kill it)", () => {
        const cat = makeInstance(grapeshotCatapult.id, { id: "cat" });
        const flyer = makeInstance(ornithopter.id, {
            id: "flyer",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [cat] }),
                makePlayer("p2", { battlefield: [flyer] }),
            ],
        });
        resolveActivated(state, cat, "grapeshot-catapult-bolt", [
            { type: "permanent", id: "flyer" },
        ]);
        const live = state.players[1].battlefield.find(
            (c) => c.id === "flyer"
        )!;
        expect(live.damageMarked).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// Colossus of Sardia — trample + does-not-untap + {9} upkeep untap (CR 702.19,
// 502.1, 602.5b)
// ---------------------------------------------------------------------------

describe("Colossus of Sardia (trample + does-not-untap + {9} untap)", () => {
    it("is a 9/9 artifact creature with trample and does-not-untap", () => {
        expect(colossusOfSardia.power).toBe(9);
        expect(colossusOfSardia.toughness).toBe(9);
        expect(colossusOfSardia.manaCost).toEqual({ X: 9 });
        expect(colossusOfSardia.staticAbilities).toEqual(
            expect.arrayContaining(["trample", "does-not-untap"])
        );
    });

    it("does not untap during the untap step (CR 502.1)", () => {
        const colossus = makeInstance(colossusOfSardia.id, {
            id: "colossus",
            isTapped: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [colossus] }),
                makePlayer("p2"),
            ],
            phase: "UPKEEP",
        });
        untapStep(state);
        expect(
            state.players[0].battlefield.find((c) => c.id === "colossus")!
                .isTapped
        ).toBe(true);
    });

    it("the {9} ability untaps it", () => {
        const colossus = makeInstance(colossusOfSardia.id, {
            id: "colossus",
            isTapped: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [colossus] }),
                makePlayer("p2"),
            ],
            phase: "UPKEEP",
        });
        resolveActivated(state, colossus, "colossus-of-sardia-untap", [
            { type: "permanent", id: "colossus" },
        ]);
        expect(
            state.players[0].battlefield.find((c) => c.id === "colossus")!
                .isTapped
        ).toBe(false);
    });

    it("the {9} untap is restricted to the controller's upkeep", () => {
        const ability = colossusOfSardia.activatedAbilities!.find(
            (a) => a.id === "colossus-of-sardia-untap"
        )!;
        expect(ability.activationPhaseRestriction).toEqual(["UPKEEP"]);
        expect(ability.controllerTurnOnly).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Strip Mine — {T}: add {C}; {T}, sacrifice: destroy target land (CR 305, 701.7)
// ---------------------------------------------------------------------------

describe("Strip Mine ({T}: add C; sac: destroy target land, CR 701.7)", () => {
    it("is a colorless land with no mana cost", () => {
        expect(stripMine.types).toEqual(["Land"]);
        expect(stripMine.manaCost).toEqual({});
    });

    it("the mana ability is a colorless mana ability (useStack: false)", () => {
        const mana = stripMine.activatedAbilities!.find(
            (a) => a.id === "strip-mine-mana"
        )!;
        expect(mana.useStack).toBe(false);
        expect(mana.manaProduced).toEqual({ C: 1 });
    });

    it("destroys a target land", () => {
        const mine = makeInstance(stripMine.id, { id: "mine" });
        const victim = makeInstance(stripMine.id, {
            id: "victim",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mine] }),
                makePlayer("p2", { battlefield: [victim] }),
            ],
        });
        resolveActivated(state, mine, "strip-mine-destroy", [
            { type: "permanent", id: "victim" },
        ]);
        expect(
            state.players[1].battlefield.find((c) => c.id === "victim")
        ).toBeUndefined();
        expect(state.players[1].graveyard.some((c) => c.id === "victim")).toBe(
            true
        );
    });
});

// ---------------------------------------------------------------------------
// Obelisk of Undoing — {6},{T}: return a permanent you own and control to hand
// (CR 701.10)
// ---------------------------------------------------------------------------

describe("Obelisk of Undoing ({6},{T}: return your permanent, CR 701.10)", () => {
    it("is a colorless artifact (mana cost per ATQ.json)", () => {
        expect(obeliskOfUndoing.types).toEqual(["Artifact"]);
        expect(obeliskOfUndoing.manaCost).toEqual({ X: 1 });
    });

    it("only the activator's own permanents are legal targets", () => {
        const obelisk = makeInstance(obeliskOfUndoing.id, { id: "obelisk" });
        const mine = makeInstance(clayStatue.id, {
            id: "mine",
            controllerId: "p1",
            ownerId: "p1",
        });
        const theirs = makeInstance(clayStatue.id, {
            id: "theirs",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [obelisk, mine] }),
                makePlayer("p2", { battlefield: [theirs] }),
            ],
        });
        const req = obeliskOfUndoing.activatedAbilities!.find(
            (a) => a.id === "obelisk-of-undoing-return"
        )!.targetRequirement!;
        const ids = getLegalTargets(state, req, [], "p1").map((t) => t.id);
        expect(ids).toContain("mine");
        expect(ids).toContain("obelisk"); // can target itself
        expect(ids).not.toContain("theirs");
    });

    it("can target a non-creature permanent (artifact) the activator controls", () => {
        // Verifies the explicit all-permanent-types target list — `type:"any"`
        // alone would miss artifacts (CR 115.4 damageable-only).
        const obelisk = makeInstance(obeliskOfUndoing.id, { id: "obelisk" });
        const land = makeInstance(stripMine.id, {
            id: "land",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [obelisk, land] }),
                makePlayer("p2"),
            ],
        });
        const req = obeliskOfUndoing.activatedAbilities!.find(
            (a) => a.id === "obelisk-of-undoing-return"
        )!.targetRequirement!;
        const ids = getLegalTargets(state, req, [], "p1").map((t) => t.id);
        expect(ids).toContain("land");
    });

    it("returns a target permanent to its owner's hand", () => {
        const obelisk = makeInstance(obeliskOfUndoing.id, { id: "obelisk" });
        const target = makeInstance(clayStatue.id, {
            id: "target",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [obelisk, target] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, obelisk, "obelisk-of-undoing-return", [
            { type: "permanent", id: "target" },
        ]);
        expect(
            state.players[0].battlefield.find((c) => c.id === "target")
        ).toBeUndefined();
        expect(state.players[0].hand.some((c) => c.id === "target")).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Free tranche #275 — graveyard / library recursion & card-flow.
// ---------------------------------------------------------------------------

describe("ATQ free-tranche #275 registration", () => {
    it.each([
        ["Reconstruction", reconstruction],
        ["Argivian Archaeologist", argivianArchaeologist],
        ["Feldon's Cane", feldonsCane],
        ["Drafna's Restoration", drafnasRestoration],
        ["Millstone", millstone],
        ["Jalum Tome", jalumTome],
        ["Candelabra of Tawnos", candelabraOfTawnos],
    ])("%s resolves from the registry by id", (name, card) => {
        expect(getDefinition(card.id).name).toBe(name);
    });
});

describe("Feldon's Cane ({T}, exile self: shuffle graveyard into library, CR 400.7 / 701.20)", () => {
    it("moves the controller's graveyard into the library and exiles itself", () => {
        const g1 = makeInstance(clayStatue.id, {
            id: "g1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const g2 = makeInstance(dragonEngine.id, {
            id: "g2",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const cane = makeInstance(feldonsCane.id, {
            id: "cane",
            controllerId: "p1",
            ownerId: "p1",
        });
        const libCard = makeInstance(yotianSoldier.id, {
            id: "lib",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [cane],
                    graveyard: [g1, g2],
                    library: [libCard],
                }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, cane, "feldons-cane-shuffle");
        // Graveyard emptied into library (now 1 original + 2 = 3 cards).
        expect(state.players[0].graveyard).toHaveLength(0);
        expect(state.players[0].library).toHaveLength(3);
        const libIds = state.players[0].library.map((c) => c.id);
        expect(libIds).toContain("g1");
        expect(libIds).toContain("g2");
        // The Cane exiled itself — not in the library it shuffled.
        expect(libIds).not.toContain("cane");
        expect(state.players[0].battlefield.some((c) => c.id === "cane")).toBe(
            false
        );
        expect(state.players[0].exile.some((c) => c.id === "cane")).toBe(true);
    });
});

describe("Millstone ({2},{T}: target player mills two, CR 701.13a)", () => {
    it("moves the top two cards of the target's library to their graveyard", () => {
        const c1 = makeInstance(yotianSoldier.id, {
            id: "c1",
            controllerId: "p2",
            ownerId: "p2",
            zone: "library",
        });
        const c2 = makeInstance(dragonEngine.id, {
            id: "c2",
            controllerId: "p2",
            ownerId: "p2",
            zone: "library",
        });
        const c3 = makeInstance(clayStatue.id, {
            id: "c3",
            controllerId: "p2",
            ownerId: "p2",
            zone: "library",
        });
        const mill = makeInstance(millstone.id, {
            id: "mill",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mill] }),
                makePlayer("p2", { library: [c1, c2, c3] }),
            ],
        });
        resolveActivated(state, mill, "millstone-mill", [
            { type: "player", id: "p2" },
        ]);
        // Top two (c1, c2) milled; c3 remains on top.
        expect(state.players[1].library.map((c) => c.id)).toEqual(["c3"]);
        expect(state.players[1].graveyard.map((c) => c.id)).toEqual([
            "c1",
            "c2",
        ]);
    });

    it("mills only what's left when the library has fewer than two cards", () => {
        const c1 = makeInstance(yotianSoldier.id, {
            id: "c1",
            controllerId: "p2",
            ownerId: "p2",
            zone: "library",
        });
        const mill = makeInstance(millstone.id, {
            id: "mill",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [mill] }),
                makePlayer("p2", { library: [c1] }),
            ],
        });
        resolveActivated(state, mill, "millstone-mill", [
            { type: "player", id: "p2" },
        ]);
        expect(state.players[1].library).toHaveLength(0);
        expect(state.players[1].graveyard.map((c) => c.id)).toEqual(["c1"]);
    });
});

describe("Jalum Tome ({2},{T}: draw then discard, CR 121.1 / 701.8)", () => {
    it("draws a card, then discards the chosen card", () => {
        const drawn = makeInstance(yotianSoldier.id, {
            id: "drawn",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const inHand = makeInstance(dragonEngine.id, {
            id: "inHand",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const tome = makeInstance(jalumTome.id, {
            id: "tome",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [tome],
                    hand: [inHand],
                    library: [drawn],
                }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, tome, "jalum-tome-loot");
        // Suspends on the discard pick: drawn card is now in hand (2 cards).
        expect(state.pendingChoices?.length ?? 0).toBe(1);
        expect(state.players[0].hand.map((c) => c.id).sort()).toEqual([
            "drawn",
            "inHand",
        ]);
        // Discard the just-drawn card.
        submitChoice(state, ["drawn"]);
        expect(state.players[0].hand.map((c) => c.id)).toEqual(["inHand"]);
        expect(state.players[0].graveyard.map((c) => c.id)).toEqual(["drawn"]);
        expect(state.players[0].library).toHaveLength(0);
    });
});

describe("Candelabra of Tawnos ({X},{T}: untap X target lands, CR 107.3 / 601.2c / 701.20b)", () => {
    it("untaps each of the X targeted lands", () => {
        const l1 = makeInstance(stripMine.id, {
            id: "l1",
            controllerId: "p1",
            ownerId: "p1",
            isTapped: true,
        });
        const l2 = makeInstance(stripMine.id, {
            id: "l2",
            controllerId: "p1",
            ownerId: "p1",
            isTapped: true,
        });
        const candelabra = makeInstance(candelabraOfTawnos.id, {
            id: "cand",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [candelabra, l1, l2] }),
                makePlayer("p2"),
            ],
        });
        // X = 2: untap both lands.
        const item: StackItem = {
            ...candelabra,
            zone: "stack",
            castById: "p1",
            abilityId: "candelabra-untap",
            chosenX: 2,
            targets: [
                { type: "permanent", id: "l1" },
                { type: "permanent", id: "l2" },
            ],
        };
        state.stack.push(item);
        resolveTopOfStack(state);
        expect(
            state.players[0].battlefield.find((c) => c.id === "l1")?.isTapped
        ).toBe(false);
        expect(
            state.players[0].battlefield.find((c) => c.id === "l2")?.isTapped
        ).toBe(false);
    });

    it("declares an X-bound land target count", () => {
        const ability = candelabraOfTawnos.activatedAbilities![0];
        expect(ability.targetRequirement).toEqual({ type: "Land", count: "X" });
        expect(ability.cost.mana).toEqual({ X: "X" });
    });

    it("getLegalTargets offers lands (and X scales the count via the engine)", () => {
        const l1 = makeInstance(stripMine.id, {
            id: "l1",
            controllerId: "p1",
            ownerId: "p1",
            isTapped: true,
        });
        const creature = vanilla("creature", 2, 2, { controllerId: "p1" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [l1, creature] }),
                makePlayer("p2"),
            ],
        });
        const ids = getLegalTargets(
            state,
            candelabraOfTawnos.activatedAbilities![0].targetRequirement!,
            [],
            "p1",
            1
        ).map((t) => t.id);
        expect(ids).toContain("l1");
        expect(ids).not.toContain("creature");
    });
});

// Urza's Chalice (CR 603.2 any-player artifact-cast trigger, CR 117.3a may-pay)
describe("Urza's Chalice (may pay {1} → gain 1 life on artifact cast)", () => {
    const setup = () => {
        const chalice = makeInstance(urzasChalice.id, {
            id: "chalice",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [chalice], life: 20 }),
                makePlayer("p2"),
            ],
        });
        return { state, chalice };
    };
    const artifactCast = {
        type: "SPELL_CAST" as const,
        casterId: "p2",
        spellInstanceId: "x",
        spellCardId: "y",
        spellTypes: ["Artifact"] as CardType[],
        spellSubtypes: [],
        spellColors: [],
    };

    it("fires on any player's artifact spell, not a non-artifact spell", () => {
        const trig = urzasChalice.triggeredAbilities![0];
        const self = {
            id: "chalice",
            controllerId: "p1",
            ownerId: "p1",
            types: ["Artifact"] as CardType[],
            subtypes: [],
            isTapped: false,
            card: {},
        };
        expect(trig.matches(artifactCast, self)).toBe(true);
        expect(trig.matches({ ...artifactCast, casterId: "p1" }, self)).toBe(
            true
        );
        expect(
            trig.matches(
                { ...artifactCast, spellTypes: ["Sorcery"] as CardType[] },
                self
            )
        ).toBe(false);
    });

    it("accept → gain 1 life", () => {
        const { state, chalice } = setup();
        fireTrigger(state, chalice, "urzas-chalice-life", artifactCast, true);
        expect(state.players[0].life).toBe(21);
        expect(state.stack).toHaveLength(0);
    });

    it("decline → no life gain", () => {
        const { state, chalice } = setup();
        fireTrigger(state, chalice, "urzas-chalice-life", artifactCast, false);
        expect(state.players[0].life).toBe(20);
    });
});

// Onulet (CR 603.2 self-death trigger, gain 2 life)
describe("Onulet (dies → gain 2 life)", () => {
    it("death trigger collected on the stack, resolves to +2 life", () => {
        const onuletInst = makeInstance(onulet.id, {
            id: "onulet",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [onuletInst], life: 20 }),
                makePlayer("p2"),
            ],
        });
        removePermanentTo(state, "onulet", "graveyard");
        processPendingActionTriggers(state);
        // The self-death trigger is now on the stack.
        const trig = state.stack.find(
            (s) => s.triggeredAbilityId === "onulet-life"
        );
        expect(trig).toBeDefined();
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(22);
    });

    it("trigger matches only this creature's death", () => {
        const trig = onulet.triggeredAbilities![0];
        const self = {
            id: "onulet",
            controllerId: "p1",
            ownerId: "p1",
            types: ["Artifact", "Creature"] as CardType[],
            subtypes: [],
            isTapped: false,
            card: {},
        };
        const ownDeath = {
            type: "CREATURE_DIED" as const,
            creatureInstanceId: "onulet",
            creatureControllerId: "p1",
            creatureTypes: ["Artifact", "Creature"] as CardType[],
            damagedBySources: [],
            creaturePower: 2,
            creatureToughness: 2,
        };
        expect(trig.matches(ownDeath, self)).toBe(true);
        expect(
            trig.matches({ ...ownDeath, creatureInstanceId: "other" }, self)
        ).toBe(false);
    });
});

// Su-Chi (CR 603.2 self-death trigger, add {C}{C}{C}{C})
describe("Su-Chi (dies → add {C}{C}{C}{C})", () => {
    it("death trigger adds four colorless mana to controller's pool", () => {
        const suChiInst = makeInstance(suChi.id, {
            id: "suchi",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [suChiInst] }),
                makePlayer("p2"),
            ],
        });
        removePermanentTo(state, "suchi", "graveyard");
        processPendingActionTriggers(state);
        resolveTopOfStack(state);
        expect(state.players[0].manaPool.C).toBe(4);
    });
});

// Tablet of Epityr (CR 603.10 your-artifact-to-graveyard trigger, may-pay)
describe("Tablet of Epityr (may pay {1} → gain 1 on your artifact to graveyard)", () => {
    const setup = () => {
        const tablet = makeInstance(tabletOfEpityr.id, {
            id: "tablet",
            controllerId: "p1",
            ownerId: "p1",
        });
        const otherArtifact = makeInstance(onulet.id, {
            id: "art",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [tablet, otherArtifact],
                    life: 20,
                }),
                makePlayer("p2"),
            ],
        });
        return { state, tablet };
    };

    it("trigger fires when a controlled artifact is put into the graveyard, then accept → +1 life", () => {
        const { state } = setup();
        removePermanentTo(state, "art", "graveyard");
        processPendingActionTriggers(state);
        // Tablet's may-pay trigger is on the stack (a CREATURE_DIED trigger
        // for Onulet may also be present; resolve the Tablet trigger).
        const tabletTrig = state.stack.find(
            (s) => s.triggeredAbilityId === "tablet-of-epityr-life"
        );
        expect(tabletTrig).toBeDefined();
        // Bring the Tablet trigger to the top of the stack and resolve it.
        const idx = state.stack.indexOf(tabletTrig!);
        state.stack.splice(idx, 1);
        state.stack.push(tabletTrig!);
        const first = resolveTopOfStack(state);
        expect(first).toBeNull();
        const pending = state.pendingChoices![0];
        const item = state.stack.find((s) => s.id === pending.stackItemId)!;
        item.collectedChoices = {
            [`${pending.step}:${pending.choiceId}`]: ["yes"],
        };
        state.pendingChoices = undefined;
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(21);
    });

    it("trigger does not fire for an opponent's artifact", () => {
        const trig = tabletOfEpityr.triggeredAbilities![0];
        const self = {
            id: "tablet",
            controllerId: "p1",
            ownerId: "p1",
            types: ["Artifact"] as CardType[],
            subtypes: [],
            isTapped: false,
            card: {},
        };
        const oppArtifactLeft = {
            type: "PERMANENT_LEFT" as const,
            instanceId: "opp-art",
            controllerId: "p2",
            ownerId: "p2",
            types: ["Artifact"] as CardType[],
            wasAura: false,
            toZone: "graveyard" as const,
        };
        expect(trig.matches(oppArtifactLeft, self)).toBe(false);
    });
});

// Ivory Tower (CR 603.6a upkeep trigger, hand-size life)
describe("Ivory Tower (upkeep: gain hand − 4 life)", () => {
    const fireUpkeep = (handCount: number, life = 20) => {
        const tower = makeInstance(ivoryTower.id, {
            id: "tower",
            controllerId: "p1",
            ownerId: "p1",
        });
        const hand = Array.from({ length: handCount }, (_, i) =>
            makeInstance(onulet.id, {
                id: `h${i}`,
                controllerId: "p1",
                ownerId: "p1",
                zone: "hand",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [tower], hand, life }),
                makePlayer("p2"),
            ],
        });
        fireTrigger(state, tower, "ivory-tower-life", {
            type: "PHASE_BEGIN",
            phase: "UPKEEP",
            activePlayerId: "p1",
        });
        return state.players[0].life;
    };

    it("gains hand − 4 when hand > 4", () => {
        expect(fireUpkeep(7)).toBe(23);
    });

    it("gains nothing (no life loss) when hand <= 4", () => {
        expect(fireUpkeep(3)).toBe(20);
        expect(fireUpkeep(4)).toBe(20);
    });

    it("trigger fires only on the controller's upkeep", () => {
        const trig = ivoryTower.triggeredAbilities![0];
        const self = {
            id: "tower",
            controllerId: "p1",
            ownerId: "p1",
            types: ["Artifact"] as CardType[],
            subtypes: [],
            isTapped: false,
            card: {},
        };
        const ev = (active: string) => ({
            type: "PHASE_BEGIN" as const,
            phase: "UPKEEP" as const,
            activePlayerId: active,
        });
        expect(trig.matches(ev("p1"), self)).toBe(true);
        expect(trig.matches(ev("p2"), self)).toBe(false);
    });
});

// Armageddon Clock (doom counters: add on upkeep, ping on draw, any-player remove)
describe("Armageddon Clock (doom-counter time bomb)", () => {
    const makeClock = (doom = 0) =>
        makeInstance(armageddonClock.id, {
            id: "clock",
            controllerId: "p1",
            ownerId: "p1",
            ...(doom > 0 ? { counters: { doom } } : {}),
        });

    it("upkeep trigger adds a doom counter", () => {
        const clock = makeClock(0);
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [clock] }),
                makePlayer("p2"),
            ],
        });
        fireTrigger(state, clock, "armageddon-clock-add-doom", {
            type: "PHASE_BEGIN",
            phase: "UPKEEP",
            activePlayerId: "p1",
        });
        const after = state.players[0].battlefield.find(
            (c) => c.id === "clock"
        )!;
        expect(after.counters?.doom).toBe(1);
    });

    it("draw-step trigger deals damage equal to doom counters to each player", () => {
        const clock = makeClock(3);
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [clock], life: 20 }),
                makePlayer("p2", { life: 20 }),
            ],
        });
        fireTrigger(state, clock, "armageddon-clock-ping", {
            type: "PHASE_BEGIN",
            phase: "DRAW",
            activePlayerId: "p1",
        });
        expect(state.players[0].life).toBe(17);
        expect(state.players[1].life).toBe(17);
    });

    it("{4} remove-doom ability is activatable by any player during any upkeep", () => {
        const ability = armageddonClock.activatedAbilities!.find(
            (a) => a.id === "armageddon-clock-remove-doom"
        )!;
        expect(ability.activatableByAnyPlayer).toBe(true);
        expect(ability.activationPhaseRestriction).toEqual(["UPKEEP"]);
        expect(ability.controllerTurnOnly).toBeUndefined();
    });

    it("remove-doom ability resolves: removes one doom counter", () => {
        const clock = makeClock(3);
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [clock] }),
                makePlayer("p2"),
            ],
            phase: "UPKEEP",
            activePlayerId: "p2",
        });
        // Activated by the opponent (p2) during p2's upkeep.
        state.stack.push({
            ...clock,
            zone: "stack",
            castById: "p2",
            abilityId: "armageddon-clock-remove-doom",
            targets: [],
        });
        resolveTopOfStack(state);
        const after = state.players[0].battlefield.find(
            (c) => c.id === "clock"
        )!;
        expect(after.counters?.doom).toBe(2);
    });
});

// Triskelion (CR 122.1 ETB counters, CR 122.6 removal cost, any-target ping)
describe("Triskelion (3 +1/+1 counters, remove-counter → 1 damage)", () => {
    it("ETB applies three +1/+1 counters → 4/4 effective", () => {
        const state = makeState();
        pushSpell(state, triskelion.id, "p1");
        resolveTopOfStack(state);
        const tris = state.players[0].battlefield.find(
            (c) => (c.card as { id: string }).id === triskelion.id
        )!;
        expect(tris.counters?.["+1/+1"]).toBe(3);
        expect(getEffectivePower(state, tris)).toBe(4);
        expect(getEffectiveToughness(state, tris)).toBe(4);
    });

    it("activated ability deals 1 damage to a player (any target)", () => {
        const tris = makeInstance(triskelion.id, {
            id: "tris",
            controllerId: "p1",
            ownerId: "p1",
            counters: { "+1/+1": 3 },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [tris] }),
                makePlayer("p2", { life: 20 }),
            ],
        });
        state.stack.push({
            ...tris,
            zone: "stack",
            castById: "p1",
            abilityId: "triskelion-bolt",
            targets: [{ type: "player", id: "p2" }],
        });
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(19);
    });

    it("removal cost is declared as a +1/+1 counter cost; target is any", () => {
        const ability = triskelion.activatedAbilities![0];
        expect(ability.cost.removeCounter).toEqual({
            type: "+1/+1",
            count: 1,
        });
        expect(ability.targetRequirement).toEqual({ type: "any", count: 1 });
    });

    it("wire format: counter-driven 4/4 survives projectPublicState", () => {
        const tris = makeInstance(triskelion.id, {
            id: "tris",
            controllerId: "p1",
            ownerId: "p1",
            counters: { "+1/+1": 3 },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [tris] }),
                makePlayer("p2"),
            ],
        });
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "tris"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(4);
        expect(getEffectiveToughness(projected, slim)).toBe(4);
    });
});

// Clockwork Avian (CR 122.1 ETB counters, end-of-combat decay, recharge)
describe("Clockwork Avian (4 +1/+0 counters, end-of-combat decay)", () => {
    it("ETB applies four +1/+0 counters → 4/4 effective with flying", () => {
        const state = makeState();
        pushSpell(state, clockworkAvian.id, "p1");
        resolveTopOfStack(state);
        const avian = state.players[0].battlefield.find(
            (c) => (c.card as { id: string }).id === clockworkAvian.id
        )!;
        expect(avian.counters?.["+1/+0"]).toBe(4);
        expect(getEffectivePower(state, avian)).toBe(4);
        expect(getEffectiveToughness(state, avian)).toBe(4);
        expect(clockworkAvian.staticAbilities).toContain("flying");
    });

    it("end-of-combat trigger fires only if it attacked or blocked this combat", () => {
        const state = makeState();
        pushSpell(state, clockworkAvian.id, "p1");
        resolveTopOfStack(state);
        const avian = state.players[0].battlefield.find(
            (c) => (c.card as { id: string }).id === clockworkAvian.id
        )!;
        const trig = clockworkAvian.triggeredAbilities![0];
        const event = {
            type: "PHASE_BEGIN" as const,
            phase: "END_OF_COMBAT" as const,
            activePlayerId: "p1",
        };
        expect(trig.matches(event, avian, state)).toBe(false);
        avian.hasAttackedThisTurn = true;
        expect(trig.matches(event, avian, state)).toBe(true);
    });

    it("recharge ability adds up to X +1/+0 counters, capped at 4 total", () => {
        const avian = makeInstance(clockworkAvian.id, {
            id: "avian",
            controllerId: "p1",
            ownerId: "p1",
            counters: { "+1/+0": 1 },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [avian] }),
                makePlayer("p2"),
            ],
            phase: "UPKEEP",
        });
        state.stack.push({
            ...avian,
            zone: "stack",
            castById: "p1",
            abilityId: "clockwork-avian-recharge",
            chosenX: 5,
            targets: [],
        });
        resolveTopOfStack(state);
        const after = state.players[0].battlefield.find(
            (c) => c.id === "avian"
        )!;
        // 1 existing + min(5, room=3) = 4, capped at four.
        expect(after.counters?.["+1/+0"]).toBe(4);
    });

    it("recharge ability is restricted to the controller's upkeep", () => {
        const ability = clockworkAvian.activatedAbilities!.find(
            (a) => a.id === "clockwork-avian-recharge"
        )!;
        expect(ability.activationPhaseRestriction).toEqual(["UPKEEP"]);
        expect(ability.controllerTurnOnly).toBe(true);
    });

    it("wire format: counter-driven 4/4 survives projectPublicState", () => {
        const avian = makeInstance(clockworkAvian.id, {
            id: "avian",
            controllerId: "p1",
            ownerId: "p1",
            counters: { "+1/+0": 4 },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [avian] }),
                makePlayer("p2"),
            ],
        });
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "avian"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(4);
        expect(getEffectiveToughness(projected, slim)).toBe(4);
    });
});

// ===========================================================================
// P/T statics, combat & one-shot prevention shields (#277)
// ===========================================================================

// Mightstone / Weakstone (CR 611 layer 7c anthem on attacking creatures)
describe("Mightstone (attacking creatures get +1/+0, CR 611)", () => {
    /** A 2/2 vanilla creature; `attacking` toggles the combat-role flag the
     *  anthem reads. */
    function setup(attacking: boolean) {
        const stone = makeInstance(mightstone.id, {
            id: "stone",
            controllerId: "p1",
            ownerId: "p1",
        });
        const bear = vanilla("bear", 2, 2, {
            controllerId: "p2",
            ownerId: "p2",
            isAttacking: attacking,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [stone] }),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        return { state, bear };
    }

    it("buffs an attacking creature (+1/+0) but not a non-attacking one", () => {
        const idle = setup(false);
        expect(getEffectivePower(idle.state, idle.bear)).toBe(2);
        const atk = setup(true);
        expect(getEffectivePower(atk.state, atk.bear)).toBe(3);
        expect(getEffectiveToughness(atk.state, atk.bear)).toBe(2);
    });

    it("affects creatures of EITHER controller (no 'you control' clause)", () => {
        const stone = makeInstance(mightstone.id, { id: "stone" });
        const mine = vanilla("mine", 1, 1, {
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [stone, mine] }),
                makePlayer("p2"),
            ],
        });
        expect(getEffectivePower(state, mine)).toBe(2);
    });

    it("wire format: the +1/+0 survives projectPublicState", () => {
        const { state, bear } = setup(true);
        // Fat state.
        expect(getEffectivePower(state, bear)).toBe(3);
        // Projected state — the anthem must still apply.
        const projected = projectPublicState(state, 1, "p2");
        const slim = projected.players[1].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(3);
        expect(getEffectiveToughness(projected, slim)).toBe(2);
    });
});

describe("Weakstone (attacking creatures get -1/-0, CR 611)", () => {
    function setup(attacking: boolean) {
        const stone = makeInstance(weakstone.id, { id: "stone" });
        const bear = vanilla("bear", 2, 2, {
            controllerId: "p2",
            ownerId: "p2",
            isAttacking: attacking,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [stone] }),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        return { state, bear };
    }

    it("debuffs an attacking creature (-1/-0) only", () => {
        expect(getEffectivePower(setup(false).state, setup(false).bear)).toBe(
            2
        );
        const atk = setup(true);
        expect(getEffectivePower(atk.state, atk.bear)).toBe(1);
        expect(getEffectiveToughness(atk.state, atk.bear)).toBe(2);
    });

    it("wire format: the -1/-0 survives projectPublicState", () => {
        const { state, bear } = setup(true);
        expect(getEffectivePower(state, bear)).toBe(1);
        const projected = projectPublicState(state, 1, "p2");
        const slim = projected.players[1].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(1);
    });
});

// Staff of Zegon (CR 611.1 temporary -2/-0)
describe("Staff of Zegon ({3},{T}: target -2/-0 EOT, CR 611.1)", () => {
    it("applies a -2/-0 temporary buff to the chosen creature", () => {
        const staff = makeInstance(staffOfZegon.id, { id: "staff" });
        const bear = vanilla("bear", 3, 3, { controllerId: "p1" });
        const state = makeState({
            players: [makePlayer("p1", { battlefield: [staff, bear] })],
        });
        resolveActivated(state, staff, "staff-of-zegon-weaken", [
            { type: "permanent", id: "bear" },
        ]);
        const live = state.players[0].battlefield.find((c) => c.id === "bear")!;
        expect(getEffectivePower(state, live)).toBe(1);
        expect(getEffectiveToughness(state, live)).toBe(3);
    });
});

// Mishra's Factory (CR 611.1 animate manland + Assembly-Worker pump)
describe("Mishra's Factory (animate + Assembly-Worker pump, CR 611.1)", () => {
    it("{T}: Add {C} is a non-stack mana ability", () => {
        const mana = mishrasFactory.activatedAbilities!.find(
            (a) => a.id === "mishras-factory-mana"
        )!;
        expect(mana.useStack).toBe(false);
        expect(mana.manaProduced).toEqual({ C: 1 });
    });

    it("animates the land into a 2/2 Assembly-Worker artifact creature (still a land)", () => {
        const factory = makeInstance(mishrasFactory.id, {
            id: "factory",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [makePlayer("p1", { battlefield: [factory] })],
        });
        resolveActivated(state, factory, "mishras-factory-animate");
        const live = state.players[0].battlefield.find(
            (c) => c.id === "factory"
        )!;
        // CR 208.2 — "2/2 Assembly-Worker artifact creature ... still a land".
        expect(live.types).toEqual(
            expect.arrayContaining(["Land", "Creature", "Artifact"])
        );
        expect(live.subtypes).toContain("Assembly-Worker");
        expect(getEffectivePower(state, live)).toBe(2);
        expect(getEffectiveToughness(state, live)).toBe(2);
    });

    // Issue #547 — while animated the Factory is an Artifact, so "destroy
    // target artifact" effects (Shatter) can target and destroy it (CR 208.2).
    describe("artifact type while animated (CR 208.2, issue #547)", () => {
        const animatedFactoryState = () => {
            const factory = makeInstance(mishrasFactory.id, {
                id: "factory",
                controllerId: "p1",
                ownerId: "p1",
            });
            const state = makeState({
                players: [
                    makePlayer("p1", { battlefield: [factory] }),
                    makePlayer("p2"),
                ],
            });
            resolveActivated(state, factory, "mishras-factory-animate");
            return state;
        };

        it("Shatter lists the animated Factory as a legal artifact target", () => {
            const state = animatedFactoryState();
            const legal = getLegalTargets(
                state,
                shatter.targetRequirement!,
                [],
                "p2"
            ).map((t) => t.id);
            expect(legal).toContain("factory");
        });

        it("Shatter accepts and destroys the animated Factory", () => {
            const state = animatedFactoryState();
            pushSpell(state, shatter.id, "p2", [
                { type: "permanent", id: "factory" },
            ]);
            resolveTopOfStack(state);
            expect(state.players[0].battlefield.map((c) => c.id)).not.toContain(
                "factory"
            );
            expect(state.players[0].graveyard.map((c) => c.id)).toContain(
                "factory"
            );
        });

        it("the added Artifact type reverts at end of turn if not destroyed (CR 514.2)", () => {
            const state = animatedFactoryState();
            state.activePlayerId = "p1";
            state.turn = 1;
            state.phase = "END_STEP" as GameState["phase"];
            // p1's hand is empty → no cleanup discard, so advancePhase runs
            // through CLEANUP's tickAllDurations and reverts the animation.
            advancePhase(state);
            const live = [
                ...state.players[0].battlefield,
                ...state.players[1].battlefield,
            ].find((c) => c.id === "factory")!;
            expect(live.types).toEqual(["Land"]);
            expect(live.animation).toBeUndefined();
        });

        it("wire format: projected animated Factory still exposes the Artifact type", () => {
            const state = animatedFactoryState();
            // Fat-state legality: p2 can Shatter it.
            const fatLegal = getLegalTargets(
                state,
                shatter.targetRequirement!,
                [],
                "p2"
            ).map((t) => t.id);
            expect(fatLegal).toContain("factory");
            // The projection must preserve `types` so client target legality
            // matches the server (CardInstanceState.types survives projection).
            const projected = projectPublicState(state, 0, "p2");
            const slim = projected.players[0].battlefield.find(
                (c) => c.id === "factory"
            )!;
            expect(slim.types).toEqual(
                expect.arrayContaining(["Land", "Creature", "Artifact"])
            );
        });
    });

    it("pumps a targeted Assembly-Worker +1/+1 EOT", () => {
        const factory = makeInstance(mishrasFactory.id, {
            id: "factory",
            controllerId: "p1",
            ownerId: "p1",
        });
        const worker = vanilla("worker", 2, 2, {
            controllerId: "p1",
            subtypes: ["Assembly-Worker"],
        });
        const state = makeState({
            players: [makePlayer("p1", { battlefield: [factory, worker] })],
        });
        resolveActivated(state, factory, "mishras-factory-pump", [
            { type: "permanent", id: "worker" },
        ]);
        const live = state.players[0].battlefield.find(
            (c) => c.id === "worker"
        )!;
        expect(getEffectivePower(state, live)).toBe(3);
        expect(getEffectiveToughness(state, live)).toBe(3);
    });

    it("the pump only lists Assembly-Worker creatures as legal targets", () => {
        const factory = makeInstance(mishrasFactory.id, {
            id: "factory",
            controllerId: "p1",
            ownerId: "p1",
        });
        const worker = vanilla("worker", 2, 2, {
            controllerId: "p1",
            subtypes: ["Assembly-Worker"],
        });
        const bear = vanilla("bear", 2, 2, { controllerId: "p1" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [factory, worker, bear] }),
            ],
        });
        const ability = mishrasFactory.activatedAbilities!.find(
            (a) => a.id === "mishras-factory-pump"
        )!;
        const legal = getLegalTargets(
            state,
            ability.targetRequirement!,
            [],
            "p1"
        ).map((t) => t.id);
        expect(legal).toContain("worker");
        expect(legal).not.toContain("bear");
    });

    // CR 302.6 — a permanent that becomes a creature is summoning-sick unless
    // it has been under its controller's control continuously since the start
    // of their most recent turn. A manland animated the turn it entered cannot
    // attack and cannot pay {T}; one controlled since a prior turn can. The
    // control-continuity flag is set at entry and cleared at the controller's
    // untap step — animation itself never touches it (class-wide across every
    // animate effect). Issue #545.
    describe("summoning sickness on the animated land (CR 302.6)", () => {
        /** Animate a Factory, returning the live instance. */
        const animate = (factory: CardInstanceState, state: GameState) => {
            resolveActivated(state, factory, "mishras-factory-animate");
            return state.players[0].battlefield.find(
                (c) => c.id === factory.id
            )!;
        };

        it("a Factory played this turn, animated this turn, is NOT a legal attacker", () => {
            // Enter via the play-land path so the control-continuity flag is set.
            const factory = makeInstance(mishrasFactory.id, {
                id: "factory",
                controllerId: "p1",
                ownerId: "p1",
                zone: "hand",
            });
            let state = makeState({
                players: [makePlayer("p1", { hand: [factory] })],
            });
            state = applyMoveForSearch(state, "p1", {
                kind: "play-land",
                cardInstanceId: "factory",
            });
            const played = state.players[0].battlefield.find(
                (c) => c.id === "factory"
            )!;
            expect(played.isSummoningSick).toBe(true);

            const live = animate(played, state);
            expect(live.types).toContain("Creature");
            expect(live.isSummoningSick).toBe(true);
            const result = validateAttackerEligibility(live);
            expect(result.eligible).toBe(false);
            if (!result.eligible) {
                expect(result.reason).toMatch(/summoning sickness/i);
            }

            // Wire format: the sickness flag survives projection, so a client
            // also sees the animated manland as an ineligible attacker.
            const projected = projectPublicState(state, 1, "p1");
            const slim = projected.players[0].battlefield.find(
                (c) => c.id === "factory"
            )!;
            expect(slim.isSummoningSick).toBe(true);
            expect(validateAttackerEligibility(slim).eligible).toBe(false);
        });

        it("a Factory controlled since a prior turn, animated this turn, IS a legal attacker", () => {
            // Already on the battlefield, flag cleared at a prior untap step.
            const factory = makeInstance(mishrasFactory.id, {
                id: "factory",
                controllerId: "p1",
                ownerId: "p1",
                // isSummoningSick undefined
            });
            const state = makeState({
                players: [makePlayer("p1", { battlefield: [factory] })],
            });
            const live = animate(factory, state);
            expect(live.types).toContain("Creature");
            expect(live.isSummoningSick).toBeUndefined();
            expect(validateAttackerEligibility(live).eligible).toBe(true);
        });

        it("the {T} pump ability is tap-locked while the animated Factory is summoning-sick", () => {
            const factory = makeInstance(mishrasFactory.id, {
                id: "factory",
                controllerId: "p1",
                ownerId: "p1",
                isSummoningSick: true, // entered this turn
            });
            const state = makeState({
                players: [makePlayer("p1", { battlefield: [factory] })],
            });
            const live = animate(factory, state);
            // CR 302.6 — the creature can't pay {T} (covers both the mana and
            // the pump abilities) the turn it was animated after entering.
            expect(isTapLockedBySummoningSickness(live)).toBe(true);
        });

        it("the {T} ability is NOT tap-locked once controlled since a prior turn", () => {
            const factory = makeInstance(mishrasFactory.id, {
                id: "factory",
                controllerId: "p1",
                ownerId: "p1",
                // isSummoningSick undefined — controlled since a prior turn
            });
            const state = makeState({
                players: [makePlayer("p1", { battlefield: [factory] })],
            });
            const live = animate(factory, state);
            expect(isTapLockedBySummoningSickness(live)).toBe(false);
        });

        it("the untap step clears the control-continuity flag so the Factory can attack next turn", () => {
            const factory = makeInstance(mishrasFactory.id, {
                id: "factory",
                controllerId: "p1",
                ownerId: "p1",
                isSummoningSick: true, // entered this turn
            });
            const state = makeState({
                players: [
                    makePlayer("p1", { battlefield: [factory] }),
                    makePlayer("p2"),
                ],
                activePlayerId: "p1",
                phase: "BEGINNING" as GameState["phase"],
            });
            // Controller's next untap step clears the flag (CR 502.4 / 302.6).
            untapStep(state);
            const after = state.players[0].battlefield.find(
                (c) => c.id === "factory"
            )!;
            expect(after.isSummoningSick).toBeUndefined();
            const live = animate(after, state);
            expect(validateAttackerEligibility(live).eligible).toBe(true);
        });
    });
});

// Regression: the AUTHORITATIVE game.ts `playCard` play-land path must set the
// summoning-sickness clock (CR 302.6). #545 added `markEnteredThisTurn` to the
// Bot simulator (`applyMoveForSearch`) and to `putOnBattlefield`, but NOT to the
// `playCard` mutation — so in a REAL game a played land never became sick and a
// manland animated turn 1 could illegally attack. The #545 test above passed
// because it exercised `applyMoveForSearch` (the simulator), which DID mark the
// flag — classic GRE→game.ts boundary drift. These tests mirror the EXACT
// sequence the fixed `playCard` mutation runs (the shared `applyPlayLand`
// helper, since there is no convex-test harness), proving both call sites now
// share the same canonical core and cannot diverge again.
describe("game.ts playCard play-land path is summoning-sick (CR 302.6)", () => {
    /** Mirror the body of the authoritative `playCard` mutation: it validates
     *  (omitted here — covered by the action-legality tests) then calls the
     *  shared `applyPlayLand(state, player, id)`. */
    const playLandViaMutationPath = (state: GameState, id: string) => {
        const player = getPlayer(state, "p1");
        return applyPlayLand(state, player, id)!;
    };

    it("a Land played this turn via playCard is summoning-sick", () => {
        const factory = makeInstance(mishrasFactory.id, {
            id: "factory",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [makePlayer("p1", { hand: [factory] })],
        });
        const played = playLandViaMutationPath(state, "factory");
        expect(played.zone).toBe("battlefield");
        expect(played.isSummoningSick).toBe(true);
        // CR 305.2 — the land drop was recorded.
        expect(state.players[0].landsPlayedThisTurn).toBe(1);
    });

    it("a Mishra's Factory played AND animated this turn (via playCard) is NOT a legal attacker", () => {
        const factory = makeInstance(mishrasFactory.id, {
            id: "factory",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [makePlayer("p1", { hand: [factory] })],
        });
        playLandViaMutationPath(state, "factory");

        // Animate the freshly-played manland this same turn.
        resolveActivated(
            state,
            state.players[0].battlefield.find((c) => c.id === "factory")!,
            "mishras-factory-animate"
        );
        const live = state.players[0].battlefield.find(
            (c) => c.id === "factory"
        )!;
        expect(live.types).toContain("Creature");
        expect(live.isSummoningSick).toBe(true);
        const result = validateAttackerEligibility(live);
        expect(result.eligible).toBe(false);
        if (!result.eligible) {
            expect(result.reason).toMatch(/summoning sickness/i);
        }

        // Wire format: the flag survives projection — a client also sees the
        // animated manland as an ineligible attacker.
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "factory"
        )!;
        expect(slim.isSummoningSick).toBe(true);
        expect(validateAttackerEligibility(slim).eligible).toBe(false);
    });

    it("a Mishra's Factory controlled since a PRIOR turn, animated this turn, IS a legal attacker", () => {
        // Already on the battlefield (flag cleared at a prior untap step) — not
        // routed through the play-land path this turn.
        const factory = makeInstance(mishrasFactory.id, {
            id: "factory",
            controllerId: "p1",
            ownerId: "p1",
            // isSummoningSick undefined
        });
        const state = makeState({
            players: [makePlayer("p1", { battlefield: [factory] })],
        });
        resolveActivated(state, factory, "mishras-factory-animate");
        const live = state.players[0].battlefield.find(
            (c) => c.id === "factory"
        )!;
        expect(live.types).toContain("Creature");
        expect(live.isSummoningSick).toBeUndefined();
        expect(validateAttackerEligibility(live).eligible).toBe(true);
    });

    it("both call sites (game.ts playCard + Bot applyMoveForSearch) set the same flag via the shared helper", () => {
        // Structural cross-check: playing the same manland through each path
        // yields the identical summoning-sickness clock — proof the paths share
        // `applyPlayLand` and cannot drift.
        const make = () =>
            makeInstance(mishrasFactory.id, {
                id: "factory",
                controllerId: "p1",
                ownerId: "p1",
                zone: "hand",
            });

        const mutationState = makeState({
            players: [makePlayer("p1", { hand: [make()] })],
        });
        playLandViaMutationPath(mutationState, "factory");

        let simState = makeState({
            players: [makePlayer("p1", { hand: [make()] })],
        });
        simState = applyMoveForSearch(simState, "p1", {
            kind: "play-land",
            cardInstanceId: "factory",
        });

        const fromMutation = mutationState.players[0].battlefield.find(
            (c) => c.id === "factory"
        )!;
        const fromSim = simState.players[0].battlefield.find(
            (c) => c.id === "factory"
        )!;
        expect(fromMutation.isSummoningSick).toBe(true);
        expect(fromSim.isSummoningSick).toBe(true);
        expect(fromMutation.isSummoningSick).toBe(fromSim.isSummoningSick);
    });
});

// Battering Ram (CR 702.21 banding grant + blocked-by-Wall destroy)
describe("Battering Ram (banding grant + destroy blocking Wall)", () => {
    it("grants banding at the beginning of combat on your turn", () => {
        const ram = makeInstance(batteringRam.id, {
            id: "ram",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [makePlayer("p1", { battlefield: [ram] })],
            phase: "BEGINNING_OF_COMBAT",
        });
        fireTrigger(state, ram, "battering-ram-banding", {
            type: "PHASE_BEGIN",
            phase: "BEGINNING_OF_COMBAT",
            activePlayerId: "p1",
        });
        const live = state.players[0].battlefield.find((c) => c.id === "ram")!;
        expect(live.staticAbilities).toContain("banding");
    });

    it("the wall trigger fires only when blocked BY a Wall", () => {
        const trig = batteringRam.triggeredAbilities!.find(
            (t) => t.id === "battering-ram-wall-destroy"
        )!;
        const ramSelf = { id: "ram" } as CardInstanceState;
        const wallBlock = blockEvent("ram", "wall", ["Wall"]);
        const nonWallBlock = blockEvent("ram", "wall", ["Bear"]);
        expect(trig.matches(wallBlock, ramSelf)).toBe(true);
        expect(trig.matches(nonWallBlock, ramSelf)).toBe(false);
        // Does not fire when the Ram is the blocker (only when it's blocked).
        expect(
            trig.matches(
                { ...wallBlock, attackerId: "other", blockerId: "ram" },
                ramSelf
            )
        ).toBe(false);
    });

    it("schedules a next-end-of-combat destroy of the blocking Wall", () => {
        const ram = makeInstance(batteringRam.id, {
            id: "ram",
            controllerId: "p1",
            ownerId: "p1",
        });
        const wall = vanilla("wall", 0, 4, {
            controllerId: "p2",
            ownerId: "p2",
            subtypes: ["Wall"],
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [ram] }),
                makePlayer("p2", { battlefield: [wall] }),
            ],
            phase: "DECLARE_BLOCKERS",
        });
        fireTrigger(
            state,
            ram,
            "battering-ram-wall-destroy",
            blockEvent("ram", "wall", ["Wall"])
        );
        // A delayed trigger should now be queued to destroy the Wall. The
        // inline delayedTrigger Op (ADR 0048/0049) captures the Wall under the
        // binding name `$wall` (a $-prefixed capture key), where the legacy
        // resolve() used the payload key `targetId`.
        expect(
            state.delayedTriggers?.some((d) => d.payload["$wall"] === "wall")
        ).toBe(true);
    });
});

// Urza's Avenger (CR 611.1 -1/-1 + chosen keyword, modeled as 4 abilities)
describe("Urza's Avenger ({0}: -1/-1 + chosen keyword EOT)", () => {
    it("exposes one ability per keyword (banding/flying/first strike/trample)", () => {
        const ids = urzasAvenger.activatedAbilities!.map((a) => a.id);
        expect(ids).toEqual([
            "urzas-avenger-banding",
            "urzas-avenger-flying",
            "urzas-avenger-first-strike",
            "urzas-avenger-trample",
        ]);
    });

    it("activating flying gives -1/-1 and grants flying until EOT", () => {
        const avenger = makeInstance(urzasAvenger.id, {
            id: "avenger",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [makePlayer("p1", { battlefield: [avenger] })],
        });
        resolveActivated(state, avenger, "urzas-avenger-flying");
        const live = state.players[0].battlefield.find(
            (c) => c.id === "avenger"
        )!;
        expect(getEffectivePower(state, live)).toBe(3);
        expect(getEffectiveToughness(state, live)).toBe(3);
        expect(live.staticAbilities).toContain("flying");
    });

    it("activating first strike grants first strike (not flying)", () => {
        const avenger = makeInstance(urzasAvenger.id, {
            id: "avenger",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [makePlayer("p1", { battlefield: [avenger] })],
        });
        resolveActivated(state, avenger, "urzas-avenger-first-strike");
        const live = state.players[0].battlefield.find(
            (c) => c.id === "avenger"
        )!;
        expect(live.staticAbilities).toContain("first strike");
        expect(live.staticAbilities).not.toContain("flying");
    });
});

// Amulet of Kroog / Argivian Blacksmith / Rakalite (CR 615.1 prevention shields)
describe("Amulet of Kroog (prevent next 1 to any target, CR 615.1)", () => {
    it("registers a 1-damage shield on the chosen target", () => {
        const amulet = makeInstance(amuletOfKroog.id, { id: "amulet" });
        const bear = vanilla("bear", 2, 2, { controllerId: "p1" });
        const state = makeState({
            players: [makePlayer("p1", { battlefield: [amulet, bear] })],
        });
        resolveActivated(state, amulet, "amulet-of-kroog-prevent", [
            { type: "permanent", id: "bear" },
        ]);
        expect(state.targetPreventionShields).toEqual([
            {
                targetType: "permanent",
                targetId: "bear",
                remaining: 1,
                duration: { phase: "end-of-turn" },
            },
        ]);
    });

    it("can shield a player target too", () => {
        const amulet = makeInstance(amuletOfKroog.id, { id: "amulet" });
        const state = makeState({
            players: [makePlayer("p1", { battlefield: [amulet] })],
        });
        resolveActivated(state, amulet, "amulet-of-kroog-prevent", [
            { type: "player", id: "p1" },
        ]);
        expect(state.targetPreventionShields?.[0]).toMatchObject({
            targetType: "player",
            targetId: "p1",
            remaining: 1,
        });
    });
});

describe("Rakalite (prevent next 1, return self next end step, CR 615.1)", () => {
    it("registers a 1-damage shield and schedules a next-end-step return", () => {
        const rk = makeInstance(rakalite.id, {
            id: "rk",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [makePlayer("p1", { battlefield: [rk] })],
        });
        resolveActivated(state, rk, "rakalite-prevent", [
            { type: "player", id: "p1" },
        ]);
        expect(state.targetPreventionShields?.[0]).toMatchObject({
            targetId: "p1",
            remaining: 1,
        });
        // Migrated to the `delayedTrigger` Op (ADR 0048, #845): the scheduled
        // self-bounce now carries its captured source under the inline-body
        // capture key `$self` (the Rocket Launcher shape) instead of the old
        // template `payload.instanceId`. Same behaviour (a next-end-step return
        // trigger scheduled for "rk"), new payload representation.
        expect(
            state.delayedTriggers?.some((d) => d.payload.$self === "rk")
        ).toBe(true);
    });
});

// Ashnod's Transmogrant (CR 122.1 +1/+1 counter; artifact-type clause deferred)
describe("Ashnod's Transmogrant ({T}, sac: +1/+1 on nonartifact creature)", () => {
    it("puts a +1/+1 counter on the targeted nonartifact creature", () => {
        const trans = makeInstance(ashnodsTransmogrant.id, {
            id: "trans",
            controllerId: "p1",
            ownerId: "p1",
        });
        const bear = vanilla("bear", 2, 2, { controllerId: "p1" });
        const state = makeState({
            players: [makePlayer("p1", { battlefield: [trans, bear] })],
        });
        resolveActivated(state, trans, "ashnods-transmogrant-counter", [
            { type: "permanent", id: "bear" },
        ]);
        const live = state.players[0].battlefield.find((c) => c.id === "bear")!;
        expect(live.counters?.["+1/+1"]).toBe(1);
        expect(getEffectivePower(state, live)).toBe(3);
        expect(getEffectiveToughness(state, live)).toBe(3);
    });

    it("excludes artifact creatures from legal targets (nonartifact only)", () => {
        const trans = makeInstance(ashnodsTransmogrant.id, { id: "trans" });
        const robot = makeInstance(ornithopter.id, {
            id: "robot",
            controllerId: "p1",
            ownerId: "p1",
        });
        const bear = vanilla("bear", 2, 2, { controllerId: "p1" });
        const state = makeState({
            players: [makePlayer("p1", { battlefield: [trans, robot, bear] })],
        });
        const ability = ashnodsTransmogrant.activatedAbilities![0];
        const legal = getLegalTargets(
            state,
            ability.targetRequirement!,
            [],
            "p1"
        ).map((t) => t.id);
        expect(legal).toContain("bear");
        expect(legal).not.toContain("robot");
    });
});

// Mishra's War Machine (CR 603.6a upkeep discard-or-3+tap)
describe("Mishra's War Machine (upkeep discard or 3 + tap)", () => {
    it("has banding", () => {
        expect(mishrasWarMachine.staticAbilities).toContain("banding");
    });

    it("with an empty hand, deals 3 to controller and taps itself", () => {
        const machine = makeInstance(mishrasWarMachine.id, {
            id: "machine",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [makePlayer("p1", { battlefield: [machine], hand: [] })],
            phase: "UPKEEP",
        });
        fireTrigger(state, machine, "mishras-war-machine-upkeep", {
            type: "PHASE_BEGIN",
            phase: "UPKEEP",
            activePlayerId: "p1",
        });
        const live = state.players[0].battlefield.find(
            (c) => c.id === "machine"
        )!;
        expect(state.players[0].life).toBe(17);
        expect(live.isTapped).toBe(true);
    });

    it("declining the discard deals 3 and taps", () => {
        const machine = makeInstance(mishrasWarMachine.id, {
            id: "machine",
            controllerId: "p1",
            ownerId: "p1",
        });
        const card = makeInstance(ornithopter.id, {
            id: "card",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [machine], hand: [card] }),
            ],
            phase: "UPKEEP",
        });
        fireTrigger(
            state,
            machine,
            "mishras-war-machine-upkeep",
            { type: "PHASE_BEGIN", phase: "UPKEEP", activePlayerId: "p1" },
            false
        );
        expect(state.players[0].life).toBe(17);
        expect(state.players[0].hand).toHaveLength(1);
    });
});

describe("Ashnod's Altar (CR 602.1 — sacrifice a creature: add {C}{C})", () => {
    it("declares a creature sacrifice cost and no tap", () => {
        const ability = ashnodsAltar.activatedAbilities![0];
        expect(ability.cost.sacrificeFilter).toEqual({ types: "Creature" });
        expect(ability.cost.tap).toBeUndefined();
    });

    it("adds {C}{C} on resolution", () => {
        const altar = makeInstance(ashnodsAltar.id, { id: "altar-1" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [altar] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, altar, "ashnods-altar-mana");
        expect(state.players[0].manaPool.C).toBe(2);
    });
});

// ---------------------------------------------------------------------------
// Mishra's Workshop — restricted mana "artifact-spell" (cluster M, #283)
//   "{T}: Add {C}{C}{C}. Spend this mana only to cast artifact spells."
//   CR 106.6 (restricted mana) / CR 500.4 (empties at end of step/phase).
//   ADR 0022 — reuses the restricted-mana storage/serialization/emptying/
//   settlement machinery; only a new union member + ability field.
// ---------------------------------------------------------------------------

describe("Mishra's Workshop (restricted mana 'artifact-spell', CR 106.6)", () => {
    /** Tap a Mishra's Workshop into the controller's pool exactly as the
     *  tapUntap mutation's fixed-mana branch does: route the produced mana
     *  into `restrictedMana` (not the fungible pool) under the ability's
     *  declared restriction. */
    function tapWorkshop(state: GameState): void {
        const ws = state.players[0].battlefield.find(
            (c) => (c.card as { id: string }).id === mishrasWorkshop.id
        )!;
        ws.isTapped = true;
        const restriction = getActivatedManaRestriction(ws)!;
        addRestrictedManaToPool(state.players[0], "C", 3, restriction);
    }

    it("is a Land whose mana ability declares the artifact-spell restriction", () => {
        const def = getDefinition(mishrasWorkshop.id);
        expect(def.name).toBe("Mishra's Workshop");
        expect(def.types).toEqual(["Land"]);
        const ability = def.activatedAbilities?.[0];
        expect(ability?.cost.tap).toBe(true);
        expect(ability?.useStack).toBe(false);
        expect(ability?.manaProduced).toEqual({ C: 3 });
        expect(ability?.manaRestriction).toBe("artifact-spell");
    });

    it("getActivatedManaRestriction reads the restriction off the instance", () => {
        const ws = makeInstance(mishrasWorkshop.id);
        expect(getActivatedManaRestriction(ws)).toBe("artifact-spell");
        // A plain land mana ability carries no restriction.
        const factory = makeInstance(mishrasFactory.id);
        expect(getActivatedManaRestriction(factory)).toBeNull();
    });

    it("restrictionAllowsSpell gates artifact spells only", () => {
        expect(restrictionAllowsSpell("artifact-spell", ["Artifact"])).toBe(
            true
        );
        expect(
            restrictionAllowsSpell("artifact-spell", ["Artifact", "Creature"])
        ).toBe(true);
        expect(restrictionAllowsSpell("artifact-spell", ["Creature"])).toBe(
            false
        );
        expect(restrictionAllowsSpell("artifact-spell", ["Sorcery"])).toBe(
            false
        );
    });

    it("tapping produces three colorless mana in the restricted pool, not the fungible pool", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [makeInstance(mishrasWorkshop.id)],
                }),
                makePlayer("p2"),
            ],
        });
        tapWorkshop(state);
        expect(state.players[0].restrictedMana).toEqual([
            { color: "C", amount: 3, restriction: "artifact-spell" },
        ]);
        // Nothing leaks into the fungible pool.
        expect(state.players[0].manaPool.C).toBe(0);
    });

    // Integration across the GRE -> game.ts spell-cast boundary: mirror the
    // affordability check + payment the cast mutations perform (CR 106.6).
    it("pays an artifact spell from restricted mana but rejects a noncreature non-artifact spell and an ability", () => {
        const subs = getManaSubstitutionsEmpty();
        // Urza's Chalice — {1} Artifact. Restricted {C} pays the generic pip.
        const artifactCost = normalizeManaCost(
            getInstanceManaCost(
                makeInstance(urzasChaliceDef.id, { zone: "hand" })
            )!,
            { chosenX: 1 }
        );
        const artifactTypes = getDefinition(urzasChaliceDef.id).types;

        const caster = makePlayer("p1", {
            restrictedMana: [
                { color: "C", amount: 3, restriction: "artifact-spell" },
            ],
        });
        expect(
            isManaCostCovered(
                spendablePoolForSpell(caster, artifactTypes),
                artifactCost,
                subs
            )
        ).toBe(true);
        payManaCostForSpell(caster, artifactCost, artifactTypes, subs);
        expect(caster.restrictedMana).toEqual([
            { color: "C", amount: 2, restriction: "artifact-spell" },
        ]);
        expect(caster.manaPool.C).toBe(0);

        // The same pool can NOT pay a non-artifact spell (e.g. a Sorcery).
        const sorcererPlayer = makePlayer("p1", {
            restrictedMana: [
                { color: "C", amount: 3, restriction: "artifact-spell" },
            ],
        });
        expect(
            isManaCostCovered(
                spendablePoolForSpell(sorcererPlayer, ["Sorcery"]),
                { X: 1 },
                subs
            )
        ).toBe(false);

        // ...nor an activated ability: those payment sites never consult
        // restrictedMana (ADR 0022), so the restricted pool is invisible there.
        // Modelled by the absence of any spendablePool helper on the ability
        // path — the fungible pool alone is { C: 0 }, which can't pay { X: 1 }.
        expect(isManaCostCovered(sorcererPlayer.manaPool, { X: 1 }, subs)).toBe(
            false
        );
    });

    it("empties the restricted mana at end of step/phase (CR 500.4)", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [makeInstance(mishrasWorkshop.id)],
                }),
                makePlayer("p2"),
            ],
        });
        tapWorkshop(state);
        expect(state.players[0].restrictedMana).toHaveLength(1);
        // advancePhase runs emptyManaPools, which clears restrictedMana too.
        advancePhase(state);
        expect(state.players[0].restrictedMana).toBeUndefined();
    });

    it("is excluded from the auto-tap solver (restricted mana stays manual)", () => {
        const battlefield = [
            makeInstance(mishrasWorkshop.id),
            makeInstance(stripMine.id), // {T}: Add {C} — a plain mana land
        ];
        const sources = buildAutoTapSources(battlefield);
        const ids = sources.map((s) => s.cardId);
        const wsId = battlefield[0].id;
        expect(ids).not.toContain(wsId);
        // The unrestricted land is still solver-visible.
        expect(ids).toContain(battlefield[1].id);
    });

    it("restricted mana survives the wire projection (CR 106.6)", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [makeInstance(mishrasWorkshop.id)],
                }),
                makePlayer("p2"),
            ],
        });
        tapWorkshop(state);
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[0].restrictedMana).toEqual([
            { color: "C", amount: 3, restriction: "artifact-spell" },
        ]);
    });
});

// ---------------------------------------------------------------------------
// Urza land trio — board-conditional mana (cluster I, #284)
//   Mine / Power Plant each "{T}: Add {C}. If you control [the other two],
//   add {C}{C} instead." Tower adds {C}{C}{C} when assembled.
//   CR 106.1 (mana production), CR 605.1a (intrinsic mana ability), CR 205.3
//   (subtype-keyed condition). Output recomputes from the controller's
//   battlefield at activation time via the ability's `manaAmount` hook;
//   `manaProduced` carries the representative assembled output (Mana Flare).
// ---------------------------------------------------------------------------

describe("Urza land trio (board-conditional mana, CR 106.1)", () => {
    const TRIO = [
        {
            def: urzasMine,
            name: "Urza's Mine",
            subtype: "Urza's Mine",
            assembled: 2,
        },
        {
            def: urzasPowerPlant,
            name: "Urza's Power Plant",
            subtype: "Urza's Power-Plant",
            assembled: 2,
        },
        {
            def: urzasTower,
            name: "Urza's Tower",
            subtype: "Urza's Tower",
            assembled: 3,
        },
    ] as const;

    /** The controller's battlefield holding the named subset of the trio. */
    function battlefieldWith(
        subtypes: readonly (
            | "Urza's Mine"
            | "Urza's Power-Plant"
            | "Urza's Tower"
        )[]
    ): CardInstanceState[] {
        const bySubtype = {
            "Urza's Mine": urzasMine.id,
            "Urza's Power-Plant": urzasPowerPlant.id,
            "Urza's Tower": urzasTower.id,
        } as const;
        return subtypes.map((s) => makeInstance(bySubtype[s]));
    }

    it("each land is a colorless mana Land carrying its Urza subtype", () => {
        for (const { def, name, subtype } of TRIO) {
            const looked = getDefinition(def.id);
            expect(looked.name).toBe(name);
            expect(looked.types).toEqual(["Land"]);
            expect(looked.subtypes).toEqual([subtype]);
            const ability = looked.activatedAbilities?.[0];
            expect(ability?.cost.tap).toBe(true);
            expect(ability?.useStack).toBe(false);
            expect(ability?.manaRestriction).toBeUndefined();
            expect(typeof ability?.manaAmount).toBe("function");
        }
    });

    it("a lone Urza land taps for exactly {C} (CR 106.1)", () => {
        for (const { def } of TRIO) {
            const land = makeInstance(def.id);
            const battlefield = [land];
            expect(getDynamicManaProduced(land, battlefield)).toEqual({ C: 1 });
            expect(getFixedManaAmount(land, "C", battlefield)).toBe(1);
        }
    });

    it("two of the trio still tap for only {C} (set not assembled)", () => {
        // Mine + Tower in play, but no Power Plant: Mine and Tower each lone-tap.
        const battlefield = battlefieldWith(["Urza's Mine", "Urza's Tower"]);
        const mine = battlefield[0];
        const tower = battlefield[1];
        expect(getFixedManaAmount(mine, "C", battlefield)).toBe(1);
        expect(getFixedManaAmount(tower, "C", battlefield)).toBe(1);
    });

    it("the assembled trio scales each land's output (2 / 2 / 3)", () => {
        const battlefield = battlefieldWith([
            "Urza's Mine",
            "Urza's Power-Plant",
            "Urza's Tower",
        ]);
        for (const { def, assembled } of TRIO) {
            const land = battlefield.find(
                (c) => (c.card as { id: string }).id === def.id
            )!;
            expect(getDynamicManaProduced(land, battlefield)).toEqual({
                C: assembled,
            });
            expect(getFixedManaAmount(land, "C", battlefield)).toBe(assembled);
        }
        // Assembled, the whole set yields 2 + 2 + 3 = 7 colorless.
        const total = battlefield.reduce(
            (sum, land) => sum + getFixedManaAmount(land, "C", battlefield),
            0
        );
        expect(total).toBe(7);
    });

    it("output recomputes from current board: losing one member drops the rest to {C}", () => {
        const battlefield = battlefieldWith([
            "Urza's Mine",
            "Urza's Power-Plant",
            "Urza's Tower",
        ]);
        const tower = battlefield[2];
        expect(getFixedManaAmount(tower, "C", battlefield)).toBe(3);
        // Power Plant leaves the battlefield → set disassembled.
        const afterLoss = [battlefield[0], battlefield[2]];
        expect(getFixedManaAmount(tower, "C", afterLoss)).toBe(1);
    });

    it("the condition is per-controller: opponent's Urza lands don't assemble yours", () => {
        // p1 has only the Tower; p2 has Mine + Power Plant. The Tower keys off
        // p1's own battlefield, so it stays at {C}.
        const p1Battlefield = battlefieldWith(["Urza's Tower"]);
        expect(getFixedManaAmount(p1Battlefield[0], "C", p1Battlefield)).toBe(
            1
        );
    });

    it("auto-tap solver reflects the assembled (not base) yield", () => {
        const battlefield = battlefieldWith([
            "Urza's Mine",
            "Urza's Power-Plant",
            "Urza's Tower",
        ]);
        const sources = buildAutoTapSources(battlefield);
        // Every Urza land is solver-visible (unrestricted, single colorless).
        expect(sources).toHaveLength(3);
        const total = sources.reduce(
            (sum, s) => sum + (s.options[0].mana.C ?? 0),
            0
        );
        expect(total).toBe(7);
    });

    it("tap snapshots the assembled amount; untap refunds it even if the board changed", () => {
        // Mirrors the tapUntap fixed-mana branch (game.ts): on tap the dynamic
        // amount is snapshotted onto `chosenMana`; on untap the refund reads the
        // snapshot, so a mid-float board change can't desync the pool.
        const battlefield = battlefieldWith([
            "Urza's Mine",
            "Urza's Power-Plant",
            "Urza's Tower",
        ]);
        const player = makePlayer("p1", { battlefield });
        const tower = battlefield[2];

        // Tap the assembled Tower for {C}{C}{C}, snapshotting onto chosenMana.
        const amount = getFixedManaAmount(tower, "C", player.battlefield);
        expect(amount).toBe(3);
        tower.isTapped = true;
        tower.chosenMana = { C: amount };
        player.manaPool.C += amount;
        expect(player.manaPool.C).toBe(3);

        // The set is broken (Mine sacrificed) while the 3 mana is floating.
        player.battlefield = [battlefield[1], battlefield[2]];

        // Untap refunds the snapshot (3), not a fresh recomputation (would be 1).
        const refund = tower.chosenMana?.C ?? 0;
        expect(refund).toBe(3);
        player.manaPool.C = Math.max(0, player.manaPool.C - refund);
        tower.chosenMana = undefined;
        tower.isTapped = false;
        expect(player.manaPool.C).toBe(0);
    });

    it("wire format: assembled output survives projectPublicState (CR 106.1)", () => {
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: battlefieldWith([
                        "Urza's Mine",
                        "Urza's Power-Plant",
                        "Urza's Tower",
                    ]),
                }),
                makePlayer("p2"),
            ],
        });
        const tower = state.players[0].battlefield.find(
            (c) => (c.card as { id: string }).id === urzasTower.id
        )!;
        // Fat state: assembled Tower yields 3.
        expect(
            getFixedManaAmount(tower, "C", state.players[0].battlefield)
        ).toBe(3);

        // Same assertion after projection (subtypes + card.id survive slimCard,
        // so the dynamic computation re-reads the def from the registry).
        const projected = projectPublicState(state, 1, "p1");
        const slimBattlefield = projected.players[0].battlefield;
        const slimTower = slimBattlefield.find(
            (c) => (c.card as { id: string }).id === urzasTower.id
        )!;
        expect(
            getFixedManaAmount(
                slimTower as unknown as CardInstanceState,
                "C",
                slimBattlefield as unknown as CardInstanceState[]
            )
        ).toBe(3);
    });
});

// ---------------------------------------------------------------------------
// Cluster E (#286) — "for as long as this remains tapped" duration + tap-lock
// (CR 611.2 state-tied duration; CR 502.1 optional untap). The buff/lock is
// read live while the source stays tapped and pruned by the
// `checkSourceTappedEffects` SBA once the source untaps or leaves.
// ---------------------------------------------------------------------------

describe("Ashnod's Battle Gear (+2/-2 while tapped, CR 611.2)", () => {
    it("is a {2} Artifact with the optional-untap keyword", () => {
        expect(ashnodsBattleGear.manaCost).toEqual({ X: 2 });
        expect(ashnodsBattleGear.types).toEqual(["Artifact"]);
        expect(ashnodsBattleGear.staticAbilities).toContain(
            "may-choose-not-to-untap"
        );
    });

    it("grants +2/-2 to a creature you control while the Gear stays tapped", () => {
        const gear = makeInstance(ashnodsBattleGear.id, {
            id: "gear",
            isTapped: true, // {T} cost already paid (resolveActivated skips costs)
        });
        const bear = vanilla("bear", 2, 2, {
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [gear, bear] }),
                makePlayer("p2"),
            ],
        });
        expect(getEffectivePower(state, bear)).toBe(2);
        expect(getEffectiveToughness(state, bear)).toBe(2);

        resolveActivated(state, gear, "ashnods-battle-gear-pump", [
            { type: "permanent", id: "bear" },
        ]);
        const live = state.players[0].battlefield.find((c) => c.id === "bear")!;
        expect(getEffectivePower(state, live)).toBe(4);
        expect(getEffectiveToughness(state, live)).toBe(0);
    });

    it("the buff disappears the moment the Gear untaps (live read + SBA prune)", () => {
        const gear = makeInstance(ashnodsBattleGear.id, {
            id: "gear",
            isTapped: true,
        });
        const bear = vanilla("bear", 2, 4, {
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [gear, bear] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, gear, "ashnods-battle-gear-pump", [
            { type: "permanent", id: "bear" },
        ]);
        const liveBear = state.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(getEffectiveToughness(state, liveBear)).toBe(2); // 4 - 2

        // Untap the Gear: the buff ends immediately on the live layer read,
        // even before the SBA splices the stale entry out.
        state.players[0].battlefield.find((c) => c.id === "gear")!.isTapped =
            false;
        expect(getEffectiveToughness(state, liveBear)).toBe(4);

        // SBA prunes the now-stale entry.
        checkStateBasedActions(state);
        expect(liveBear.sourceTappedPTMods).toBeUndefined();
        expect(getEffectiveToughness(state, liveBear)).toBe(4);
    });

    it("the buff ends when the Gear leaves the battlefield", () => {
        const gear = makeInstance(ashnodsBattleGear.id, {
            id: "gear",
            isTapped: true,
        });
        const bear = vanilla("bear", 2, 4, {
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [gear, bear] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, gear, "ashnods-battle-gear-pump", [
            { type: "permanent", id: "bear" },
        ]);
        removePermanentTo(state, "gear", "graveyard");
        const liveBear = state.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(getEffectiveToughness(state, liveBear)).toBe(4); // source gone
        checkStateBasedActions(state);
        expect(liveBear.sourceTappedPTMods).toBeUndefined();
    });

    it("wire format: the +2/-2 survives projectPublicState while the Gear is tapped", () => {
        const gear = makeInstance(ashnodsBattleGear.id, {
            id: "gear",
            isTapped: true,
        });
        const bear = vanilla("bear", 2, 4, {
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [gear, bear] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, gear, "ashnods-battle-gear-pump", [
            { type: "permanent", id: "bear" },
        ]);

        const projected = projectPublicState(state, 1, "p1");
        const slimBear = projected.players
            .find((p) => p.id === "p1")!
            .battlefield.find((c) => c.id === "bear")!;
        expect(getEffectivePower(projected, slimBear)).toBe(4);
        expect(getEffectiveToughness(projected, slimBear)).toBe(2);

        // And the projected tapped state of the source still gates the buff:
        // flipping the projected Gear's isTapped removes the contribution.
        const slimGear = projected.players
            .find((p) => p.id === "p1")!
            .battlefield.find((c) => c.id === "gear")!;
        (slimGear as { isTapped: boolean }).isTapped = false;
        expect(getEffectiveToughness(projected, slimBear)).toBe(4);
    });
});

describe("Tawnos's Weaponry (+1/+1 while tapped, CR 611.2)", () => {
    it("is a {2} Artifact with the optional-untap keyword", () => {
        expect(tawnossWeaponry.manaCost).toEqual({ X: 2 });
        expect(tawnossWeaponry.staticAbilities).toContain(
            "may-choose-not-to-untap"
        );
    });

    it("grants +1/+1 to any creature while the Weaponry stays tapped", () => {
        const weap = makeInstance(tawnossWeaponry.id, {
            id: "weap",
            isTapped: true,
        });
        const foe = vanilla("foe", 2, 2); // p2's creature — "any" target
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [weap] }),
                makePlayer("p2", { battlefield: [foe] }),
            ],
        });
        resolveActivated(state, weap, "tawnoss-weaponry-pump", [
            { type: "permanent", id: "foe" },
        ]);
        const live = state.players[1].battlefield.find((c) => c.id === "foe")!;
        expect(getEffectivePower(state, live)).toBe(3);
        expect(getEffectiveToughness(state, live)).toBe(3);

        // Untap → buff gone.
        state.players[0].battlefield.find((c) => c.id === "weap")!.isTapped =
            false;
        expect(getEffectivePower(state, live)).toBe(2);
        expect(getEffectiveToughness(state, live)).toBe(2);
    });

    it("wire format: the +1/+1 survives projectPublicState", () => {
        const weap = makeInstance(tawnossWeaponry.id, {
            id: "weap",
            isTapped: true,
        });
        const foe = vanilla("foe", 2, 2);
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [weap] }),
                makePlayer("p2", { battlefield: [foe] }),
            ],
        });
        resolveActivated(state, weap, "tawnoss-weaponry-pump", [
            { type: "permanent", id: "foe" },
        ]);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players
            .find((p) => p.id === "p2")!
            .battlefield.find((c) => c.id === "foe")!;
        expect(getEffectivePower(projected, slim)).toBe(3);
        expect(getEffectiveToughness(projected, slim)).toBe(3);
    });
});

describe("Optional untap (CR 502.1 — 'you may choose not to untap this')", () => {
    function untapState(source: CardInstanceState): GameState {
        return makeState({
            phase: "UNTAP",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            players: [
                makePlayer("p1", { battlefield: [source] }),
                makePlayer("p2"),
            ],
        });
    }

    it("prompts the controller before untapping a may-choose-not-to-untap permanent", () => {
        const gear = makeInstance(ashnodsBattleGear.id, {
            id: "gear",
            isTapped: true,
        });
        const state = untapState(gear);
        untapStep(state);
        // The Gear is not auto-untapped; an untap-pick prompt is queued.
        expect(
            state.players[0].battlefield.find((c) => c.id === "gear")!.isTapped
        ).toBe(true);
        expect(state.pendingChoices?.[0]?.kind).toBe("untap-pick");
        expect(state.pendingChoices?.[0]?.choiceId).toBe("untap-optional-gear");
    });

    it("untaps when the controller chooses to (selects the id)", () => {
        const gear = makeInstance(ashnodsBattleGear.id, {
            id: "gear",
            isTapped: true,
        });
        const state = untapState(gear);
        untapStep(state);
        submitChoice(state, ["gear"]);
        expect(
            state.players[0].battlefield.find((c) => c.id === "gear")!.isTapped
        ).toBe(false);
        expect(state.pendingChoices).toBeUndefined();
    });

    it("keeps it tapped when the controller declines (selects nothing)", () => {
        const gear = makeInstance(ashnodsBattleGear.id, {
            id: "gear",
            isTapped: true,
        });
        const state = untapState(gear);
        untapStep(state);
        submitChoice(state, []);
        expect(
            state.players[0].battlefield.find((c) => c.id === "gear")!.isTapped
        ).toBe(true);
        expect(state.pendingChoices).toBeUndefined();
    });
});

describe("Primal Clay (choose-body-on-entry, CR 614.12 / 702.3 / 702.9)", () => {
    function castPrimalClay() {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const item = pushSpell(state, primalClay.id, "p1");
        item.id = "clay1";
        return { state, item };
    }

    function bodyOf(state: ReturnType<typeof castPrimalClay>["state"]) {
        return state.players[0].battlefield.find((c) => c.id === "clay1")!;
    }

    it("definition: 0/0 artifact creature with the entry-choice resolveStep", () => {
        expect(primalClay.types).toEqual(["Artifact", "Creature"]);
        expect(primalClay.power).toBe(0);
        expect(primalClay.toughness).toBe(0);
        expect(primalClay.resolveSteps).toHaveLength(1);
    });

    it("entry choice 3/3 sets base P/T, no extra subtype/keyword", () => {
        const { state, item } = castPrimalClay();
        // First resolve suspends on the option-pick.
        expect(resolveTopOfStack(state)).toBeNull();
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("option-pick");
        expect(head.playerId).toBe("p1");
        expect(head.options?.map((o) => o.id)).toEqual([
            "3-3",
            "2-2-flying",
            "1-6-wall",
        ]);
        // Commit through the backend submit primitive (integration path).
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: item.id,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["3-3"],
        });
        const clay = bodyOf(state);
        expect(getEffectivePower(state, clay)).toBe(3);
        expect(getEffectiveToughness(state, clay)).toBe(3);
        expect(clay.staticAbilities).not.toContain("flying");
        expect(clay.staticAbilities).not.toContain("defender");
        expect(clay.subtypes).not.toContain("Wall");
        // Still an artifact creature in every mode (CR 301).
        expect(clay.types).toContain("Artifact");
        expect(clay.types).toContain("Creature");
    });

    it("entry choice 2/2 flying grants flying", () => {
        const { state, item } = castPrimalClay();
        expect(resolveTopOfStack(state)).toBeNull();
        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: item.id,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["2-2-flying"],
        });
        const clay = bodyOf(state);
        expect(getEffectivePower(state, clay)).toBe(2);
        expect(getEffectiveToughness(state, clay)).toBe(2);
        expect(clay.staticAbilities).toContain("flying");
    });

    it("entry choice 1/6 Wall adds Wall subtype + defender keyword", () => {
        const { state, item } = castPrimalClay();
        expect(resolveTopOfStack(state)).toBeNull();
        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: item.id,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["1-6-wall"],
        });
        const clay = bodyOf(state);
        expect(getEffectivePower(state, clay)).toBe(1);
        expect(getEffectiveToughness(state, clay)).toBe(6);
        expect(clay.subtypes).toContain("Wall");
        expect(clay.staticAbilities).toContain("defender");
    });

    it("rejects an option id not in the offered list", () => {
        const { state, item } = castPrimalClay();
        expect(resolveTopOfStack(state)).toBeNull();
        const head = state.pendingChoices![0];
        expect(() =>
            applyPendingChoiceSubmit(state, {
                playerId: "p1",
                stackItemId: item.id,
                step: head.step,
                choiceId: head.choiceId,
                cardInstanceIds: ["9-9"],
            })
        ).toThrow(/legal choice/i);
    });

    it("wire format: chosen Wall body survives projectPublicState", () => {
        const { state, item } = castPrimalClay();
        expect(resolveTopOfStack(state)).toBeNull();
        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: item.id,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["1-6-wall"],
        });
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "clay1"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(1);
        expect(getEffectiveToughness(projected, slim)).toBe(6);
        expect(slim.subtypes).toContain("Wall");
        expect(slim.staticAbilities).toContain("defender");
    });
});

describe("Shapeshifter (choose-number-on-entry + upkeep, CR 614.12 / 603.6a)", () => {
    function castShapeshifter() {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const item = pushSpell(state, shapeshifter.id, "p1");
        item.id = "shift1";
        return { state, item };
    }

    function enterWith(
        state: ReturnType<typeof castShapeshifter>["state"],
        item: ReturnType<typeof castShapeshifter>["item"],
        n: number
    ) {
        expect(resolveTopOfStack(state)).toBeNull();
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("option-pick");
        expect(head.options).toHaveLength(8);
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: item.id,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: [String(n)],
        });
    }

    function bodyOf(state: ReturnType<typeof castShapeshifter>["state"]) {
        return state.players[0].battlefield.find((c) => c.id === "shift1")!;
    }

    it("definition: 0/0 with entry resolveStep + upkeep re-choice trigger", () => {
        expect(shapeshifter.types).toEqual(["Artifact", "Creature"]);
        expect(shapeshifter.subtypes).toEqual(["Shapeshifter"]);
        expect(shapeshifter.resolveSteps).toHaveLength(1);
        expect(
            shapeshifter.triggeredAbilities?.some(
                (t) => t.id === "shapeshifter-upkeep-renumber"
            )
        ).toBe(true);
    });

    it("entry choice 3 → 3/4 (power=N, toughness=7-N)", () => {
        const { state, item } = castShapeshifter();
        enterWith(state, item, 3);
        const shift = bodyOf(state);
        expect(getEffectivePower(state, shift)).toBe(3);
        expect(getEffectiveToughness(state, shift)).toBe(4);
    });

    it("entry choice 0 → 0/7 (survives) and 6 → 6/1 (boundaries)", () => {
        const a = castShapeshifter();
        enterWith(a.state, a.item, 0);
        expect(getEffectivePower(a.state, bodyOf(a.state))).toBe(0);
        expect(getEffectiveToughness(a.state, bodyOf(a.state))).toBe(7);

        const b = castShapeshifter();
        enterWith(b.state, b.item, 6);
        expect(getEffectivePower(b.state, bodyOf(b.state))).toBe(6);
        expect(getEffectiveToughness(b.state, bodyOf(b.state))).toBe(1);
    });

    it("entry choice 7 → 7/0 dies to the 0-toughness SBA (CR 704.5f)", () => {
        const { state, item } = castShapeshifter();
        enterWith(state, item, 7);
        // toughness 0 → the SBA fired by the submit path puts it in the
        // graveyard; it never settles on the battlefield.
        expect(
            state.players[0].battlefield.find((c) => c.id === "shift1")
        ).toBeUndefined();
        expect(state.players[0].graveyard.some((c) => c.id === "shift1")).toBe(
            true
        );
    });

    it("upkeep re-choice (may) updates P/T to the new number", () => {
        const { state, item } = castShapeshifter();
        enterWith(state, item, 2);
        expect(getEffectivePower(state, bodyOf(state))).toBe(2);

        // Fire the controller's upkeep trigger.
        state.stack.push(...collectTriggers(state, [UPKEEP_P1]));
        const trigItem = state.stack[state.stack.length - 1];
        // may-pay → yes
        expect(resolveTopOfStack(state)).toBeNull();
        let head = state.pendingChoices![0];
        expect(head.kind).toBe("may-pay");
        applyMayPaySubmit(state, { playerId: "p1", accept: true });
        // option-pick → 5
        head = state.pendingChoices![0];
        expect(head.kind).toBe("option-pick");
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: trigItem.id,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["5"],
        });
        const shift = bodyOf(state);
        expect(getEffectivePower(state, shift)).toBe(5);
        expect(getEffectiveToughness(state, shift)).toBe(2);
    });

    it("upkeep re-choice declined (may → no) keeps the prior body", () => {
        const { state, item } = castShapeshifter();
        enterWith(state, item, 4);
        state.stack.push(...collectTriggers(state, [UPKEEP_P1]));
        expect(resolveTopOfStack(state)).toBeNull();
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("may-pay");
        applyMayPaySubmit(state, { playerId: "p1", accept: false });
        const shift = bodyOf(state);
        expect(getEffectivePower(state, shift)).toBe(4);
        expect(getEffectiveToughness(state, shift)).toBe(3);
    });

    it("wire format: chosen number P/T survives projectPublicState", () => {
        const { state, item } = castShapeshifter();
        enterWith(state, item, 6);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "shift1"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(6);
        expect(getEffectiveToughness(projected, slim)).toBe(1);
    });

    it("chosen P/T persists across a serialize round-trip (CR 614.12 lock-in)", () => {
        const { state, item } = castShapeshifter();
        enterWith(state, item, 3);
        const round = expandState(compactState(state));
        const shift = round.players[0].battlefield.find(
            (c) => c.id === "shift1"
        )!;
        expect(getEffectivePower(round, shift)).toBe(3);
        expect(getEffectiveToughness(round, shift)).toBe(4);
    });
});

// Cursed Rack (CR 402.2 chosen-opponent max-hand-size override)
describe("Cursed Rack (chosen opponent's max hand size is four)", () => {
    const setup = () => {
        const rack = makeInstance(cursedRack.id, {
            id: "rack",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [rack] }),
                makePlayer("p2"),
            ],
        });
        return { state, rack };
    };

    it("stores the chosen opponent on entry", () => {
        const { state, rack } = setup();
        fireEntered(state, rack, "cursed-rack-choose-opponent");
        const live = state.players[0].battlefield.find((c) => c.id === "rack")!;
        expect(live.chosenPlayerId).toBe("p2");
    });

    it("caps the chosen opponent's max hand size at 4 (not the controller's)", () => {
        const { state, rack } = setup();
        fireEntered(state, rack, "cursed-rack-choose-opponent");
        // Controller is unaffected (default 7); chosen opponent is capped at 4.
        expect(effectiveMaxHandSize(state.players[0], state)).toBe(7);
        expect(effectiveMaxHandSize(state.players[1], state)).toBe(4);
    });

    it("override survives the wire-format round-trip", () => {
        const { state, rack } = setup();
        fireEntered(state, rack, "cursed-rack-choose-opponent");
        const round = expandState(compactState(state));
        expect(
            round.players[0].battlefield.find((c) => c.id === "rack")!
                .chosenPlayerId
        ).toBe("p2");
        expect(effectiveMaxHandSize(round.players[1], round)).toBe(4);
    });

    it("no cap once the Rack leaves the battlefield", () => {
        const { state, rack } = setup();
        fireEntered(state, rack, "cursed-rack-choose-opponent");
        removePermanentTo(state, rack.id, "graveyard");
        expect(effectiveMaxHandSize(state.players[1], state)).toBe(7);
    });
});

// The Rack (CR 603.6a chosen-player upkeep damage = 3 − hand size)
describe("The Rack (chosen player's upkeep: 3 − hand size damage)", () => {
    const setup = (opponentHand: number) => {
        const rack = makeInstance(theRack.id, {
            id: "rack",
            controllerId: "p1",
            ownerId: "p1",
        });
        const hand = Array.from({ length: opponentHand }, (_, i) =>
            makeInstance(onulet.id, {
                id: `oh${i}`,
                controllerId: "p2",
                ownerId: "p2",
                zone: "hand",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [rack] }),
                makePlayer("p2", { hand, life: 20 }),
            ],
        });
        fireEntered(state, rack, "the-rack-choose-opponent");
        return { state };
    };

    it("deals 3 − hand size to the chosen player on their upkeep", () => {
        const { state } = setup(0);
        const rack = state.players[0].battlefield[0];
        fireTrigger(state, rack, "the-rack-upkeep-damage", {
            type: "PHASE_BEGIN",
            phase: "UPKEEP",
            activePlayerId: "p2",
        });
        expect(state.players[1].life).toBe(17);
    });

    it("deals 1 when the chosen player has 2 cards", () => {
        const { state } = setup(2);
        const rack = state.players[0].battlefield[0];
        fireTrigger(state, rack, "the-rack-upkeep-damage", {
            type: "PHASE_BEGIN",
            phase: "UPKEEP",
            activePlayerId: "p2",
        });
        expect(state.players[1].life).toBe(19);
    });

    it("deals no damage when the chosen player has 3+ cards", () => {
        const { state } = setup(3);
        const rack = state.players[0].battlefield[0];
        fireTrigger(state, rack, "the-rack-upkeep-damage", {
            type: "PHASE_BEGIN",
            phase: "UPKEEP",
            activePlayerId: "p2",
        });
        expect(state.players[1].life).toBe(20);
    });

    it("does not fire on the controller's own upkeep", () => {
        const { state } = setup(0);
        const rack = state.players[0].battlefield[0];
        const trig = theRack.triggeredAbilities!.find(
            (t) => t.id === "the-rack-upkeep-damage"
        )!;
        const self = { ...rack, chosenPlayerId: "p2" };
        expect(
            trig.matches(
                {
                    type: "PHASE_BEGIN",
                    phase: "UPKEEP",
                    activePlayerId: "p1",
                },
                self
            )
        ).toBe(false);
    });
});

// Urza's Miter (CR 603.10 — draws only when the artifact wasn't sacrificed)
describe("Urza's Miter (non-sacrifice artifact to graveyard → may pay {3} draw)", () => {
    const setup = () => {
        const miter = makeInstance(urzasMiter.id, {
            id: "miter",
            controllerId: "p1",
            ownerId: "p1",
        });
        const artifact = makeInstance(onulet.id, {
            id: "art",
            controllerId: "p1",
            ownerId: "p1",
        });
        const library = [
            makeInstance(onulet.id, {
                id: "libtop",
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            }),
        ];
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [miter, artifact], library }),
                makePlayer("p2"),
            ],
        });
        return { state };
    };

    it("fires on a destroyed (non-sacrificed) artifact; accept → draws", () => {
        const { state } = setup();
        // Destruction routes through removePermanentTo with no cause.
        removePermanentTo(state, "art", "graveyard");
        processPendingActionTriggers(state);
        const trig = state.stack.find(
            (s) => s.triggeredAbilityId === "urzas-miter-draw"
        );
        expect(trig).toBeDefined();
        const idx = state.stack.indexOf(trig!);
        state.stack.splice(idx, 1);
        state.stack.push(trig!);
        const first = resolveTopOfStack(state);
        expect(first).toBeNull();
        const pending = state.pendingChoices![0];
        const item = state.stack.find((s) => s.id === pending.stackItemId)!;
        item.collectedChoices = {
            [`${pending.step}:${pending.choiceId}`]: ["yes"],
        };
        state.pendingChoices = undefined;
        resolveTopOfStack(state);
        expect(state.players[0].hand.some((c) => c.id === "libtop")).toBe(true);
    });

    it("does NOT fire when the artifact was sacrificed", () => {
        const { state } = setup();
        // Sacrifice tags the PERMANENT_LEFT event with cause "sacrifice".
        removePermanentTo(state, "art", "graveyard", "sacrifice");
        processPendingActionTriggers(state);
        const trig = state.stack.find(
            (s) => s.triggeredAbilityId === "urzas-miter-draw"
        );
        expect(trig).toBeUndefined();
    });

    it("condition predicate rejects a sacrifice cause directly", () => {
        const trig = urzasMiter.triggeredAbilities![0];
        const self = {
            id: "miter",
            controllerId: "p1",
            ownerId: "p1",
            types: ["Artifact"] as CardType[],
            subtypes: [],
            isTapped: false,
            card: {},
        };
        const base = {
            type: "PERMANENT_LEFT" as const,
            instanceId: "art",
            controllerId: "p1",
            ownerId: "p1",
            types: ["Artifact"] as CardType[],
            wasAura: false,
            toZone: "graveyard" as const,
        };
        expect(trig.matches({ ...base }, self)).toBe(true);
        expect(trig.matches({ ...base, cause: "sacrifice" }, self)).toBe(false);
    });
});

// Coral Helm (CR 118.3 random-discard cost; +2/+2 EOT)
describe("Coral Helm ({3}, discard at random: target +2/+2 EOT)", () => {
    it("pumps the target +2/+2 until end of turn", () => {
        const helm = makeInstance(coralHelm.id, {
            id: "helm",
            controllerId: "p1",
            ownerId: "p1",
        });
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [helm, bear] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, helm, "coral-helm-pump", [
            { type: "permanent", id: "bear" },
        ]);
        const live = state.players[0].battlefield.find((c) => c.id === "bear")!;
        expect(getEffectivePower(state, live)).toBe(4);
        expect(getEffectiveToughness(state, live)).toBe(4);
        // Wire format: the buff survives projection.
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(4);
    });
});

// Golgothian Sylex (origin-filtered mass sacrifice)
describe("Golgothian Sylex ({1},{T}: sacrifice each nontoken ATQ permanent)", () => {
    it("sacrifices ATQ-origin nontoken permanents, sparing non-ATQ and tokens", () => {
        const sylex = makeInstance(golgothianSylex.id, {
            id: "sylex",
            controllerId: "p1",
            ownerId: "p1",
        });
        const atqArtifact = makeInstance(onulet.id, {
            id: "onulet",
            controllerId: "p1",
            ownerId: "p1",
        });
        const leaCreature = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
        });
        const atqOpponent = makeInstance(yotianSoldier.id, {
            id: "yotian",
            controllerId: "p2",
            ownerId: "p2",
        });
        const tokenAtq = makeInstance(onulet.id, {
            id: "token",
            controllerId: "p1",
            ownerId: "p1",
            isToken: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [sylex, atqArtifact, leaCreature, tokenAtq],
                }),
                makePlayer("p2", { battlefield: [atqOpponent] }),
            ],
        });
        resolveActivated(state, sylex, "golgothian-sylex-wrath");
        const ids = (pid: number) =>
            state.players[pid].battlefield.map((c) => c.id);
        // Sylex (ATQ), Onulet (ATQ), Yotian (ATQ) sacrificed; Grizzly Bears
        // (LEA) and the token survive.
        expect(ids(0)).toContain("bear");
        expect(ids(0)).toContain("token");
        expect(ids(0)).not.toContain("sylex");
        expect(ids(0)).not.toContain("onulet");
        expect(ids(1)).not.toContain("yotian");
    });
});

// Rocket Launcher (continuous-control precondition + delayed self-destroy)
describe("Rocket Launcher ({2}: 1 damage any target; destroy at end step)", () => {
    const place = (summoningSick: boolean) => {
        const launcher = makeInstance(rocketLauncher.id, {
            id: "launcher",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: summoningSick || undefined,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [launcher], life: 20 }),
                makePlayer("p2", { life: 20 }),
            ],
            activePlayerId: "p1",
        });
        return { state, launcher };
    };

    it("enters summoning-sick (tracksControlContinuity)", () => {
        expect(rocketLauncher.tracksControlContinuity).toBe(true);
    });

    it("canActivate is false while controlled this turn (summoning sick)", () => {
        const { state, launcher } = place(true);
        const ability = rocketLauncher.activatedAbilities![0];
        expect(ability.canActivate!(launcher, state)).toBe(false);
    });

    it("canActivate is true once controlled since the last turn", () => {
        const { state, launcher } = place(false);
        const ability = rocketLauncher.activatedAbilities![0];
        expect(ability.canActivate!(launcher, state)).toBe(true);
    });

    it("deals 1 to any target and schedules the end-step self-destroy", () => {
        const { state, launcher } = place(false);
        resolveActivated(state, launcher, "rocket-launcher-ping", [
            { type: "player", id: "p2" },
        ]);
        expect(state.players[1].life).toBe(19);
        // A delayed trigger to destroy the launcher is queued for the end step
        // (post-#838 the instance carries an inline destroy body, ADR 0048 —
        // the old template-id assertion pinned the legacy authoring internals).
        expect(
            state.delayedTriggers?.some(
                (d) =>
                    d.timing === "next-end-step" &&
                    d.effects?.some((e) => e.op === "destroy") &&
                    d.payload.$self === "launcher"
            )
        ).toBe(true);
    });
});

// Tawnos's Wand (can't-be-blocked-this-turn flag)
describe("Tawnos's Wand ({2},{T}: target power ≤ 2 can't be blocked)", () => {
    const setup = () => {
        const wand = makeInstance(tawnossWand.id, {
            id: "wand",
            controllerId: "p1",
            ownerId: "p1",
        });
        const attacker = makeInstance(grizzlyBears.id, {
            id: "attacker",
            controllerId: "p1",
            ownerId: "p1",
        });
        const blocker = vanilla("blocker", 2, 2, { controllerId: "p2" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [wand, attacker] }),
                makePlayer("p2", { battlefield: [blocker] }),
            ],
        });
        return { state, wand, attacker, blocker };
    };

    it("only targets creatures with power 2 or less", () => {
        const req = tawnossWand.activatedAbilities![0].targetRequirement!;
        expect(req.powerFilter).toEqual({ max: 2 });
    });

    it("flags the target as unblockable; blockers become ineligible", () => {
        const { state, wand, attacker, blocker } = setup();
        // Before: the 2/2 can legally block the 2/2.
        expect(
            validateBlockerEligibility(attacker, blocker, [blocker], state)
                .eligible
        ).toBe(true);
        resolveActivated(state, wand, "tawnoss-wand-unblockable", [
            { type: "permanent", id: "attacker" },
        ]);
        const liveAttacker = state.players[0].battlefield.find(
            (c) => c.id === "attacker"
        )!;
        expect(liveAttacker.cantBeBlockedThisTurn).toBe(true);
        expect(
            validateBlockerEligibility(liveAttacker, blocker, [blocker], state)
                .eligible
        ).toBe(false);
    });

    it("the unblockable flag survives the wire-format round-trip", () => {
        const { state, wand } = setup();
        resolveActivated(state, wand, "tawnoss-wand-unblockable", [
            { type: "permanent", id: "attacker" },
        ]);
        const round = expandState(compactState(state));
        expect(
            round.players[0].battlefield.find((c) => c.id === "attacker")!
                .cantBeBlockedThisTurn
        ).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tetravus (cluster L #293) — token provenance link. CR 111 / 707.1
// (`createdBy` link), 122.1/122.6 (counter add/remove), 303.4 (Tetravite
// "can't be enchanted" guard), 603.6a (optional upkeep abilities).
// ─────────────────────────────────────────────────────────────────────────────
describe("Tetravus (token provenance link, CR 111 / 122 / 303.4)", () => {
    /** Fire one named UPKEEP trigger on Tetravus and resolve it once. Returns
     *  the resolution result (null when it suspends on a pending choice). */
    function fireUpkeep(
        state: GameState,
        source: CardInstanceState,
        abilityId: string
    ): ReturnType<typeof resolveTopOfStack> {
        const item: StackItem = {
            ...source,
            id: `trig-${abilityId}`,
            castById: source.controllerId,
            zone: "stack",
            triggeredAbilityId: abilityId,
            triggerSourceId: source.id,
            triggerEvent: UPKEEP_P1,
            targets: [],
        };
        state.stack.push(item);
        return resolveTopOfStack(state);
    }

    function tetravusOnBattlefield(counters = 3) {
        const tet = makeInstance(tetravus.id, {
            id: "tet1",
            controllerId: "p1",
            counters: { "+1/+1": counters },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [tet] }),
                makePlayer("p2"),
            ],
            phase: "UPKEEP",
        });
        return {
            state,
            tet: () =>
                state.players[0].battlefield.find((c) => c.id === "tet1")!,
        };
    }

    function tetravites(state: GameState) {
        return state.players[0].battlefield.filter(
            (c) => c.createdBy === "tet1"
        );
    }

    it("definition: 1/1 flying artifact Construct, enters with three +1/+1", () => {
        expect(tetravus.types).toEqual(["Artifact", "Creature"]);
        expect(tetravus.subtypes).toEqual(["Construct"]);
        expect(tetravus.power).toBe(1);
        expect(tetravus.toughness).toBe(1);
        expect(tetravus.staticAbilities).toContain("flying");
        expect(tetravus.entersWith).toEqual({
            counters: [{ type: "+1/+1", count: 3 }],
        });
        expect(tetravus.triggeredAbilities?.map((t) => t.id)).toEqual([
            "tetravus-counters-to-tokens",
            "tetravus-tokens-to-counters",
        ]);
    });

    it("ETB counters make it effectively 4/4 (1/1 + three +1/+1)", () => {
        const { state, tet } = tetravusOnBattlefield(3);
        expect(getEffectivePower(state, tet())).toBe(4);
        expect(getEffectiveToughness(state, tet())).toBe(4);
    });

    it("counters→tokens: removing 2 creates 2 linked Tetravites and shrinks Tetravus", () => {
        const { state, tet } = tetravusOnBattlefield(3);
        expect(
            fireUpkeep(state, tet(), "tetravus-counters-to-tokens")
        ).toBeNull();
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("option-pick");
        expect(head.options).toHaveLength(4); // 0..3
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["2"],
        });
        expect(tet().counters?.["+1/+1"]).toBe(1);
        expect(getEffectivePower(state, tet())).toBe(2);
        const toks = tetravites(state);
        expect(toks).toHaveLength(2);
        for (const t of toks) {
            expect(t.isToken).toBe(true);
            expect(t.types).toEqual(["Artifact", "Creature"]);
            expect(t.subtypes).toContain("Tetravite");
            expect(t.power).toBe(1);
            expect(t.toughness).toBe(1);
            expect(t.staticAbilities).toContain("flying");
        }
    });

    it("counters→tokens: choosing 0 creates no tokens and keeps counters", () => {
        const { state, tet } = tetravusOnBattlefield(3);
        fireUpkeep(state, tet(), "tetravus-counters-to-tokens");
        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["0"],
        });
        expect(tet().counters?.["+1/+1"]).toBe(3);
        expect(tetravites(state)).toHaveLength(0);
    });

    it("counters→tokens: with zero counters the trigger auto-resolves (no prompt)", () => {
        const { state, tet } = tetravusOnBattlefield(0);
        const res = fireUpkeep(state, tet(), "tetravus-counters-to-tokens");
        expect(res).not.toBeNull();
        expect(state.pendingChoices?.length ?? 0).toBe(0);
        expect(tetravites(state)).toHaveLength(0);
    });

    it("tokens→counters: exiles linked tokens to put back that many +1/+1 counters", () => {
        const { state, tet } = tetravusOnBattlefield(2);
        fireUpkeep(state, tet(), "tetravus-counters-to-tokens");
        let head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["2"],
        });
        const minted = tetravites(state).map((t) => t.id);
        expect(minted).toHaveLength(2);

        // A foreign token must NOT be offered to Tetravus's exile ability.
        state.players[0].battlefield.push(
            makeInstance(grizzlyBears.id, {
                id: "foreign-token",
                controllerId: "p1",
                isToken: true,
                createdBy: "someone-else",
            })
        );

        expect(tet().counters?.["+1/+1"] ?? 0).toBe(0);
        expect(
            fireUpkeep(state, tet(), "tetravus-tokens-to-counters")
        ).toBeNull();
        head = state.pendingChoices![0];
        expect(head.kind).toBe("choose-permanents");
        expect(head.filter?.createdBy).toBe("tet1");

        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: minted,
        });
        expect(tet().counters?.["+1/+1"]).toBe(2);
        expect(getEffectivePower(state, tet())).toBe(3); // 1 + 2
        expect(tetravites(state)).toHaveLength(0);
        expect(
            state.players[0].battlefield.some((c) => c.id === "foreign-token")
        ).toBe(true);
        expect(
            state.players[0].exile.filter((c) => minted.includes(c.id))
        ).toHaveLength(2);
    });

    it("tokens→counters: submitting a foreign token is rejected by the filter", () => {
        const { state, tet } = tetravusOnBattlefield(1);
        fireUpkeep(state, tet(), "tetravus-counters-to-tokens");
        let head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["1"],
        });
        state.players[0].battlefield.push(
            makeInstance(grizzlyBears.id, {
                id: "foreign-token",
                controllerId: "p1",
                isToken: true,
                createdBy: "someone-else",
            })
        );
        fireUpkeep(state, tet(), "tetravus-tokens-to-counters");
        head = state.pendingChoices![0];
        expect(() =>
            applyPendingChoiceSubmit(state, {
                playerId: "p1",
                stackItemId: head.stackItemId,
                step: head.step,
                choiceId: head.choiceId,
                cardInstanceIds: ["foreign-token"],
            })
        ).toThrow();
    });

    it("tokens→counters: with no linked tokens the trigger auto-resolves (no prompt)", () => {
        const { state, tet } = tetravusOnBattlefield(3);
        const res = fireUpkeep(state, tet(), "tetravus-tokens-to-counters");
        expect(res).not.toBeNull();
        expect(state.pendingChoices?.length ?? 0).toBe(0);
        expect(tet().counters?.["+1/+1"]).toBe(3);
    });

    it("Tetravite tokens can't be enchanted (CR 303.4 self-guard)", () => {
        const { state, tet } = tetravusOnBattlefield(1);
        fireUpkeep(state, tet(), "tetravus-counters-to-tokens");
        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["1"],
        });
        const token = tetravites(state)[0]!;
        expect(getDefinition(token.card.id as string).staticEffects).toEqual([
            expect.objectContaining({
                kind: "permanent-guard",
                cantBeEnchanted: true,
            }),
        ]);
        expect(isGuardedAgainst(state, token, "cantBeEnchanted")).toBe(true);
        // Tetravus itself is enchantable.
        expect(isGuardedAgainst(state, tet(), "cantBeEnchanted")).toBe(false);
    });

    it("wire format: provenance link, token flag, and guard survive projection", () => {
        const { state, tet } = tetravusOnBattlefield(1);
        fireUpkeep(state, tet(), "tetravus-counters-to-tokens");
        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["1"],
        });
        const tokenId = tetravites(state)[0]!.id;

        const projected = projectPublicState(state, 1, "p1");
        const slimTok = projected.players[0].battlefield.find(
            (c) => c.id === tokenId
        )!;
        expect(slimTok.createdBy).toBe("tet1");
        expect(slimTok.isToken).toBe(true);
        expect(isGuardedAgainst(projected, slimTok, "cantBeEnchanted")).toBe(
            true
        );
    });

    it("DB round-trip: createdBy link + token guard survive serialize/expand", () => {
        const { state, tet } = tetravusOnBattlefield(1);
        fireUpkeep(state, tet(), "tetravus-counters-to-tokens");
        const head = state.pendingChoices![0];
        applyPendingChoiceSubmit(state, {
            playerId: "p1",
            stackItemId: head.stackItemId,
            step: head.step,
            choiceId: head.choiceId,
            cardInstanceIds: ["1"],
        });
        const tokenId = tetravites(state)[0]!.id;

        const restored = expandState(compactState(state));
        const restoredTok = restored.players[0].battlefield.find(
            (c) => c.id === tokenId
        )!;
        expect(restoredTok.createdBy).toBe("tet1");
        expect(restoredTok.isToken).toBe(true);
        expect(isGuardedAgainst(restored, restoredTok, "cantBeEnchanted")).toBe(
            true
        );
    });
});

describe("Tawnos's Coffin (ATQ cluster K — exile-with-attachments + return, CR 701.18 / 122 / 603.7a / 502.1)", () => {
    /** p1 controls Tawnos's Coffin; p2 controls `victim`, a creature with the
     *  given counters (and optionally an attached Holy Strength). Activates the
     *  coffin's exile ability targeting `victim` and returns the resolved
     *  state, the coffin instance, and the victim id. */
    function exileVictim(opts: {
        counters?: Record<string, number>;
        withAura?: boolean;
    }): { state: GameState; coffin: CardInstanceState; victimId: string } {
        const coffin = makeInstance(tawnossCoffin.id, {
            id: "coffin",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const victim = makeInstance(grizzlyBears.id, {
            id: "victim",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
            ...(opts.counters ? { counters: opts.counters } : {}),
        });
        const p2Battlefield: CardInstanceState[] = [victim];
        if (opts.withAura) {
            p2Battlefield.push(
                makeInstance(holyStrength.id, {
                    id: "aura",
                    controllerId: "p2",
                    ownerId: "p2",
                    zone: "battlefield",
                    attachedTo: "victim",
                })
            );
        }
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [coffin] }),
                makePlayer("p2", { battlefield: p2Battlefield }),
            ],
        });
        resolveActivated(state, coffin, "tawnoss-coffin-exile", [
            { type: "permanent", id: "victim" },
        ]);
        return { state, coffin, victimId: "victim" };
    }

    /** Drives the untap step for p1's tapped coffin, choosing to untap it, then
     *  resolves the resulting return trigger. */
    function untapCoffinAndResolve(state: GameState, coffinId: string): void {
        const coffin = state.players[0].battlefield.find(
            (c) => c.id === coffinId
        )!;
        coffin.isTapped = true; // the {T} cost was paid on activation
        state.phase = "UNTAP";
        state.activePlayerId = "p1";
        state.priorityPlayerId = "p1";
        untapStep(state);
        // may-choose-not-to-untap: the coffin defers to an optional prompt.
        expect(state.pendingChoices?.[0]?.kind).toBe("untap-pick");
        submitChoice(state, [coffinId]); // choose to untap → arms the return
        // The "becomes untapped" trigger is on the stack; resolve it.
        const trig = state.stack.find(
            (s) => s.triggeredAbilityId === "tawnoss-coffin-return-on-untap"
        );
        expect(trig).toBeDefined();
        resolveTopOfStack(state);
    }

    it("exiles the target creature, notes its counters, and arms a return bundle", () => {
        const { state, coffin } = exileVictim({ counters: { "+1/+1": 2 } });

        expect(
            state.players[1].battlefield.find((c) => c.id === "victim")
        ).toBeUndefined();
        expect(state.players[1].exile.map((c) => c.id)).toContain("victim");
        expect(state.exileHeld).toHaveLength(1);
        expect(state.exileHeld?.[0]).toMatchObject({
            sourceId: coffin.id,
            hostId: "victim",
            hostOwnerId: "p2",
            counters: { "+1/+1": 2 },
            returnTapped: true,
        });
    });

    it("exiles attached Auras alongside the creature (CR 303.4)", () => {
        const { state } = exileVictim({ withAura: true });

        expect(state.players[1].exile.map((c) => c.id)).toEqual(
            expect.arrayContaining(["victim", "aura"])
        );
        expect(
            state.players[1].battlefield.find((c) => c.id === "aura")
        ).toBeUndefined();
        expect(state.exileHeld?.[0].attached).toEqual([
            { id: "aura", ownerId: "p2" },
        ]);
    });

    it("returns the creature tapped under its owner's control with the noted counters when the coffin becomes untapped", () => {
        const { state, coffin } = exileVictim({ counters: { "+1/+1": 2 } });
        untapCoffinAndResolve(state, coffin.id);

        const returned = state.players[1].battlefield.find(
            (c) => c.id === "victim"
        );
        expect(returned).toBeDefined();
        expect(returned!.isTapped).toBe(true); // returns tapped
        expect(returned!.counters).toEqual({ "+1/+1": 2 }); // noted counters
        expect(state.exileHeld).toBeUndefined(); // bundle consumed
    });

    it("reattaches the exiled Aura to the returned creature (CR 303.4)", () => {
        const { state, coffin } = exileVictim({ withAura: true });
        untapCoffinAndResolve(state, coffin.id);

        const returned = state.players[1].battlefield.find(
            (c) => c.id === "victim"
        )!;
        const aura = state.players[1].battlefield.find((c) => c.id === "aura");
        expect(aura).toBeDefined();
        expect(aura!.attachedTo).toBe("victim");
        // Holy Strength's +1/+2 applies again → Grizzly Bears 2/2 reads 3/4.
        expect(getEffectivePower(state, returned)).toBe(3);
        expect(getEffectiveToughness(state, returned)).toBe(4);
    });

    it("returns the creature when the coffin leaves the battlefield (CR 603.7a)", () => {
        const { state, coffin } = exileVictim({ counters: { "+1/+1": 1 } });
        removePermanentTo(state, coffin.id, "graveyard");
        processPendingActionTriggers(state);
        const trig = state.stack.find(
            (s) => s.triggeredAbilityId === "tawnoss-coffin-return-on-leave"
        );
        expect(trig).toBeDefined();
        resolveTopOfStack(state);

        const returned = state.players[1].battlefield.find(
            (c) => c.id === "victim"
        );
        expect(returned).toBeDefined();
        expect(returned!.isTapped).toBe(true);
        expect(returned!.counters).toEqual({ "+1/+1": 1 });
        expect(state.exileHeld).toBeUndefined();
    });

    it("keeps the creature exiled when the controller declines to untap the coffin (CR 502.1)", () => {
        const { state, coffin } = exileVictim({});
        const c = state.players[0].battlefield.find((x) => x.id === coffin.id)!;
        c.isTapped = true;
        state.phase = "UNTAP";
        state.activePlayerId = "p1";
        untapStep(state);
        submitChoice(state, []); // decline → coffin stays tapped, no return

        expect(c.isTapped).toBe(true);
        expect(state.players[1].exile.map((x) => x.id)).toContain("victim");
        expect(state.exileHeld).toHaveLength(1);
        expect(
            state.stack.find(
                (s) => s.triggeredAbilityId === "tawnoss-coffin-return-on-untap"
            )
        ).toBeUndefined();
    });

    it("does not fire a return trigger when an empty (nothing-held) coffin untaps", () => {
        const coffin = makeInstance(tawnossCoffin.id, {
            id: "coffin",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            isTapped: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [coffin] }),
                makePlayer("p2"),
            ],
            phase: "UNTAP",
        });
        untapStep(state);
        submitChoice(state, ["coffin"]); // untap it — but nothing is held
        expect(
            state.stack.find(
                (s) => s.triggeredAbilityId === "tawnoss-coffin-return-on-untap"
            )
        ).toBeUndefined();
    });

    it("emits PERMANENT_UNTAPPED only on a real tapped → untapped transition (CR 701.20b)", () => {
        const card = makeInstance(grizzlyBears.id, {
            id: "c",
            isTapped: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [card] }),
                makePlayer("p2"),
            ],
        });
        expect(untapPermanent(state, card)).toBe(true);
        expect(state.pendingEvents?.[0]).toMatchObject({
            type: "PERMANENT_UNTAPPED",
            permanentId: "c",
        });
        // Already untapped → no transition, no event.
        state.pendingEvents = undefined;
        expect(untapPermanent(state, card)).toBe(false);
        expect(state.pendingEvents).toBeUndefined();
    });

    it("serialization: a non-empty exileHeld bundle round-trips (schema drift guard)", () => {
        const { state } = exileVictim({ counters: { "+1/+1": 3 } });
        const restored = expandState(compactState(state));
        expect(restored.exileHeld).toEqual(state.exileHeld);
    });

    it("wire format: the returned creature is on its owner's projected battlefield", () => {
        const { state, coffin } = exileVictim({ counters: { "+1/+1": 1 } });
        untapCoffinAndResolve(state, coffin.id);

        const projected = projectPublicState(state, 1, "p2");
        const returned = projected.players[1].battlefield.find(
            (c) => c.id === "victim"
        );
        expect(returned).toBeDefined();
        expect(returned!.isTapped).toBe(true);
    });
});
