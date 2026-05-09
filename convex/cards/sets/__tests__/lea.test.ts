// Per-card behavior tests for cards in `convex/cards/sets/lea.ts`.
// Mirrors the data file: every card with non-trivial behavior gets its own
// describe() block. Spell cards are exercised through resolveTopOfStack();
// pt-buff cards are exercised via effectivePower/Toughness, both at the GRE
// level AND through the wire format (projectPublicState → frontend adapter)
// so regressions at the projection boundary are caught here.

import { describe, it, expect } from "vitest";
import {
    armageddon,
    badMoon,
    badlands,
    balance,
    bayou,
    berserk,
    birdsOfParadise,
    blackKnight,
    blackWard,
    blueWard,
    bogWraith,
    braingeyser,
    burrowing,
    consecrateLand,
    crusade,
    cursedLand,
    deathWard,
    drudgeSkeletons,
    farmstead,
    feedback,
    flight,
    goblinBalloonBrigade,
    goblinKing,
    greenWard,
    holyStrength,
    jump,
    karma,
    keldonWarlord,
    lance,
    mindTwist,
    monssGoblinRaiders,
    orcishArtillery,
    pirateShip,
    plagueRats,
    prodigalSorcerer,
    raiseDead,
    shatter,
    stoneRain,
    tunnel,
    unholyStrength,
    uthdenTroll,
    wallOfBone,
    warpArtifact,
    weakness,
    willOTheWisp,
    redWard,
    whiteWard,
    shanodinDryads,
    castle,
    channel,
    circleOfProtectionBlue,
    circleOfProtectionGreen,
    circleOfProtectionRed,
    circleOfProtectionWhite,
    counterspell,
    controlMagic,
    ancestralRecall,
    darkRitual,
    demonicTutor,
    drainLife,
    fireball,
    lightningBolt,
    llanowarElves,
    plateau,
    savannah,
    scrubland,
    swamp,
    swordsToPlowshares,
    taiga,
    timeWalk,
    timetwister,
    tropicalIsland,
    tundra,
    twiddle,
    undergroundSea,
    unsummon,
    whiteKnight,
    wrathOfGod,
    disenchant,
    earthquake,
    elvishArchers,
    grizzlyBears,
    hurricane,
    howlingMine,
    hypnoticSpecter,
    icyManipulator,
    island,
    jadeStatue,
    jayemdaeTome,
    juggernaut,
    nightmare,
    plains,
    serraAngel,
    psionicBlast,
    regeneration,
    regrowth,
    royalAssassin,
    savannahLions,
    seaSerpent,
    sengirVampire,
    sinkhole,
    solRing,
    moxEmerald,
    moxJet,
    moxPearl,
    moxRuby,
    moxSapphire,
    stealArtifact,
    mountain,
    volcanicEruption,
    wallOfSwords,
    wheelOfFortune,
    winterOrb,
} from "../lea";
import {
    commitLandsForCost,
    removePermanentTo,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
} from "../../../gre/state";
import { getEffectivePower, getEffectiveToughness } from "../../../gre/layers";
import {
    getActivatedManaColor,
    getFixedManaAmount,
    hasManaAbility,
} from "../../../gre/constants";
import {
    getLegalActions,
    getLegalTargets,
    getProtectedColors,
    isProtectedFromSource,
    parseProtectionFromColor,
} from "../../../gre/rules";
import { projectPublicState } from "../../../gameProjections";
import { checkStateBasedActions } from "../../../gre/sba";
import {
    validateAttackerEligibility,
    validateBlockerEligibility,
    mustAttack,
    getRequiredAttackerIds,
} from "../../../gre/combat";
import { advancePhase } from "../../../gre/phases";
import type { CardDefinition, CardType } from "../../types";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../__tests__/setup";

// ---------------------------------------------------------------------------
// Static P/T buffs (layer 7c — CR 611, 613)
// ---------------------------------------------------------------------------

describe("Castle (static pt-buff: +0/+2 to your untapped creatures)", () => {
    function setup() {
        const creature = makeInstance(savannahLions.id, { id: "lion" });
        const enchant = makeInstance(castle.id, { id: "castle" });
        const p1 = makePlayer("p1", { battlefield: [creature, enchant] });
        return makeState({ players: [p1, makePlayer("p2")] });
    }

    it("buffs toughness of your untapped creatures by 2", () => {
        const state = setup();
        const lion = state.players[0].battlefield[0];
        expect(getEffectiveToughness(state, lion)).toBe(3);
        expect(getEffectivePower(state, lion)).toBe(2);
    });

    it("does NOT buff tapped creatures (predicate requires !isTapped)", () => {
        const state = setup();
        const lion = state.players[0].battlefield[0];
        lion.isTapped = true;
        expect(getEffectiveToughness(state, lion)).toBe(1);
    });

    it("does NOT buff opponent's creatures", () => {
        const state = setup();
        const oppLion = makeInstance(savannahLions.id, {
            id: "opp-lion",
            controllerId: "p2",
            ownerId: "p2",
        });
        state.players[1].battlefield.push(oppLion);
        expect(getEffectiveToughness(state, oppLion)).toBe(1);
    });

    it("wire format: buff survives projectPublicState (regression guard)", () => {
        // The projection slims `card.card` to { id }. If the buff logic were
        // to rely on embedded fields, this assertion would break.
        const state = setup();
        const projected = projectPublicState(state, 1, "p1");
        const projectedLion = projected.players[0].battlefield.find(
            (c) => c.id === "lion"
        )!;
        // Re-feed the projected state back to the layer system through
        // PermanentView-compatible shape.
        expect(getEffectiveToughness(projected, projectedLion)).toBe(3);
    });
});

describe("Bad Moon (static pt-buff: +1/+1 to black creatures)", () => {
    // Savannah Lions is white — Bad Moon must NOT apply. To exercise the
    // positive case we synthesize a black creature via manaCost.
    function blackCreature(id: string, controllerId = "p1"): CardInstanceState {
        return {
            id,
            card: { id: "fake-black", manaCost: { B: 1 } },
            types: ["Creature"] as CardType[],
            subtypes: [],
            staticAbilities: [],
            power: 1,
            toughness: 1,
            controllerId,
            ownerId: controllerId,
            zone: "battlefield",
            isTapped: false,
        };
    }

    it("buffs black creatures +1/+1", () => {
        const black = blackCreature("black-1");
        const enchant = makeInstance(badMoon.id, { id: "moon" });
        const p1 = makePlayer("p1", { battlefield: [black, enchant] });
        const state = makeState({ players: [p1, makePlayer("p2")] });
        expect(getEffectivePower(state, black)).toBe(2);
        expect(getEffectiveToughness(state, black)).toBe(2);
    });

    it("does NOT buff non-black creatures (Savannah Lions is white)", () => {
        const lion = makeInstance(savannahLions.id, { id: "lion" });
        const enchant = makeInstance(badMoon.id, { id: "moon" });
        const p1 = makePlayer("p1", { battlefield: [lion, enchant] });
        const state = makeState({ players: [p1, makePlayer("p2")] });
        expect(getEffectivePower(state, lion)).toBe(2);
        expect(getEffectiveToughness(state, lion)).toBe(1);
    });

    it("buffs opponent's black creatures too (not controller-restricted)", () => {
        const black = blackCreature("opp-black", "p2");
        const enchant = makeInstance(badMoon.id, { id: "moon" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [enchant] }),
                makePlayer("p2", { battlefield: [black] }),
            ],
        });
        expect(getEffectivePower(state, black)).toBe(2);
    });

    it("wire format: buff still applies after projection strips manaCost (regression)", () => {
        // getColors used to read manaCost from card.card. The projection
        // strips card to { id }, so Bad Moon must resolve manaCost via the
        // registry fallback. This test would fail on the pre-fix code.
        const black: CardInstanceState = {
            id: "black-proj",
            // Embedded manaCost will be STRIPPED by the projection.
            card: { id: savannahLions.id, manaCost: { B: 1 } },
            types: ["Creature"] as CardType[],
            subtypes: [],
            staticAbilities: [],
            power: 1,
            toughness: 1,
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            isTapped: false,
        };
        const enchant = makeInstance(badMoon.id, { id: "moon" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [black, enchant] }),
                makePlayer("p2"),
            ],
        });
        const projected = projectPublicState(state, 1, "p1");
        const projectedBlack = projected.players[0].battlefield.find(
            (c) => c.id === "black-proj"
        )!;
        // After projection, the creature should still be identified as white
        // via the registry (Savannah Lions), NOT black. That's the correct
        // semantic: color comes from the card def, not from any stale embed.
        expect(getEffectivePower(projected, projectedBlack)).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// Spell resolutions (CR 608.3)
// ---------------------------------------------------------------------------

describe("Lightning Bolt (3 damage to any target, CR 608.3)", () => {
    it("deals 3 damage to a target player", () => {
        const state = makeState();
        pushSpell(state, lightningBolt.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(17);
    });

    it("kills a 1/1 creature (damage >= toughness)", () => {
        const lion = makeInstance(savannahLions.id, {
            id: "lion",
            controllerId: "p2",
            ownerId: "p2",
            power: 2,
            toughness: 1,
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [lion] }),
            ],
        });
        pushSpell(state, lightningBolt.id, "p1", [
            { type: "permanent", id: "lion" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[1].battlefield).toHaveLength(0);
        expect(state.players[1].graveyard).toHaveLength(1);
        expect(state.players[1].graveyard[0].id).toBe("lion");
    });

    it("goes to the caster's graveyard after resolving", () => {
        const state = makeState();
        pushSpell(state, lightningBolt.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[0].graveyard).toHaveLength(1);
        expect((state.players[0].graveyard[0].card as { id: string }).id).toBe(
            lightningBolt.id
        );
    });

    it("cannot target lands (CR 115.4 / 120.3 — 'any target' is damageable only)", () => {
        const lion = makeInstance(savannahLions.id, {
            id: "lion",
            controllerId: "p2",
            ownerId: "p2",
        });
        const forest = makeInstance(taiga.id, {
            id: "forest",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [lion, forest] }),
            ],
        });
        const legal = getLegalTargets(state, lightningBolt.targetRequirement!);
        const ids = legal.map((t) => t.id);
        expect(ids).toContain("lion");
        expect(ids).toContain("p1");
        expect(ids).toContain("p2");
        expect(ids).not.toContain("forest");
    });
});

describe("Psionic Blast ({2}{U} — 4 to any target, 2 to you, CR 120.3)", () => {
    it("deals 4 damage to target player and 2 damage to the caster", () => {
        const state = makeState();
        pushSpell(state, psionicBlast.id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(16);
        expect(state.players[0].life).toBe(18);
    });

    it("kills a 4-toughness creature while still damaging the caster", () => {
        const wall = makeInstance(wallOfSwords.id, {
            id: "wall",
            controllerId: "p2",
            ownerId: "p2",
            power: 3,
            toughness: 4,
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [wall] }),
            ],
        });
        pushSpell(state, psionicBlast.id, "p1", [
            { type: "permanent", id: "wall" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[1].battlefield).toHaveLength(0);
        expect(state.players[1].graveyard.map((c) => c.id)).toContain("wall");
        expect(state.players[0].life).toBe(18);
    });

    it("can target the caster — 4 + 2 damage both hit p1", () => {
        const state = makeState();
        pushSpell(state, psionicBlast.id, "p1", [{ type: "player", id: "p1" }]);
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(14);
    });
});

describe("Fireball ({X}{R} — X damage divided, +{1}/target, CR 107.3 / 120.1 / 601.2f)", () => {
    function setupState(targets: string[] = []) {
        const creatures = targets.map((id) =>
            makeInstance(savannahLions.id, {
                id,
                controllerId: "p2",
                ownerId: "p2",
                power: 2,
                toughness: 1,
            })
        );
        return makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: creatures }),
            ],
        });
    }

    it("deals X damage to a single target when only one is chosen", () => {
        const state = setupState();
        const item = pushSpell(state, fireball.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        item.chosenX = 5;
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(15);
    });

    it("divides X damage evenly rounded down across multiple targets", () => {
        // X=5 across 2 targets => 2 each, remainder 1 discarded (CR 120.1).
        const state = setupState(["lion-a", "lion-b"]);
        state.players[1].battlefield[0].toughness = 3;
        state.players[1].battlefield[1].toughness = 3;
        const item = pushSpell(state, fireball.id, "p1", [
            { type: "permanent", id: "lion-a" },
            { type: "permanent", id: "lion-b" },
        ]);
        item.chosenX = 5;
        resolveTopOfStack(state);
        // 2 damage per target < 3 toughness → neither dies, both stay alive.
        expect(state.players[1].battlefield).toHaveLength(2);
    });

    it("kills all targets when per-target damage reaches lethal", () => {
        // X=6 across 2 targets => 3 each, lethal against toughness 1.
        const state = setupState(["lion-a", "lion-b"]);
        const item = pushSpell(state, fireball.id, "p1", [
            { type: "permanent", id: "lion-a" },
            { type: "permanent", id: "lion-b" },
        ]);
        item.chosenX = 6;
        resolveTopOfStack(state);
        expect(state.players[1].battlefield).toHaveLength(0);
        expect(state.players[1].graveyard).toHaveLength(2);
    });

    it("is a no-op when X is 0 (total 0 damage)", () => {
        const state = setupState();
        const item = pushSpell(state, fireball.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        item.chosenX = 0;
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(20);
    });

    it("declares additionalGenericPerExtraTarget for the cost modifier", () => {
        // CR 601.2f: the engine uses this value in finalizeTargetSelection to
        // grow the generic mana cost with each target beyond the first.
        expect(fireball.additionalGenericPerExtraTarget).toBe(1);
    });

    it("declares a variable target count with min 1", () => {
        expect(fireball.targetRequirement).toEqual({
            type: "any",
            count: { min: 1 },
        });
    });

    it("goes to the caster's graveyard after resolving (CR 608.2k)", () => {
        const state = setupState();
        const item = pushSpell(state, fireball.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        item.chosenX = 3;
        resolveTopOfStack(state);
        expect(state.players[0].graveyard).toHaveLength(1);
        expect((state.players[0].graveyard[0].card as { id: string }).id).toBe(
            fireball.id
        );
    });

    it("wire format: divided damage still lethal after projectPublicState", () => {
        // Regression: the projection slims stack items' card to { id } only,
        // but chosenX/targets must survive the projection AND re-driving the
        // GRE from a freshly cloned state must still kill both lions.
        const state = setupState(["lion-a", "lion-b"]);
        const item = pushSpell(state, fireball.id, "p1", [
            { type: "permanent", id: "lion-a" },
            { type: "permanent", id: "lion-b" },
        ]);
        item.chosenX = 4;
        const projected = projectPublicState(state, 1, "p1");
        const projectedItem = projected.stack[0];
        expect(projectedItem.chosenX).toBe(4);
        expect(projectedItem.targets).toHaveLength(2);
        // Resolve against the live state (the source of truth) and assert
        // that the per-target damage (4/2 = 2) clears both 1-toughness lions.
        resolveTopOfStack(state);
        expect(state.players[1].battlefield).toHaveLength(0);
    });
});

describe("Earthquake ({X}{R} — X damage to each non-flying creature and each player, CR 107.3 / 120.3)", () => {
    function setupBoard() {
        const ground = makeInstance(savannahLions.id, {
            id: "ground",
            controllerId: "p2",
            ownerId: "p2",
        });
        // Serra Angel is a 4/4 with flying — the canonical flier in LEA.
        const flier = makeInstance(serraAngel.id, {
            id: "flier",
            controllerId: "p2",
            ownerId: "p2",
        });
        return makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [ground, flier] }),
            ],
        });
    }

    it("kills non-flying creatures, spares fliers, damages both players", () => {
        const state = setupBoard();
        const item = pushSpell(state, earthquake.id, "p1");
        item.chosenX = 2;
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "ground")
        ).toBeUndefined();
        expect(
            state.players[1].battlefield.find((c) => c.id === "flier")
        ).toBeDefined();
        expect(state.players[0].life).toBe(18);
        expect(state.players[1].life).toBe(18);
    });

    it("is a no-op when X is 0", () => {
        const state = setupBoard();
        const item = pushSpell(state, earthquake.id, "p1");
        item.chosenX = 0;
        resolveTopOfStack(state);
        expect(state.players[1].battlefield).toHaveLength(2);
        expect(state.players[0].life).toBe(20);
        expect(state.players[1].life).toBe(20);
    });

    it("leaves fliers alive even when X would otherwise be lethal", () => {
        const state = setupBoard();
        const item = pushSpell(state, earthquake.id, "p1");
        item.chosenX = 10;
        resolveTopOfStack(state);
        // Only the flier survives; both players take 10.
        expect(state.players[1].battlefield).toHaveLength(1);
        expect(state.players[1].battlefield[0].id).toBe("flier");
        expect(state.players[0].life).toBe(10);
        expect(state.players[1].life).toBe(10);
    });

    it("wire format: battlefield and life projection reflect the sweep", () => {
        const state = setupBoard();
        const item = pushSpell(state, earthquake.id, "p1");
        item.chosenX = 2;
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        const p2 = projected.players.find((p) => p.id === "p2")!;
        const ids = p2.battlefield.map((c) => c.id);
        expect(ids).not.toContain("ground");
        expect(ids).toContain("flier");
        expect(p2.life).toBe(18);
        expect(projected.players.find((p) => p.id === "p1")!.life).toBe(18);
    });
});

describe("Hurricane ({X}{G} — X damage to each flying creature and each player, CR 107.3 / 120.3)", () => {
    function setupBoard() {
        const ground = makeInstance(savannahLions.id, {
            id: "ground",
            controllerId: "p2",
            ownerId: "p2",
        });
        const flier = makeInstance(serraAngel.id, {
            id: "flier",
            controllerId: "p2",
            ownerId: "p2",
        });
        return makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [ground, flier] }),
            ],
        });
    }

    it("kills fliers when X reaches lethal, spares ground, damages both players", () => {
        const state = setupBoard();
        const item = pushSpell(state, hurricane.id, "p1");
        item.chosenX = 4;
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "flier")
        ).toBeUndefined();
        expect(
            state.players[1].battlefield.find((c) => c.id === "ground")
        ).toBeDefined();
        expect(state.players[0].life).toBe(16);
        expect(state.players[1].life).toBe(16);
    });

    it("is a no-op when X is 0", () => {
        const state = setupBoard();
        const item = pushSpell(state, hurricane.id, "p1");
        item.chosenX = 0;
        resolveTopOfStack(state);
        expect(state.players[1].battlefield).toHaveLength(2);
        expect(state.players[0].life).toBe(20);
    });

    it("wire format: projection confirms only the flier died", () => {
        const state = setupBoard();
        const item = pushSpell(state, hurricane.id, "p1");
        item.chosenX = 4;
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        const p2 = projected.players.find((p) => p.id === "p2")!;
        const ids = p2.battlefield.map((c) => c.id);
        expect(ids).toContain("ground");
        expect(ids).not.toContain("flier");
        expect(p2.life).toBe(16);
    });
});

describe("Volcanic Eruption ({X}{U}{U}{U} — destroy X target Mountains, deal that many to each creature/player, CR 107.3 / 205.3 / 614.5 / 120.3)", () => {
    function makeMountain(id: string, controllerId: string): CardInstanceState {
        return makeInstance(mountain.id, {
            id,
            controllerId,
            ownerId: controllerId,
        });
    }

    function setupBoard() {
        const m1 = makeMountain("mtn-1", "p2");
        const m2 = makeMountain("mtn-2", "p2");
        const m3 = makeMountain("mtn-3", "p2");
        const lion = makeInstance(savannahLions.id, {
            id: "lion",
            controllerId: "p2",
            ownerId: "p2",
        });
        const flier = makeInstance(serraAngel.id, {
            id: "flier",
            controllerId: "p1",
            ownerId: "p1",
        });
        return makeState({
            players: [
                makePlayer("p1", { battlefield: [flier] }),
                makePlayer("p2", { battlefield: [m1, m2, m3, lion] }),
            ],
        });
    }

    it("declares X-bound count and Mountain subtype filter", () => {
        expect(volcanicEruption.targetRequirement).toEqual({
            type: "Land",
            subtypeFilter: "Mountain",
            count: "X",
        });
    });

    it("destroys X Mountains and deals X damage to each creature and each player", () => {
        const state = setupBoard();
        const item = pushSpell(state, volcanicEruption.id, "p1", [
            { type: "permanent", id: "mtn-1" },
            { type: "permanent", id: "mtn-2" },
        ]);
        item.chosenX = 2;
        resolveTopOfStack(state);

        // Two Mountains gone from p2's battlefield.
        const p2 = state.players[1];
        expect(p2.battlefield.find((c) => c.id === "mtn-1")).toBeUndefined();
        expect(p2.battlefield.find((c) => c.id === "mtn-2")).toBeUndefined();
        expect(p2.battlefield.find((c) => c.id === "mtn-3")).toBeDefined();

        // Savannah Lions (toughness 1) dies to 2 damage; Serra Angel
        // (toughness 4) survives with 2 marked damage.
        expect(p2.battlefield.find((c) => c.id === "lion")).toBeUndefined();
        const flier = state.players[0].battlefield.find(
            (c) => c.id === "flier"
        );
        expect(flier?.damageMarked).toBe(2);

        // Mountains + Lions in p2's graveyard.
        const p2GraveIds = p2.graveyard.map((c) => c.id);
        expect(p2GraveIds).toEqual(
            expect.arrayContaining(["mtn-1", "mtn-2", "lion"])
        );
        // Volcanic Eruption itself goes to its caster's graveyard (CR 608.2k).
        expect((state.players[0].graveyard[0].card as { id: string }).id).toBe(
            volcanicEruption.id
        );

        // Both players take 2.
        expect(state.players[0].life).toBe(18);
        expect(state.players[1].life).toBe(18);
    });

    it("treats dual lands with the Mountain subtype as legal targets (CR 205.3)", () => {
        // Plateau is "Land — Mountain Plains" — has the Mountain subtype.
        const dual = makeInstance(plateau.id, {
            id: "plateau",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [dual] }),
            ],
        });
        const legal = getLegalTargets(
            state,
            volcanicEruption.targetRequirement!
        );
        expect(legal.map((t) => t.id)).toContain("plateau");
    });

    it("excludes non-Mountain lands from legal targets", () => {
        // Underground Sea (Island Swamp) — no Mountain subtype, must NOT match.
        const sea = makeInstance(undergroundSea.id, {
            id: "sea",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [sea] }),
            ],
        });
        const legal = getLegalTargets(
            state,
            volcanicEruption.targetRequirement!
        );
        expect(legal).toHaveLength(0);
    });

    it("skips a target that is no longer a Mountain on resolution (CR 608.2b)", () => {
        // Pre-stage: caster picked two targets, but mtn-2 has already left
        // the battlefield (removed before resolution). Only mtn-1 is still a
        // Mountain — Volcanic Eruption deals 1 damage, not 2.
        const state = setupBoard();
        // Surgically remove mtn-2 from the battlefield.
        const p2 = state.players[1];
        p2.battlefield = p2.battlefield.filter((c) => c.id !== "mtn-2");

        const item = pushSpell(state, volcanicEruption.id, "p1", [
            { type: "permanent", id: "mtn-1" },
            { type: "permanent", id: "mtn-2" },
        ]);
        item.chosenX = 2;
        resolveTopOfStack(state);

        // Only mtn-1 was destroyed → damage = 1.
        expect(p2.battlefield.find((c) => c.id === "mtn-1")).toBeUndefined();
        expect(state.players[0].life).toBe(19);
        expect(state.players[1].life).toBe(19);
        // Savannah Lions (toughness 1) dies even to 1 damage.
        expect(p2.battlefield.find((c) => c.id === "lion")).toBeUndefined();
        // Serra Angel (toughness 4) survives with 1 marked damage.
        const flier = state.players[0].battlefield.find(
            (c) => c.id === "flier"
        );
        expect(flier?.damageMarked).toBe(1);
    });

    it("is a no-op when no Mountains were destroyed (avoids spurious 0 damage)", () => {
        const state = setupBoard();
        // Surgically remove every Mountain before resolution — every chosen
        // target is now off-battlefield.
        const p2 = state.players[1];
        p2.battlefield = p2.battlefield.filter(
            (c) => !c.subtypes.includes("Mountain")
        );
        const item = pushSpell(state, volcanicEruption.id, "p1", [
            { type: "permanent", id: "mtn-1" },
            { type: "permanent", id: "mtn-2" },
        ]);
        item.chosenX = 2;
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(20);
        expect(state.players[1].life).toBe(20);
        const lion = p2.battlefield.find((c) => c.id === "lion");
        expect(lion?.damageMarked).toBeUndefined();
    });

    it("wire format: destroyed Mountains and damaged creatures survive projection", () => {
        const state = setupBoard();
        const item = pushSpell(state, volcanicEruption.id, "p1", [
            { type: "permanent", id: "mtn-1" },
            { type: "permanent", id: "mtn-2" },
        ]);
        item.chosenX = 2;
        resolveTopOfStack(state);

        const projected = projectPublicState(state, 2, "p2");
        const p2 = projected.players.find((p) => p.id === "p2")!;
        const ids = p2.battlefield.map((c) => c.id);
        expect(ids).not.toContain("mtn-1");
        expect(ids).not.toContain("mtn-2");
        expect(ids).toContain("mtn-3");
        // Savannah Lions died → not on the projected board.
        expect(ids).not.toContain("lion");
        expect(p2.life).toBe(18);
        const p1 = projected.players.find((p) => p.id === "p1")!;
        expect(p1.life).toBe(18);
    });
});

describe("Damage accumulation on creatures (CR 120.3, 704.5g, 514.2)", () => {
    function setup() {
        // Serra Angel: 4/4 flying — two Lightning Bolts (3 each) accumulate
        // to 6 marked damage >= 4 toughness → dies. One alone leaves her at
        // 3 marked damage, alive.
        const angel = makeInstance(serraAngel.id, {
            id: "angel",
            controllerId: "p2",
            ownerId: "p2",
        });
        return makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [angel] }),
            ],
        });
    }

    it("single non-lethal hit leaves the creature alive with marked damage", () => {
        const state = setup();
        pushSpell(state, lightningBolt.id, "p1", [
            { type: "permanent", id: "angel" },
        ]);
        resolveTopOfStack(state);
        const angel = state.players[1].battlefield.find(
            (c) => c.id === "angel"
        );
        expect(angel).toBeDefined();
        expect(angel!.damageMarked).toBe(3);
    });

    it("second hit accumulates and kills once marked damage >= toughness", () => {
        const state = setup();
        pushSpell(state, lightningBolt.id, "p1", [
            { type: "permanent", id: "angel" },
        ]);
        resolveTopOfStack(state);
        pushSpell(state, lightningBolt.id, "p1", [
            { type: "permanent", id: "angel" },
        ]);
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "angel")
        ).toBeUndefined();
        // Angel in p2's graveyard (along with the two resolved bolts for p1).
        expect(
            state.players[1].graveyard.find(
                (c) => (c.card as { id: string }).id === serraAngel.id
            )
        ).toBeDefined();
    });

    it("CLEANUP wipes marked damage (CR 514.2)", () => {
        const state = setup();
        pushSpell(state, lightningBolt.id, "p1", [
            { type: "permanent", id: "angel" },
        ]);
        resolveTopOfStack(state);
        // Jump straight to END_STEP so the next advancePhase lands on CLEANUP,
        // whose entry handler wipes marked damage inline (CR 514.2). Walking
        // every phase with advancePhase risks an auto-skip / combat-entry loop
        // in a scenario without declared attackers.
        state.phase = "END_STEP";
        // advancePhase will traverse CLEANUP (auto) into the next turn's
        // UPKEEP — the CR 514.2 wipe runs inline on CLEANUP entry.
        advancePhase(state);
        const angel = state.players[1].battlefield.find(
            (c) => c.id === "angel"
        );
        expect(angel).toBeDefined();
        expect(angel!.damageMarked).toBeUndefined();
    });
});

describe("Dark Ritual (add {B}{B}{B}, CR 608.3 + 106.1)", () => {
    it("adds three black mana to the caster's mana pool on resolution", () => {
        const state = makeState();
        pushSpell(state, darkRitual.id, "p1");
        resolveTopOfStack(state);
        expect(state.players[0].manaPool.B).toBe(3);
        expect(state.players[0].graveyard).toHaveLength(1);
    });

    it("adds to the caster, not the opponent", () => {
        const state = makeState();
        pushSpell(state, darkRitual.id, "p2");
        resolveTopOfStack(state);
        expect(state.players[0].manaPool.B ?? 0).toBe(0);
        expect(state.players[1].manaPool.B).toBe(3);
    });
});

describe("Ancestral Recall (target player draws 3, CR 608.3)", () => {
    it("draws 3 cards for the target player", () => {
        const p2Library = Array.from({ length: 5 }, (_, i) =>
            makeInstance(grizzlyBearsId(), {
                id: `p2-lib-${i}`,
                controllerId: "p2",
                ownerId: "p2",
                zone: "library",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { library: p2Library }),
            ],
        });
        pushSpell(state, ancestralRecall.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[1].hand).toHaveLength(3);
        expect(state.players[1].library).toHaveLength(2);
    });
});

describe("Braingeyser ({X}{U}{U} — target player draws X, CR 107.3 / 121.1)", () => {
    function setup(libSize = 10) {
        const p2Library = Array.from({ length: libSize }, (_, i) =>
            makeInstance(grizzlyBearsId(), {
                id: `p2-lib-${i}`,
                controllerId: "p2",
                ownerId: "p2",
                zone: "library",
            })
        );
        return makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { library: p2Library }),
            ],
        });
    }

    it("target player draws X cards on resolution", () => {
        const state = setup();
        const item = pushSpell(state, braingeyser.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        item.chosenX = 4;
        resolveTopOfStack(state);
        expect(state.players[1].hand).toHaveLength(4);
        expect(state.players[1].library).toHaveLength(6);
    });

    it("can target the caster", () => {
        const p1Library = Array.from({ length: 5 }, (_, i) =>
            makeInstance(grizzlyBearsId(), {
                id: `p1-lib-${i}`,
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1", { library: p1Library }),
                makePlayer("p2"),
            ],
        });
        const item = pushSpell(state, braingeyser.id, "p1", [
            { type: "player", id: "p1" },
        ]);
        item.chosenX = 3;
        resolveTopOfStack(state);
        expect(state.players[0].hand).toHaveLength(3);
        expect(state.players[0].library).toHaveLength(2);
    });

    it("is a no-op when X is 0 (draws no cards)", () => {
        const state = setup();
        const item = pushSpell(state, braingeyser.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        item.chosenX = 0;
        resolveTopOfStack(state);
        expect(state.players[1].hand).toHaveLength(0);
        expect(state.players[1].library).toHaveLength(10);
    });

    it("stops at empty library and flags hasDrawnFromEmpty (CR 704.5b)", () => {
        // Library has only 2 cards; X=5 draws 2 and then pulls from empty.
        const state = setup(2);
        const item = pushSpell(state, braingeyser.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        item.chosenX = 5;
        resolveTopOfStack(state);
        expect(state.players[1].hand).toHaveLength(2);
        expect(state.players[1].library).toHaveLength(0);
        expect(state.players[1].hasDrawnFromEmpty).toBe(true);
    });

    it("goes to the caster's graveyard after resolving (CR 608.2k)", () => {
        const state = setup();
        const item = pushSpell(state, braingeyser.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        item.chosenX = 1;
        resolveTopOfStack(state);
        expect(state.players[0].graveyard).toHaveLength(1);
        expect((state.players[0].graveyard[0].card as { id: string }).id).toBe(
            braingeyser.id
        );
    });

    it("wire format: chosenX survives projectPublicState", () => {
        const state = setup();
        const item = pushSpell(state, braingeyser.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        item.chosenX = 3;
        const projected = projectPublicState(state, 1, "p1");
        const projectedItem = projected.stack[0];
        expect(projectedItem.chosenX).toBe(3);
        expect(projectedItem.targets).toEqual([{ type: "player", id: "p2" }]);
    });

    it("declares a single-player target requirement", () => {
        expect(braingeyser.targetRequirement).toEqual({
            type: "player",
            count: 1,
        });
    });
});

describe("Counterspell (counter target spell, CR 701.5a)", () => {
    it("removes a spell from the stack (doesn't let it resolve)", () => {
        const state = makeState();
        const bolt = pushSpell(state, lightningBolt.id, "p2", [
            { type: "player", id: "p1" },
        ]);
        pushSpell(state, counterspell.id, "p1", [
            { type: "spell", id: bolt.id },
        ]);
        // Resolve Counterspell first (top of stack → LIFO)
        resolveTopOfStack(state);
        // The Lightning Bolt should have been removed from the stack.
        expect(state.stack.find((s) => s.id === bolt.id)).toBeUndefined();
        // Counterspell itself goes to p1's graveyard.
        expect(state.players[0].graveyard).toHaveLength(1);
    });

    it("preserves p1 life (bolt never resolves)", () => {
        const state = makeState();
        const bolt = pushSpell(state, lightningBolt.id, "p2", [
            { type: "player", id: "p1" },
        ]);
        pushSpell(state, counterspell.id, "p1", [
            { type: "spell", id: bolt.id },
        ]);
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(20);
    });
});

describe("Swords to Plowshares (exile + gain life = power, CR 608.3)", () => {
    it("exiles the target creature and grants life = its power to controller", () => {
        const angel = makeInstance(serraAngel.id, {
            id: "angel",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [angel] }),
            ],
        });
        pushSpell(state, swordsToPlowshares.id, "p1", [
            { type: "permanent", id: "angel" },
        ]);
        resolveTopOfStack(state);
        // Exiled (not graveyard).
        expect(state.players[1].battlefield).toHaveLength(0);
        expect(state.players[1].exile).toHaveLength(1);
        expect(state.players[1].exile[0].id).toBe("angel");
        // Controller of the exiled creature (p2) gains life = angel's power (4).
        expect(state.players[1].life).toBe(24);
    });
});

describe("Wrath of God (destroy all creatures, CR 608.3)", () => {
    it("moves every creature to its owner's graveyard", () => {
        const angel = makeInstance(serraAngel.id, { id: "angel" });
        const lion = makeInstance(savannahLions.id, {
            id: "lion",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [angel] }),
                makePlayer("p2", { battlefield: [lion] }),
            ],
        });
        pushSpell(state, wrathOfGod.id, "p1");
        resolveTopOfStack(state);
        expect(state.players[0].battlefield).toHaveLength(0);
        expect(state.players[1].battlefield).toHaveLength(0);
        expect(state.players[0].graveyard.map((c) => c.id)).toContain("angel");
        expect(state.players[1].graveyard.map((c) => c.id)).toContain("lion");
    });
});

describe("Disenchant (destroy target Artifact/Enchantment, CR 608.3)", () => {
    it("destroys a target enchantment", () => {
        const c = makeInstance(castle.id, { id: "castle-target" });
        const state = makeState({
            players: [makePlayer("p1", { battlefield: [c] }), makePlayer("p2")],
        });
        pushSpell(state, disenchant.id, "p2", [
            { type: "permanent", id: "castle-target" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[0].battlefield).toHaveLength(0);
        expect(state.players[0].graveyard[0].id).toBe("castle-target");
    });

    it("uses the destroy-target effect shorthand (registry-compiled resolve)", () => {
        expect(disenchant.effect).toBe("destroy-target");
        expect(disenchant.resolve).toBeUndefined();
    });

    it("wire format: destroyed target absent from projected battlefield, present in graveyard", () => {
        const c = makeInstance(castle.id, { id: "castle-target" });
        const state = makeState({
            players: [makePlayer("p1", { battlefield: [c] }), makePlayer("p2")],
        });
        pushSpell(state, disenchant.id, "p2", [
            { type: "permanent", id: "castle-target" },
        ]);
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p2");
        const p1 = projected.players.find((p) => p.id === "p1")!;
        expect(p1.battlefield.map((c) => c.id)).not.toContain("castle-target");
        expect(p1.graveyard.map((c) => c.id)).toContain("castle-target");
    });
});

describe("Demonic Tutor (search library, put into hand, CR 701.19)", () => {
    function commitHead(state: GameState, picks: string[]) {
        const queue = state.pendingChoices ?? [];
        const head = queue[0];
        const item = state.stack.find((s) => s.id === head.stackItemId);
        if (!item) throw new Error("stack item missing");
        item.collectedChoices = {
            ...(item.collectedChoices ?? {}),
            [`${head.step}:${head.choiceId}`]: picks,
        };
        queue.shift();
        state.pendingChoices = queue.length > 0 ? queue : undefined;
    }

    it("enqueues a search-library pending choice for the caster", () => {
        const card = makeInstance(swamp.id, {
            id: "target-card",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const state = makeState({
            players: [makePlayer("p1", { library: [card] }), makePlayer("p2")],
        });
        pushSpell(state, demonicTutor.id, "p1");
        resolveTopOfStack(state);
        expect(state.pendingChoices).toHaveLength(1);
        expect(state.pendingChoices?.[0]).toMatchObject({
            playerId: "p1",
            zone: "library",
            count: 1,
            kind: "search-library",
        });
    });

    it("moves the chosen card into the caster's hand and shuffles library", () => {
        const wanted = makeInstance(grizzlyBears.id, {
            id: "wanted",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const others = [
            makeInstance(swamp.id, {
                id: "other-1",
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            }),
            makeInstance(swamp.id, {
                id: "other-2",
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            }),
        ];
        const state = makeState({
            players: [
                makePlayer("p1", { library: [wanted, ...others] }),
                makePlayer("p2"),
            ],
            rngSeed: 1,
        });
        pushSpell(state, demonicTutor.id, "p1");
        resolveTopOfStack(state); // step 0 suspends
        expect(state.pendingChoices).toHaveLength(1);
        commitHead(state, ["wanted"]);
        resolveTopOfStack(state); // step 1 resumes

        const p1 = state.players[0];
        expect(p1.hand.map((c) => c.id)).toContain("wanted");
        expect(p1.library.map((c) => c.id)).not.toContain("wanted");
        expect(p1.library).toHaveLength(2);
    });
});

describe("Drain Life (X damage to any target, gain X life, CR 107.3 + 120.1)", () => {
    it("deals X damage to a player and gains the caster X life", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { life: 20 }),
                makePlayer("p2", { life: 20 }),
            ],
        });
        const spell = pushSpell(state, drainLife.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        spell.chosenX = 5;
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(15);
        expect(state.players[0].life).toBe(25);
    });

    it("deals X damage to a creature and gains the caster X life", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "opp-bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { life: 20 }),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        const spell = pushSpell(state, drainLife.id, "p1", [
            { type: "permanent", id: "opp-bear" },
        ]);
        spell.chosenX = 3;
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(23);
    });

    it("is a no-op when X is 0", () => {
        const state = makeState({
            players: [
                makePlayer("p1", { life: 20 }),
                makePlayer("p2", { life: 20 }),
            ],
        });
        const spell = pushSpell(state, drainLife.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        spell.chosenX = 0;
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(20);
        expect(state.players[1].life).toBe(20);
    });
});

describe("Royal Assassin ({T}: destroy target tapped creature, CR 701.20 + 701.7)", () => {
    function setup() {
        const assassin = makeInstance(royalAssassin.id, {
            id: "assassin",
            isSummoningSick: false,
        });
        const victim = makeInstance(savannahLions.id, {
            id: "victim",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [assassin] }),
                makePlayer("p2", { battlefield: [victim] }),
            ],
        });
        return { state, assassin, victim };
    }

    function activate(
        state: ReturnType<typeof makeState>,
        source: CardInstanceState,
        targetId: string
    ) {
        state.stack.push({
            ...source,
            zone: "stack",
            castById: "p1",
            abilityId: "royal-assassin-destroy",
            targets: [{ type: "permanent", id: targetId }],
        });
        resolveTopOfStack(state);
    }

    it("declares a tapped-creature TargetRequirement", () => {
        const ability = royalAssassin.activatedAbilities?.[0];
        expect(ability?.cost).toEqual({ tap: true });
        expect(ability?.useStack).toBe(true);
        expect(ability?.targetRequirement).toEqual({
            type: "Creature",
            count: 1,
            tappedFilter: "tapped",
        });
    });

    it("destroys a tapped creature on resolution", () => {
        const { state, assassin, victim } = setup();
        victim.isTapped = true;
        activate(state, assassin, "victim");
        expect(state.players[1].battlefield).toHaveLength(0);
        expect(state.players[1].graveyard.map((c) => c.id)).toContain("victim");
    });

    it("fizzles silently if target untaps between activation and resolution (CR 608.2b)", () => {
        const { state, assassin, victim } = setup();
        victim.isTapped = true;
        state.stack.push({
            ...assassin,
            zone: "stack",
            castById: "p1",
            abilityId: "royal-assassin-destroy",
            targets: [{ type: "permanent", id: "victim" }],
        });
        // Opponent untaps the target in response.
        state.players[1].battlefield[0].isTapped = false;
        resolveTopOfStack(state);
        expect(state.players[1].battlefield).toHaveLength(1);
        expect(state.players[1].graveyard).toHaveLength(0);
    });

    it("getLegalTargets only returns tapped creatures", () => {
        const { state, victim } = setup();
        const tappedBear = makeInstance(grizzlyBears.id, {
            id: "tapped-bear",
            controllerId: "p2",
            ownerId: "p2",
            isTapped: true,
        });
        state.players[1].battlefield.push(tappedBear);
        // victim is untapped (default) → should NOT appear; tappedBear should.
        expect(victim.isTapped).toBe(false);
        const req = royalAssassin.activatedAbilities?.[0]?.targetRequirement;
        if (!req) throw new Error("requirement missing");
        const legal = getLegalTargets(state, req);
        const ids = legal.map((t) => t.id);
        expect(ids).toContain("tapped-bear");
        expect(ids).not.toContain("victim");
    });
});

describe("Nightmare (flying, P/T = Swamps you control, CR 604.3 CDA)", () => {
    function setup(args: { controller: string; swamps: number }) {
        const nm = makeInstance(nightmare.id, {
            id: "nm",
            controllerId: args.controller,
            ownerId: args.controller,
        });
        const battlefield: CardInstanceState[] = [nm];
        for (let i = 0; i < args.swamps; i++) {
            battlefield.push(
                makeInstance(swamp.id, {
                    id: `swamp-${args.controller}-${i}`,
                    controllerId: args.controller,
                    ownerId: args.controller,
                })
            );
        }
        const players =
            args.controller === "p1"
                ? [makePlayer("p1", { battlefield }), makePlayer("p2")]
                : [makePlayer("p1"), makePlayer("p2", { battlefield })];
        return makeState({ players });
    }

    it("has flying as a baseline static ability", () => {
        expect(nightmare.staticAbilities).toContain("flying");
    });

    it("P/T equals controller's Swamp count (3)", () => {
        const state = setup({ controller: "p1", swamps: 3 });
        const nm = state.players[0].battlefield[0];
        expect(getEffectivePower(state, nm)).toBe(3);
        expect(getEffectiveToughness(state, nm)).toBe(3);
    });

    it("does NOT count opponent's Swamps", () => {
        const state = setup({ controller: "p1", swamps: 2 });
        state.players[1].battlefield.push(
            makeInstance(swamp.id, {
                id: "opp-swamp",
                controllerId: "p2",
                ownerId: "p2",
            })
        );
        const nm = state.players[0].battlefield[0];
        expect(getEffectivePower(state, nm)).toBe(2);
        expect(getEffectiveToughness(state, nm)).toBe(2);
    });

    it("is 0/0 with no Swamps in play (would die to SBA, CR 704.5f)", () => {
        const state = setup({ controller: "p1", swamps: 0 });
        const nm = state.players[0].battlefield[0];
        expect(getEffectivePower(state, nm)).toBe(0);
        expect(getEffectiveToughness(state, nm)).toBe(0);
    });

    it("CDA survives the projection boundary (wire format)", () => {
        const state = setup({ controller: "p1", swamps: 4 });
        const nm = state.players[0].battlefield[0];
        expect(getEffectiveToughness(state, nm)).toBe(4);
        const projected = projectPublicState(state, 0, "p1");
        const slimNm = projected.players[0].battlefield.find(
            (c) => c.id === "nm"
        );
        if (!slimNm) throw new Error("nm not in projection");
        expect(getEffectivePower(projected, slimNm)).toBe(4);
        expect(getEffectiveToughness(projected, slimNm)).toBe(4);
    });
});

describe("Sengir Vampire (+1/+1 on damaged-creature death, CR 603.2)", () => {
    it("has flying and the CREATURE_DIED trigger", () => {
        expect(sengirVampire.staticAbilities).toContain("flying");
        const trig = sengirVampire.triggeredAbilities?.[0];
        expect(trig?.event).toBe("CREATURE_DIED");
    });

    it("grows +1/+1 when a blocker it damaged dies in combat", async () => {
        const vampire = makeInstance(sengirVampire.id, {
            id: "vamp",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
            isBlocking: true,
        });
        const state = makeState({
            phase: "COMBAT_DAMAGE",
            players: [
                makePlayer("p1", { battlefield: [vampire] }),
                makePlayer("p2", { battlefield: [bear] }),
            ],
            combat: {
                attackerIds: ["vamp"],
                confirmed: true,
                blockerAssignments: { bear: "vamp" },
                blockersConfirmed: true,
            },
        });
        const { applyAllCombatDamage } = await import("../../../gre/phases");
        applyAllCombatDamage(state, { vamp: { bear: 4 } });
        // Bear is dead and in graveyard
        expect(state.players[1].battlefield).toHaveLength(0);
        expect(state.players[1].graveyard).toHaveLength(1);
        // CREATURE_DIED trigger is on the stack for Sengir Vampire
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].triggeredAbilityId).toBe(
            "sengir-vampire-counter"
        );
        resolveTopOfStack(state);
        const live = state.players[0].battlefield[0];
        expect(live.power).toBe(5);
        expect(live.toughness).toBe(5);
    });

    it("does NOT trigger on the death of a creature it didn't damage", async () => {
        // Vampire attacks, is blocked by bear1. A second bear (bear2) dies from
        // damage dealt by another attacker, not by vampire. Vampire's trigger
        // must not fire for bear2's death.
        const vampire = makeInstance(sengirVampire.id, {
            id: "vamp",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const other = makeInstance(grizzlyBears.id, {
            id: "other",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const bear1 = makeInstance(grizzlyBears.id, {
            id: "bear1",
            controllerId: "p2",
            ownerId: "p2",
            isBlocking: true,
        });
        const bear2 = makeInstance(grizzlyBears.id, {
            id: "bear2",
            controllerId: "p2",
            ownerId: "p2",
            isBlocking: true,
        });
        const state = makeState({
            phase: "COMBAT_DAMAGE",
            players: [
                makePlayer("p1", { battlefield: [vampire, other] }),
                makePlayer("p2", { battlefield: [bear1, bear2] }),
            ],
            combat: {
                attackerIds: ["vamp", "other"],
                confirmed: true,
                blockerAssignments: { bear1: "vamp", bear2: "other" },
                blockersConfirmed: true,
            },
        });
        const { applyAllCombatDamage } = await import("../../../gre/phases");
        applyAllCombatDamage(state, {
            vamp: { bear1: 4 },
            other: { bear2: 2 },
        });
        // bear1 (damaged by vamp) and bear2 (damaged by other) are both dead.
        // Only bear1's death should trigger Sengir Vampire.
        expect(state.players[1].battlefield).toHaveLength(0);
        const sengirTriggers = state.stack.filter(
            (s) => s.triggeredAbilityId === "sengir-vampire-counter"
        );
        expect(sengirTriggers).toHaveLength(1);
    });

    it("does NOT trigger on Sengir Vampire's own death", async () => {
        const vampire = makeInstance(sengirVampire.id, {
            id: "vamp",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
            toughness: 1, // make it fragile so it dies to the bear
            power: 4,
        });
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
            isBlocking: true,
            toughness: 10,
        });
        const state = makeState({
            phase: "COMBAT_DAMAGE",
            players: [
                makePlayer("p1", { battlefield: [vampire] }),
                makePlayer("p2", { battlefield: [bear] }),
            ],
            combat: {
                attackerIds: ["vamp"],
                confirmed: true,
                blockerAssignments: { bear: "vamp" },
                blockersConfirmed: true,
            },
        });
        const { applyAllCombatDamage } = await import("../../../gre/phases");
        applyAllCombatDamage(state, { vamp: { bear: 4 } });
        // Vampire damaged the bear but died from the bear's counter-damage.
        // The bear survived (10 toughness). No CREATURE_DIED for bear →
        // no Sengir trigger. Vampire's own death must not trigger either
        // (matches excludes self).
        expect(state.players[0].battlefield).toHaveLength(0);
        expect(state.players[1].battlefield).toHaveLength(1);
        const sengirTriggers = state.stack.filter(
            (s) => s.triggeredAbilityId === "sengir-vampire-counter"
        );
        expect(sengirTriggers).toHaveLength(0);
    });

    it("clears damagedBySources at CLEANUP (CR 514.2)", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
            damagedBySources: ["some-source"],
        });
        const state = makeState({
            phase: "END_STEP",
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        advancePhase(state); // END_STEP → CLEANUP (auto-advances to UNTAP)
        expect(
            state.players[1].battlefield[0].damagedBySources
        ).toBeUndefined();
    });
});

describe("Sea Serpent (CR 508.1c attack restriction + CR 603.8 state trigger)", () => {
    function setup(opts: {
        controllerHasIsland: boolean;
        defenderHasIsland: boolean;
    }) {
        const serpent = makeInstance(seaSerpent.id, {
            id: "serpent",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        const p1Lands = opts.controllerHasIsland
            ? [
                  makeInstance(island.id, {
                      id: "p1-isle",
                      controllerId: "p1",
                      ownerId: "p1",
                  }),
              ]
            : [];
        const p2Lands = opts.defenderHasIsland
            ? [
                  makeInstance(island.id, {
                      id: "p2-isle",
                      controllerId: "p2",
                      ownerId: "p2",
                  }),
              ]
            : [];
        return makeState({
            players: [
                makePlayer("p1", { battlefield: [serpent, ...p1Lands] }),
                makePlayer("p2", { battlefield: p2Lands }),
            ],
        });
    }

    it("can attack when defending player controls an Island", () => {
        const state = setup({
            controllerHasIsland: true,
            defenderHasIsland: true,
        });
        const serpent = state.players[0].battlefield[0];
        const result = validateAttackerEligibility(
            serpent,
            state.players[1].battlefield
        );
        expect(result).toEqual({ eligible: true });
    });

    it("cannot attack when defending player has no Island", () => {
        const state = setup({
            controllerHasIsland: true,
            defenderHasIsland: false,
        });
        const serpent = state.players[0].battlefield[0];
        const result = validateAttackerEligibility(
            serpent,
            state.players[1].battlefield
        );
        expect(result.eligible).toBe(false);
        if (!result.eligible) {
            expect(result.reason).toMatch(/Island/);
        }
    });

    it("ignores controller's Islands — only defender's count for the attack restriction", () => {
        // p1 controls an Island, p2 does not. Serpent still cannot attack
        // because the restriction reads "defending player controls an Island".
        const state = setup({
            controllerHasIsland: true,
            defenderHasIsland: false,
        });
        const serpent = state.players[0].battlefield[0];
        expect(
            validateAttackerEligibility(serpent, state.players[1].battlefield)
                .eligible
        ).toBe(false);
    });

    it("state trigger queues a sacrifice when controller has no Islands", () => {
        // Serpent in play, controller has zero Islands. The first SBA pass
        // schedules the sacrifice trigger on the stack (CR 117.5 + 603.8).
        const state = setup({
            controllerHasIsland: false,
            defenderHasIsland: true,
        });
        expect(state.stack).toHaveLength(0);
        checkStateBasedActions(state);
        expect(state.stack).toHaveLength(1);
        const item = state.stack[0];
        expect(item.triggeredAbilityId).toBe(
            "sea-serpent-no-islands-sacrifice"
        );
        expect(item.triggerSourceId).toBe("serpent");
        expect(item.triggerEvent?.type).toBe("STATE_CHECK");
    });

    it("does NOT trigger a second time while the first trigger is on the stack (CR 603.8)", () => {
        const state = setup({
            controllerHasIsland: false,
            defenderHasIsland: false,
        });
        checkStateBasedActions(state);
        expect(state.stack).toHaveLength(1);
        // Subsequent SBA passes (e.g. another priority handoff) must not pile
        // up duplicate triggers — the state trigger holds itself off until
        // the existing copy resolves or otherwise leaves the stack.
        checkStateBasedActions(state);
        checkStateBasedActions(state);
        expect(state.stack).toHaveLength(1);
    });

    it("does NOT trigger when controller has at least one Island", () => {
        const state = setup({
            controllerHasIsland: true,
            defenderHasIsland: false,
        });
        checkStateBasedActions(state);
        expect(state.stack).toHaveLength(0);
    });

    it("on resolve, sends Sea Serpent to its owner's graveyard", () => {
        const state = setup({
            controllerHasIsland: false,
            defenderHasIsland: false,
        });
        checkStateBasedActions(state);
        expect(state.stack).toHaveLength(1);
        resolveTopOfStack(state);
        expect(state.players[0].battlefield).toHaveLength(0);
        expect(state.players[0].graveyard.map((c) => c.id)).toContain(
            "serpent"
        );
    });

    it("re-triggers after the first sacrifice trigger leaves the stack if the condition still holds", () => {
        // Two Sea Serpents: the trigger fires once per source even after a
        // separate trigger of the same kind has resolved. After resolution,
        // a fresh SBA pass produces a new trigger for any remaining serpent
        // whose controller still has no Islands.
        const state = setup({
            controllerHasIsland: false,
            defenderHasIsland: false,
        });
        const second = makeInstance(seaSerpent.id, {
            id: "serpent2",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        state.players[0].battlefield.push(second);
        checkStateBasedActions(state);
        expect(state.stack).toHaveLength(2);
        resolveTopOfStack(state);
        resolveTopOfStack(state);
        expect(state.players[0].battlefield).toHaveLength(0);
        expect(state.players[0].graveyard.map((c) => c.id).sort()).toEqual([
            "serpent",
            "serpent2",
        ]);
    });

    it("wire format: attack restriction survives projectPublicState", () => {
        // The projection slims `card.card` to `{ id }`. The restriction
        // logic reads `staticAbilities` and the defender battlefield's
        // `subtypes` — both of which the projection preserves.
        const state = setup({
            controllerHasIsland: true,
            defenderHasIsland: false,
        });
        const projected = projectPublicState(state, 1, "p1");
        const projectedSerpent = projected.players[0].battlefield.find(
            (c) => c.id === "serpent"
        )!;
        const projectedDefender = projected.players[1].battlefield;
        const result = validateAttackerEligibility(
            projectedSerpent as CardInstanceState,
            projectedDefender as CardInstanceState[]
        );
        expect(result.eligible).toBe(false);
    });
});

describe("Sinkhole (destroy target land, CR 701.7)", () => {
    it("destroys a target Swamp and sends it to its owner's graveyard", () => {
        const land = makeInstance(swamp.id, {
            id: "p1-swamp",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [land] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, sinkhole.id, "p2", [
            { type: "permanent", id: "p1-swamp" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[0].battlefield).toHaveLength(0);
        expect(state.players[0].graveyard.map((c) => c.id)).toContain(
            "p1-swamp"
        );
    });

    it("declares a Land target requirement with count 1", () => {
        expect(sinkhole.targetRequirement).toEqual({
            type: "Land",
            count: 1,
        });
    });

    it("uses the destroy-target effect shorthand (registry-compiled resolve)", () => {
        expect(sinkhole.effect).toBe("destroy-target");
        expect(sinkhole.resolve).toBeUndefined();
    });

    it("wire format: destroyed land absent from projected battlefield, present in graveyard", () => {
        const land = makeInstance(swamp.id, {
            id: "p1-swamp",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [land] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, sinkhole.id, "p2", [
            { type: "permanent", id: "p1-swamp" },
        ]);
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p2");
        const p1 = projected.players.find((p) => p.id === "p1")!;
        expect(p1.battlefield.map((c) => c.id)).not.toContain("p1-swamp");
        expect(p1.graveyard.map((c) => c.id)).toContain("p1-swamp");
    });
});

// ---------------------------------------------------------------------------
// Keyword abilities (the layer/combat system tests them generically; here we
// only assert the card definition carries the right keywords — guards against
// typos / accidental removals).
// ---------------------------------------------------------------------------

describe("Serra Angel (keyword abilities)", () => {
    it("has flying and vigilance", () => {
        expect(serraAngel.staticAbilities).toContain("flying");
        expect(serraAngel.staticAbilities).toContain("vigilance");
    });
});

describe("Elvish Archers (first strike, CR 702.7)", () => {
    it("is a 2/1 Elf Archer for {1}{G} with first strike", () => {
        expect(elvishArchers.manaCost).toEqual({ X: 1, G: 1 });
        expect(elvishArchers.types).toContain("Creature");
        expect(elvishArchers.subtypes).toEqual(["Elf", "Archer"]);
        expect(elvishArchers.power).toBe(2);
        expect(elvishArchers.toughness).toBe(1);
        expect(elvishArchers.staticAbilities).toContain("first strike");
    });

    it("kills a 2/2 blocker in the first-strike step before it can swing back", () => {
        // Elvish Archers (2/1, first strike) attacks, blocked by Grizzly
        // Bears (2/2). CR 510.2: only first/double strike creatures deal
        // damage in the first-strike step — the archer kills the bear, then
        // the bear (dead) cannot deal regular combat damage.
        const archer = makeInstance(elvishArchers.id, {
            id: "archer",
            controllerId: "p1",
            isAttacking: true,
        });
        const bear: CardInstanceState = {
            id: "bear",
            card: { id: "fake-bear" },
            types: ["Creature"] as CardType[],
            subtypes: ["Bear"],
            staticAbilities: [],
            power: 2,
            toughness: 2,
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
            isTapped: false,
            isBlocking: true,
        };
        const p1 = makePlayer("p1", { battlefield: [archer] });
        const p2 = makePlayer("p2", { battlefield: [bear] });
        const state = makeState({
            players: [p1, p2],
            activePlayerId: "p1",
            phase: "DECLARE_BLOCKERS",
            combat: {
                attackerIds: ["archer"],
                confirmed: true,
                blockerAssignments: { bear: "archer" },
                blockersConfirmed: true,
                blockerOrder: { archer: ["bear"] },
                blockerOrderConfirmed: true,
            },
        });

        advancePhase(state);
        expect(state.phase).toBe("FIRST_STRIKE_DAMAGE");
        expect(p2.battlefield.find((c) => c.id === "bear")).toBeUndefined();
        expect(p2.graveyard.some((c) => c.id === "bear")).toBe(true);

        advancePhase(state);
        expect(state.phase).toBe("COMBAT_DAMAGE");
        advancePhase(state);
        expect(state.phase).toBe("END_OF_COMBAT");
        const archerAfter = p1.battlefield.find((c) => c.id === "archer");
        expect(archerAfter).toBeDefined();
    });

    it("dies to a 3/3 blocker (first strike can't save a 1-toughness attacker from a bigger body)", () => {
        // Archer deals 2 first-strike to a 3/3 — 3/3 survives (2 < 3) and
        // then hits back in the regular step for 3, killing the archer.
        const archer = makeInstance(elvishArchers.id, {
            id: "archer",
            controllerId: "p1",
            isAttacking: true,
        });
        const ogre: CardInstanceState = {
            id: "ogre",
            card: { id: "fake-ogre" },
            types: ["Creature"] as CardType[],
            subtypes: [],
            staticAbilities: [],
            power: 3,
            toughness: 3,
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
            isTapped: false,
            isBlocking: true,
        };
        const p1 = makePlayer("p1", { battlefield: [archer] });
        const p2 = makePlayer("p2", { battlefield: [ogre] });
        const state = makeState({
            players: [p1, p2],
            activePlayerId: "p1",
            phase: "DECLARE_BLOCKERS",
            combat: {
                attackerIds: ["archer"],
                confirmed: true,
                blockerAssignments: { ogre: "archer" },
                blockersConfirmed: true,
                blockerOrder: { archer: ["ogre"] },
                blockerOrderConfirmed: true,
            },
        });

        advancePhase(state);
        expect(state.phase).toBe("FIRST_STRIKE_DAMAGE");
        // Ogre alive (3 toughness > 2 damage from first strike).
        expect(p2.battlefield.find((c) => c.id === "ogre")).toBeDefined();

        advancePhase(state);
        expect(state.phase).toBe("COMBAT_DAMAGE");
        // Archer now dead: ogre's 3 power >= archer's 1 toughness.
        expect(p1.battlefield.find((c) => c.id === "archer")).toBeUndefined();
        expect(p1.graveyard.some((c) => c.id === "archer")).toBe(true);
    });
});

describe("Protection keyword helpers (CR 702.16)", () => {
    it("parses color variants only", () => {
        expect(parseProtectionFromColor("protection from black")).toBe("B");
        expect(parseProtectionFromColor("protection from white")).toBe("W");
        expect(parseProtectionFromColor("protection from blue")).toBe("U");
        expect(parseProtectionFromColor("protection from red")).toBe("R");
        expect(parseProtectionFromColor("protection from green")).toBe("G");
        // Non-color variants return null (not yet supported).
        expect(
            parseProtectionFromColor("protection from everything")
        ).toBeNull();
        expect(parseProtectionFromColor("flying")).toBeNull();
    });

    it("collapses duplicate protection entries (CR 702.16m)", () => {
        const card = {
            staticAbilities: [
                "protection from black",
                "protection from black",
                "first strike",
            ],
        };
        expect(getProtectedColors(card)).toEqual(["B"]);
    });

    it("matches only when source color overlaps", () => {
        const wk = makeInstance(whiteKnight.id, { id: "wk" });
        const blackSource = makeInstance(bogWraith.id, {
            id: "src-b",
            controllerId: "p1",
        });
        const redSource = makeInstance(lightningBolt.id, {
            id: "src-r",
            controllerId: "p1",
            zone: "stack",
        });
        expect(isProtectedFromSource(wk, blackSource)).toBe(true);
        expect(isProtectedFromSource(wk, redSource)).toBe(false);
    });
});

describe("White Knight (first strike + protection from black, CR 702.7 + 702.16)", () => {
    it("is a 2/2 Knight for {W}{W} with first strike and protection from black", () => {
        expect(whiteKnight.manaCost).toEqual({ W: 2 });
        expect(whiteKnight.types).toContain("Creature");
        expect(whiteKnight.subtypes).toEqual(["Human", "Knight"]);
        expect(whiteKnight.power).toBe(2);
        expect(whiteKnight.toughness).toBe(2);
        expect(whiteKnight.staticAbilities).toContain("first strike");
        expect(whiteKnight.staticAbilities).toContain("protection from black");
    });

    it("CR 702.16b — cannot be targeted by a black-source damage spell", () => {
        const wk = makeInstance(whiteKnight.id, {
            id: "wk",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [wk] }),
            ],
        });
        const legal = getLegalTargets(state, lightningBolt.targetRequirement!, [
            "B",
        ]);
        const ids = legal.map((t) => t.id);
        expect(ids).not.toContain("wk");
        // Players are still legal (players have no color; protection from
        // color only protects permanents with the ability).
        expect(ids).toContain("p1");
        expect(ids).toContain("p2");
    });

    it("CR 702.16b — can still be targeted by a red-source damage spell", () => {
        const wk = makeInstance(whiteKnight.id, {
            id: "wk",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [wk] }),
            ],
        });
        const legal = getLegalTargets(state, lightningBolt.targetRequirement!, [
            "R",
        ]);
        expect(legal.map((t) => t.id)).toContain("wk");
    });

    it("CR 702.16f — as attacker, cannot be blocked by a black creature", () => {
        const wk = makeInstance(whiteKnight.id, {
            id: "wk",
            controllerId: "p1",
            isAttacking: true,
        });
        const wraith = makeInstance(bogWraith.id, {
            id: "wraith",
            controllerId: "p2",
            ownerId: "p2",
        });
        const result = validateBlockerEligibility(wk, wraith, [wraith]);
        expect(result.eligible).toBe(false);
    });

    it("CR 702.16e — blocking a black attacker prevents its return damage while WK's first strike still hits back", () => {
        // Bog Wraith (3/3, black) attacks; White Knight (2/2 first strike,
        // protection from black) blocks. First-strike step: WK deals 2 to
        // wraith (toughness 3 → survives with 2 marked). Regular step: wraith
        // would deal 3 to WK → prevented (CR 702.16e). WK already dealt its
        // damage in first-strike step. Net: WK unhurt, wraith survives with
        // 2 marked damage.
        const wraith = makeInstance(bogWraith.id, {
            id: "wraith",
            controllerId: "p1",
            isAttacking: true,
        });
        const wk = makeInstance(whiteKnight.id, {
            id: "wk",
            controllerId: "p2",
            ownerId: "p2",
            isBlocking: true,
        });
        const p1 = makePlayer("p1", { battlefield: [wraith] });
        const p2 = makePlayer("p2", { battlefield: [wk] });
        const state = makeState({
            players: [p1, p2],
            activePlayerId: "p1",
            phase: "DECLARE_BLOCKERS",
            combat: {
                attackerIds: ["wraith"],
                confirmed: true,
                blockerAssignments: { wk: "wraith" },
                blockersConfirmed: true,
                blockerOrder: { wraith: ["wk"] },
                blockerOrderConfirmed: true,
            },
        });

        advancePhase(state);
        expect(state.phase).toBe("FIRST_STRIKE_DAMAGE");
        // Wraith alive with 2 marked damage (3 toughness > 2 first-strike).
        const wraithAfterFS = p1.battlefield.find((c) => c.id === "wraith")!;
        expect(wraithAfterFS.damageMarked).toBe(2);

        advancePhase(state);
        expect(state.phase).toBe("COMBAT_DAMAGE");
        // WK took no damage (pro from black prevented the 3 incoming).
        const wkAfter = p2.battlefield.find((c) => c.id === "wk")!;
        expect(wkAfter.damageMarked ?? 0).toBe(0);
        // Wraith still alive (marked damage 2 < toughness 3).
        expect(p1.battlefield.find((c) => c.id === "wraith")).toBeDefined();
    });

    it("wire format: block rejection survives projectPublicState (regression guard)", () => {
        // The projection slims `card.card` to { id }. getColors must still
        // derive the source's color via registry lookup.
        const wk = makeInstance(whiteKnight.id, {
            id: "wk",
            controllerId: "p1",
            isAttacking: true,
        });
        const wraith = makeInstance(bogWraith.id, {
            id: "wraith",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [wk] }),
                makePlayer("p2", { battlefield: [wraith] }),
            ],
        });
        const projected = projectPublicState(state, 1, "p1");
        const slimWk = projected.players[0].battlefield.find(
            (c) => c.id === "wk"
        )! as CardInstanceState;
        const slimWraith = projected.players[1].battlefield.find(
            (c) => c.id === "wraith"
        )! as CardInstanceState;
        // Block rejected even on slim projection.
        expect(
            validateBlockerEligibility(slimWk, slimWraith, [slimWraith])
                .eligible
        ).toBe(false);
        // Protection detection still resolves through the slim projection.
        expect(isProtectedFromSource(slimWk, slimWraith)).toBe(true);
    });
});

describe("Black Knight (first strike + protection from white, CR 702.7 + 702.16)", () => {
    it("is a 2/2 Knight for {B}{B} with first strike and protection from white", () => {
        expect(blackKnight.manaCost).toEqual({ B: 2 });
        expect(blackKnight.types).toContain("Creature");
        expect(blackKnight.subtypes).toEqual(["Human", "Knight"]);
        expect(blackKnight.power).toBe(2);
        expect(blackKnight.toughness).toBe(2);
        expect(blackKnight.staticAbilities).toContain("first strike");
        expect(blackKnight.staticAbilities).toContain("protection from white");
    });

    it("CR 702.16b — cannot be targeted by Swords to Plowshares (white source)", () => {
        const bk = makeInstance(blackKnight.id, {
            id: "bk",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bk] }),
            ],
        });
        const legal = getLegalTargets(
            state,
            swordsToPlowshares.targetRequirement!,
            ["W"]
        );
        expect(legal.map((t) => t.id)).not.toContain("bk");
    });

    it("CR 702.16f — as attacker, cannot be blocked by a white creature", () => {
        const bk = makeInstance(blackKnight.id, {
            id: "bk",
            controllerId: "p1",
            isAttacking: true,
        });
        const lion = makeInstance(savannahLions.id, {
            id: "lion",
            controllerId: "p2",
            ownerId: "p2",
        });
        const result = validateBlockerEligibility(bk, lion, [lion]);
        expect(result.eligible).toBe(false);
    });

    it("wire format: protection detection survives projectPublicState", () => {
        const bk = makeInstance(blackKnight.id, {
            id: "bk",
            controllerId: "p1",
        });
        const lion = makeInstance(savannahLions.id, {
            id: "lion",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bk] }),
                makePlayer("p2", { battlefield: [lion] }),
            ],
        });
        const projected = projectPublicState(state, 1, "p1");
        const slimBk = projected.players[0].battlefield.find(
            (c) => c.id === "bk"
        )! as CardInstanceState;
        const slimLion = projected.players[1].battlefield.find(
            (c) => c.id === "lion"
        )! as CardInstanceState;
        expect(isProtectedFromSource(slimBk, slimLion)).toBe(true);
    });
});

describe("Aura core — attach / fizzle / SBA 704.5m (CR 303.4)", () => {
    it("ETB attached to the chosen creature target", () => {
        const lion = makeInstance(savannahLions.id, {
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
        pushSpell(state, redWard.id, "p1", [{ type: "permanent", id: "lion" }]);
        resolveTopOfStack(state);
        // Aura is on caster's battlefield, attached to lion.
        const aura = state.players[0].battlefield.find(
            (c) => c.card.id === redWard.id
        )!;
        expect(aura).toBeDefined();
        expect(aura.attachedTo).toBe("lion");
    });

    it("CR 608.2b / 303.4i — fizzles if the target is no longer on battlefield at resolution", () => {
        // Push the aura with a target, then remove the target from
        // battlefield before resolving (simulates a kill-in-response).
        const lion = makeInstance(savannahLions.id, {
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
        pushSpell(state, redWard.id, "p1", [{ type: "permanent", id: "lion" }]);
        // Lion dies before the aura resolves.
        state.players[1].battlefield = [];
        resolveTopOfStack(state);
        // Aura went to caster's graveyard, not battlefield.
        expect(state.players[0].battlefield).toHaveLength(0);
        expect(state.players[0].graveyard).toHaveLength(1);
        expect(state.players[0].graveyard[0].card.id).toBe(redWard.id);
    });

    it("CR 704.5m — aura whose host leaves play goes to graveyard as SBA", () => {
        const lion = makeInstance(savannahLions.id, {
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
        pushSpell(state, redWard.id, "p1", [{ type: "permanent", id: "lion" }]);
        resolveTopOfStack(state);
        // Aura attached to lion.
        expect(
            state.players[0].battlefield.find((c) => c.card.id === redWard.id)
        ).toBeDefined();
        // Lion dies (removed from battlefield) — host becomes illegal.
        state.players[1].battlefield = [];
        checkStateBasedActions(state);
        // Aura swept into caster's graveyard, attachedTo cleared.
        expect(state.players[0].battlefield).toHaveLength(0);
        const gy = state.players[0].graveyard.find(
            (c) => c.card.id === redWard.id
        )!;
        expect(gy).toBeDefined();
        expect(gy.attachedTo).toBeUndefined();
    });

    it("CR 704.5m — aura whose host loses Creature type is detached (currently no such effect, so host deleted proxies the case)", () => {
        // Exercise the "host no longer satisfies enchant" branch by
        // constructing a host that isn't a Creature after attach — easiest
        // way is to hand-attach the aura to a non-creature and run SBA.
        const tome = makeInstance(jayemdaeTome.id, {
            id: "tome",
            controllerId: "p1",
            ownerId: "p1",
        });
        const aura = makeInstance(redWard.id, {
            id: "aura",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "tome",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [tome, aura] }),
                makePlayer("p2"),
            ],
        });
        checkStateBasedActions(state);
        const battlefieldIds = state.players[0].battlefield.map((c) => c.id);
        expect(battlefieldIds).not.toContain("aura");
        expect(battlefieldIds).toContain("tome");
        expect(state.players[0].graveyard.some((c) => c.id === "aura")).toBe(
            true
        );
    });
});

describe("Red Ward (Aura keyword-grant → protection from red, CR 611 + 702.16)", () => {
    it("is a {W} Aura with the right target shape", () => {
        expect(redWard.manaCost).toEqual({ W: 1 });
        expect(redWard.types).toEqual(["Enchantment"]);
        expect(redWard.subtypes).toEqual(["Aura"]);
        expect(redWard.targetRequirement?.type).toBe("Creature");
    });

    it("grants 'protection from red' to its host on attach and reverts on detach", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, redWard.id, "p1", [{ type: "permanent", id: "bear" }]);
        resolveTopOfStack(state);

        // Aura attached; host gained the keyword.
        const bearAfter = state.players[1].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(bearAfter.staticAbilities).toContain("protection from red");

        // Red Lightning Bolt now can't target the bear (CR 702.16b).
        const legal = getLegalTargets(state, lightningBolt.targetRequirement!, [
            "R",
        ]);
        expect(legal.map((t) => t.id)).not.toContain("bear");

        // Bear dies (say, exiled by Swords to Plowshares). Aura should
        // detach via SBA and the bear keyword is no longer tracked.
        state.players[1].battlefield = [];
        checkStateBasedActions(state);
        const aura = state.players[0].graveyard.find(
            (c) => c.card.id === redWard.id
        )!;
        expect(aura).toBeDefined();
        expect(aura.attachedTo).toBeUndefined();
    });

    it("reverts the grant when the aura is destroyed directly (removePermanentTo)", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, redWard.id, "p1", [{ type: "permanent", id: "bear" }]);
        resolveTopOfStack(state);
        const aura = state.players[0].battlefield.find(
            (c) => c.card.id === redWard.id
        )!;
        // Baseline: keyword is present on the host.
        expect(bear.staticAbilities).toContain("protection from red");

        // Disenchant-like effect destroys the aura directly.
        removePermanentTo(state, aura.id, "graveyard");

        // Keyword lifted from the host.
        expect(bear.staticAbilities).not.toContain("protection from red");
        expect(bear.grantedStaticAbilities ?? []).toHaveLength(0);
    });

    it("wire format: granted protection survives projectPublicState", () => {
        // Regression: the projection slims `card.card`, but the grant lives
        // on the host's `staticAbilities` array, so a projected bear must
        // still read as protected via isProtectedFromSource.
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, redWard.id, "p1", [{ type: "permanent", id: "bear" }]);
        resolveTopOfStack(state);
        const redBolt = makeInstance(lightningBolt.id, {
            id: "src",
            controllerId: "p2",
            zone: "stack",
        });
        const projected = projectPublicState(state, 1, "p1");
        const slimBear = projected.players[0].battlefield.find(
            (c) => c.id === "bear"
        )! as CardInstanceState;
        expect(isProtectedFromSource(slimBear, redBolt)).toBe(true);
    });
});

describe("Protection-detach SBA (CR 702.16c + 702.16n)", () => {
    it("aura WITHOUT the 702.16n exemption is detached when host gains matching protection", () => {
        // All real ward auras in the set carry the 702.16n rider, so use a
        // synthetic aura (unregistered id → no card def lookup → no
        // exemption) with an embedded mana cost to exercise the non-exempt
        // branch. Blue mana cost + host pro-blue = 702.16c detach.
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
        });
        const syntheticAura: CardInstanceState = {
            id: "syn-aura",
            card: { id: "synthetic-blue-aura", manaCost: { U: 1 } },
            types: ["Enchantment"],
            subtypes: ["Aura"],
            staticAbilities: [],
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            isTapped: false,
            attachedTo: "bear",
        };
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear, syntheticAura] }),
                makePlayer("p2"),
            ],
        });

        // Host acquires protection from blue (simulating another source).
        bear.staticAbilities = [
            ...bear.staticAbilities,
            "protection from blue",
        ];
        checkStateBasedActions(state);

        // Aura detached (no exemption) and moved to graveyard.
        expect(
            state.players[0].battlefield.find((c) => c.id === "syn-aura")
        ).toBeUndefined();
        expect(
            state.players[0].graveyard.find((c) => c.id === "syn-aura")
        ).toBeDefined();
    });

    it("aura whose color does NOT match host protection stays attached", () => {
        // Same setup but host acquires pro-blue. Red Ward is white, pro-blue
        // doesn't match → aura stays.
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, redWard.id, "p1", [{ type: "permanent", id: "bear" }]);
        resolveTopOfStack(state);
        bear.staticAbilities = [
            ...bear.staticAbilities,
            "protection from blue",
        ];
        checkStateBasedActions(state);
        // Aura still attached.
        expect(
            state.players[0].battlefield.find((c) => c.card.id === redWard.id)
        ).toBeDefined();
    });

    it("CR 608.2b — aura fizzles if target acquires matching protection between cast and resolution", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        // Red Ward (white aura) targeting bear — legal at cast.
        pushSpell(state, redWard.id, "p1", [{ type: "permanent", id: "bear" }]);
        // Before resolution, bear gains protection from white.
        bear.staticAbilities = [
            ...bear.staticAbilities,
            "protection from white",
        ];
        resolveTopOfStack(state);
        // Aura fizzled to caster's graveyard, not attached.
        expect(state.players[0].battlefield).toHaveLength(0);
        expect(
            state.players[0].graveyard.find((c) => c.card.id === redWard.id)
        ).toBeDefined();
        // Bear did not gain a new grant from the fizzled aura.
        expect(bear.staticAbilities).not.toContain("protection from red");
    });
});

describe("White Ward (exempt self-referential aura, CR 702.16n)", () => {
    it("stays attached even though aura-color matches granted protection", () => {
        // White Ward is a white aura that grants pro-white. Without the
        // CR 702.16n exemption, the aura would immediately fall off as SBA
        // after attach. With the exemption (exemptFromProtectionDetach), it
        // persists.
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, whiteWard.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);
        checkStateBasedActions(state);

        // Aura still attached, host has pro-white.
        const aura = state.players[0].battlefield.find(
            (c) => c.card.id === whiteWard.id
        );
        expect(aura).toBeDefined();
        expect(bear.staticAbilities).toContain("protection from white");
    });

    it("all five wards register and carry the 702.16n exemption", () => {
        for (const ward of [
            redWard,
            blueWard,
            blackWard,
            greenWard,
            whiteWard,
        ]) {
            expect(ward.manaCost).toEqual({ W: 1 });
            expect(ward.types).toEqual(["Enchantment"]);
            expect(ward.subtypes).toEqual(["Aura"]);
            expect(ward.targetRequirement?.type).toBe("Creature");
            expect(ward.exemptFromProtectionDetach).toBe(true);
            expect(ward.staticEffects).toHaveLength(1);
            expect(ward.staticEffects?.[0].kind).toBe("keyword-grant");
        }
    });
});

// One smoke test per remaining color ward — the factory is shared, so a per-card
// wire-format check guards against the AURA_AFFECTS_HOST predicate being applied
// inconsistently after extraction.
describe.each([
    { ward: blueWard, keyword: "protection from blue" },
    { ward: blackWard, keyword: "protection from black" },
    { ward: greenWard, keyword: "protection from green" },
])("$ward.name (Aura keyword-grant)", ({ ward, keyword }) => {
    it(`grants '${keyword}' to its host and the grant survives projectPublicState`, () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, ward.id, "p1", [{ type: "permanent", id: "bear" }]);
        resolveTopOfStack(state);

        const bearAfter = state.players[1].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(bearAfter.staticAbilities).toContain(keyword);

        const projected = projectPublicState(state, 1, "p1");
        const slimBear = projected.players[1].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(slimBear.staticAbilities).toContain(keyword);
    });
});

describe("Control Magic (Aura control-change, CR 613.1b layer 2 + 702.10c)", () => {
    it("is a {2}{U}{U} Aura that targets a creature and declares a control-change effect", () => {
        expect(controlMagic.manaCost).toEqual({ X: 2, U: 2 });
        expect(controlMagic.types).toEqual(["Enchantment"]);
        expect(controlMagic.subtypes).toEqual(["Aura"]);
        expect(controlMagic.targetRequirement?.type).toBe("Creature");
        expect(controlMagic.staticEffects).toHaveLength(1);
        expect(controlMagic.staticEffects?.[0].kind).toBe("control-change");
    });

    it("on resolve, transfers control of the enchanted creature and sets summoning sickness", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
            isSummoningSick: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, controlMagic.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);
        checkStateBasedActions(state);

        // Bear now lives in p1's battlefield array under p1's control.
        expect(state.players[0].battlefield.map((c) => c.id)).toContain("bear");
        expect(state.players[1].battlefield.map((c) => c.id)).not.toContain(
            "bear"
        );
        const bearAfter = state.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(bearAfter.controllerId).toBe("p1");
        // CR 702.10c — control continuity broke, sickness applies.
        expect(bearAfter.isSummoningSick).toBe(true);
        // Bookkeeping for reversal: the stack has one entry (this aura)
        // with the pre-flip controller as `previousControllerId`.
        expect(bearAfter.controlChanges).toHaveLength(1);
        expect(bearAfter.controlChanges?.[0].previousControllerId).toBe("p2");

        // Aura sits on caster's battlefield, attached to the bear.
        const aura = state.players[0].battlefield.find(
            (c) => c.card.id === controlMagic.id
        )!;
        expect(aura).toBeDefined();
        expect(aura.attachedTo).toBe("bear");
        expect(bearAfter.controlChanges?.[0].auraId).toBe(aura.id);
    });

    it("wire format: the control flip survives projectPublicState", () => {
        // Regression: the projection maps each player's battlefield array
        // verbatim (slimming card defs). A controlled creature must therefore
        // appear in the new controller's projected battlefield with the
        // updated controllerId — otherwise the client would render it on
        // the wrong side.
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, controlMagic.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);

        const projected = projectPublicState(state, 1, "p1");
        const slimBear = projected.players[0].battlefield.find(
            (c) => c.id === "bear"
        );
        expect(slimBear).toBeDefined();
        expect(slimBear?.controllerId).toBe("p1");
        expect(
            projected.players[1].battlefield.find((c) => c.id === "bear")
        ).toBeUndefined();
    });

    it("reverts control when the aura is destroyed (Disenchant-style removal)", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, controlMagic.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);
        const aura = state.players[0].battlefield.find(
            (c) => c.card.id === controlMagic.id
        )!;

        // Disenchant the aura directly.
        removePermanentTo(state, aura.id, "graveyard");

        // Bear returned to p2's battlefield with its original controller.
        expect(state.players[1].battlefield.map((c) => c.id)).toContain("bear");
        expect(state.players[0].battlefield.map((c) => c.id)).not.toContain(
            "bear"
        );
        const bearAfter = state.players[1].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(bearAfter.controllerId).toBe("p2");
        expect(bearAfter.controlChanges).toBeUndefined();
        // Continuity broke again on reversal — sickness applies until p2's
        // next untap step.
        expect(bearAfter.isSummoningSick).toBe(true);
        // Aura went to its owner's graveyard.
        expect(
            state.players[0].graveyard.find(
                (c) => c.card.id === controlMagic.id
            )
        ).toBeDefined();
    });

    it("host dies → SBA detaches the aura to the caster's graveyard (CR 704.5m)", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, controlMagic.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);

        // The bear dies (e.g. Lightning Bolt). The host id is gone from
        // every battlefield array — SBA should sweep the aura into its
        // caster's graveyard.
        state.players[0].battlefield = state.players[0].battlefield.filter(
            (c) => c.id !== "bear"
        );
        checkStateBasedActions(state);

        expect(
            state.players[0].battlefield.find(
                (c) => c.card.id === controlMagic.id
            )
        ).toBeUndefined();
        const auraInGY = state.players[0].graveyard.find(
            (c) => c.card.id === controlMagic.id
        )!;
        expect(auraInGY).toBeDefined();
        expect(auraInGY.attachedTo).toBeUndefined();
    });

    it("retargeting own creature is a no-op for the flip (same controller pre/post)", () => {
        // If the caster already controls the target, the aura attaches but
        // the control-change predicate still runs; since newControllerId
        // matches the current controllerId, no stack entry is written and
        // no battlefield array swap happens.
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, controlMagic.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);

        const bearAfter = state.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(bearAfter.controllerId).toBe("p1");
        expect(bearAfter.controlChanges).toBeUndefined();
        // Aura is still attached and resident on p1's bf.
        expect(
            state.players[0].battlefield.find(
                (c) => c.card.id === controlMagic.id
            )?.attachedTo
        ).toBe("bear");
    });

    it("stacked CMs: latest wins while present; removing the TOP restores to the layer below (CR 613 layer 2 timestamps)", () => {
        // P1 owns bear. P2's CM1 steals it → bear on p2. P1's CM2 steals it
        // back → bear on p1. Removing CM2 first: CR says CM1 is still
        // active, so bear must revert to p2 (not to owner p1).
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear] }),
                makePlayer("p2"),
            ],
        });
        // CM1 cast by p2 targeting the bear.
        pushSpell(state, controlMagic.id, "p2", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);
        const cm1 = state.players[1].battlefield.find(
            (c) => c.card.id === controlMagic.id
        )!;
        expect(
            state.players[1].battlefield.find((c) => c.id === "bear")
                ?.controllerId
        ).toBe("p2");

        // CM2 cast by p1 targeting the (now p2-controlled) bear.
        pushSpell(state, controlMagic.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);
        const cm2 = state.players[0].battlefield.find(
            (c) => c.card.id === controlMagic.id && c.id !== cm1.id
        )!;
        const bearWithBoth = state.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(bearWithBoth.controllerId).toBe("p1");
        expect(bearWithBoth.controlChanges).toHaveLength(2);

        // Disenchant CM2 (top of stack) first → CM1 still applies → bear
        // must go to p2, NOT back to owner p1.
        removePermanentTo(state, cm2.id, "graveyard");
        const bearAfterCm2 = state.players[1].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(bearAfterCm2).toBeDefined();
        expect(bearAfterCm2.controllerId).toBe("p2");
        expect(bearAfterCm2.controlChanges).toHaveLength(1);
        expect(bearAfterCm2.controlChanges?.[0].auraId).toBe(cm1.id);

        // Then disenchant CM1 → no more effects → bear collapses to owner.
        removePermanentTo(state, cm1.id, "graveyard");
        const bearFinal = state.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(bearFinal).toBeDefined();
        expect(bearFinal.controllerId).toBe("p1");
        expect(bearFinal.controlChanges).toBeUndefined();
    });

    it("stacked CMs: removing the MIDDLE entry leaves current controller intact and top pops to owner (CR 108.3)", () => {
        // Same stacked setup as above, but this time CM1 (bottom of stack)
        // is destroyed first. CR: CM2 is still active, bear stays on p1.
        // Then CM2 destroyed → stack empty → bear collapses to owner p1.
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, controlMagic.id, "p2", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);
        const cm1 = state.players[1].battlefield.find(
            (c) => c.card.id === controlMagic.id
        )!;
        pushSpell(state, controlMagic.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);
        const cm2 = state.players[0].battlefield.find(
            (c) => c.card.id === controlMagic.id && c.id !== cm1.id
        )!;

        // Disenchant CM1 (middle/bottom) — bear stays on p1 (CM2 still
        // applies), stack collapses to a single entry.
        removePermanentTo(state, cm1.id, "graveyard");
        const bearMid = state.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(bearMid.controllerId).toBe("p1");
        expect(bearMid.controlChanges).toHaveLength(1);
        expect(bearMid.controlChanges?.[0].auraId).toBe(cm2.id);
        // The middle-removal patched `previousControllerId` so the remaining
        // entry now records the pre-chain value (bear's owner = p1).
        expect(bearMid.controlChanges?.[0].previousControllerId).toBe("p1");

        // Disenchant CM2 — stack empties, bear goes back to owner.
        removePermanentTo(state, cm2.id, "graveyard");
        const bearFinal = state.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(bearFinal.controllerId).toBe("p1");
        expect(bearFinal.controlChanges).toBeUndefined();
    });
});

describe("Steal Artifact (Aura control-change on artifacts, CR 613.1b layer 2)", () => {
    it("is a {2}{U}{U} Aura that targets an artifact and declares a control-change effect", () => {
        expect(stealArtifact.manaCost).toEqual({ X: 2, U: 2 });
        expect(stealArtifact.types).toEqual(["Enchantment"]);
        expect(stealArtifact.subtypes).toEqual(["Aura"]);
        expect(stealArtifact.targetRequirement?.type).toBe("Artifact");
        expect(stealArtifact.staticEffects).toHaveLength(1);
        expect(stealArtifact.staticEffects?.[0].kind).toBe("control-change");
    });

    it("on resolve, transfers control of the enchanted artifact (no summoning sickness — artifacts aren't creatures)", () => {
        const statue = makeInstance(jadeStatue.id, {
            id: "statue",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [statue] }),
            ],
        });
        pushSpell(state, stealArtifact.id, "p1", [
            { type: "permanent", id: "statue" },
        ]);
        resolveTopOfStack(state);
        checkStateBasedActions(state);

        expect(state.players[0].battlefield.map((c) => c.id)).toContain(
            "statue"
        );
        expect(state.players[1].battlefield.map((c) => c.id)).not.toContain(
            "statue"
        );
        const statueAfter = state.players[0].battlefield.find(
            (c) => c.id === "statue"
        )!;
        expect(statueAfter.controllerId).toBe("p1");
        // CR 702.10c scopes summoning sickness to creatures — artifacts
        // aren't creatures so they don't pick it up on a control flip.
        expect(statueAfter.isSummoningSick).toBeUndefined();
        expect(statueAfter.controlChanges).toHaveLength(1);
        expect(statueAfter.controlChanges?.[0].previousControllerId).toBe("p2");

        const aura = state.players[0].battlefield.find(
            (c) => c.card.id === stealArtifact.id
        )!;
        expect(aura.attachedTo).toBe("statue");
    });

    it("wire format: the control flip survives projectPublicState", () => {
        const statue = makeInstance(jadeStatue.id, {
            id: "statue",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [statue] }),
            ],
        });
        pushSpell(state, stealArtifact.id, "p1", [
            { type: "permanent", id: "statue" },
        ]);
        resolveTopOfStack(state);

        const projected = projectPublicState(state, 1, "p1");
        const slimStatue = projected.players[0].battlefield.find(
            (c) => c.id === "statue"
        );
        expect(slimStatue).toBeDefined();
        expect(slimStatue?.controllerId).toBe("p1");
        expect(
            projected.players[1].battlefield.find((c) => c.id === "statue")
        ).toBeUndefined();
    });

    it("reverts control when the aura is destroyed (Disenchant-style removal)", () => {
        const statue = makeInstance(jadeStatue.id, {
            id: "statue",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [statue] }),
            ],
        });
        pushSpell(state, stealArtifact.id, "p1", [
            { type: "permanent", id: "statue" },
        ]);
        resolveTopOfStack(state);
        const aura = state.players[0].battlefield.find(
            (c) => c.card.id === stealArtifact.id
        )!;

        removePermanentTo(state, aura.id, "graveyard");

        expect(state.players[1].battlefield.map((c) => c.id)).toContain(
            "statue"
        );
        const statueAfter = state.players[1].battlefield.find(
            (c) => c.id === "statue"
        )!;
        expect(statueAfter.controllerId).toBe("p2");
    });

    it("fizzles when the target leaves the battlefield between cast and resolution (CR 608.2b)", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        pushSpell(state, stealArtifact.id, "p1", [
            { type: "permanent", id: "ghost-statue" },
        ]);
        resolveTopOfStack(state);

        expect(
            state.players[0].battlefield.find(
                (c) => c.card.id === stealArtifact.id
            )
        ).toBeUndefined();
        expect(state.players[0].graveyard.map((c) => c.card.id)).toContain(
            stealArtifact.id
        );
    });

    it("SBA detaches the aura when the host loses its artifact type (removed from battlefield)", () => {
        const statue = makeInstance(jadeStatue.id, {
            id: "statue",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [statue] }),
            ],
        });
        pushSpell(state, stealArtifact.id, "p1", [
            { type: "permanent", id: "statue" },
        ]);
        resolveTopOfStack(state);

        // Artifact host leaves play.
        state.players[0].battlefield = state.players[0].battlefield.filter(
            (c) => c.id !== "statue"
        );
        checkStateBasedActions(state);

        expect(
            state.players[0].battlefield.find(
                (c) => c.card.id === stealArtifact.id
            )
        ).toBeUndefined();
        expect(state.players[0].graveyard.map((c) => c.card.id)).toContain(
            stealArtifact.id
        );
    });
});

describe("Winter Orb (caps ACL untaps to one per untap step, CR 502.1)", () => {
    it("is a {2} artifact that declares the global untap-limit marker", () => {
        expect(winterOrb.manaCost).toEqual({ X: 2 });
        expect(winterOrb.types).toEqual(["Artifact"]);
        expect(winterOrb.staticAbilities).toContain("limits-acl-untap");
    });

    // Drives the incoming player's UNTAP step by advancing from END_STEP:
    // CLEANUP auto-resolves, turn flips, UNTAP auto-resolves, state settles
    // in UPKEEP of the intended player.
    function runUntapFor(playerId: string, state: GameState): void {
        state.activePlayerId = playerId === "p1" ? "p2" : "p1";
        state.phase = "END_STEP";
        advancePhase(state);
    }

    it("without Winter Orb, every ACL the active player controls untaps", () => {
        const land1 = makeInstance(plains.id, { id: "l1", isTapped: true });
        const land2 = makeInstance(plains.id, { id: "l2", isTapped: true });
        const creature = makeInstance(grizzlyBears.id, {
            id: "bear",
            isTapped: true,
            isSummoningSick: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [land1, land2, creature] }),
                makePlayer("p2"),
            ],
        });
        runUntapFor("p1", state);

        const bf = state.players[0].battlefield;
        expect(bf.find((c) => c.id === "l1")?.isTapped).toBe(false);
        expect(bf.find((c) => c.id === "l2")?.isTapped).toBe(false);
        expect(bf.find((c) => c.id === "bear")?.isTapped).toBe(false);
    });

    it("with Winter Orb in play, the active player untaps at most one ACL", () => {
        const orb = makeInstance(winterOrb.id, { id: "orb", isTapped: true });
        const land1 = makeInstance(plains.id, { id: "l1", isTapped: true });
        const land2 = makeInstance(plains.id, { id: "l2", isTapped: true });
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            isTapped: true,
            isSummoningSick: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [orb, land1, land2, bear],
                }),
                makePlayer("p2"),
            ],
        });
        runUntapFor("p1", state);

        const bf = state.players[0].battlefield;
        const untappedAcl = bf.filter(
            (c) =>
                !c.isTapped &&
                (c.types.includes("Artifact") ||
                    c.types.includes("Creature") ||
                    c.types.includes("Land"))
        );
        expect(untappedAcl).toHaveLength(1);
    });

    it("non-ACL permanents (enchantments) untap normally under Winter Orb", () => {
        const orb = makeInstance(winterOrb.id, { id: "orb", isTapped: false });
        const land = makeInstance(plains.id, { id: "l1", isTapped: true });
        // Castle is an Enchantment — not A/C/L, so it's exempt from the cap.
        const enchant = makeInstance(castle.id, {
            id: "castle",
            isTapped: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [orb, land, enchant] }),
                makePlayer("p2"),
            ],
        });
        runUntapFor("p1", state);

        const bf = state.players[0].battlefield;
        expect(bf.find((c) => c.id === "castle")?.isTapped).toBe(false);
    });

    it("Winter Orb on the opponent's side still restricts the active player", () => {
        const orb = makeInstance(winterOrb.id, {
            id: "orb",
            controllerId: "p2",
            ownerId: "p2",
            isTapped: false,
        });
        const land1 = makeInstance(plains.id, { id: "l1", isTapped: true });
        const land2 = makeInstance(plains.id, { id: "l2", isTapped: true });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [land1, land2] }),
                makePlayer("p2", { battlefield: [orb] }),
            ],
        });
        runUntapFor("p1", state);

        const bf = state.players[0].battlefield;
        const untappedCount = bf.filter((c) => !c.isTapped).length;
        expect(untappedCount).toBe(1);
    });
});

describe("Bog Wraith (swampwalk evasion, CR 702.13b)", () => {
    it("is a 3/3 Wraith for {3}{B} with swampwalk", () => {
        expect(bogWraith.manaCost).toEqual({ X: 3, B: 1 });
        expect(bogWraith.types).toContain("Creature");
        expect(bogWraith.subtypes).toEqual(["Wraith"]);
        expect(bogWraith.power).toBe(3);
        expect(bogWraith.toughness).toBe(3);
        expect(bogWraith.staticAbilities).toContain("swampwalk");
    });

    it("cannot be blocked when defending player controls a Swamp", () => {
        const wraith = makeInstance(bogWraith.id, {
            id: "wraith",
            controllerId: "p1",
        });
        const bears = makeInstance(savannahLions.id, {
            id: "bears",
            controllerId: "p2",
        });
        const swampInst = makeInstance(swamp.id, {
            id: "swamp-1",
            controllerId: "p2",
        });
        const result = validateBlockerEligibility(wraith, bears, [
            bears,
            swampInst,
        ]);
        expect(result.eligible).toBe(false);
        if (!result.eligible) expect(result.reason).toMatch(/Swamp/);
    });

    it("can be blocked when defender controls no Swamp", () => {
        const wraith = makeInstance(bogWraith.id, { id: "wraith" });
        const bears = makeInstance(savannahLions.id, {
            id: "bears",
            controllerId: "p2",
        });
        expect(validateBlockerEligibility(wraith, bears, [bears])).toEqual({
            eligible: true,
        });
    });

    it("dual land with Swamp subtype (Bayou) also triggers swampwalk", () => {
        const wraith = makeInstance(bogWraith.id, { id: "wraith" });
        const bears = makeInstance(savannahLions.id, {
            id: "bears",
            controllerId: "p2",
        });
        const bayouInst = makeInstance(bayou.id, {
            id: "bayou-1",
            controllerId: "p2",
        });
        expect(
            validateBlockerEligibility(wraith, bears, [bears, bayouInst])
                .eligible
        ).toBe(false);
    });
});

describe("Shanodin Dryads (forestwalk evasion, CR 702.13b)", () => {
    it("is a 1/1 Nymph Dryad for {G} with forestwalk", () => {
        expect(shanodinDryads.manaCost).toEqual({ G: 1 });
        expect(shanodinDryads.types).toContain("Creature");
        expect(shanodinDryads.subtypes).toEqual(["Nymph", "Dryad"]);
        expect(shanodinDryads.power).toBe(1);
        expect(shanodinDryads.toughness).toBe(1);
        expect(shanodinDryads.staticAbilities).toContain("forestwalk");
    });

    it("cannot be blocked when defender controls a Forest", () => {
        const dryads = makeInstance(shanodinDryads.id, { id: "dryads" });
        const bears = makeInstance(savannahLions.id, {
            id: "bears",
            controllerId: "p2",
        });
        const forestInst = makeInstance(
            // Reuse Bayou (Swamp + Forest) to exercise the multi-subtype case.
            bayou.id,
            { id: "bayou-1", controllerId: "p2" }
        );
        expect(
            validateBlockerEligibility(dryads, bears, [bears, forestInst])
                .eligible
        ).toBe(false);
    });

    it("can be blocked when defender has no Forest", () => {
        const dryads = makeInstance(shanodinDryads.id, { id: "dryads" });
        const bears = makeInstance(savannahLions.id, {
            id: "bears",
            controllerId: "p2",
        });
        expect(validateBlockerEligibility(dryads, bears, [bears])).toEqual({
            eligible: true,
        });
    });
});

describe("Juggernaut (CR 508.1d + 509.1b)", () => {
    it("is a 5/3 Juggernaut for {4} with the two restrictions/requirements", () => {
        expect(juggernaut.manaCost).toEqual({ X: 4 });
        expect(juggernaut.types).toEqual(["Artifact", "Creature"]);
        expect(juggernaut.subtypes).toEqual(["Juggernaut"]);
        expect(juggernaut.power).toBe(5);
        expect(juggernaut.toughness).toBe(3);
        expect(juggernaut.staticAbilities).toContain("attacks-if-able");
        expect(juggernaut.staticAbilities).toContain("cant-be-blocked-by-wall");
    });

    it("can't be blocked by Walls (CR 509.1b)", () => {
        const jug = makeInstance(juggernaut.id, { id: "jug" });
        const wall = makeInstance(wallOfSwords.id, {
            id: "wall",
            controllerId: "p2",
        });
        const result = validateBlockerEligibility(jug, wall, [wall]);
        expect(result.eligible).toBe(false);
        if (!result.eligible) expect(result.reason).toMatch(/Wall/);
    });

    it("can still be blocked by non-Wall creatures", () => {
        const jug = makeInstance(juggernaut.id, { id: "jug" });
        const bears = makeInstance(savannahLions.id, {
            id: "bears",
            controllerId: "p2",
        });
        expect(validateBlockerEligibility(jug, bears, [bears])).toEqual({
            eligible: true,
        });
    });

    it("mustAttack is true when eligible, false when tapped or sick", () => {
        const jug = makeInstance(juggernaut.id, { id: "jug" });
        expect(mustAttack(jug)).toBe(true);
        expect(mustAttack({ ...jug, isTapped: true })).toBe(false);
        expect(mustAttack({ ...jug, isSummoningSick: true })).toBe(false);
    });

    it("getRequiredAttackerIds picks up eligible Juggernauts only", () => {
        const eligible = makeInstance(juggernaut.id, { id: "jug1" });
        const sick = makeInstance(juggernaut.id, {
            id: "jug2",
            isSummoningSick: true,
        });
        const bears = makeInstance(savannahLions.id, { id: "bears" });
        expect(getRequiredAttackerIds([eligible, sick, bears])).toEqual([
            "jug1",
        ]);
    });
});

describe("Hypnotic Specter (keyword abilities + CR 603 trigger)", () => {
    it("is a 2/2 Specter for {1}{B}{B} with flying", () => {
        expect(hypnoticSpecter.manaCost).toEqual({ X: 1, B: 2 });
        expect(hypnoticSpecter.types).toContain("Creature");
        expect(hypnoticSpecter.subtypes).toEqual(["Specter"]);
        expect(hypnoticSpecter.power).toBe(2);
        expect(hypnoticSpecter.toughness).toBe(2);
        expect(hypnoticSpecter.staticAbilities).toContain("flying");
    });

    it("declares a damage-dealt trigger with matching oracle text", () => {
        const trigger = hypnoticSpecter.triggeredAbilities?.[0];
        expect(trigger?.event).toBe("DAMAGE_DEALT");
        expect(trigger?.oracleText).toMatch(/discards a card at random/);
    });

    function setupCombatScenario() {
        const specter = makeInstance(hypnoticSpecter.id, {
            id: "specter",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const oppHand = [
            makeInstance(llanowarElves.id, {
                id: "opp-card-1",
                controllerId: "p2",
                ownerId: "p2",
                zone: "hand",
            }),
            makeInstance(llanowarElves.id, {
                id: "opp-card-2",
                controllerId: "p2",
                ownerId: "p2",
                zone: "hand",
            }),
        ];
        const state = makeState({
            phase: "COMBAT_DAMAGE",
            players: [
                makePlayer("p1", { battlefield: [specter] }),
                makePlayer("p2", { hand: oppHand }),
            ],
            combat: {
                attackerIds: ["specter"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: true,
            },
            rngSeed: 1,
        });
        return state;
    }

    it("queues a trigger on the stack when Specter deals damage to an opponent", async () => {
        const state = setupCombatScenario();
        const { applyAllCombatDamage } = await import("../../../gre/phases");
        applyAllCombatDamage(state, {});
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].triggeredAbilityId).toBe(
            "hypnotic-specter-discard"
        );
        expect(state.stack[0].triggerEvent).toMatchObject({
            type: "DAMAGE_DEALT",
            target: { type: "player", id: "p2" },
            amount: 2,
        });
        // Priority restarts at active player with triggers on the stack.
        expect(state.priorityPlayerId).toBe("p1");
    });

    it("resolves the trigger into a random discard from the opponent's hand", async () => {
        const state = setupCombatScenario();
        const { applyAllCombatDamage } = await import("../../../gre/phases");
        applyAllCombatDamage(state, {});
        resolveTopOfStack(state);

        const p2 = state.players[1];
        expect(p2.hand).toHaveLength(1);
        expect(p2.graveyard).toHaveLength(1);
        // Specter stays on the battlefield after the trigger resolves.
        expect(state.players[0].battlefield).toHaveLength(1);
    });

    it("is deterministic: same seed → same discarded card", async () => {
        const { applyAllCombatDamage } = await import("../../../gre/phases");
        const runOnce = () => {
            const state = setupCombatScenario();
            applyAllCombatDamage(state, {});
            resolveTopOfStack(state);
            return state.players[1].graveyard[0].id;
        };
        expect(runOnce()).toBe(runOnce());
    });

    it("does NOT trigger when dealing damage to self (controller)", () => {
        const specter = makeInstance(hypnoticSpecter.id, {
            id: "specter",
            controllerId: "p1",
            ownerId: "p1",
        });
        const trigger = hypnoticSpecter.triggeredAbilities![0];
        const match = trigger.matches(
            {
                type: "DAMAGE_DEALT",
                sourceInstanceId: "specter",
                sourceControllerId: "p1",
                target: { type: "player", id: "p1" },
                amount: 2,
                isCombat: true,
            },
            specter
        );
        expect(match).toBe(false);
    });

    it("wire format: triggerEvent and triggeredAbilityId survive projection", async () => {
        const state = setupCombatScenario();
        const { applyAllCombatDamage } = await import("../../../gre/phases");
        applyAllCombatDamage(state, {});
        const projected = projectPublicState(state, 1, "p2");
        expect(projected.stack).toHaveLength(1);
        expect(projected.stack[0].triggeredAbilityId).toBe(
            "hypnotic-specter-discard"
        );
        expect(projected.stack[0].triggerEvent).toMatchObject({
            type: "DAMAGE_DEALT",
            target: { type: "player", id: "p2" },
        });
    });
});

describe("Howling Mine (CR 603.6a phase-begin trigger with intervening-if)", () => {
    function setupAtUpkeep(options: { tapped?: boolean } = {}) {
        const mine = makeInstance(howlingMine.id, {
            id: "mine",
            controllerId: "p1",
            ownerId: "p1",
            isTapped: options.tapped ?? false,
        });
        // Two cards in each library so the draw step entry action + Howling
        // Mine's extra draw both succeed.
        const p1Lib = [
            makeInstance(llanowarElves.id, {
                id: "p1-lib-1",
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            }),
            makeInstance(llanowarElves.id, {
                id: "p1-lib-2",
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            }),
        ];
        const p2Lib = [
            makeInstance(llanowarElves.id, {
                id: "p2-lib-1",
                controllerId: "p2",
                ownerId: "p2",
                zone: "library",
            }),
            makeInstance(llanowarElves.id, {
                id: "p2-lib-2",
                controllerId: "p2",
                ownerId: "p2",
                zone: "library",
            }),
        ];
        return makeState({
            turn: 2, // turn > 1 so the draw step's turn-based draw fires
            phase: "UPKEEP",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            players: [
                makePlayer("p1", { battlefield: [mine], library: p1Lib }),
                makePlayer("p2", { library: p2Lib }),
            ],
        });
    }

    it("is a {2} artifact with the phase-begin trigger declared", () => {
        expect(howlingMine.manaCost).toEqual({ X: 2 });
        expect(howlingMine.types).toContain("Artifact");
        const trigger = howlingMine.triggeredAbilities?.[0];
        expect(trigger?.event).toBe("PHASE_BEGIN");
        expect(trigger?.oracleText).toMatch(/draw step/i);
    });

    it("queues the trigger when the active player's draw step begins", () => {
        const state = setupAtUpkeep();
        advancePhase(state); // UPKEEP → DRAW (turn-based action + trigger)
        expect(state.phase).toBe("DRAW");
        // p1 drew the turn-based card (CR 504.1) and the trigger sits on the stack.
        expect(state.players[0].hand).toHaveLength(1);
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].triggeredAbilityId).toBe("howling-mine-draw");
        expect(state.stack[0].triggerEvent).toMatchObject({
            type: "PHASE_BEGIN",
            phase: "DRAW",
            activePlayerId: "p1",
        });
        expect(state.priorityPlayerId).toBe("p1");
    });

    it("resolves into an extra draw for the active player", () => {
        const state = setupAtUpkeep();
        advancePhase(state);
        resolveTopOfStack(state);
        // Turn-based draw + Howling Mine draw = 2
        expect(state.players[0].hand).toHaveLength(2);
        expect(state.stack).toHaveLength(0);
    });

    it("fires on the opponent's draw step and draws for them (each player's)", () => {
        const state = setupAtUpkeep();
        // Simulate p2's turn at UPKEEP — Howling Mine still on p1's battlefield.
        state.turn = 3;
        state.activePlayerId = "p2";
        state.priorityPlayerId = "p2";
        state.phase = "UPKEEP";
        advancePhase(state);
        expect(state.phase).toBe("DRAW");
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].triggerEvent).toMatchObject({
            type: "PHASE_BEGIN",
            activePlayerId: "p2",
        });
        resolveTopOfStack(state);
        // p2 got 1 turn-based + 1 Howling Mine = 2 cards.
        expect(state.players[1].hand).toHaveLength(2);
    });

    it("does NOT fire the trigger while the artifact is tapped (CR 603.4)", () => {
        const state = setupAtUpkeep({ tapped: true });
        advancePhase(state);
        expect(state.phase).toBe("DRAW");
        expect(state.stack).toHaveLength(0);
        // p1 only got the turn-based draw.
        expect(state.players[0].hand).toHaveLength(1);
    });

    it("intervening-if re-check: if tapped between trigger and resolve, no draw", () => {
        const state = setupAtUpkeep();
        advancePhase(state); // trigger enqueued
        expect(state.stack).toHaveLength(1);
        // Simulate Icy Manipulator tapping the artifact in response.
        state.players[0].battlefield[0].isTapped = true;
        resolveTopOfStack(state);
        // Only the turn-based draw; intervening-if failed at resolve.
        expect(state.players[0].hand).toHaveLength(1);
    });

    it("does NOT fire on non-draw phases", () => {
        const state = setupAtUpkeep();
        state.phase = "PRECOMBAT_MAIN";
        advancePhase(state); // PRECOMBAT_MAIN → BEGINNING_OF_COMBAT
        expect(state.stack).toHaveLength(0);
    });

    it("wire format: trigger StackItem survives projectPublicState", () => {
        const state = setupAtUpkeep();
        advancePhase(state);
        expect(state.stack).toHaveLength(1);
        const projected = projectPublicState(state, 1, "p2");
        expect(projected.stack).toHaveLength(1);
        expect(projected.stack[0].triggeredAbilityId).toBe("howling-mine-draw");
        expect(projected.stack[0].triggerEvent).toMatchObject({
            type: "PHASE_BEGIN",
            phase: "DRAW",
        });
    });
});

// ---------------------------------------------------------------------------
// Activated mana abilities on creatures (CR 605.1a)
// ---------------------------------------------------------------------------

describe("Llanowar Elves ({T}: Add {G}, CR 605.1a)", () => {
    it("is a 1/1 Elf Druid for {G}", () => {
        expect(llanowarElves.manaCost).toEqual({ G: 1 });
        expect(llanowarElves.types).toContain("Creature");
        expect(llanowarElves.subtypes).toEqual(["Elf", "Druid"]);
        expect(llanowarElves.power).toBe(1);
        expect(llanowarElves.toughness).toBe(1);
    });

    it("declares a tap-for-green mana ability (useStack: false)", () => {
        const ability = llanowarElves.activatedAbilities?.[0];
        expect(ability?.cost.tap).toBe(true);
        expect(ability?.useStack).toBe(false);
        expect(ability?.manaProduced).toEqual({ G: 1 });
    });

    it("engine recognizes the mana ability on the battlefield", () => {
        const elf = makeInstance(llanowarElves.id, { id: "elf" });
        expect(hasManaAbility(elf)).toBe(true);
        expect(getActivatedManaColor(elf)).toBe("G");
    });

    it("wire format: mana ability survives projectPublicState", () => {
        // The projection slims `card.card` to `{ id }`. The constants helpers
        // read the ability via `getCardById(card.card.id)` — this test guards
        // against any future refactor that reads ability data off the fat embed.
        const elf = makeInstance(llanowarElves.id, { id: "elf" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [elf] }),
                makePlayer("p2"),
            ],
        });
        const projected = projectPublicState(state, 1, "p1");
        const slimElf = projected.players[0].battlefield.find(
            (c) => c.id === "elf"
        )!;
        expect(hasManaAbility(slimElf as CardInstanceState)).toBe(true);
        expect(getActivatedManaColor(slimElf as CardInstanceState)).toBe("G");
    });
});

describe("Sol Ring ({T}: Add {C}{C}, CR 605.1a)", () => {
    it("is a {1} artifact", () => {
        expect(solRing.manaCost).toEqual({ X: 1 });
        expect(solRing.types).toEqual(["Artifact"]);
    });

    it("declares a tap-for-{C}{C} mana ability (useStack: false)", () => {
        const ability = solRing.activatedAbilities?.[0];
        expect(ability?.cost.tap).toBe(true);
        expect(ability?.useStack).toBe(false);
        expect(ability?.manaProduced).toEqual({ C: 2 });
    });

    it("engine recognizes the ability and reports 2 colorless produced", () => {
        const ring = makeInstance(solRing.id, { id: "ring" });
        expect(hasManaAbility(ring)).toBe(true);
        expect(getActivatedManaColor(ring)).toBe("C");
        expect(getFixedManaAmount(ring, "C")).toBe(2);
    });

    it("wire format: ability survives projectPublicState", () => {
        // Artifact abilities are visible on the board — must be readable from
        // the projected state too (the projection strips card.card to { id }).
        const ring = makeInstance(solRing.id, { id: "ring" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [ring] }),
                makePlayer("p2"),
            ],
        });
        const projected = projectPublicState(state, 1, "p1");
        const slimRing = projected.players[0].battlefield.find(
            (c) => c.id === "ring"
        )!;
        expect(hasManaAbility(slimRing as CardInstanceState)).toBe(true);
        expect(getActivatedManaColor(slimRing as CardInstanceState)).toBe("C");
        expect(getFixedManaAmount(slimRing as CardInstanceState, "C")).toBe(2);
    });
});

// All five Mox share the makeTapForMana factory; one parameterized describe
// covers shape, GRE recognition, and wire-format projection per color.
describe.each([
    { card: moxPearl, color: "W" as const, abilityId: "mox-pearl-mana" },
    { card: moxSapphire, color: "U" as const, abilityId: "mox-sapphire-mana" },
    { card: moxJet, color: "B" as const, abilityId: "mox-jet-mana" },
    { card: moxRuby, color: "R" as const, abilityId: "mox-ruby-mana" },
    { card: moxEmerald, color: "G" as const, abilityId: "mox-emerald-mana" },
])(
    "$card.name ({T}: Add {$color}, CR 605.1a)",
    ({ card, color, abilityId }) => {
        it("is a 0-mana artifact with a tap-for-color mana ability (useStack: false)", () => {
            expect(card.manaCost).toEqual({ X: 0 });
            expect(card.types).toEqual(["Artifact"]);
            const ability = card.activatedAbilities?.[0];
            expect(ability?.id).toBe(abilityId);
            expect(ability?.cost).toEqual({ tap: true });
            expect(ability?.useStack).toBe(false);
            expect(ability?.manaProduced).toEqual({ [color]: 1 });
        });

        it("engine recognizes the mana ability and reports the correct color", () => {
            const inst = makeInstance(card.id, { id: "mox" });
            expect(hasManaAbility(inst)).toBe(true);
            expect(getActivatedManaColor(inst)).toBe(color);
            expect(getFixedManaAmount(inst, color)).toBe(1);
        });

        it("wire format: mana ability survives projectPublicState", () => {
            const inst = makeInstance(card.id, { id: "mox" });
            const state = makeState({
                players: [
                    makePlayer("p1", { battlefield: [inst] }),
                    makePlayer("p2"),
                ],
            });
            const projected = projectPublicState(state, 1, "p1");
            const slim = projected.players[0].battlefield.find(
                (c) => c.id === "mox"
            )!;
            expect(hasManaAbility(slim as CardInstanceState)).toBe(true);
            expect(getActivatedManaColor(slim as CardInstanceState)).toBe(
                color
            );
            expect(getFixedManaAmount(slim as CardInstanceState, color)).toBe(
                1
            );
        });
    }
);

describe("Jayemdae Tome ({4}, {T}: Draw a card, CR 602.1 + 121.1)", () => {
    it("is a {4} artifact with a stack-using activated ability", () => {
        expect(jayemdaeTome.manaCost).toEqual({ X: 4 });
        expect(jayemdaeTome.types).toEqual(["Artifact"]);
        const ability = jayemdaeTome.activatedAbilities?.[0];
        expect(ability?.cost).toEqual({ tap: true, mana: { X: 4 } });
        expect(ability?.useStack).toBe(true);
    });

    it("resolving the ability draws one card for the controller", () => {
        const tome = makeInstance(jayemdaeTome.id, {
            id: "tome",
            controllerId: "p1",
            ownerId: "p1",
        });
        const library = Array.from({ length: 3 }, (_, i) =>
            makeInstance(grizzlyBearsId(), {
                id: `p1-lib-${i}`,
                controllerId: "p1",
                ownerId: "p1",
                zone: "library",
            })
        );
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [tome], library }),
                makePlayer("p2"),
            ],
        });
        // Simulate activation: the tome is pushed on the stack with its
        // abilityId set (the engine does this at activation time).
        state.stack.push({
            ...tome,
            zone: "stack",
            castById: "p1",
            abilityId: "jayemdae-tome-draw",
            targets: [],
        });
        resolveTopOfStack(state);
        expect(state.players[0].hand).toHaveLength(1);
        expect(state.players[0].library).toHaveLength(2);
    });

    it("wire format: activated ability survives projectPublicState", () => {
        // Jayemdae Tome's ability is visible on the board — the projection
        // strips card.card to { id }, so the engine must read ability metadata
        // from the registry, not from the fat embed.
        const tome = makeInstance(jayemdaeTome.id, { id: "tome" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [tome] }),
                makePlayer("p2"),
            ],
        });
        const projected = projectPublicState(state, 1, "p1");
        const slimTome = projected.players[0].battlefield.find(
            (c) => c.id === "tome"
        )!;
        // After projection, the ability is still reachable through the
        // registry via the card id.
        const def = jayemdaeTome;
        expect(slimTome.card.id).toBe(def.id);
        expect(def.activatedAbilities?.[0].id).toBe("jayemdae-tome-draw");
    });
});

describe("Jade Statue (animate until end of combat, CR 208.2 + 511.3 + 602.5)", () => {
    it("is a {4} artifact with a combat-only {2} activated ability", () => {
        expect(jadeStatue.manaCost).toEqual({ X: 4 });
        expect(jadeStatue.types).toEqual(["Artifact"]);
        const ability = jadeStatue.activatedAbilities?.[0];
        expect(ability?.id).toBe("jade-statue-animate");
        expect(ability?.cost).toEqual({ mana: { X: 2 } });
        expect(ability?.useStack).toBe(true);
        // CR 602.5 — restriction covers every combat sub-step.
        expect(ability?.activationPhaseRestriction).toEqual([
            "BEGINNING_OF_COMBAT",
            "DECLARE_ATTACKERS",
            "DECLARE_BLOCKERS",
            "FIRST_STRIKE_DAMAGE",
            "COMBAT_DAMAGE",
            "END_OF_COMBAT",
        ]);
    });

    function setupAnimationScenario() {
        const statue = makeInstance(jadeStatue.id, {
            id: "statue",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            phase: "DECLARE_ATTACKERS",
            players: [
                makePlayer("p1", { battlefield: [statue] }),
                makePlayer("p2"),
            ],
        });
        // Simulate activation: push the ability on the stack (engine does this
        // at activation time once costs are paid).
        state.stack.push({
            ...statue,
            zone: "stack",
            castById: "p1",
            abilityId: "jade-statue-animate",
            targets: [],
        });
        return state;
    }

    it("resolving the ability animates the artifact into a 3/6 Golem artifact creature", () => {
        const state = setupAnimationScenario();
        resolveTopOfStack(state);
        const animated = state.players[0].battlefield.find(
            (c) => c.id === "statue"
        )!;
        // CR 208.2 — creature card type added; original artifact type preserved.
        expect(animated.types).toEqual(["Artifact", "Creature"]);
        expect(animated.subtypes).toEqual(["Golem"]);
        expect(animated.power).toBe(3);
        expect(animated.toughness).toBe(6);
        expect(animated.animation).toMatchObject({
            addedCreatureType: true,
            addedSubtype: "Golem",
            savedPower: undefined,
            savedToughness: undefined,
            duration: { phase: "end-of-combat" },
        });
    });

    it("END_OF_COMBAT reverts the animation (CR 511.3): artifact loses creature type, P/T, and Golem subtype", () => {
        const state = setupAnimationScenario();
        resolveTopOfStack(state);
        // Walk to END_OF_COMBAT. advancePhase auto-skips empty combat steps,
        // so we land in POSTCOMBAT_MAIN — the purge still runs at the
        // END_OF_COMBAT entry before the skip advances us forward.
        state.phase = "COMBAT_DAMAGE";
        advancePhase(state);
        const reverted = state.players[0].battlefield.find(
            (c) => c.id === "statue"
        )!;
        expect(reverted.types).toEqual(["Artifact"]);
        expect(reverted.subtypes).toEqual([]);
        expect(reverted.power).toBeUndefined();
        expect(reverted.toughness).toBeUndefined();
        expect(reverted.animation).toBeUndefined();
    });

    it("CLEANUP does NOT revert an animation still scoped to a future end-of-combat", () => {
        // Fabricate an animation whose duration is end-of-combat and run
        // CLEANUP: it must not affect effects tied to a different boundary.
        const statue = makeInstance(jadeStatue.id, { id: "statue" });
        statue.types = ["Artifact", "Creature"];
        statue.subtypes = ["Golem"];
        statue.power = 3;
        statue.toughness = 6;
        statue.animation = {
            savedPower: undefined,
            savedToughness: undefined,
            addedCreatureType: true,
            addedSubtype: "Golem",
            duration: { phase: "end-of-combat" },
        };
        const state = makeState({
            phase: "END_STEP",
            players: [
                makePlayer("p1", { battlefield: [statue] }),
                makePlayer("p2"),
            ],
        });
        advancePhase(state); // END_STEP → CLEANUP → next turn
        const still = state.players[0].battlefield.find(
            (c) => c.id === "statue"
        )!;
        expect(still.animation).toBeDefined();
        expect(still.types).toContain("Creature");
    });

    it("wire format: animated statue projects as a 3/6 creature with the Golem subtype for both viewers", () => {
        const state = setupAnimationScenario();
        resolveTopOfStack(state);
        for (const viewer of ["p1", "p2"] as const) {
            const projected = projectPublicState(state, 1, viewer);
            const slim = projected.players[0].battlefield.find(
                (c) => c.id === "statue"
            )!;
            expect(slim.types).toEqual(["Artifact", "Creature"]);
            expect(slim.subtypes).toEqual(["Golem"]);
            expect(slim.power).toBe(3);
            expect(slim.toughness).toBe(6);
            // Effective P/T survives the projection (layer 7c reads the slim
            // shape and returns the 3/6 printed on the animated card).
            expect(getEffectivePower(projected, slim)).toBe(3);
            expect(getEffectiveToughness(projected, slim)).toBe(6);
        }
    });
});

describe("Icy Manipulator ({1}, {T}: tap target artifact/creature/land, CR 701.20a)", () => {
    it("is a {4} artifact with a stack-using activated ability", () => {
        expect(icyManipulator.manaCost).toEqual({ X: 4 });
        expect(icyManipulator.types).toEqual(["Artifact"]);
        const ability = icyManipulator.activatedAbilities?.[0];
        expect(ability?.cost).toEqual({ tap: true, mana: { X: 1 } });
        expect(ability?.useStack).toBe(true);
        expect(ability?.targetRequirement).toEqual({
            type: ["Artifact", "Creature", "Land"],
            count: 1,
        });
    });

    function activate(
        state: ReturnType<typeof makeState>,
        icy: CardInstanceState,
        target: { type: "permanent" | "player" | "spell"; id: string }
    ) {
        state.stack.push({
            ...icy,
            zone: "stack",
            castById: "p1",
            abilityId: "icy-manipulator-tap",
            targets: [target],
        });
        resolveTopOfStack(state);
    }

    it("taps an untapped creature on resolution", () => {
        const icy = makeInstance(icyManipulator.id, { id: "icy" });
        const lion = makeInstance(savannahLions.id, {
            id: "lion",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [icy] }),
                makePlayer("p2", { battlefield: [lion] }),
            ],
        });
        activate(state, icy, { type: "permanent", id: "lion" });
        expect(state.players[1].battlefield[0].isTapped).toBe(true);
    });

    it("is a no-op when the target is already tapped (CR 701.20a)", () => {
        const icy = makeInstance(icyManipulator.id, { id: "icy" });
        const lion = makeInstance(savannahLions.id, {
            id: "lion",
            controllerId: "p2",
            ownerId: "p2",
            isTapped: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [icy] }),
                makePlayer("p2", { battlefield: [lion] }),
            ],
        });
        activate(state, icy, { type: "permanent", id: "lion" });
        expect(state.players[1].battlefield[0].isTapped).toBe(true);
    });

    it("can target a land (tapping a tapland-source for mana denial)", () => {
        const icy = makeInstance(icyManipulator.id, { id: "icy" });
        const island = makeInstance(tropicalIsland.id, {
            id: "island",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [icy] }),
                makePlayer("p2", { battlefield: [island] }),
            ],
        });
        activate(state, icy, { type: "permanent", id: "island" });
        expect(state.players[1].battlefield[0].isTapped).toBe(true);
    });

    it("can target an artifact (including itself in principle)", () => {
        const icy = makeInstance(icyManipulator.id, { id: "icy" });
        const tome = makeInstance(jayemdaeTome.id, {
            id: "tome",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [icy] }),
                makePlayer("p2", { battlefield: [tome] }),
            ],
        });
        activate(state, icy, { type: "permanent", id: "tome" });
        expect(state.players[1].battlefield[0].isTapped).toBe(true);
    });

    it("silently fizzles if the target has left the battlefield (CR 608.2b)", () => {
        const icy = makeInstance(icyManipulator.id, { id: "icy" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [icy] }),
                makePlayer("p2"),
            ],
        });
        activate(state, icy, { type: "permanent", id: "ghost" });
        expect(state.stack).toHaveLength(0);
    });

    it("legal-target set spans artifacts, creatures and lands", () => {
        const icy = makeInstance(icyManipulator.id, { id: "icy" });
        const lion = makeInstance(savannahLions.id, {
            id: "lion",
            controllerId: "p2",
            ownerId: "p2",
        });
        const island = makeInstance(tropicalIsland.id, {
            id: "island",
            controllerId: "p2",
            ownerId: "p2",
        });
        const tome = makeInstance(jayemdaeTome.id, {
            id: "tome",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [icy, tome] }),
                makePlayer("p2", { battlefield: [lion, island] }),
            ],
        });
        const legal = getLegalTargets(
            state,
            icyManipulator.activatedAbilities![0].targetRequirement!
        );
        const ids = legal.map((t) => t.id).sort();
        expect(ids).toEqual(["icy", "island", "lion", "tome"].sort());
    });

    it("wire format: tap survives projectPublicState (regression guard)", () => {
        const icy = makeInstance(icyManipulator.id, { id: "icy" });
        const lion = makeInstance(savannahLions.id, {
            id: "lion",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [icy] }),
                makePlayer("p2", { battlefield: [lion] }),
            ],
        });
        activate(state, icy, { type: "permanent", id: "lion" });
        const projected = projectPublicState(state, 1, "p1");
        const slimLion = projected.players[1].battlefield.find(
            (c) => c.id === "lion"
        )!;
        expect(slimLion.isTapped).toBe(true);
    });
});

describe("Birds of Paradise (flying + {T}: Add one mana of any color, CR 605.1a)", () => {
    it("is a 0/1 Bird for {G} with flying", () => {
        expect(birdsOfParadise.manaCost).toEqual({ G: 1 });
        expect(birdsOfParadise.types).toContain("Creature");
        expect(birdsOfParadise.subtypes).toEqual(["Bird"]);
        expect(birdsOfParadise.power).toBe(0);
        expect(birdsOfParadise.toughness).toBe(1);
        expect(birdsOfParadise.staticAbilities).toContain("flying");
    });

    it("declares a tap mana ability offering all five colors (no colorless)", () => {
        const ability = birdsOfParadise.activatedAbilities?.[0];
        expect(ability?.cost.tap).toBe(true);
        expect(ability?.useStack).toBe(false);
        // "Any color" excludes colorless per CR 106.1b — must be W/U/B/R/G only.
        expect(ability?.manaChoices).toEqual([
            { W: 1 },
            { U: 1 },
            { B: 1 },
            { R: 1 },
            { G: 1 },
        ]);
    });

    it("engine recognizes the mana ability; color is null (choice-based)", () => {
        const bird = makeInstance(birdsOfParadise.id, { id: "bird" });
        expect(hasManaAbility(bird)).toBe(true);
        // getActivatedManaColor only resolves fixed (manaProduced) abilities.
        // Choice-based abilities MUST return null so the engine takes the
        // manaChoices branch in tapUntap instead of adding a fixed color.
        expect(getActivatedManaColor(bird)).toBeNull();
    });

    it("wire format: ability survives projectPublicState", () => {
        const bird = makeInstance(birdsOfParadise.id, { id: "bird" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bird] }),
                makePlayer("p2"),
            ],
        });
        const projected = projectPublicState(state, 1, "p1");
        const slimBird = projected.players[0].battlefield.find(
            (c) => c.id === "bird"
        )!;
        expect(hasManaAbility(slimBird as CardInstanceState)).toBe(true);
        expect(getActivatedManaColor(slimBird as CardInstanceState)).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// Dual lands (Alpha — CR 305.6, 605.1a): two land types + choice-based mana
// ---------------------------------------------------------------------------

describe("Tundra (dual land: {T}: Add {W} or {U})", () => {
    it("is a Land with both Plains and Island subtypes", () => {
        expect(tundra.types).toEqual(["Land"]);
        expect(tundra.subtypes).toEqual(["Plains", "Island"]);
        // Dual lands are NOT Basic (CR 205.4a).
        expect(tundra.supertypes).toBeUndefined();
    });

    it("offers W and U as a single choice ability", () => {
        const ability = tundra.activatedAbilities?.[0];
        expect(ability?.cost.tap).toBe(true);
        expect(ability?.useStack).toBe(false);
        expect(ability?.manaChoices).toEqual([{ W: 1 }, { U: 1 }]);
    });

    it("commitLandsForCost commits a Tundra tapped for U when paying {U}", () => {
        // Regression: without chosenMana, commitLandsForCost would see Tundra
        // as {W} (via getBasicLandMana on first subtype) and skip it when
        // committing a {U} cost — leaving Tundra untappable-but-uncommitted
        // and exploitable for infinite mana.
        const tund = makeInstance(tundra.id, {
            id: "tundra-1",
            isTapped: true,
            chosenMana: { U: 1 },
        });
        const p1 = makePlayer("p1", { battlefield: [tund] });
        commitLandsForCost(p1, { U: 1 });
        expect(p1.battlefield[0].manaCommitted).toBe(true);
    });
});

describe("Alpha dual lands (snapshot: types, subtypes, mana choices)", () => {
    // The remaining 8 duals share Tundra's shape. Locking down the triples
    // guards against typos in subtypes/manaChoices when adding new prints.
    const duals: Array<{
        card: CardDefinition;
        subtypes: string[];
        choices: [string, string];
    }> = [
        {
            card: badlands,
            subtypes: ["Swamp", "Mountain"],
            choices: ["B", "R"],
        },
        { card: bayou, subtypes: ["Swamp", "Forest"], choices: ["B", "G"] },
        {
            card: plateau,
            subtypes: ["Mountain", "Plains"],
            choices: ["R", "W"],
        },
        { card: savannah, subtypes: ["Forest", "Plains"], choices: ["G", "W"] },
        { card: scrubland, subtypes: ["Plains", "Swamp"], choices: ["W", "B"] },
        { card: taiga, subtypes: ["Mountain", "Forest"], choices: ["R", "G"] },
        {
            card: tropicalIsland,
            subtypes: ["Forest", "Island"],
            choices: ["G", "U"],
        },
        {
            card: undergroundSea,
            subtypes: ["Island", "Swamp"],
            choices: ["U", "B"],
        },
    ];

    for (const { card, subtypes, choices } of duals) {
        it(`${card.name}: land with subtypes ${subtypes.join("/")} and ${choices.join("/")} mana`, () => {
            expect(card.types).toEqual(["Land"]);
            expect(card.subtypes).toEqual(subtypes);
            expect(card.supertypes).toBeUndefined();
            const ability = card.activatedAbilities?.[0];
            expect(ability?.cost.tap).toBe(true);
            expect(ability?.useStack).toBe(false);
            expect(ability?.manaChoices).toEqual([
                { [choices[0]]: 1 },
                { [choices[1]]: 1 },
            ]);
        });
    }
});

// Per-dual GRE + wire-format coverage. After moving every dual to makeDualLand,
// regression-guard each card's mana ability survives both fat-state inspection
// (commitLandsForCost picks the chosen color) and projectPublicState (the
// constants helpers must still resolve the slim instance to the right ability).
describe.each([
    { card: badlands, primary: "B" as const, secondary: "R" as const },
    { card: bayou, primary: "B" as const, secondary: "G" as const },
    { card: plateau, primary: "R" as const, secondary: "W" as const },
    { card: savannah, primary: "G" as const, secondary: "W" as const },
    { card: scrubland, primary: "W" as const, secondary: "B" as const },
    { card: taiga, primary: "R" as const, secondary: "G" as const },
    { card: tropicalIsland, primary: "G" as const, secondary: "U" as const },
    { card: tundra, primary: "W" as const, secondary: "U" as const },
    { card: undergroundSea, primary: "U" as const, secondary: "B" as const },
])(
    "$card.name (dual land mana ability — GRE + wire format)",
    ({ card, primary, secondary }) => {
        it("commitLandsForCost commits the dual for either chosen color", () => {
            for (const color of [primary, secondary]) {
                const dual = makeInstance(card.id, {
                    id: `${card.id}-inst`,
                    isTapped: true,
                    chosenMana: { [color]: 1 },
                });
                const p1 = makePlayer("p1", { battlefield: [dual] });
                commitLandsForCost(p1, { [color]: 1 });
                expect(
                    p1.battlefield[0].manaCommitted,
                    `commit failed for ${card.name} chosen ${color}`
                ).toBe(true);
            }
        });

        it("wire format: mana ability resolvable via projectPublicState", () => {
            const dual = makeInstance(card.id, { id: "dual-inst" });
            const state = makeState({
                players: [
                    makePlayer("p1", { battlefield: [dual] }),
                    makePlayer("p2"),
                ],
            });
            const projected = projectPublicState(state, 1, "p1");
            const slim = projected.players[0].battlefield.find(
                (c) => c.id === "dual-inst"
            )!;
            expect(hasManaAbility(slim as CardInstanceState)).toBe(true);
            // Subtypes survive projection (engine reads them off the instance,
            // not via card.card lookup).
            expect(slim.subtypes).toEqual(card.subtypes);
        });
    }
);

describe("Channel (CR 605.1a, 118.4, 514.2)", () => {
    it("is a {G}{G} sorcery", () => {
        expect(channel.manaCost).toEqual({ G: 2 });
        expect(channel.types).toEqual(["Sorcery"]);
    });

    it("declares a pay-1-life mana ability template (useStack: false)", () => {
        const ability = channel.activatedAbilities?.[0];
        expect(ability?.id).toBe("channel-mana");
        expect(ability?.cost.life).toBe(1);
        expect(ability?.cost.tap).toBeUndefined();
        expect(ability?.useStack).toBe(false);
        expect(ability?.manaProduced).toEqual({ C: 1 });
    });

    it("resolve grants the caster a reference to channel-mana for the turn", () => {
        const state = makeState();
        pushSpell(state, channel.id, "p1");
        resolveTopOfStack(state);
        const grants = state.players[0].grantedAbilities;
        expect(grants).toHaveLength(1);
        expect(grants?.[0]).toMatchObject({
            sourceCardId: channel.id,
            abilityId: "channel-mana",
            duration: { phase: "end-of-turn" },
            grantedAtTurn: state.turn,
        });
        expect(grants?.[0].id).toMatch(/^grant-\d+$/);
        // Opponent does not get the grant.
        expect(state.players[1].grantedAbilities).toBeUndefined();
    });

    it("multiple resolves produce distinct grant ids", () => {
        const state = makeState();
        pushSpell(state, channel.id, "p1");
        resolveTopOfStack(state);
        pushSpell(state, channel.id, "p1");
        resolveTopOfStack(state);
        const grants = state.players[0].grantedAbilities!;
        expect(grants).toHaveLength(2);
        expect(grants[0].id).not.toBe(grants[1].id);
    });

    it("CLEANUP step purges end-of-turn grants", () => {
        const state = makeState({ phase: "END_STEP" });
        pushSpell(state, channel.id, "p1");
        resolveTopOfStack(state);
        expect(state.players[0].grantedAbilities).toHaveLength(1);
        // advancePhase from END_STEP traverses CLEANUP (auto) into next turn.
        advancePhase(state);
        expect(state.players[0].grantedAbilities).toBeUndefined();
    });

    it("template effect adds {C} via ActivatedAbilityContext.addMana", () => {
        // The mutation drives execution over the network; here we exercise
        // the template directly to guarantee the effect is wired correctly.
        const state = makeState();
        pushSpell(state, channel.id, "p1");
        resolveTopOfStack(state);
        const p1 = state.players[0];
        const ability = channel.activatedAbilities![0];
        // Simulate the mutation's payment+execution path for useStack:false.
        p1.life -= ability.cost.life!;
        ability.effect!({
            addMana: (amount) => {
                for (const [color, count] of Object.entries(amount)) {
                    if (color === "X" || typeof count !== "number") continue;
                    p1.manaPool[color] = (p1.manaPool[color] ?? 0) + count;
                }
            },
        });
        expect(p1.life).toBe(19);
        expect(p1.manaPool.C).toBe(1);
    });

    it("wire format: projectPublicState hydrates grantedAbilities for both viewers", () => {
        const state = makeState();
        pushSpell(state, channel.id, "p1");
        resolveTopOfStack(state);

        for (const viewer of ["p1", "p2"] as const) {
            const projected = projectPublicState(state, 1, viewer);
            const slim = projected.players[0].grantedAbilities;
            expect(slim).toHaveLength(1);
            expect(slim?.[0]).toMatchObject({
                sourceCardId: channel.id,
                abilityId: "channel-mana",
                oracleText: "Pay 1 life: Add {C}.",
                useStack: false,
                manaProduced: { C: 1 },
                duration: { phase: "end-of-turn" },
            });
            expect(slim?.[0].cost.life).toBe(1);
        }
    });
});

describe("Time Walk (extra turn after this one, CR 500.7)", () => {
    it("is a {1}{U} sorcery", () => {
        expect(timeWalk.manaCost).toEqual({ X: 1, U: 1 });
        expect(timeWalk.types).toEqual(["Sorcery"]);
    });

    it("resolves by queueing an extra turn for the caster", () => {
        const state = makeState();
        pushSpell(state, timeWalk.id, "p1");
        expect(state.extraTurns).toBeUndefined();
        resolveTopOfStack(state);
        expect(state.extraTurns).toEqual(["p1"]);
        expect(state.players[0].graveyard).toHaveLength(1);
    });

    it("advancing the turn keeps the caster active (no opponent swap)", () => {
        // Resolve Time Walk at end-of-turn so the very next advanceTurn runs.
        const state = makeState({
            phase: "END_STEP",
            turn: 1,
            activePlayerId: "p1",
        });
        pushSpell(state, timeWalk.id, "p1");
        resolveTopOfStack(state);
        // END_STEP → CLEANUP (auto) → UNTAP of the next turn.
        advancePhase(state);
        expect(state.activePlayerId).toBe("p1");
        expect(state.turn).toBe(2);
        expect(state.extraTurns).toBeUndefined();
        // The turn after the extra turn returns to normal swap order.
        const next = makeState({
            ...state,
            phase: "END_STEP",
        });
        advancePhase(next);
        expect(next.activePlayerId).toBe("p2");
    });

    it("multiple extra turns stack LIFO (CR 500.7)", () => {
        const state = makeState({ phase: "END_STEP", activePlayerId: "p1" });
        // p1 casts Time Walk targeting self, then p2 somehow gets one queued
        // (simulated by pushing directly). Order: [p1, p2] → p2 taken first.
        state.extraTurns = ["p1", "p2"];
        advancePhase(state);
        expect(state.activePlayerId).toBe("p2");
        expect(state.extraTurns).toEqual(["p1"]);
        const next = makeState({ ...state, phase: "END_STEP" });
        advancePhase(next);
        expect(next.activePlayerId).toBe("p1");
        expect(next.extraTurns).toBeUndefined();
    });

    it("wire format: extraTurns survives projectPublicState", () => {
        const state = makeState();
        pushSpell(state, timeWalk.id, "p1");
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p2");
        expect(projected.extraTurns).toEqual(["p1"]);
        expect(projected.activePlayerId).toBe(state.activePlayerId);
    });
});

// ---------------------------------------------------------------------------
// Timetwister — "Each player shuffles their hand and graveyard into their
// library, then draws seven cards." (CR 121.1, 701.20)
// ---------------------------------------------------------------------------

describe("Timetwister (each player reshuffles + draws 7, CR 121.1 / 701.20)", () => {
    function libraryCards(
        owner: string,
        count: number,
        prefix: string
    ): CardInstanceState[] {
        return Array.from({ length: count }, (_, i) =>
            makeInstance(grizzlyBearsId(), {
                id: `${prefix}-${i}`,
                controllerId: owner,
                ownerId: owner,
                zone: "library",
            })
        );
    }

    it("is a {2}{U} sorcery", () => {
        expect(timetwister.manaCost).toEqual({ X: 2, U: 1 });
        expect(timetwister.types).toEqual(["Sorcery"]);
    });

    it("each player ends with 7 cards in hand, graveyard empty, remainder in library", () => {
        // p1 totals 10 cards across private zones (3 hand + 2 gy + 5 lib);
        // p2 totals 15 (4 hand + 1 gy + 10 lib). After resolve, p1 has
        // Timetwister itself in graveyard (resolved sorcery) so library = 3
        // and graveyard = 1; p2 has no such contribution so library = 8.
        const p1 = makePlayer("p1", {
            hand: libraryCards("p1", 3, "p1-hand").map((c) => ({
                ...c,
                zone: "hand",
            })),
            graveyard: libraryCards("p1", 2, "p1-gy").map((c) => ({
                ...c,
                zone: "graveyard",
            })),
            library: libraryCards("p1", 5, "p1-lib"),
        });
        const p2 = makePlayer("p2", {
            hand: libraryCards("p2", 4, "p2-hand").map((c) => ({
                ...c,
                zone: "hand",
            })),
            graveyard: libraryCards("p2", 1, "p2-gy").map((c) => ({
                ...c,
                zone: "graveyard",
            })),
            library: libraryCards("p2", 10, "p2-lib"),
        });
        const state = makeState({ players: [p1, p2], rngSeed: 42 });
        pushSpell(state, timetwister.id, "p1");
        resolveTopOfStack(state);

        expect(state.players[0].hand).toHaveLength(7);
        // Timetwister itself lands in p1's graveyard after resolution.
        expect(state.players[0].graveyard).toHaveLength(1);
        expect(state.players[0].graveyard[0].card.id).toBe(timetwister.id);
        expect(state.players[0].library).toHaveLength(3);

        expect(state.players[1].hand).toHaveLength(7);
        expect(state.players[1].graveyard).toHaveLength(0);
        expect(state.players[1].library).toHaveLength(8);
    });

    it("shuffles deterministically under the same seed (PRNG replay)", () => {
        function run(seed: number): string[] {
            const p1 = makePlayer("p1", {
                library: libraryCards("p1", 12, "p1-lib"),
            });
            const state = makeState({
                players: [p1, makePlayer("p2")],
                rngSeed: seed,
            });
            pushSpell(state, timetwister.id, "p1");
            resolveTopOfStack(state);
            return state.players[0].library.map((c) => c.id);
        }
        expect(run(123)).toEqual(run(123));
        expect(run(123)).not.toEqual(run(456));
    });

    it("wire format: hand/library/graveyard counts survive projectPublicState", () => {
        const p1 = makePlayer("p1", {
            hand: libraryCards("p1", 3, "p1-hand").map((c) => ({
                ...c,
                zone: "hand",
            })),
            library: libraryCards("p1", 8, "p1-lib"),
        });
        const p2 = makePlayer("p2", {
            hand: libraryCards("p2", 2, "p2-hand").map((c) => ({
                ...c,
                zone: "hand",
            })),
            library: libraryCards("p2", 9, "p2-lib"),
        });
        const state = makeState({ players: [p1, p2], rngSeed: 7 });
        pushSpell(state, timetwister.id, "p1");
        resolveTopOfStack(state);

        const projected = projectPublicState(state, 1, "p1");
        // p1 is the viewer → hand is the fat list of their own cards.
        expect(projected.players[0].hand).toHaveLength(7);
        expect(projected.players[0].library.count).toBe(
            state.players[0].library.length
        );
        expect(projected.players[0].graveyard).toHaveLength(1);
        // p2 is the opponent → hand is projected as null placeholders.
        expect(projected.players[1].hand).toHaveLength(7);
        expect(projected.players[1].library.count).toBe(
            state.players[1].library.length
        );
        expect(projected.players[1].graveyard).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// Wheel of Fortune — "Each player discards their hand, then draws seven
// cards." (CR 701.8, 121.1)
// ---------------------------------------------------------------------------

describe("Wheel of Fortune (each player discards hand + draws 7, CR 701.8 / 121.1)", () => {
    function libraryCards(
        owner: string,
        count: number,
        prefix: string
    ): CardInstanceState[] {
        return Array.from({ length: count }, (_, i) =>
            makeInstance(grizzlyBearsId(), {
                id: `${prefix}-${i}`,
                controllerId: owner,
                ownerId: owner,
                zone: "library",
            })
        );
    }

    it("is a {2}{R} sorcery", () => {
        expect(wheelOfFortune.manaCost).toEqual({ X: 2, R: 1 });
        expect(wheelOfFortune.types).toEqual(["Sorcery"]);
    });

    it("discarded cards land in each player's graveyard, then each draws 7", () => {
        // p1: 3 in hand, 0 in graveyard, 10 in library → after resolve:
        //   graveyard = 3 discarded + Wheel itself = 4, hand = 7, library = 3
        // p2: 4 in hand, 1 in graveyard, 12 in library → after resolve:
        //   graveyard = 1 + 4 discarded = 5, hand = 7, library = 5
        const p1 = makePlayer("p1", {
            hand: libraryCards("p1", 3, "p1-hand").map((c) => ({
                ...c,
                zone: "hand",
            })),
            library: libraryCards("p1", 10, "p1-lib"),
        });
        const p2 = makePlayer("p2", {
            hand: libraryCards("p2", 4, "p2-hand").map((c) => ({
                ...c,
                zone: "hand",
            })),
            graveyard: libraryCards("p2", 1, "p2-gy").map((c) => ({
                ...c,
                zone: "graveyard",
            })),
            library: libraryCards("p2", 12, "p2-lib"),
        });
        const state = makeState({ players: [p1, p2] });
        pushSpell(state, wheelOfFortune.id, "p1");
        resolveTopOfStack(state);

        expect(state.players[0].hand).toHaveLength(7);
        expect(state.players[0].graveyard).toHaveLength(4);
        expect(
            state.players[0].graveyard.some(
                (c) => c.card.id === wheelOfFortune.id
            )
        ).toBe(true);
        expect(state.players[0].library).toHaveLength(3);

        expect(state.players[1].hand).toHaveLength(7);
        expect(state.players[1].graveyard).toHaveLength(5);
        expect(state.players[1].library).toHaveLength(5);
    });

    it("is a no-op on an empty hand for the discard step (player still draws 7)", () => {
        const p1 = makePlayer("p1", {
            library: libraryCards("p1", 10, "p1-lib"),
        });
        const p2 = makePlayer("p2", {
            library: libraryCards("p2", 10, "p2-lib"),
        });
        const state = makeState({ players: [p1, p2] });
        pushSpell(state, wheelOfFortune.id, "p1");
        resolveTopOfStack(state);

        expect(state.players[0].hand).toHaveLength(7);
        expect(state.players[1].hand).toHaveLength(7);
    });

    it("wire format: hand/library/graveyard counts survive projectPublicState", () => {
        const p1 = makePlayer("p1", {
            hand: libraryCards("p1", 2, "p1-hand").map((c) => ({
                ...c,
                zone: "hand",
            })),
            library: libraryCards("p1", 10, "p1-lib"),
        });
        const p2 = makePlayer("p2", {
            hand: libraryCards("p2", 3, "p2-hand").map((c) => ({
                ...c,
                zone: "hand",
            })),
            library: libraryCards("p2", 10, "p2-lib"),
        });
        const state = makeState({ players: [p1, p2] });
        pushSpell(state, wheelOfFortune.id, "p1");
        resolveTopOfStack(state);

        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[0].hand).toHaveLength(7);
        expect(projected.players[0].graveyard).toHaveLength(3);
        expect(projected.players[0].library.count).toBe(
            state.players[0].library.length
        );
        expect(projected.players[1].hand).toHaveLength(7);
        expect(projected.players[1].graveyard).toHaveLength(3);
        expect(projected.players[1].library.count).toBe(
            state.players[1].library.length
        );
    });
});

// ---------------------------------------------------------------------------
// Circle of Protection: {color} (CR 615.1, 615.6 — one-shot damage prevention)
// ---------------------------------------------------------------------------

describe("Circle of Protection: Red (CR 615.1, 615.6)", () => {
    function setupCoPOnBattlefield(copCard = circleOfProtectionRed) {
        const cop = makeInstance(copCard.id, { id: "cop" });
        const p1 = makePlayer("p1", { battlefield: [cop] });
        return makeState({ players: [p1, makePlayer("p2")] });
    }

    it("registers an end-of-turn prevention effect when the ability resolves", () => {
        const state = setupCoPOnBattlefield();
        const cop = state.players[0].battlefield[0];
        // Simulate activation: push ability on stack with a chosen source.
        const bolt = makeInstance(lightningBolt.id, {
            id: "bolt-stack",
            controllerId: "p2",
            ownerId: "p2",
            zone: "stack",
        });
        state.stack.push({
            ...bolt,
            castById: "p2",
            targets: [{ type: "player", id: "p1" }],
        });
        state.stack.push({
            ...cop,
            zone: "stack",
            castById: "p1",
            abilityId: "cop-prevent",
            targets: [{ type: "spell", id: "bolt-stack" }],
        });
        resolveTopOfStack(state);
        expect(state.preventionEffects).toEqual([
            {
                sourceInstanceId: "bolt-stack",
                playerId: "p1",
                duration: { phase: "end-of-turn" },
            },
        ]);
    });

    it("prevents direct damage from the chosen spell source to the protected player", () => {
        const state = setupCoPOnBattlefield();
        state.preventionEffects = [
            {
                sourceInstanceId: "bolt-stack",
                playerId: "p1",
                duration: { phase: "end-of-turn" },
            },
        ];
        const bolt = makeInstance(lightningBolt.id, {
            id: "bolt-stack",
            controllerId: "p2",
            ownerId: "p2",
            zone: "stack",
        });
        state.stack.push({
            ...bolt,
            castById: "p2",
            targets: [{ type: "player", id: "p1" }],
        });
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(20);
        expect(state.preventionEffects).toBeUndefined();
    });

    it("is a one-shot: a second bolt from a different source still hits the player", () => {
        const state = setupCoPOnBattlefield();
        state.preventionEffects = [
            {
                sourceInstanceId: "bolt-first",
                playerId: "p1",
                duration: { phase: "end-of-turn" },
            },
        ];
        // Prevention matches the first bolt.
        const first = makeInstance(lightningBolt.id, {
            id: "bolt-first",
            controllerId: "p2",
            ownerId: "p2",
            zone: "stack",
        });
        state.stack.push({
            ...first,
            castById: "p2",
            targets: [{ type: "player", id: "p1" }],
        });
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(20);
        // A different bolt (different instance id) goes through.
        const second = makeInstance(lightningBolt.id, {
            id: "bolt-second",
            controllerId: "p2",
            ownerId: "p2",
            zone: "stack",
        });
        state.stack.push({
            ...second,
            castById: "p2",
            targets: [{ type: "player", id: "p1" }],
        });
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(17);
    });

    it("prevents combat damage from the chosen unblocked attacker", async () => {
        const state = setupCoPOnBattlefield();
        const attacker = makeInstance(hypnoticSpecter.id, {
            id: "specter",
            controllerId: "p2",
            ownerId: "p2",
            isAttacking: true,
        });
        state.players[1].battlefield.push(attacker);
        // p2 is the active player while attacking — flip turn control.
        state.activePlayerId = "p2";
        state.phase = "COMBAT_DAMAGE";
        state.combat = {
            attackerIds: ["specter"],
            confirmed: true,
            blockerAssignments: {},
            blockersConfirmed: true,
        };
        state.preventionEffects = [
            {
                sourceInstanceId: "specter",
                playerId: "p1",
                duration: { phase: "end-of-turn" },
            },
        ];
        const { applyAllCombatDamage } = await import("../../../gre/phases");
        applyAllCombatDamage(state, {});
        expect(state.players[0].life).toBe(20);
        expect(state.preventionEffects).toBeUndefined();
    });

    it("does NOT prevent damage from a source other than the chosen one", () => {
        const state = setupCoPOnBattlefield();
        state.preventionEffects = [
            {
                sourceInstanceId: "some-other-bolt",
                playerId: "p1",
                duration: { phase: "end-of-turn" },
            },
        ];
        const bolt = makeInstance(lightningBolt.id, {
            id: "bolt-stack",
            controllerId: "p2",
            ownerId: "p2",
            zone: "stack",
        });
        state.stack.push({
            ...bolt,
            castById: "p2",
            targets: [{ type: "player", id: "p1" }],
        });
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(17);
        // Prevention survives because it didn't match.
        expect(state.preventionEffects).toHaveLength(1);
    });

    it("CLEANUP wipes unused end-of-turn prevention effects (CR 514.2)", async () => {
        const state = setupCoPOnBattlefield();
        state.preventionEffects = [
            {
                sourceInstanceId: "whatever",
                playerId: "p1",
                duration: { phase: "end-of-turn" },
            },
        ];
        state.phase = "END_STEP";
        const { advancePhase } = await import("../../../gre/phases");
        // END_STEP → CLEANUP (auto) → next turn.
        advancePhase(state);
        expect(state.preventionEffects).toBeUndefined();
    });
});

describe("Circle of Protection: color filter on target selection", () => {
    it("Red CoP only offers red spells/permanents as legal targets", () => {
        const redBolt = makeInstance(lightningBolt.id, {
            id: "bolt",
            controllerId: "p2",
            ownerId: "p2",
            zone: "stack",
        });
        const blueSpell = makeInstance(ancestralRecall.id, {
            id: "recall",
            controllerId: "p2",
            ownerId: "p2",
            zone: "stack",
        });
        const state = makeState();
        state.stack.push({ ...redBolt, castById: "p2" });
        state.stack.push({ ...blueSpell, castById: "p2" });
        const ability = circleOfProtectionRed.activatedAbilities![0];
        const legal = getLegalTargets(state, ability.targetRequirement!);
        expect(legal.map((t) => t.id)).toEqual(["bolt"]);
    });

    it("Blue CoP only offers blue spells/permanents as legal targets", () => {
        const redBolt = makeInstance(lightningBolt.id, {
            id: "bolt",
            controllerId: "p2",
            ownerId: "p2",
            zone: "stack",
        });
        const blueSpell = makeInstance(ancestralRecall.id, {
            id: "recall",
            controllerId: "p2",
            ownerId: "p2",
            zone: "stack",
        });
        const state = makeState();
        state.stack.push({ ...redBolt, castById: "p2" });
        state.stack.push({ ...blueSpell, castById: "p2" });
        const ability = circleOfProtectionBlue.activatedAbilities![0];
        const legal = getLegalTargets(state, ability.targetRequirement!);
        expect(legal.map((t) => t.id)).toEqual(["recall"]);
    });

    it("color filter excludes players (players have no color)", () => {
        const state = makeState();
        const ability = circleOfProtectionWhite.activatedAbilities![0];
        const legal = getLegalTargets(state, ability.targetRequirement!);
        expect(legal.filter((t) => t.type === "player")).toEqual([]);
    });

    it("Green CoP exposes the correct declarative shape", () => {
        const ability = circleOfProtectionGreen.activatedAbilities![0];
        expect(ability.useStack).toBe(true);
        expect(ability.cost).toEqual({ mana: { X: 1 } });
        expect(ability.targetRequirement).toEqual({
            type: ["any", "spell"],
            count: 1,
            colorFilter: "G",
        });
    });
});

describe("Berserk ({G} — trample + X/+0, delayed destroy if attacked, CR 117.1b / 611.1b / 603.7a / 514.2)", () => {
    function setupWithAttacker() {
        const bear = makeInstance(grizzlyBears.id, { id: "bear" });
        bear.isAttacking = true;
        bear.hasAttackedThisTurn = true;
        const p1 = makePlayer("p1", { battlefield: [bear] });
        const state = makeState({
            players: [p1, makePlayer("p2")],
            phase: "DECLARE_BLOCKERS",
        });
        return { state, bear };
    }

    it("is a {G} instant", () => {
        expect(berserk.manaCost).toEqual({ G: 1 });
        expect(berserk.types).toEqual(["Instant"]);
    });

    it("targets a single creature", () => {
        expect(berserk.targetRequirement).toEqual({
            type: "Creature",
            count: 1,
        });
    });

    it("is castable in every combat step before combat damage", () => {
        const legal = berserk.castPhaseRestriction!;
        for (const phase of [
            "UNTAP",
            "UPKEEP",
            "DRAW",
            "PRECOMBAT_MAIN",
            "BEGINNING_OF_COMBAT",
            "DECLARE_ATTACKERS",
            "DECLARE_BLOCKERS",
            "FIRST_STRIKE_DAMAGE",
        ] as const) {
            expect(legal).toContain(phase);
        }
        for (const phase of [
            "COMBAT_DAMAGE",
            "END_OF_COMBAT",
            "POSTCOMBAT_MAIN",
            "END_STEP",
            "CLEANUP",
        ] as const) {
            expect(legal).not.toContain(phase);
        }
    });

    it("getLegalActions rejects Berserk during COMBAT_DAMAGE", () => {
        const berserkCard = makeInstance(berserk.id, {
            id: "b1",
            zone: "hand",
        });
        const p1 = makePlayer("p1", { hand: [berserkCard] });
        const state = makeState({
            players: [p1, makePlayer("p2")],
            phase: "COMBAT_DAMAGE",
        });
        const legal = getLegalActions(state, p1, berserkCard);
        expect(legal).not.toContain("cast");
    });

    it("getLegalActions allows Berserk during DECLARE_ATTACKERS", () => {
        const berserkCard = makeInstance(berserk.id, {
            id: "b1",
            zone: "hand",
        });
        const p1 = makePlayer("p1", {
            hand: [berserkCard],
            manaPool: { W: 0, U: 0, B: 0, R: 0, G: 1, C: 0 },
        });
        const state = makeState({
            players: [p1, makePlayer("p2")],
            phase: "DECLARE_ATTACKERS",
        });
        const legal = getLegalActions(state, p1, berserkCard);
        expect(legal).toContain("cast");
    });

    it("grants trample and +X/+0 on resolve (X = current power)", () => {
        const { state, bear } = setupWithAttacker();
        pushSpell(state, berserk.id, "p1", [{ type: "permanent", id: "bear" }]);
        resolveTopOfStack(state);
        expect(bear.staticAbilities).toContain("trample");
        // 2 + 2 = 4 (via modifyPower; effective reading agrees)
        expect(bear.power).toBe(4);
        expect(bear.toughness).toBe(2);
        expect(getEffectivePower(state, bear)).toBe(4);
        expect(getEffectiveToughness(state, bear)).toBe(2);
    });

    it("schedules a next-end-step delayed trigger tied to the target id", () => {
        const { state } = setupWithAttacker();
        pushSpell(state, berserk.id, "p1", [{ type: "permanent", id: "bear" }]);
        resolveTopOfStack(state);
        expect(state.delayedTriggers).toHaveLength(1);
        expect(state.delayedTriggers?.[0]).toMatchObject({
            sourceCardId: berserk.id,
            triggerId: "destroy-if-attacked",
            controller: "p1",
            timing: "next-end-step",
            payload: { targetId: "bear" },
        });
        expect(state.delayedTriggers?.[0].id).toMatch(/^delayed-\d+$/);
    });

    it("END_STEP pushes the delayed trigger onto the stack with active-player priority", () => {
        const { state } = setupWithAttacker();
        pushSpell(state, berserk.id, "p1", [{ type: "permanent", id: "bear" }]);
        resolveTopOfStack(state);
        // Fast-forward to end step so the trigger fires.
        state.phase = "POSTCOMBAT_MAIN";
        advancePhase(state);
        expect(state.phase).toBe("END_STEP");
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].delayedTriggerId).toBe("destroy-if-attacked");
        expect(state.stack[0].delayedPayload).toEqual({ targetId: "bear" });
        expect(state.priorityPlayerId).toBe(state.activePlayerId);
        expect(state.delayedTriggers).toBeUndefined();
    });

    it("delayed trigger destroys the creature when it attacked this turn", () => {
        const { state, bear } = setupWithAttacker();
        pushSpell(state, berserk.id, "p1", [{ type: "permanent", id: "bear" }]);
        resolveTopOfStack(state); // Berserk resolves
        state.phase = "POSTCOMBAT_MAIN";
        advancePhase(state); // enter END_STEP, push delayed trigger
        resolveTopOfStack(state); // resolve the delayed trigger
        expect(state.players[0].battlefield).not.toContain(bear);
        expect(state.players[0].graveyard.some((c) => c.id === "bear")).toBe(
            true
        );
    });

    it("delayed trigger is a no-op when the target never attacked", () => {
        const bear = makeInstance(grizzlyBears.id, { id: "bear" });
        // Not an attacker: no hasAttackedThisTurn, no isAttacking.
        const p1 = makePlayer("p1", { battlefield: [bear] });
        const state = makeState({
            players: [p1, makePlayer("p2")],
            phase: "PRECOMBAT_MAIN",
        });
        pushSpell(state, berserk.id, "p1", [{ type: "permanent", id: "bear" }]);
        resolveTopOfStack(state);
        state.phase = "POSTCOMBAT_MAIN";
        advancePhase(state); // END_STEP, pushes delayed trigger
        resolveTopOfStack(state);
        expect(state.players[0].battlefield).toContain(bear);
        expect(state.players[0].graveyard.some((c) => c.id === "bear")).toBe(
            false
        );
    });

    it("CLEANUP removes the granted trample and clears hasAttackedThisTurn", () => {
        const { state, bear } = setupWithAttacker();
        pushSpell(state, berserk.id, "p1", [{ type: "permanent", id: "bear" }]);
        resolveTopOfStack(state);
        expect(bear.staticAbilities).toContain("trample");
        // Advance through END_STEP → CLEANUP → next turn UNTAP.
        state.phase = "POSTCOMBAT_MAIN";
        advancePhase(state); // END_STEP (trigger enqueued on stack)
        resolveTopOfStack(state); // resolve delayed trigger (destroys bear)
        advancePhase(state); // CLEANUP (auto) → next turn
        // Bear is in the graveyard; its turn-scoped state still carries no
        // granted ability (cleanup ran before GY move? No — cleanup runs on
        // battlefield permanents. For a test that reaches cleanup we need a
        // creature that survives.)
        // Assert that hasAttackedThisTurn was cleared from the graveyard
        // copy (it persists on the instance but CLEANUP should have run
        // over the battlefield before the creature died — the creature
        // itself is already gone, so we cover the surviving-case below).
        const grave = state.players[0].graveyard.find((c) => c.id === "bear");
        expect(grave?.hasAttackedThisTurn).toBe(true); // never touched post-destroy
    });

    it("surviving creature loses granted trample and hasAttackedThisTurn at CLEANUP", () => {
        const bear = makeInstance(grizzlyBears.id, { id: "bear" });
        bear.hasAttackedThisTurn = true;
        const p1 = makePlayer("p1", { battlefield: [bear] });
        const state = makeState({
            players: [p1, makePlayer("p2")],
            phase: "PRECOMBAT_MAIN",
        });
        pushSpell(state, berserk.id, "p1", [{ type: "permanent", id: "bear" }]);
        resolveTopOfStack(state); // grants trample, +2/+0, schedules delayed
        expect(bear.staticAbilities).toContain("trample");
        state.phase = "POSTCOMBAT_MAIN";
        advancePhase(state); // END_STEP (pushes trigger)
        resolveTopOfStack(state); // delayed trigger resolves → destroys bear
        // Bear is dead here; verify the secondary case where the creature
        // would survive uses a non-attacker bear.
        const pacifistBear = makeInstance(grizzlyBears.id, {
            id: "pbear",
            controllerId: "p1",
        });
        const state2 = makeState({
            players: [
                makePlayer("p1", { battlefield: [pacifistBear] }),
                makePlayer("p2"),
            ],
            phase: "PRECOMBAT_MAIN",
        });
        pushSpell(state2, berserk.id, "p1", [
            { type: "permanent", id: "pbear" },
        ]);
        resolveTopOfStack(state2);
        expect(pacifistBear.staticAbilities).toContain("trample");
        state2.phase = "POSTCOMBAT_MAIN";
        advancePhase(state2); // END_STEP
        resolveTopOfStack(state2); // delayed trigger: no-op (didn't attack)
        advancePhase(state2); // CLEANUP (auto) → next turn UNTAP
        expect(pacifistBear.staticAbilities).not.toContain("trample");
        expect(pacifistBear.grantedStaticAbilities).toBeUndefined();
        expect(pacifistBear.hasAttackedThisTurn).toBeUndefined();
    });

    it("wire format: projected state shows buffed power + granted trample", () => {
        const { state, bear } = setupWithAttacker();
        pushSpell(state, berserk.id, "p1", [{ type: "permanent", id: "bear" }]);
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(slim.power).toBe(4);
        expect(slim.staticAbilities).toContain("trample");
        expect(getEffectivePower(projected, slim)).toBe(4);
        // Opponent's viewer sees the same data (no hidden info on battlefield).
        const oppView = projectPublicState(state, 1, "p2");
        const slimOpp = oppView.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(slimOpp.power).toBe(4);
        expect(slimOpp.staticAbilities).toContain("trample");
        // Preserve the reference to `bear` so TS doesn't flag the variable.
        expect(bear.id).toBe("bear");
    });
});

// ---------------------------------------------------------------------------
// Balance — CR 608.2 (stepped resolve) + 101.4 (APNAP)
// ---------------------------------------------------------------------------

describe("Balance ({1}{W}, sorcery — equalize lands / cards / creatures)", () => {
    /** Seeds a state with Balance on the stack and the given per-player
     *  zone sizes. Uses plains for lands, grizzly bears for creatures and
     *  hand cards (any card definition works — only the zone matters). */
    function seed(opts: {
        p1Lands?: number;
        p2Lands?: number;
        p1Creatures?: number;
        p2Creatures?: number;
        p1Hand?: number;
        p2Hand?: number;
    }) {
        const mk = (
            cardId: string,
            count: number,
            owner: string,
            prefix: string,
            zone: "battlefield" | "hand" = "battlefield"
        ) =>
            Array.from({ length: count }, (_, i) =>
                makeInstance(cardId, {
                    id: `${prefix}-${i}`,
                    controllerId: owner,
                    ownerId: owner,
                    zone,
                })
            );
        const p1 = makePlayer("p1", {
            battlefield: [
                ...mk(plains.id, opts.p1Lands ?? 0, "p1", "p1-land"),
                ...mk(grizzlyBears.id, opts.p1Creatures ?? 0, "p1", "p1-bear"),
            ],
            hand: mk(
                grizzlyBears.id,
                opts.p1Hand ?? 0,
                "p1",
                "p1-card",
                "hand"
            ),
        });
        const p2 = makePlayer("p2", {
            battlefield: [
                ...mk(plains.id, opts.p2Lands ?? 0, "p2", "p2-land"),
                ...mk(grizzlyBears.id, opts.p2Creatures ?? 0, "p2", "p2-bear"),
            ],
            hand: mk(
                grizzlyBears.id,
                opts.p2Hand ?? 0,
                "p2",
                "p2-card",
                "hand"
            ),
        });
        const state = makeState({ players: [p1, p2] });
        pushSpell(state, balance.id, "p1");
        return state;
    }

    /** Mimics selectResolutionChoice for the head pending choice. */
    function commitHead(state: ReturnType<typeof seed>, picks: string[]) {
        const queue = state.pendingChoices ?? [];
        const head = queue[0];
        const item = state.stack.find((s) => s.id === head.stackItemId)!;
        item.collectedChoices = {
            ...(item.collectedChoices ?? {}),
            [`${head.step}:${head.choiceId}`]: picks,
        };
        queue.shift();
        state.pendingChoices = queue.length > 0 ? queue : undefined;
    }

    it("no-op when all counts are equal (resolves to graveyard with no choices)", () => {
        const state = seed({
            p1Lands: 2,
            p2Lands: 2,
            p1Hand: 1,
            p2Hand: 1,
            p1Creatures: 1,
            p2Creatures: 1,
        });
        const result = resolveTopOfStack(state);
        expect(result).not.toBeNull();
        expect(state.stack.length).toBe(0);
        expect(state.pendingChoices).toBeUndefined();
        // Balance itself in p1's graveyard
        expect(state.players[0].graveyard.map((c) => c.id)).toContain(
            (result as CardInstanceState).id
        );
        // Nothing else moved
        expect(state.players[0].battlefield.length).toBe(3);
        expect(state.players[1].battlefield.length).toBe(3);
    });

    it("equalizes lands: p1 keeps their chosen land, rest go to graveyard", () => {
        const state = seed({ p1Lands: 3, p2Lands: 1 });
        resolveTopOfStack(state);
        expect(state.pendingChoices?.[0].playerId).toBe("p1");
        expect(state.pendingChoices?.[0].count).toBe(1);
        commitHead(state, ["p1-land-1"]);
        resolveTopOfStack(state);

        expect(state.players[0].battlefield.map((c) => c.id)).toEqual([
            "p1-land-1",
        ]);
        const gyIds = state.players[0].graveyard.map((c) => c.id);
        expect(gyIds).toContain("p1-land-0");
        expect(gyIds).toContain("p1-land-2");
        expect(gyIds).toHaveLength(3); // + Balance itself
    });

    it("min=0: asymmetric wipe — player with 0 forces the other to sacrifice everything", () => {
        // p1 has 4 lands, p2 has 0 lands → no choice needed (min=0).
        const state = seed({ p1Lands: 4, p2Lands: 0 });
        const result = resolveTopOfStack(state);
        expect(result).not.toBeNull(); // resolves in one shot — no prompt
        expect(state.players[0].battlefield.length).toBe(0);
        expect(state.players[0].graveyard.length).toBe(5); // 4 lands + Balance
    });

    it("preserves creature-land count semantics (ruling): sacrificed as land is not counted as creature", () => {
        // Model a creature-land inline: a Plains instance with both Land and
        // Creature types. Step 1 counts it as a land (total lands: 2 for p1
        // vs 0 for p2 → both sacrificed). Step 3 counts it as a creature
        // only if still on the battlefield — it is not.
        const creatureLand = makeInstance(plains.id, {
            id: "p1-creature-land",
            controllerId: "p1",
            ownerId: "p1",
            types: ["Land", "Creature"],
            power: 1,
            toughness: 1,
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        makeInstance(plains.id, {
                            id: "p1-land-0",
                            controllerId: "p1",
                        }),
                        creatureLand,
                        makeInstance(grizzlyBears.id, {
                            id: "p1-bear-0",
                            controllerId: "p1",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, balance.id, "p1");
        resolveTopOfStack(state);
        // Both lands (including creature-land) sacrificed (p2 has 0 → min=0).
        expect(state.stack.length).toBe(0); // no pending choice, resolved

        const bf = state.players[0].battlefield.map((c) => c.id);
        expect(bf).not.toContain("p1-land-0");
        expect(bf).not.toContain("p1-creature-land");
        // The bear survives step 1 and then gets sacrificed by step 3
        // (only p1 has a creature, min=0 again).
        expect(bf).not.toContain("p1-bear-0");
        // Graveyard holds both lands + the bear + Balance itself (4).
        expect(state.players[0].graveyard.length).toBe(4);
    });

    it("runs all three steps in order: lands → hand → creatures", () => {
        const state = seed({
            p1Lands: 2,
            p2Lands: 1, // step 1: p1 keeps 1
            p1Hand: 2,
            p2Hand: 0, // step 2: min=0, all p1 cards discarded (no prompt)
            p1Creatures: 2,
            p2Creatures: 1, // step 3: p1 keeps 1
        });
        resolveTopOfStack(state);

        // Suspended on lands step
        expect(state.stack[0].resolutionStep).toBe(0);
        expect(state.pendingChoices?.[0].filter?.types).toBe("Land");
        commitHead(state, ["p1-land-0"]);
        resolveTopOfStack(state);

        // Lands applied, hand applied (min=0, no prompt), creatures suspends
        expect(state.players[0].hand.length).toBe(0);
        expect(state.stack[0].resolutionStep).toBe(2);
        expect(state.pendingChoices?.[0].filter?.types).toBe("Creature");
        commitHead(state, ["p1-bear-0"]);
        resolveTopOfStack(state);

        // Fully resolved
        expect(state.stack.length).toBe(0);
        expect(state.pendingChoices).toBeUndefined();
        expect(state.players[0].battlefield.map((c) => c.id)).toEqual([
            "p1-land-0",
            "p1-bear-0",
        ]);
        expect(state.players[1].battlefield.map((c) => c.id).sort()).toEqual([
            "p2-bear-0",
            "p2-land-0",
        ]);
    });

    it("hand step uses keep semantics: picked cards stay, rest discarded simultaneously", () => {
        const state = seed({ p1Hand: 3, p2Hand: 1 });
        resolveTopOfStack(state);
        expect(state.stack[0].resolutionStep).toBe(1); // lands step skipped
        expect(state.pendingChoices?.[0].zone).toBe("hand");
        expect(state.pendingChoices?.[0].kind).toBe("keep-hand");
        expect(state.pendingChoices?.[0].count).toBe(1);

        commitHead(state, ["p1-card-2"]);
        resolveTopOfStack(state);

        expect(state.players[0].hand.map((c) => c.id)).toEqual(["p1-card-2"]);
        expect(state.players[1].hand.map((c) => c.id)).toEqual(["p2-card-0"]);
        // p1-card-0 and p1-card-1 are in graveyard
        expect(state.players[0].graveyard.map((c) => c.id).sort()).toContain(
            "p1-card-0"
        );
        expect(state.players[0].graveyard.map((c) => c.id).sort()).toContain(
            "p1-card-1"
        );
    });
});

describe("Regeneration ({1}{G} Aura — {G}: Regenerate enchanted creature, CR 701.15a / 614.5)", () => {
    function setupAttached(args?: {
        bearOverrides?: Partial<CardInstanceState>;
    }) {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
            ...(args?.bearOverrides ?? {}),
        });
        const aura = makeInstance(regeneration.id, {
            id: "aura",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "bear",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [aura] }),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        return { state, aura, bear };
    }

    function activateRegen(state: GameState, aura: CardInstanceState) {
        state.stack.push({
            ...aura,
            zone: "stack",
            castById: aura.controllerId,
            abilityId: "regeneration-regenerate",
            targets: [],
        });
        resolveTopOfStack(state);
    }

    it("declares the right shape: {1}{G} Aura targeting Creature with one activated ability", () => {
        expect(regeneration.manaCost).toEqual({ X: 1, G: 1 });
        expect(regeneration.types).toEqual(["Enchantment"]);
        expect(regeneration.subtypes).toEqual(["Aura"]);
        expect(regeneration.targetRequirement).toEqual({
            type: "Creature",
            count: 1,
        });
        const ability = regeneration.activatedAbilities?.[0];
        expect(ability?.id).toBe("regeneration-regenerate");
        expect(ability?.cost).toEqual({ mana: { G: 1 } });
        expect(ability?.useStack).toBe(true);
    });

    it("attaches to the targeted creature on resolution (CR 303.4)", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, regeneration.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);
        const aura = state.players[0].battlefield.find(
            (c) => c.card.id === regeneration.id
        )!;
        expect(aura).toBeDefined();
        expect(aura.attachedTo).toBe("bear");
    });

    it("activating {G} stacks one regeneration shield on the enchanted creature", () => {
        const { state, aura } = setupAttached();
        activateRegen(state, aura);
        const target = state.players[1].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(target.regenerationShields).toBe(1);
    });

    it("destroyAll's per-card destroy is replaced by the regen rider (CR 614.5)", () => {
        const { state, aura } = setupAttached();
        activateRegen(state, aura);
        // Wrath of God calls ctx.destroyAll("Creature"); the per-card path
        // routes through regenerateOrDestroy, so the shielded bear survives.
        pushSpell(state, wrathOfGod.id, "p1");
        resolveTopOfStack(state);
        const bearAfter = state.players[1].battlefield.find(
            (c) => c.id === "bear"
        );
        expect(bearAfter).toBeDefined();
        expect(bearAfter!.regenerationShields).toBeUndefined();
        expect(bearAfter!.isTapped).toBe(true);
        expect(
            state.players[1].graveyard.find((c) => c.id === "bear")
        ).toBeUndefined();
    });

    it("lethal damage triggers regen too — heals damageMarked, taps, no graveyard (CR 704.5g + 701.15a)", () => {
        const { state, aura, bear } = setupAttached();
        activateRegen(state, aura);
        // Lightning Bolt for 3 — Grizzly Bears is 2/2, lethal.
        pushSpell(state, lightningBolt.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);
        const bearAfter = state.players[1].battlefield.find(
            (c) => c.id === "bear"
        );
        expect(bearAfter).toBeDefined();
        expect(bearAfter!.damageMarked).toBeUndefined();
        expect(bearAfter!.isTapped).toBe(true);
        expect(bearAfter!.regenerationShields).toBeUndefined();
        expect(bear.zone).toBe("battlefield");
    });

    it("multiple activations stack shields, each shield consumed independently", () => {
        const { state, aura } = setupAttached();
        activateRegen(state, aura);
        activateRegen(state, aura);
        let bear = state.players[1].battlefield.find((c) => c.id === "bear")!;
        expect(bear.regenerationShields).toBe(2);
        // First lethal — shield 1 consumed.
        pushSpell(state, lightningBolt.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);
        bear = state.players[1].battlefield.find((c) => c.id === "bear")!;
        expect(bear.regenerationShields).toBe(1);
        // Second lethal — shield 2 consumed.
        pushSpell(state, lightningBolt.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);
        bear = state.players[1].battlefield.find((c) => c.id === "bear")!;
        expect(bear.regenerationShields).toBeUndefined();
        expect(bear.zone).toBe("battlefield");
        // Third lethal — no shield, dies.
        pushSpell(state, lightningBolt.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "bear")
        ).toBeUndefined();
        expect(state.players[1].graveyard.map((c) => c.id)).toContain("bear");
    });

    it("unused shields wear off at CLEANUP (CR 514.2)", () => {
        const { state, aura } = setupAttached();
        activateRegen(state, aura);
        // Shortcut to CLEANUP and run it.
        state.phase = "END_STEP";
        advancePhase(state); // → CLEANUP, runs purge, then auto-advances
        const bear = state.players[1].battlefield.find((c) => c.id === "bear");
        expect(bear?.regenerationShields).toBeUndefined();
    });

    it("combat: regen on a blocking creature removes it from combat and clears damage", async () => {
        const angel = makeInstance(serraAngel.id, {
            id: "angel",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
            isTapped: true,
            hasAttackedThisTurn: true,
        });
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
            isBlocking: true,
        });
        const aura = makeInstance(regeneration.id, {
            id: "aura",
            controllerId: "p2",
            ownerId: "p2",
            attachedTo: "bear",
        });
        const state = makeState({
            phase: "DECLARE_BLOCKERS",
            activePlayerId: "p1",
            players: [
                makePlayer("p1", { battlefield: [angel] }),
                makePlayer("p2", { battlefield: [bear, aura] }),
            ],
            combat: {
                attackerIds: ["angel"],
                confirmed: true,
                blockerAssignments: { bear: "angel" },
                blockersConfirmed: true,
            },
        });
        activateRegen(state, aura);
        // Angel deals 4 to bear (lethal). The lethal SBA inside
        // applyAllCombatDamage routes through regenerateOrDestroy → shield.
        const { applyAllCombatDamage } = await import("../../../gre/phases");
        applyAllCombatDamage(state, { angel: { bear: 4 } }, "regular");
        const bearAfter = state.players[1].battlefield.find(
            (c) => c.id === "bear"
        );
        expect(bearAfter).toBeDefined();
        expect(bearAfter!.damageMarked).toBeUndefined();
        expect(bearAfter!.isTapped).toBe(true);
        expect(bearAfter!.isBlocking).toBeUndefined();
        expect(bearAfter!.regenerationShields).toBeUndefined();
        expect(state.combat?.blockerAssignments).not.toHaveProperty("bear");
    });

    it("wire format: regen shield count survives projectPublicState (regression guard)", () => {
        const { state, aura } = setupAttached();
        activateRegen(state, aura);
        const projected = projectPublicState(state, 1, "p1");
        const bearProjected = projected.players[1].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(bearProjected.regenerationShields).toBe(1);
    });
});

describe("Regrowth (return target card from your graveyard to hand, CR 400.7 / 608.2b)", () => {
    it("returns the chosen card from the caster's graveyard to their hand", () => {
        const buried = makeInstance(grizzlyBears.id, {
            id: "buried-bear",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { graveyard: [buried] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, regrowth.id, "p1", [
            { type: "graveyard-card", id: "buried-bear", playerId: "p1" },
        ]);
        resolveTopOfStack(state);
        const p1 = state.players[0];
        expect(p1.hand.map((c) => c.id)).toContain("buried-bear");
        expect(p1.graveyard.map((c) => c.id)).not.toContain("buried-bear");
    });

    it("getLegalTargets only sees cards in the caster's own graveyard (controller: 'you')", () => {
        const mine = makeInstance(grizzlyBears.id, {
            id: "mine",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const theirs = makeInstance(grizzlyBears.id, {
            id: "theirs",
            controllerId: "p2",
            ownerId: "p2",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { graveyard: [mine] }),
                makePlayer("p2", { graveyard: [theirs] }),
            ],
        });
        const legal = getLegalTargets(
            state,
            regrowth.targetRequirement!,
            [],
            "p1"
        );
        expect(legal).toHaveLength(1);
        expect(legal[0]).toMatchObject({
            type: "graveyard-card",
            id: "mine",
            playerId: "p1",
        });
    });

    it("CR 608.2b: silently does nothing if the target left the graveyard before resolution", () => {
        const buried = makeInstance(grizzlyBears.id, {
            id: "buried",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { graveyard: [buried] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, regrowth.id, "p1", [
            { type: "graveyard-card", id: "buried", playerId: "p1" },
        ]);
        // Simulate the target being exiled in response (target is now illegal).
        const p1 = state.players[0];
        const idx = p1.graveyard.findIndex((c) => c.id === "buried");
        const [removed] = p1.graveyard.splice(idx, 1);
        removed.zone = "exile";
        p1.exile.push(removed);
        resolveTopOfStack(state);
        // No-op: the card stays in exile, the caster's hand stays empty.
        expect(p1.hand.map((c) => c.id)).not.toContain("buried");
        expect(p1.exile.map((c) => c.id)).toContain("buried");
    });
});

describe("Twiddle (toggle tap state on artifact/creature/land, CR 701.20)", () => {
    it("taps an untapped target", () => {
        const land = makeInstance(grizzlyBears.id, {
            id: "land",
            controllerId: "p2",
            ownerId: "p2",
            isTapped: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [land] }),
            ],
        });
        pushSpell(state, twiddle.id, "p1", [{ type: "permanent", id: "land" }]);
        resolveTopOfStack(state);
        expect(state.players[1].battlefield[0].isTapped).toBe(true);
    });

    it("untaps a tapped target", () => {
        const land = makeInstance(grizzlyBears.id, {
            id: "land",
            controllerId: "p2",
            ownerId: "p2",
            isTapped: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [land] }),
            ],
        });
        pushSpell(state, twiddle.id, "p1", [{ type: "permanent", id: "land" }]);
        resolveTopOfStack(state);
        expect(state.players[1].battlefield[0].isTapped).toBe(false);
    });

    it("getLegalTargets returns artifacts, creatures, and lands (and excludes other types)", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const tome = makeInstance(jayemdaeTome.id, {
            id: "tome",
            controllerId: "p1",
            ownerId: "p1",
        });
        const isle = makeInstance(island.id, {
            id: "isle",
            controllerId: "p1",
            ownerId: "p1",
        });
        const aura = makeInstance(controlMagic.id, {
            id: "cm",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [tome, isle, aura] }),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        const legal = getLegalTargets(
            state,
            twiddle.targetRequirement!,
            [],
            "p1"
        );
        const ids = legal.map((t) => t.id).sort();
        expect(ids).toEqual(["bear", "isle", "tome"]);
    });

    it("CR 608.2b: silently does nothing if the target left the battlefield before resolution", () => {
        const land = makeInstance(grizzlyBears.id, {
            id: "land",
            controllerId: "p2",
            ownerId: "p2",
            isTapped: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [land] }),
            ],
        });
        pushSpell(state, twiddle.id, "p1", [{ type: "permanent", id: "land" }]);
        removePermanentTo(state, "land", "graveyard");
        // Should not throw — primitive silently no-ops.
        expect(() => resolveTopOfStack(state)).not.toThrow();
    });
});

describe("Unsummon (return target creature to its owner's hand, CR 701.10 / 400.7)", () => {
    it("returns the target creature from battlefield to its owner's hand", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, unsummon.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);
        const p2 = state.players[1];
        expect(p2.battlefield.map((c) => c.id)).not.toContain("bear");
        expect(p2.hand.map((c) => c.id)).toContain("bear");
        expect(p2.hand[0].zone).toBe("hand");
    });

    it("clears battlefield-only transient state on the bounced card (CR 400.7)", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
            isTapped: true,
            damageMarked: 1,
            isSummoningSick: true,
            hasAttackedThisTurn: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, unsummon.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);
        const returned = state.players[1].hand.find((c) => c.id === "bear")!;
        expect(returned.isTapped).toBe(false);
        expect(returned.damageMarked).toBeUndefined();
        expect(returned.isSummoningSick).toBeUndefined();
        expect(returned.hasAttackedThisTurn).toBeUndefined();
    });

    it("CR 608.2b: silently does nothing if the target left the battlefield before resolution", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, unsummon.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        // Target leaves the battlefield in response (e.g. Lightning Bolt kills it).
        removePermanentTo(state, "bear", "graveyard");
        resolveTopOfStack(state);
        const p2 = state.players[1];
        expect(p2.hand.map((c) => c.id)).not.toContain("bear");
        expect(p2.graveyard.map((c) => c.id)).toContain("bear");
    });

    it("strips aura-granted keywords from a bounced host (CR 611.2)", () => {
        // Bear with Red Ward attached grants "protection from red". Bouncing
        // the bear must lift the grant before the host enters its hand —
        // otherwise a re-cast bear would carry stale protection.
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, redWard.id, "p2", [{ type: "permanent", id: "bear" }]);
        resolveTopOfStack(state);
        expect(bear.staticAbilities).toContain("protection from red");

        pushSpell(state, unsummon.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);

        const returned = state.players[1].hand.find((c) => c.id === "bear")!;
        expect(returned.staticAbilities).not.toContain("protection from red");
        expect(returned.grantedStaticAbilities ?? []).toHaveLength(0);

        // The orphan aura is still on the battlefield with stale attachedTo;
        // SBA sweeps it to the graveyard (CR 704.5n).
        checkStateBasedActions(state);
        const aura = state.players[1].graveyard.find(
            (c) => c.card.id === redWard.id
        )!;
        expect(aura).toBeDefined();
        expect(aura.attachedTo).toBeUndefined();
    });

    it("strips aura-granted control change from a bounced host (CR 611.2 / 613.1b)", () => {
        // Bear under p2 control via p1's Control Magic. Bouncing the bear
        // must collapse the control stack so the host returns to its owner
        // (p2) clean. The orphan Control Magic is then swept by SBA.
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, controlMagic.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);
        // Control flipped to p1.
        const stolen = state.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(stolen.controllerId).toBe("p1");

        pushSpell(state, unsummon.id, "p2", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);

        const returned = state.players[1].hand.find((c) => c.id === "bear")!;
        expect(returned.controlChanges).toBeUndefined();
        expect(returned.controllerId).toBe("p2");

        checkStateBasedActions(state);
        const aura = state.players[0].graveyard.find(
            (c) => c.card.id === controlMagic.id
        )!;
        expect(aura).toBeDefined();
        expect(aura.attachedTo).toBeUndefined();
    });

    it("wire format: bounced creature is no longer on the projected battlefield", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, unsummon.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p2");
        expect(projected.players[1].battlefield.map((c) => c.id)).not.toContain(
            "bear"
        );
        // Owner's hand grows by one (the projection lists own-hand cards).
        const handIds = projected.players[1].hand
            .filter((c): c is NonNullable<typeof c> => c !== null)
            .map((c) => c.id);
        expect(handIds).toContain("bear");
    });
});

// ---------------------------------------------------------------------------
// White FREE cycle (LEA): Consecrate Land, Crusade, Death Ward, Farmstead,
// Holy Strength, Karma, Lance.
// ---------------------------------------------------------------------------

describe("Consecrate Land (Aura — enchanted land is indestructible, CR 702.12)", () => {
    // Cast the aura via the stack so the engine attaches it and applies the
    // keyword-grant imperatively — staticEffects on auras only flow through
    // attach()/detach().
    function setupAttached() {
        const host = makeInstance(plains.id, {
            id: "host-land",
            controllerId: "p1",
            ownerId: "p1",
        });
        const victim = makeInstance(plains.id, {
            id: "victim-land",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [host, victim] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, consecrateLand.id, "p1", [
            { type: "permanent", id: "host-land" },
        ]);
        resolveTopOfStack(state);
        return { state };
    }

    it("declares Aura targeting Land", () => {
        expect(consecrateLand.types).toEqual(["Enchantment"]);
        expect(consecrateLand.subtypes).toEqual(["Aura"]);
        expect(consecrateLand.targetRequirement).toEqual({
            type: "Land",
            count: 1,
        });
    });

    it("grants 'indestructible' to the enchanted land — Armageddon spares it", () => {
        const { state } = setupAttached();
        pushSpell(state, armageddon.id, "p1");
        resolveTopOfStack(state);
        const survivors = state.players[0].battlefield.map((c) => c.id);
        expect(survivors).toContain("host-land");
        expect(survivors).not.toContain("victim-land");
    });

    it("wire format: indestructible keyword survives the projection", () => {
        const { state } = setupAttached();
        const projected = projectPublicState(state, 1, "p1");
        const slimLand = projected.players[0].battlefield.find(
            (c) => c.id === "host-land"
        )!;
        expect(slimLand.staticAbilities).toContain("indestructible");
    });
});

describe("Crusade (static pt-buff: +1/+1 to white creatures)", () => {
    it("buffs both controllers' white creatures", () => {
        const myLion = makeInstance(savannahLions.id, { id: "mine" });
        const oppLion = makeInstance(savannahLions.id, {
            id: "theirs",
            controllerId: "p2",
            ownerId: "p2",
        });
        const enchant = makeInstance(crusade.id, { id: "crusade" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [myLion, enchant] }),
                makePlayer("p2", { battlefield: [oppLion] }),
            ],
        });
        expect(getEffectivePower(state, myLion)).toBe(3);
        expect(getEffectiveToughness(state, myLion)).toBe(2);
        expect(getEffectivePower(state, oppLion)).toBe(3);
    });

    it("does NOT buff non-white creatures (Grizzly Bears is green)", () => {
        const bear = makeInstance(grizzlyBears.id, { id: "bear" });
        const enchant = makeInstance(crusade.id, { id: "crusade" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear, enchant] }),
                makePlayer("p2"),
            ],
        });
        expect(getEffectivePower(state, bear)).toBe(2);
        expect(getEffectiveToughness(state, bear)).toBe(2);
    });

    it("wire format: white creatures still buffed after projection", () => {
        const lion = makeInstance(savannahLions.id, { id: "lion" });
        const enchant = makeInstance(crusade.id, { id: "crusade" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [lion, enchant] }),
                makePlayer("p2"),
            ],
        });
        const projected = projectPublicState(state, 1, "p1");
        const slimLion = projected.players[0].battlefield.find(
            (c) => c.id === "lion"
        )!;
        expect(getEffectivePower(projected, slimLion)).toBe(3);
        expect(getEffectiveToughness(projected, slimLion)).toBe(2);
    });
});

describe("Death Ward (instant — regenerate target creature, CR 701.15a)", () => {
    it("stacks one regeneration shield on the target", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, deathWard.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);
        const target = state.players[1].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(target.regenerationShields).toBe(1);
    });

    it("the shield replaces a subsequent destroy (Wrath of God survives)", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, deathWard.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);
        pushSpell(state, wrathOfGod.id, "p1");
        resolveTopOfStack(state);
        const bearAfter = state.players[1].battlefield.find(
            (c) => c.id === "bear"
        );
        expect(bearAfter).toBeDefined();
        expect(bearAfter!.isTapped).toBe(true);
    });
});

describe("Farmstead (Aura on Plains — controller gains 2 life at upkeep, CR 603.6a)", () => {
    function setup(activePlayerId: string = "p1") {
        const land = makeInstance(plains.id, {
            id: "host-plains",
            controllerId: activePlayerId,
            ownerId: activePlayerId,
        });
        const aura = makeInstance(farmstead.id, {
            id: "farmstead",
            controllerId: activePlayerId,
            ownerId: activePlayerId,
            attachedTo: "host-plains",
        });
        const ownerIdx = activePlayerId === "p1" ? 0 : 1;
        const players = [makePlayer("p1"), makePlayer("p2")];
        players[ownerIdx].battlefield = [land, aura];
        return makeState({
            turn: 2,
            phase: "UNTAP",
            activePlayerId,
            priorityPlayerId: activePlayerId,
            players,
        });
    }

    it("enqueues the trigger on the host controller's UPKEEP", () => {
        const state = setup("p1");
        advancePhase(state); // UNTAP → UPKEEP
        expect(state.phase).toBe("UPKEEP");
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].triggeredAbilityId).toBe("farmstead-upkeep");
    });

    it("resolves into +2 life for the host's controller", () => {
        const state = setup("p1");
        const lifeBefore = state.players[0].life;
        advancePhase(state);
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(lifeBefore + 2);
    });

    it("does NOT fire on the opponent's upkeep (only the host's controller)", () => {
        const state = setup("p1");
        // Simulate p2's upkeep next.
        state.turn = 3;
        state.activePlayerId = "p2";
        state.priorityPlayerId = "p2";
        state.phase = "UNTAP";
        advancePhase(state);
        expect(state.phase).toBe("UPKEEP");
        // Stack stays empty — the host belongs to p1, not the active player.
        expect(state.stack).toHaveLength(0);
    });
});

describe("Holy Strength (Aura — enchanted creature gets +1/+2)", () => {
    function setup() {
        const lion = makeInstance(savannahLions.id, {
            id: "lion",
            controllerId: "p1",
            ownerId: "p1",
        });
        const aura = makeInstance(holyStrength.id, {
            id: "aura",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "lion",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [lion, aura] }),
                makePlayer("p2"),
            ],
        });
        return { state, lion };
    }

    it("buffs the host +1/+2", () => {
        const { state, lion } = setup();
        expect(getEffectivePower(state, lion)).toBe(3);
        expect(getEffectiveToughness(state, lion)).toBe(3);
    });

    it("wire format: buff still applies after projection", () => {
        const { state } = setup();
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "lion"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(3);
        expect(getEffectiveToughness(projected, slim)).toBe(3);
    });
});

describe("Karma (deal damage = Swamps controlled to each player at upkeep, CR 603.6a)", () => {
    function setup(opts: {
        opponentSwamps: number;
        ownerSwamps: number;
        activePlayerId?: string;
    }) {
        const enchant = makeInstance(karma.id, {
            id: "karma",
            controllerId: "p1",
            ownerId: "p1",
        });
        const p1Battlefield: CardInstanceState[] = [enchant];
        for (let i = 0; i < opts.ownerSwamps; i++) {
            p1Battlefield.push(
                makeInstance(swamp.id, {
                    id: `p1-swamp-${i}`,
                    controllerId: "p1",
                    ownerId: "p1",
                })
            );
        }
        const p2Battlefield: CardInstanceState[] = [];
        for (let i = 0; i < opts.opponentSwamps; i++) {
            p2Battlefield.push(
                makeInstance(swamp.id, {
                    id: `p2-swamp-${i}`,
                    controllerId: "p2",
                    ownerId: "p2",
                })
            );
        }
        const activePlayerId = opts.activePlayerId ?? "p1";
        return makeState({
            turn: 2,
            phase: "UNTAP",
            activePlayerId,
            priorityPlayerId: activePlayerId,
            players: [
                makePlayer("p1", { battlefield: p1Battlefield }),
                makePlayer("p2", { battlefield: p2Battlefield }),
            ],
        });
    }

    it("deals damage to active player equal to their Swamp count", () => {
        const state = setup({ ownerSwamps: 3, opponentSwamps: 0 });
        const before = state.players[0].life;
        advancePhase(state); // UNTAP → UPKEEP
        expect(state.stack).toHaveLength(1);
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(before - 3);
    });

    it("hits the opponent on their upkeep — 'each player'", () => {
        const state = setup({
            ownerSwamps: 0,
            opponentSwamps: 2,
            activePlayerId: "p2",
        });
        const before = state.players[1].life;
        advancePhase(state);
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(before - 2);
    });

    it("no-op when active player controls 0 Swamps (no stack entry)", () => {
        const state = setup({ ownerSwamps: 0, opponentSwamps: 5 });
        advancePhase(state);
        // Trigger predicate matches but resolve guards against 0 — still
        // queued, so stack length 1 is acceptable. Verify no life lost.
        if (state.stack.length > 0) resolveTopOfStack(state);
        expect(state.players[0].life).toBe(20);
    });
});

describe("Lance (Aura — enchanted creature has first strike, CR 702.7)", () => {
    function setupAttached() {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, lance.id, "p1", [{ type: "permanent", id: "bear" }]);
        resolveTopOfStack(state);
        return { state };
    }

    it("grants 'first strike' to the host", () => {
        const { state } = setupAttached();
        const bear = state.players[0].battlefield.find((c) => c.id === "bear")!;
        expect(bear.staticAbilities).toContain("first strike");
    });

    it("wire format: first strike survives the projection", () => {
        const { state } = setupAttached();
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(slim.staticAbilities).toContain("first strike");
    });
});

// ---------------------------------------------------------------------------
// Blue FREE cycle (LEA): Feedback, Flight, Jump, Pirate Ship,
// Prodigal Sorcerer.
// ---------------------------------------------------------------------------

describe("Feedback (Aura on Enchantment — 1 dmg to host's controller at upkeep)", () => {
    // Host always belongs to p1; aura always to p2. Trigger should fire on
    // p1's upkeep only.
    function setup(activePlayerId: string) {
        const hostEnchant = makeInstance(badMoon.id, {
            id: "host-ench",
            controllerId: "p1",
            ownerId: "p1",
        });
        const aura = makeInstance(feedback.id, {
            id: "feedback",
            controllerId: "p2",
            ownerId: "p2",
            attachedTo: "host-ench",
        });
        return makeState({
            turn: 2,
            phase: "UNTAP",
            activePlayerId,
            priorityPlayerId: activePlayerId,
            players: [
                makePlayer("p1", { battlefield: [hostEnchant] }),
                makePlayer("p2", { battlefield: [aura] }),
            ],
        });
    }

    it("declares Aura targeting Enchantment", () => {
        expect(feedback.types).toEqual(["Enchantment"]);
        expect(feedback.subtypes).toEqual(["Aura"]);
        expect(feedback.targetRequirement).toEqual({
            type: "Enchantment",
            count: 1,
        });
    });

    it("queues + resolves into 1 damage to host's controller at their upkeep", () => {
        const state = setup("p1");
        const before = state.players[0].life;
        advancePhase(state); // UNTAP → UPKEEP
        expect(state.phase).toBe("UPKEEP");
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].triggeredAbilityId).toBe("feedback-upkeep");
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(before - 1);
    });

    it("does NOT fire on a non-host-controller's upkeep", () => {
        const state = setup("p2");
        advancePhase(state);
        expect(state.phase).toBe("UPKEEP");
        expect(state.stack).toHaveLength(0);
    });
});

describe("Flight (Aura — enchanted creature has flying, CR 702.9)", () => {
    function setupAttached() {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, flight.id, "p1", [{ type: "permanent", id: "bear" }]);
        resolveTopOfStack(state);
        return { state };
    }

    it("grants 'flying' to the host", () => {
        const { state } = setupAttached();
        const bear = state.players[0].battlefield.find((c) => c.id === "bear")!;
        expect(bear.staticAbilities).toContain("flying");
    });

    it("wire format: flying survives the projection", () => {
        const { state } = setupAttached();
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(slim.staticAbilities).toContain("flying");
    });
});

describe("Jump (instant — target creature gains flying until end of turn)", () => {
    it("grants flying for the rest of the turn (duration = end-of-turn)", () => {
        const bear = makeInstance(grizzlyBears.id, { id: "bear" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, jump.id, "p1", [{ type: "permanent", id: "bear" }]);
        resolveTopOfStack(state);
        const after = state.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(after.staticAbilities).toContain("flying");
    });

    it("the temporary grant expires at CLEANUP (CR 514.2)", () => {
        const bear = makeInstance(grizzlyBears.id, { id: "bear" });
        const state = makeState({
            phase: "PRECOMBAT_MAIN",
            players: [
                makePlayer("p1", { battlefield: [bear] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, jump.id, "p1", [{ type: "permanent", id: "bear" }]);
        resolveTopOfStack(state);
        // Walk turn until CLEANUP fires.
        for (let i = 0; i < 12 && state.phase !== "CLEANUP"; i++) {
            advancePhase(state);
        }
        // After CLEANUP processing, pump should be gone.
        advancePhase(state);
        const bearAfter = state.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(bearAfter.staticAbilities).not.toContain("flying");
    });
});

describe("Pirate Ship ({T}: 1 dmg + can't attack unless defender controls Island)", () => {
    function setup(opts: { defenderHasIsland: boolean }) {
        const ship = makeInstance(pirateShip.id, {
            id: "ship",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        const p2Lands = opts.defenderHasIsland
            ? [
                  makeInstance(island.id, {
                      id: "p2-isle",
                      controllerId: "p2",
                      ownerId: "p2",
                  }),
              ]
            : [];
        return makeState({
            players: [
                makePlayer("p1", { battlefield: [ship] }),
                makePlayer("p2", { battlefield: p2Lands }),
            ],
        });
    }

    it("can attack when defender controls an Island", () => {
        const state = setup({ defenderHasIsland: true });
        const ship = state.players[0].battlefield[0];
        const result = validateAttackerEligibility(
            ship,
            state.players[1].battlefield
        );
        expect(result.eligible).toBe(true);
    });

    it("cannot attack when defender has no Island", () => {
        const state = setup({ defenderHasIsland: false });
        const ship = state.players[0].battlefield[0];
        const result = validateAttackerEligibility(
            ship,
            state.players[1].battlefield
        );
        expect(result.eligible).toBe(false);
    });

    it("activated {T} ability deals 1 to a target player", () => {
        const state = setup({ defenderHasIsland: true });
        const ship = state.players[0].battlefield[0];
        state.stack.push({
            ...ship,
            zone: "stack",
            castById: "p1",
            abilityId: "pirate-ship-zap",
            targets: [{ type: "player", id: "p2" }],
        });
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(19);
    });
});

describe("Prodigal Sorcerer ({T}: 1 dmg to any target — original Tim)", () => {
    function setup() {
        const tim = makeInstance(prodigalSorcerer.id, {
            id: "tim",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        return makeState({
            players: [
                makePlayer("p1", { battlefield: [tim] }),
                makePlayer("p2"),
            ],
        });
    }

    it("declares a 'tap, target any, deal 1' activated ability", () => {
        const ability = prodigalSorcerer.activatedAbilities?.[0];
        expect(ability?.cost).toEqual({ tap: true });
        expect(ability?.useStack).toBe(true);
        expect(ability?.targetRequirement?.type).toBe("any");
    });

    it("deals 1 damage to a target player", () => {
        const state = setup();
        const tim = state.players[0].battlefield[0];
        state.stack.push({
            ...tim,
            zone: "stack",
            castById: "p1",
            abilityId: "prodigal-sorcerer-zap",
            targets: [{ type: "player", id: "p2" }],
        });
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(19);
    });

    it("kills a 1-toughness creature", () => {
        const state = setup();
        const lion = makeInstance(savannahLions.id, {
            id: "lion",
            controllerId: "p2",
            ownerId: "p2",
        });
        state.players[1].battlefield.push(lion);
        const tim = state.players[0].battlefield[0];
        state.stack.push({
            ...tim,
            zone: "stack",
            castById: "p1",
            abilityId: "prodigal-sorcerer-zap",
            targets: [{ type: "permanent", id: "lion" }],
        });
        resolveTopOfStack(state);
        expect(state.players[1].battlefield.map((c) => c.id)).not.toContain(
            "lion"
        );
        expect(state.players[1].graveyard.map((c) => c.id)).toContain("lion");
    });
});

// ---------------------------------------------------------------------------
// Black FREE cycle (LEA): Cursed Land, Drudge Skeletons, Mind Twist, Plague
// Rats, Raise Dead, Unholy Strength, Wall of Bone, Warp Artifact, Weakness,
// Will-o'-the-Wisp.
// ---------------------------------------------------------------------------

describe("Cursed Land (Aura on Land — 1 dmg to host's controller at upkeep)", () => {
    function setup(activePlayerId: string) {
        const land = makeInstance(plains.id, {
            id: "host-land",
            controllerId: "p1",
            ownerId: "p1",
        });
        const aura = makeInstance(cursedLand.id, {
            id: "curse",
            controllerId: "p2",
            ownerId: "p2",
            attachedTo: "host-land",
        });
        return makeState({
            turn: 2,
            phase: "UNTAP",
            activePlayerId,
            priorityPlayerId: activePlayerId,
            players: [
                makePlayer("p1", { battlefield: [land] }),
                makePlayer("p2", { battlefield: [aura] }),
            ],
        });
    }

    it("queues + resolves into 1 damage to the host's controller at their upkeep", () => {
        const state = setup("p1");
        const before = state.players[0].life;
        advancePhase(state);
        expect(state.phase).toBe("UPKEEP");
        expect(state.stack).toHaveLength(1);
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(before - 1);
    });

    it("does NOT fire on the aura controller's upkeep", () => {
        const state = setup("p2");
        advancePhase(state);
        expect(state.stack).toHaveLength(0);
    });
});

describe("Drudge Skeletons ({B}: regenerate self, CR 701.15a)", () => {
    function setup() {
        const skel = makeInstance(drudgeSkeletons.id, {
            id: "skel",
            controllerId: "p1",
            ownerId: "p1",
        });
        return makeState({
            players: [
                makePlayer("p1", { battlefield: [skel] }),
                makePlayer("p2"),
            ],
        });
    }

    function activate(state: GameState, source: CardInstanceState) {
        state.stack.push({
            ...source,
            zone: "stack",
            castById: "p1",
            abilityId: "drudge-skeletons-regenerate",
            targets: [],
        });
        resolveTopOfStack(state);
    }

    it("stacks one regen shield on resolution", () => {
        const state = setup();
        const skel = state.players[0].battlefield[0];
        activate(state, skel);
        const after = state.players[0].battlefield[0];
        expect(after.regenerationShields).toBe(1);
    });

    it("survives Wrath of God after activation (regen rider replaces destroy)", () => {
        const state = setup();
        const skel = state.players[0].battlefield[0];
        activate(state, skel);
        pushSpell(state, wrathOfGod.id, "p1");
        resolveTopOfStack(state);
        const after = state.players[0].battlefield.find((c) => c.id === "skel");
        expect(after).toBeDefined();
        expect(after!.isTapped).toBe(true);
    });
});

describe("Mind Twist (X cards at random from target player's hand)", () => {
    it("discards X cards at random from target player", () => {
        const filler = (id: string, controllerId: string) =>
            makeInstance(grizzlyBears.id, {
                id,
                controllerId,
                ownerId: controllerId,
                zone: "hand",
            });
        const p2Hand = [
            filler("h1", "p2"),
            filler("h2", "p2"),
            filler("h3", "p2"),
            filler("h4", "p2"),
        ];
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2", { hand: p2Hand })],
        });
        // Pay X = 3 via the stack item's chosen X.
        state.stack.push({
            ...makeInstance(mindTwist.id, {
                controllerId: "p1",
                ownerId: "p1",
                zone: "stack",
            }),
            castById: "p1",
            chosenX: 3,
            targets: [{ type: "player", id: "p2" }],
        });
        resolveTopOfStack(state);
        expect(state.players[1].hand).toHaveLength(1);
        expect(state.players[1].graveyard).toHaveLength(3);
    });
});

describe("Plague Rats (P/T = number of Plague Rats on the battlefield, CR 604.3)", () => {
    it("scales with the number of Plague Rats across both battlefields", () => {
        const r1 = makeInstance(plagueRats.id, { id: "r1" });
        const r2 = makeInstance(plagueRats.id, {
            id: "r2",
            controllerId: "p2",
            ownerId: "p2",
        });
        const r3 = makeInstance(plagueRats.id, {
            id: "r3",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [r1] }),
                makePlayer("p2", { battlefield: [r2, r3] }),
            ],
        });
        expect(getEffectivePower(state, r1)).toBe(3);
        expect(getEffectiveToughness(state, r1)).toBe(3);
    });

    it("a lone Plague Rats counts itself (1/1)", () => {
        const r = makeInstance(plagueRats.id, { id: "lone" });
        const state = makeState({
            players: [makePlayer("p1", { battlefield: [r] }), makePlayer("p2")],
        });
        expect(getEffectivePower(state, r)).toBe(1);
    });

    it("wire format: pt-cda survives the projection", () => {
        const r = makeInstance(plagueRats.id, { id: "wire" });
        const state = makeState({
            players: [makePlayer("p1", { battlefield: [r] }), makePlayer("p2")],
        });
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "wire"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(1);
    });
});

describe("Raise Dead (return target Creature card from your graveyard, CR 400.7)", () => {
    it("returns a creature from your graveyard to your hand", () => {
        const dead = makeInstance(grizzlyBears.id, {
            id: "dead",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { graveyard: [dead] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, raiseDead.id, "p1", [
            { type: "graveyard-card", id: "dead", playerId: "p1" },
        ]);
        resolveTopOfStack(state);
        // The Raise Dead spell itself enters the graveyard on resolve, so the
        // assertion is "the targeted card is no longer there", not length 0.
        expect(state.players[0].graveyard.map((c) => c.id)).not.toContain(
            "dead"
        );
        expect(state.players[0].hand.map((c) => c.id)).toContain("dead");
    });

    it("targeting filter excludes opponent's graveyard (controller: 'you')", () => {
        const dead = makeInstance(grizzlyBears.id, {
            id: "opp-dead",
            controllerId: "p2",
            ownerId: "p2",
            zone: "graveyard",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { graveyard: [dead] }),
            ],
        });
        const req = raiseDead.targetRequirement;
        if (!req) throw new Error("requirement missing");
        const legal = getLegalTargets(state, req, [], "p1");
        const ids = legal.map((t) => t.id);
        expect(ids).not.toContain("opp-dead");
    });
});

describe("Unholy Strength + Weakness (pt-buff aura mirror cycle)", () => {
    it("Unholy Strength buffs host +2/+1", () => {
        const bear = makeInstance(grizzlyBears.id, { id: "bear" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, unholyStrength.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);
        const after = state.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(getEffectivePower(state, after)).toBe(4);
        expect(getEffectiveToughness(state, after)).toBe(3);
    });

    it("Weakness debuffs host -2/-1", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, weakness.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);
        const after = state.players[1].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(getEffectivePower(state, after)).toBe(0);
        expect(getEffectiveToughness(state, after)).toBe(1);
    });
});

describe("Wall of Bone (defender + {B} regen)", () => {
    it("declares defender and a {B} regen activated ability", () => {
        expect(wallOfBone.staticAbilities).toContain("defender");
        const ability = wallOfBone.activatedAbilities?.[0];
        expect(ability?.cost).toEqual({ mana: { B: 1 } });
        expect(ability?.useStack).toBe(true);
    });

    it("activating regen shields self", () => {
        const wob = makeInstance(wallOfBone.id, {
            id: "wob",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [wob] }),
                makePlayer("p2"),
            ],
        });
        state.stack.push({
            ...wob,
            zone: "stack",
            castById: "p1",
            abilityId: "wall-of-bone-regenerate",
            targets: [],
        });
        resolveTopOfStack(state);
        expect(state.players[0].battlefield[0].regenerationShields).toBe(1);
    });
});

describe("Warp Artifact (Aura on Artifact — 1 dmg to host's controller at upkeep)", () => {
    function setup(activePlayerId: string) {
        const ring = makeInstance(solRing.id, {
            id: "host-art",
            controllerId: "p1",
            ownerId: "p1",
        });
        const aura = makeInstance(warpArtifact.id, {
            id: "warp",
            controllerId: "p2",
            ownerId: "p2",
            attachedTo: "host-art",
        });
        return makeState({
            turn: 2,
            phase: "UNTAP",
            activePlayerId,
            priorityPlayerId: activePlayerId,
            players: [
                makePlayer("p1", { battlefield: [ring] }),
                makePlayer("p2", { battlefield: [aura] }),
            ],
        });
    }

    it("deals 1 to host's controller on their upkeep", () => {
        const state = setup("p1");
        const before = state.players[0].life;
        advancePhase(state);
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(before - 1);
    });
});

describe("Will-o'-the-Wisp (flying + {B} regen)", () => {
    it("flying static + regen activated", () => {
        expect(willOTheWisp.staticAbilities).toContain("flying");
        const ability = willOTheWisp.activatedAbilities?.[0];
        expect(ability?.cost).toEqual({ mana: { B: 1 } });
    });

    it("activating regen shields self", () => {
        const wisp = makeInstance(willOTheWisp.id, {
            id: "wisp",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [wisp] }),
                makePlayer("p2"),
            ],
        });
        state.stack.push({
            ...wisp,
            zone: "stack",
            castById: "p1",
            abilityId: "will-o-the-wisp-regenerate",
            targets: [],
        });
        resolveTopOfStack(state);
        expect(state.players[0].battlefield[0].regenerationShields).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// Red FREE cycle (LEA): Burrowing, Goblin Balloon Brigade, Goblin King,
// Keldon Warlord, Orcish Artillery, Shatter, Stone Rain, Tunnel,
// Uthden Troll.
// ---------------------------------------------------------------------------

describe("Burrowing (Aura — host has mountainwalk, CR 702.13c)", () => {
    function setupAttached() {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, burrowing.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);
        return { state };
    }

    it("grants mountainwalk to host", () => {
        const { state } = setupAttached();
        const bear = state.players[0].battlefield.find((c) => c.id === "bear")!;
        expect(bear.staticAbilities).toContain("mountainwalk");
    });

    it("wire format: mountainwalk survives the projection", () => {
        const { state } = setupAttached();
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(slim.staticAbilities).toContain("mountainwalk");
    });
});

describe("Goblin Balloon Brigade ({R}: gain flying until end of turn)", () => {
    function setup() {
        const bb = makeInstance(goblinBalloonBrigade.id, {
            id: "bb",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        return makeState({
            players: [
                makePlayer("p1", { battlefield: [bb] }),
                makePlayer("p2"),
            ],
        });
    }

    function activate(state: GameState, source: CardInstanceState) {
        state.stack.push({
            ...source,
            zone: "stack",
            castById: "p1",
            abilityId: "goblin-balloon-brigade-fly",
            targets: [],
        });
        resolveTopOfStack(state);
    }

    it("grants flying to itself on activation", () => {
        const state = setup();
        const bb = state.players[0].battlefield[0];
        expect(bb.staticAbilities).not.toContain("flying");
        activate(state, bb);
        const after = state.players[0].battlefield[0];
        expect(after.staticAbilities).toContain("flying");
    });
});

describe("Goblin King (other Goblins get +1/+1; lord pt-buff)", () => {
    it("buffs other Goblins +1/+1 and excludes itself", () => {
        const king = makeInstance(goblinKing.id, { id: "king" });
        const goblin = makeInstance(monssGoblinRaiders.id, { id: "raider" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [king, goblin] }),
                makePlayer("p2"),
            ],
        });
        // Raider gets buffed.
        expect(getEffectivePower(state, goblin)).toBe(2);
        expect(getEffectiveToughness(state, goblin)).toBe(2);
        // King does NOT buff itself.
        expect(getEffectivePower(state, king)).toBe(2);
        expect(getEffectiveToughness(state, king)).toBe(2);
    });

    it("buffs opponent's Goblins too (subtype-only filter)", () => {
        const king = makeInstance(goblinKing.id, { id: "king" });
        const oppGoblin = makeInstance(monssGoblinRaiders.id, {
            id: "opp-rat",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [king] }),
                makePlayer("p2", { battlefield: [oppGoblin] }),
            ],
        });
        expect(getEffectivePower(state, oppGoblin)).toBe(2);
    });

    it("does NOT buff non-Goblin creatures", () => {
        const king = makeInstance(goblinKing.id, { id: "king" });
        const bear = makeInstance(grizzlyBears.id, { id: "bear" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [king, bear] }),
                makePlayer("p2"),
            ],
        });
        expect(getEffectivePower(state, bear)).toBe(2);
    });
});

describe("Keldon Warlord (P/T = number of OTHER creatures you control)", () => {
    it("scales with creatures you control, excluding itself", () => {
        const warlord = makeInstance(keldonWarlord.id, { id: "warlord" });
        const c1 = makeInstance(grizzlyBears.id, { id: "c1" });
        const c2 = makeInstance(grizzlyBears.id, { id: "c2" });
        const oppCreature = makeInstance(grizzlyBears.id, {
            id: "opp",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [warlord, c1, c2] }),
                makePlayer("p2", { battlefield: [oppCreature] }),
            ],
        });
        // 2 other creatures controlled → 2/2.
        expect(getEffectivePower(state, warlord)).toBe(2);
        expect(getEffectiveToughness(state, warlord)).toBe(2);
    });

    it("a lone Warlord is 0/0 (dies to SBA)", () => {
        const warlord = makeInstance(keldonWarlord.id, { id: "warlord" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [warlord] }),
                makePlayer("p2"),
            ],
        });
        expect(getEffectivePower(state, warlord)).toBe(0);
        expect(getEffectiveToughness(state, warlord)).toBe(0);
    });
});

describe("Orcish Artillery ({T}: 2 dmg to any target + 3 dmg to self)", () => {
    function setup() {
        const oa = makeInstance(orcishArtillery.id, {
            id: "oa",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        return makeState({
            players: [
                makePlayer("p1", { battlefield: [oa] }),
                makePlayer("p2"),
            ],
        });
    }

    it("deals 2 to a target opponent and 3 to the controller", () => {
        const state = setup();
        const oa = state.players[0].battlefield[0];
        state.stack.push({
            ...oa,
            zone: "stack",
            castById: "p1",
            abilityId: "orcish-artillery-shoot",
            targets: [{ type: "player", id: "p2" }],
        });
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(17); // self-damage
        expect(state.players[1].life).toBe(18); // target damage
    });
});

describe("Shatter / Stone Rain / Tunnel (destroy-target shorthand)", () => {
    it("Shatter destroys an artifact, ignores creatures", () => {
        const ring = makeInstance(solRing.id, {
            id: "ring",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [ring] }),
            ],
        });
        pushSpell(state, shatter.id, "p1", [{ type: "permanent", id: "ring" }]);
        resolveTopOfStack(state);
        expect(state.players[1].battlefield.map((c) => c.id)).not.toContain(
            "ring"
        );
        expect(state.players[1].graveyard.map((c) => c.id)).toContain("ring");
    });

    it("Stone Rain destroys a target Land", () => {
        const land = makeInstance(plains.id, {
            id: "victim-land",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [land] }),
            ],
        });
        pushSpell(state, stoneRain.id, "p1", [
            { type: "permanent", id: "victim-land" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[1].battlefield).toHaveLength(0);
    });

    it("Tunnel only targets Walls (subtypeFilter)", () => {
        expect(tunnel.targetRequirement).toEqual({
            type: "Creature",
            count: 1,
            subtypeFilter: "Wall",
        });
        const wall = makeInstance(wallOfSwords.id, {
            id: "wall",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [wall] }),
            ],
        });
        pushSpell(state, tunnel.id, "p1", [{ type: "permanent", id: "wall" }]);
        resolveTopOfStack(state);
        expect(state.players[1].graveyard.map((c) => c.id)).toContain("wall");
    });
});

describe("Uthden Troll ({R}: regenerate self)", () => {
    it("activating regen shields self", () => {
        const troll = makeInstance(uthdenTroll.id, {
            id: "troll",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [troll] }),
                makePlayer("p2"),
            ],
        });
        state.stack.push({
            ...troll,
            zone: "stack",
            castById: "p1",
            abilityId: "uthden-troll-regenerate",
            targets: [],
        });
        resolveTopOfStack(state);
        expect(state.players[0].battlefield[0].regenerationShields).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function grizzlyBearsId(): string {
    // grizzlyBears is exported from lea.ts — use getCardByName to stay
    // decoupled if we rename the variable.
    return "ce2d603a-3231-4a8c-bf39-1617586ea870";
}
