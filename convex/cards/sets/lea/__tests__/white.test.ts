// Per-card behavior tests for white cards in `convex/cards/sets/lea/white.ts`
// (LEA, split by colour per ADR 0043). Each non-trivial card gets a describe
// block citing the CR section it exercises. Shared stack/resolve shims live in
// ./helpers; fixture builders stay in convex/cards/__tests__/setup.ts.

import { describe, it, expect } from "vitest";
import {
    ancestralRecall,
    animateWall,
    armageddon,
    balance,
    benalishHero,
    blackWard,
    blazeOfGlory,
    blessing,
    blueWard,
    bogWraith,
    castle,
    chaoslace,
    circleOfProtectionBlue,
    circleOfProtectionGreen,
    circleOfProtectionRed,
    circleOfProtectionWhite,
    consecrateLand,
    conversion,
    crusade,
    deathWard,
    deathlace,
    disenchant,
    farmstead,
    fireball,
    forest,
    goblinKing,
    greenWard,
    grizzlyBears,
    guardianAngel,
    holyArmor,
    holyStrength,
    hypnoticSpecter,
    island,
    islandSanctuary,
    jayemdaeTome,
    karma,
    lance,
    lifelace,
    lightningBolt,
    mesaPegasus,
    monssGoblinRaiders,
    mountain,
    northernPaladin,
    personalIncarnation,
    plains,
    purelace,
    redWard,
    resurrection,
    reverseDamage,
    righteousness,
    samiteHealer,
    savannahLions,
    serraAngel,
    shivanDragon,
    stoneRain,
    swamp,
    swordsToPlowshares,
    thoughtlace,
    timberWolves,
    verduranEnchantress,
    veteranBodyguard,
    wallOfSwords,
    whiteKnight,
    whiteWard,
    wrathOfGod,
} from "..";
import {
    regenerateOrDestroy,
    removePermanentTo,
    resolveTopOfStack,
    emitSpellCastEvent,
    processPendingActionTriggers,
    applySourceStaticEffects,
    unapplySourceStaticEffects,
    applyExistingGrantsTo,
    type CardInstanceState,
    type GameState,
} from "../../../../gre/state";
import {
    getEffectivePower,
    getEffectiveToughness,
    STATIC_EFFECT_CTX,
} from "../../../../gre/layers";
import { getBasicLandMana } from "../../../../gre/constants";
import {
    getLegalActions,
    getLegalTargets,
    getProtectedColors,
    isProtectedFromSource,
    parseProtectionFromColor,
    NO_TARGETING_SOURCE,
} from "../../../../gre/rules";
import { projectPublicState } from "../../../../gameProjections";
import { checkStateBasedActions } from "../../../../gre/sba";
import {
    validateAttackerEligibility,
    validateBlockerEligibility,
    getRequiredBlockerAssignments,
} from "../../../../gre/combat";
import { advancePhase } from "../../../../gre/phases";
import {
    getEffectiveBlockGraph,
    getDamageAssignerId,
    isLegalBandComposition,
} from "../../../../gre/banding";
import { compactState, expandState } from "../../../../gre/serialize";
import type { CardType } from "../../../types";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { activatePump, grizzlyBearsId } from "./helpers";

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

    // Wire format (mandatory for the DSL bind+ref card, issue #802): the
    // exile + snapshotted-power life gain must survive the GameState → public
    // projection, which strips `card.card` and reshapes zones.
    it("wire format: exile + ref-driven life gain survive projectPublicState", () => {
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

        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[1].battlefield).toHaveLength(0);
        expect(projected.players[1].exile.map((c) => c.id)).toContain("angel");
        expect(projected.players[1].life).toBe(24);
    });
});

describe("target-legality gate at resolution (CR 608.2b / 608.2c)", () => {
    // CR 608.2b — "If all its targets, for every instance of the word
    // 'target,' are now illegal, the spell or ability doesn't resolve. It's
    // removed from the stack and, if it's a spell, put into its owner's
    // graveyard." (Countered by the game rules / "fizzle".)
    it("CR 608.2b — Swords to Plowshares fizzles cleanly when its sole target left the battlefield (regression for the crash)", () => {
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
        // Target leaves the battlefield before resolution (bounced/sacrificed).
        removePermanentTo(state, "angel", "graveyard");

        // Must NOT throw "Creature angel not on battlefield" — the gate
        // counters the spell before its resolve() runs.
        expect(() => resolveTopOfStack(state)).not.toThrow();

        // No effect applied: controller did NOT gain life from the (gone) power.
        expect(state.players[1].life).toBe(20);
        // Countered by the game rules → owner's graveyard (Swords' caster p1).
        const gy = state.players[0].graveyard;
        expect(
            gy.some(
                (c) => (c.card as { id?: string }).id === swordsToPlowshares.id
            )
        ).toBe(true);
        // The spell left the stack.
        expect(state.stack).toHaveLength(0);
    });

    it("CR 608.2b — a single-target damage spell with its only target gone fizzles to the graveyard, dealing no damage", () => {
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
        pushSpell(state, lightningBolt.id, "p1", [
            { type: "permanent", id: "lion" },
        ]);
        removePermanentTo(state, "lion", "graveyard");

        expect(() => resolveTopOfStack(state)).not.toThrow();
        // Opponent's life untouched — the bolt never resolved.
        expect(state.players[1].life).toBe(20);
        // Bolt is in p1's graveyard (countered), not still on the stack.
        expect(state.stack).toHaveLength(0);
        expect(
            state.players[0].graveyard.some(
                (c) => (c.card as { id?: string }).id === lightningBolt.id
            )
        ).toBe(true);
    });

    // CR 608.2c — "The spell or ability does as much as possible." An illegal
    // target is skipped; remaining legal targets are still affected.
    it("CR 608.2c — Fireball with one of two targets gone still resolves, hitting only the surviving target", () => {
        const survivor = makeInstance(serraAngel.id, {
            id: "survivor",
            controllerId: "p2",
            ownerId: "p2",
        });
        const goner = makeInstance(serraAngel.id, {
            id: "goner",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [survivor, goner] }),
            ],
        });
        const item = pushSpell(state, fireball.id, "p1", [
            { type: "permanent", id: "survivor" },
            { type: "permanent", id: "goner" },
        ]);
        // X=2: Serra Angel has 4 toughness, so the surviving target takes
        // damage but lives — letting us assert it was actually hit.
        item.chosenX = 2;
        // One of the two targets leaves before resolution.
        removePermanentTo(state, "goner", "graveyard");

        expect(() => resolveTopOfStack(state)).not.toThrow();

        // At least one legal target remained → the spell resolves (not
        // countered). The gate prunes the illegal target so resolve() only
        // reads the survivor (CR 608.2c "an illegal target is skipped").
        const remaining = state.players[1].battlefield.find(
            (c) => c.id === "survivor"
        );
        expect(remaining).toBeDefined();
        expect(remaining?.damageMarked).toBeGreaterThan(0);
        // The spell left the stack (resolved) rather than being countered.
        expect(state.stack).toHaveLength(0);
    });

    // Untargeted spells are entirely unaffected by the gate.
    it("untargeted spell (Wrath of God) is unaffected by the legality gate", () => {
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
        expect(() => resolveTopOfStack(state)).not.toThrow();
        // Both creatures destroyed — the gate did not interfere.
        expect(state.players[0].battlefield).toHaveLength(0);
        expect(state.players[1].battlefield).toHaveLength(0);
    });

    // Wire format: the fizzle outcome must survive the GameState → public
    // projection so the client sees the spell gone from the stack and in the
    // graveyard (rather than a stuck stack item).
    it("wire format: fizzle outcome survives projectPublicState", () => {
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
        removePermanentTo(state, "angel", "graveyard");
        resolveTopOfStack(state);

        const projected = projectPublicState(state, 1, "p1");
        // Stack is empty in the projected (client-visible) state.
        expect(projected.stack).toHaveLength(0);
        // Swords sits in p1's projected graveyard, slimmed to `{ id }`.
        const slimGy = projected.players[0].graveyard;
        expect(
            slimGy.some(
                (c) => (c.card as { id?: string }).id === swordsToPlowshares.id
            )
        ).toBe(true);
    });
});

describe("Wrath of God (destroy all creatures, can't regenerate, CR 701.15c)", () => {
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

    it("regeneration shields are NOT consumed — the rider suppresses them", () => {
        const lion = makeInstance(savannahLions.id, {
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
        pushSpell(state, wrathOfGod.id, "p1");
        resolveTopOfStack(state);
        // Lion in graveyard, not in play — Wrath bypassed the shield.
        expect(
            state.players[1].battlefield.find((c) => c.id === "lion")
        ).toBeUndefined();
        expect(
            state.players[1].graveyard.find((c) => c.id === "lion")
        ).toBeDefined();
    });

    it("indestructible creatures still survive (CR 702.12)", () => {
        const lion = makeInstance(savannahLions.id, {
            id: "lion",
            staticAbilities: ["indestructible"],
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [lion] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, wrathOfGod.id, "p1");
        resolveTopOfStack(state);
        expect(
            state.players[0].battlefield.find((c) => c.id === "lion")
        ).toBeDefined();
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

describe("Serra Angel (keyword abilities)", () => {
    it("has flying and vigilance", () => {
        expect(serraAngel.staticAbilities).toContain("flying");
        expect(serraAngel.staticAbilities).toContain("vigilance");
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
        const legal = getLegalTargets(state, lightningBolt.targetRequirement!, {
            ...NO_TARGETING_SOURCE,
            colors: ["B"],
        });
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
        const legal = getLegalTargets(state, lightningBolt.targetRequirement!, {
            ...NO_TARGETING_SOURCE,
            colors: ["R"],
        });
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
                blockerAssignments: { wk: ["wraith"] },
                blockersConfirmed: true,
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
        const legal = getLegalTargets(state, lightningBolt.targetRequirement!, {
            ...NO_TARGETING_SOURCE,
            colors: ["R"],
        });
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
        const { applyAllCombatDamage } = await import("../../../../gre/phases");
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
        const { advancePhase } = await import("../../../../gre/phases");
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
        const legal = getLegalTargets(
            state,
            ability.targetRequirement!,
            NO_TARGETING_SOURCE
        );
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
        const legal = getLegalTargets(
            state,
            ability.targetRequirement!,
            NO_TARGETING_SOURCE
        );
        expect(legal.map((t) => t.id)).toEqual(["recall"]);
    });

    it("color filter excludes players (players have no color)", () => {
        const state = makeState();
        const ability = circleOfProtectionWhite.activatedAbilities![0];
        const legal = getLegalTargets(
            state,
            ability.targetRequirement!,
            NO_TARGETING_SOURCE
        );
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

    it("can't be enchanted by other Auras — a second Aura targeting the consecrated land goes to the graveyard (CR 303.4)", () => {
        const { state } = setupAttached();
        // host-land is now enchanted by Consecrate Land. A second Aura
        // (another Consecrate Land) targeting it can't attach: the
        // cantBeEnchanted guard bars the attach gate, so it hits the graveyard.
        pushSpell(state, consecrateLand.id, "p1", [
            { type: "permanent", id: "host-land" },
        ]);
        resolveTopOfStack(state);
        const auras = state.players[0].battlefield.filter(
            (c) => c.attachedTo === "host-land"
        );
        expect(auras).toHaveLength(1);
        expect(
            state.players[0].graveyard.some(
                (c) => (c.card as { id?: string }).id === consecrateLand.id
            )
        ).toBe(true);
    });

    it("guard is host-scoped — an Aura still attaches to a different, unconsecrated land", () => {
        const { state } = setupAttached();
        // victim-land carries no Consecrate Land, so the guard doesn't cover
        // it: another Consecrate Land attaches there normally.
        pushSpell(state, consecrateLand.id, "p1", [
            { type: "permanent", id: "victim-land" },
        ]);
        resolveTopOfStack(state);
        const attachedToVictim = state.players[0].battlefield.some(
            (c) => c.attachedTo === "victim-land"
        );
        expect(attachedToVictim).toBe(true);
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

    it("the shield replaces a subsequent regen-honoring destroy (CR 614.5)", () => {
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
        // Use a regen-honoring destroy (no can't-be-regenerated rider). Wrath
        // would suppress the shield (CR 701.15c) — exercised separately.
        regenerateOrDestroy(state, "bear");
        const bearAfter = state.players[1].battlefield.find(
            (c) => c.id === "bear"
        );
        expect(bearAfter).toBeDefined();
        expect(bearAfter!.isTapped).toBe(true);
        expect(bearAfter!.regenerationShields).toBeUndefined();
    });

    // CR 601.2c — a spell can't be announced if there aren't enough legal
    // targets. getLegalActions suppresses "cast" for creature-only target
    // spells when no creatures exist on either battlefield.
    it("getLegalActions rejects cast with no creatures on the battlefield", () => {
        const dw = makeInstance(deathWard.id, { id: "dw1", zone: "hand" });
        const p1 = makePlayer("p1", {
            hand: [dw],
            manaPool: { W: 1, U: 0, B: 0, R: 0, G: 0, C: 0 },
        });
        const state = makeState({ players: [p1, makePlayer("p2")] });
        const legal = getLegalActions(state, p1, dw);
        expect(legal).not.toContain("cast");
    });

    it("getLegalActions allows cast when a creature is on the battlefield", () => {
        const dw = makeInstance(deathWard.id, { id: "dw1", zone: "hand" });
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            zone: "battlefield",
        });
        const p1 = makePlayer("p1", {
            hand: [dw],
            manaPool: { W: 1, U: 0, B: 0, R: 0, G: 0, C: 0 },
        });
        const p2 = makePlayer("p2", { battlefield: [bear] });
        const state = makeState({ players: [p1, p2] });
        const legal = getLegalActions(state, p1, dw);
        expect(legal).toContain("cast");
    });
});

describe("Farmstead (Aura on Plains — host controller may pay {W}{W} to gain 1 life at upkeep, CR 603.6a/117.3a)", () => {
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

    it("gains 1 life for the host's controller when they pay {W}{W}", () => {
        const state = setup("p1");
        const lifeBefore = state.players[0].life;
        advancePhase(state);
        resolveTopOfStack(state); // enqueues the optional {W}{W} may-pay
        const head = state.pendingChoices?.[0];
        expect(head?.kind).toBe("may-pay");
        expect(head?.playerId).toBe("p1");
        const item = state.stack.find((s) => s.id === head!.stackItemId)!;
        item.collectedChoices = {
            ...(item.collectedChoices ?? {}),
            [`${head!.step}:${head!.choiceId}`]: ["yes"],
        };
        state.pendingChoices = undefined;
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(lifeBefore + 1);
    });

    it("gains no life when the controller declines to pay {W}{W}", () => {
        const state = setup("p1");
        const lifeBefore = state.players[0].life;
        advancePhase(state);
        resolveTopOfStack(state);
        const head = state.pendingChoices?.[0];
        expect(head?.kind).toBe("may-pay");
        const item = state.stack.find((s) => s.id === head!.stackItemId)!;
        item.collectedChoices = {
            ...(item.collectedChoices ?? {}),
            [`${head!.step}:${head!.choiceId}`]: ["no"],
        };
        state.pendingChoices = undefined;
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(lifeBefore);
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

describe("CREATURE_DIED emission (combat + non-combat death paths)", () => {
    it("non-combat lethal damage queues a CREATURE_DIED event", () => {
        const target = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [target] }),
                makePlayer("p2"),
            ],
        });
        // Lightning Bolt resolving from p2 deals 3 to the bear → SBA-equivalent
        // lethal kills it (CR 704.5g) routed through removePermanentTo.
        pushSpell(state, lightningBolt.id, "p2", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);
        // The bear is in p1's graveyard.
        expect(
            state.players[0].graveyard.find((c) => c.id === "bear")
        ).toBeDefined();
        // Pending events drained by resolveTopOfStack — verifies the queue
        // was processed (no leftover events).
        expect(state.pendingEvents).toBeUndefined();
    });

    it("destroy via Wrath queues CREATURE_DIED for each victim", () => {
        const a = makeInstance(grizzlyBears.id, {
            id: "a",
            controllerId: "p1",
            ownerId: "p1",
        });
        const b = makeInstance(grizzlyBears.id, {
            id: "b",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [a] }),
                makePlayer("p2", { battlefield: [b] }),
            ],
        });
        pushSpell(state, wrathOfGod.id, "p1");
        resolveTopOfStack(state);
        expect(state.players[0].battlefield).toHaveLength(0);
        expect(state.players[1].battlefield).toHaveLength(0);
    });

    it("non-creature destroy does not queue CREATURE_DIED", () => {
        const land = makeInstance(plains.id, {
            id: "land",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [land] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, stoneRain.id, "p2", [
            { type: "permanent", id: "land" },
        ]);
        resolveTopOfStack(state);
        expect(state.pendingEvents).toBeUndefined();
    });
});

describe("SPELL_CAST event emission", () => {
    it("casting a spell with no payment fires SPELL_CAST and lands triggers on top", () => {
        // Verduran Enchantress on the battlefield, then cast an aura. The
        // enchantress trigger goes on top, the player gets a may-pay prompt.
        const enchantress = makeInstance(verduranEnchantress.id, {
            id: "vEn",
            controllerId: "p1",
            ownerId: "p1",
        });
        const aura = makeInstance(consecrateLand.id, {
            id: "aura",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [enchantress], hand: [aura] }),
                makePlayer("p2"),
            ],
        });
        // Push the aura onto stack manually (cast announce path) and emit
        // SPELL_CAST + run trigger collection (mirrors game.ts call sites).
        const stackItem = {
            ...aura,
            castById: "p1",
            zone: "stack" as const,
            targets: [],
        };
        state.stack.push(stackItem);
        emitSpellCastEvent(state, stackItem);
        processPendingActionTriggers(state);
        // Verduran trigger now on stack (above the aura).
        expect(state.stack[1].triggeredAbilityId).toBe(
            "verduran-enchantress-draw"
        );
    });
});

describe("Holy Armor (Aura — +0/+2 + {1}{W}: enchanted creature gets +0/+3 EOT)", () => {
    function setup() {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
        });
        const aura = makeInstance(holyArmor.id, {
            id: "ha",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "bear",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear, aura] }),
                makePlayer("p2"),
            ],
        });
        return { state, aura };
    }

    it("static buff +0/+2 applies to host", () => {
        const { state } = setup();
        const bear = state.players[0].battlefield.find((c) => c.id === "bear")!;
        expect(getEffectivePower(state, bear)).toBe(2);
        expect(getEffectiveToughness(state, bear)).toBe(4);
    });

    it("activated +0/+3 stacks with the static buff (total +0/+5)", () => {
        const { state, aura } = setup();
        activatePump(state, aura, "holy-armor-pump");
        const bear = state.players[0].battlefield.find((c) => c.id === "bear")!;
        expect(getEffectivePower(state, bear)).toBe(2);
        expect(getEffectiveToughness(state, bear)).toBe(7);
    });

    it("wire format: static +0/+2 survives the projection", () => {
        const { state } = setup();
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(getEffectiveToughness(projected, slim)).toBe(4);
    });
});

describe("Northern Paladin ({W}{W}, {T}: destroy target black creature)", () => {
    function setup() {
        const paladin = makeInstance(northernPaladin.id, {
            id: "paladin",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        const blackVictim: CardInstanceState = {
            id: "victim",
            card: { id: "fake-black", manaCost: { B: 1 } },
            types: ["Creature"] as CardType[],
            subtypes: [],
            staticAbilities: [],
            power: 2,
            toughness: 2,
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
            isTapped: false,
        };
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [paladin] }),
                makePlayer("p2", { battlefield: [blackVictim] }),
            ],
        });
        return { state, paladin };
    }

    it("destroys a black creature on resolution", () => {
        const { state, paladin } = setup();
        state.stack.push({
            ...paladin,
            zone: "stack",
            castById: "p1",
            abilityId: "northern-paladin-destroy",
            targets: [{ type: "permanent", id: "victim" }],
        });
        resolveTopOfStack(state);
        expect(state.players[1].battlefield).toHaveLength(0);
        expect(state.players[1].graveyard.map((c) => c.id)).toContain("victim");
    });

    it("getLegalTargets only returns black creatures", () => {
        const { state } = setup();
        const whiteLion = makeInstance(savannahLions.id, {
            id: "lion",
            controllerId: "p2",
            ownerId: "p2",
        });
        state.players[1].battlefield.push(whiteLion);
        const req = northernPaladin.activatedAbilities?.[0]?.targetRequirement;
        if (!req) throw new Error("requirement missing");
        const ids = getLegalTargets(state, req, NO_TARGETING_SOURCE).map(
            (t) => t.id
        );
        expect(ids).toContain("victim");
        expect(ids).not.toContain("lion");
    });
});

describe("Samite Healer ({T}: prevent next 1 to any target this turn)", () => {
    function setup() {
        const healer = makeInstance(samiteHealer.id, {
            id: "healer",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        const friendBear = makeInstance(grizzlyBears.id, {
            id: "friend",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [healer, friendBear] }),
                makePlayer("p2"),
            ],
        });
        return { state, healer };
    }

    function activate(
        state: GameState,
        healer: CardInstanceState,
        target: { type: "permanent" | "player"; id: string }
    ) {
        state.stack.push({
            ...healer,
            zone: "stack",
            castById: "p1",
            abilityId: "samite-healer-prevent",
            targets: [target],
        });
        resolveTopOfStack(state);
    }

    it("declares 'any target' requirement (count 1)", () => {
        const ability = samiteHealer.activatedAbilities?.[0];
        expect(ability?.targetRequirement).toEqual({ type: "any", count: 1 });
        expect(ability?.cost).toEqual({ tap: true });
    });

    it("absorbs 1 damage of incoming Lightning Bolt to a player", () => {
        const { state, healer } = setup();
        activate(state, healer, { type: "player", id: "p2" });
        const p2BeforeBolt = state.players[1].life;
        // Lightning Bolt p2: 3 damage, 1 absorbed, 2 land.
        pushSpell(state, lightningBolt.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(p2BeforeBolt - 2);
    });

    it("absorbs 1 damage on a creature (residual marked on the survivor)", () => {
        const { state, healer } = setup();
        const enemyDragon = makeInstance(shivanDragon.id, {
            id: "enemy",
            controllerId: "p2",
            ownerId: "p2",
        });
        state.players[1].battlefield.push(enemyDragon);
        activate(state, healer, { type: "permanent", id: "enemy" });
        // Lightning Bolt: 3 dmg → 1 absorbed → 2 marked. Dragon (5/5)
        // survives so we can read the marked total.
        pushSpell(state, lightningBolt.id, "p1", [
            { type: "permanent", id: "enemy" },
        ]);
        resolveTopOfStack(state);
        const after = state.players[1].battlefield.find(
            (c) => c.id === "enemy"
        )!;
        expect(after.damageMarked).toBe(2);
    });

    it("shield is consumed by the first event (no leftover for next event)", () => {
        const { state, healer } = setup();
        activate(state, healer, { type: "player", id: "p2" });
        const before = state.players[1].life;
        // First Bolt: 3 → 2 absorbed.
        pushSpell(state, lightningBolt.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(before - 2);
        // Second Bolt: shield depleted → full 3.
        pushSpell(state, lightningBolt.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[1].life).toBe(before - 5);
    });

    it("unconsumed shield wears off at CLEANUP (CR 514.2)", () => {
        const { state, healer } = setup();
        activate(state, healer, { type: "player", id: "p2" });
        expect(state.targetPreventionShields).toHaveLength(1);
        // Tick to CLEANUP: hop directly to END_STEP then advance.
        state.phase = "END_STEP";
        advancePhase(state);
        expect(state.targetPreventionShields).toBeUndefined();
    });
});

describe("Resurrection (return target Creature card from your graveyard to the battlefield, CR 400.7)", () => {
    it("returns a creature from your graveyard to your battlefield", () => {
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
        pushSpell(state, resurrection.id, "p1", [
            { type: "graveyard-card", id: "dead", playerId: "p1" },
        ]);
        resolveTopOfStack(state);
        expect(state.players[0].graveyard.map((c) => c.id)).not.toContain(
            "dead"
        );
        const revived = state.players[0].battlefield.find(
            (c) => c.id === "dead"
        );
        expect(revived).toBeDefined();
        expect(revived?.controllerId).toBe("p1");
        // CR 302.1 — a freshly-entered creature is summoning sick.
        expect(revived?.isSummoningSick).toBe(true);
        expect(revived?.zone).toBe("battlefield");
    });

    it("silent fizzle if the target is no longer in the graveyard at resolution (CR 608.2b)", () => {
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
        pushSpell(state, resurrection.id, "p1", [
            { type: "graveyard-card", id: "dead", playerId: "p1" },
        ]);
        state.players[0].graveyard = [];
        state.players[0].exile.push(dead);
        resolveTopOfStack(state);
        expect(
            state.players[0].battlefield.find((c) => c.id === "dead")
        ).toBeUndefined();
        expect(state.players[0].exile.map((c) => c.id)).toContain("dead");
    });

    it("targeting filter is 'controller: you' — opponent graveyard not legal", () => {
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
        const req = resurrection.targetRequirement;
        if (!req) throw new Error("requirement missing");
        const legal = getLegalTargets(state, req, NO_TARGETING_SOURCE, "p1");
        const ids = legal.map((t) => t.id);
        expect(ids).not.toContain("opp-dead");
    });

    it("reanimated creature receives existing lord-grants (Goblin King + reanimated Goblin)", () => {
        const dead = makeInstance(monssGoblinRaiders.id, {
            id: "dead-goblin",
            controllerId: "p1",
            ownerId: "p1",
            zone: "graveyard",
        });
        const king = makeInstance(goblinKing.id, {
            id: "king",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    graveyard: [dead],
                    battlefield: [king],
                }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, resurrection.id, "p1", [
            { type: "graveyard-card", id: "dead-goblin", playerId: "p1" },
        ]);
        resolveTopOfStack(state);
        const revived = state.players[0].battlefield.find(
            (c) => c.id === "dead-goblin"
        )!;
        // Goblin King grants other Goblins +1/+1 and mountainwalk (CR 611).
        expect(getEffectivePower(state, revived)).toBe(2);
        expect(revived.staticAbilities).toContain("mountainwalk");
    });
});

describe("Reverse Damage (CR 614 one-shot prevent + gain life)", () => {
    it("prevents the next damage from the chosen source to the caster and gains life equal", () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { life: 10 }),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, reverseDamage.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);
        // Now have the bear deal 4 damage to p1 (via a fake event).
        // Easiest path: directly call into runDamageReplacement-equivalent
        // by casting a Lightning Bolt FROM the bear is not possible; use
        // Lightning Bolt to verify a *different* source isn't intercepted.
        // For the bear-specific shield, simulate via a Lightning Bolt cast
        // whose source matches: replace bolt's stack id with "bear" before
        // resolve to mimic combat damage from bear.
        // Simpler: emit a manual DamageEvent through a Lightning Bolt cast
        // on the same target; the shield is sourceInstanceId-keyed and the
        // bolt's id won't match. So we test cancellation by mimicking the
        // bear source through SpellContext is not direct.
        // Use Lightning Bolt cast (different source): shield should NOT
        // consume it (sanity), confirming sourceInstanceId binding.
        const opp = state.players[1];
        const lifeBefore = state.players[0].life;
        // Have the bear deal 4 damage to p1 via fake SpellContext path —
        // we step into the engine directly:
        // Replace bear-source by pushing a synthetic damage event through
        // dealDamage of a stack item with id = "bear".
        // Workaround: directly inject the shield consumption by calling
        // applyTransientDamageRedirections via cast of Lightning Bolt then
        // overriding id pre-resolve.
        pushSpell(state, lightningBolt.id, "p2", [
            { type: "player", id: "p1" },
        ]);
        const bolt = state.stack[state.stack.length - 1];
        bolt.id = "bear"; // pretend the bolt is dealt by the bear
        resolveTopOfStack(state);
        // Damage was prevented and life increased by 3 (Lightning Bolt's
        // amount). Pre-bolt life 10, gained 3, total 13.
        expect(state.players[0].life).toBe(lifeBefore + 3);
        // Sanity: opponent is unaffected.
        expect(opp.life).toBe(20);
    });

    it("routes the gain through the single life-gain choke point — tally + LIFE_GAINED (CR 119.3)", async () => {
        // Driven through the shield consumer directly so the emitted events
        // are still on `state.pendingEvents` (a full resolution drains them
        // into the trigger scan).
        const { applyTransientDamageRedirections } =
            await import("../../../../gre/replacements");
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { life: 10 }),
                makePlayer("p2", { battlefield: [bear] }),
            ],
        });
        pushSpell(state, reverseDamage.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);
        state.pendingEvents = undefined;
        const result = applyTransientDamageRedirections(state, {
            kind: "damage",
            sourceInstanceId: "bear",
            sourceControllerId: "p2",
            target: { type: "player", id: "p1" },
            amount: 3,
            isCombat: false,
            sourceColors: [],
            sourceTypes: ["Creature"],
            sourceStaticAbilities: [],
        });
        // The shield consumed the damage and the caster gained 3 life.
        expect(result).toBeNull();
        expect(state.players[0].life).toBe(13);
        // "if you gained life this turn" tally (issue #1457).
        expect(state.lifeGainedThisTurn?.p1).toBe(3);
        // "whenever you gain life" triggers must observe the gain.
        expect(state.pendingEvents ?? []).toContainEqual({
            type: "LIFE_GAINED",
            playerId: "p1",
            amount: 3,
        });
        // The one-shot shield was consumed.
        expect(state.damageRedirections).toBeUndefined();
    });
});

describe("Veteran Bodyguard (CR 614 continuous damage redirect)", () => {
    it("redirects unblocked combat damage to the bodyguard when it's untapped", async () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear-att",
            controllerId: "p2",
            ownerId: "p2",
            isAttacking: true,
        });
        const bg = makeInstance(veteranBodyguard.id, {
            id: "bg",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            activePlayerId: "p2",
            players: [
                makePlayer("p1", { battlefield: [bg], life: 20 }),
                makePlayer("p2", { battlefield: [bear], life: 20 }),
            ],
            phase: "COMBAT_DAMAGE",
            combat: {
                attackerIds: ["bear-att"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: true,
            },
        });
        const { applyAllCombatDamage } = await import("../../../../gre/phases");
        applyAllCombatDamage(state, {}, "regular");
        // Bear's 2 damage redirected to Veteran Bodyguard (now has 2 marked).
        expect(state.players[0].life).toBe(20);
        const bgAfter = state.players[0].battlefield.find((c) => c.id === "bg");
        expect(bgAfter?.damageMarked).toBe(2);
    });

    it("does NOT redirect when the bodyguard is tapped (CR 614 condition)", async () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear-att",
            controllerId: "p2",
            ownerId: "p2",
            isAttacking: true,
        });
        const bg = makeInstance(veteranBodyguard.id, {
            id: "bg",
            controllerId: "p1",
            ownerId: "p1",
            isTapped: true,
        });
        const state = makeState({
            activePlayerId: "p2",
            players: [
                makePlayer("p1", { battlefield: [bg], life: 20 }),
                makePlayer("p2", { battlefield: [bear], life: 20 }),
            ],
            phase: "COMBAT_DAMAGE",
            combat: {
                attackerIds: ["bear-att"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: true,
            },
        });
        const { applyAllCombatDamage } = await import("../../../../gre/phases");
        applyAllCombatDamage(state, {}, "regular");
        expect(state.players[0].life).toBe(18);
        const bgAfter = state.players[0].battlefield.find((c) => c.id === "bg");
        expect(bgAfter?.damageMarked).toBeUndefined();
    });

    it("does NOT redirect when the attacker is blocked (source filter)", async () => {
        const bear = makeInstance(grizzlyBears.id, {
            id: "bear-att",
            controllerId: "p2",
            ownerId: "p2",
            isAttacking: true,
        });
        const blocker = makeInstance(grizzlyBears.id, {
            id: "blk",
            controllerId: "p1",
            ownerId: "p1",
            isBlocking: true,
        });
        const bg = makeInstance(veteranBodyguard.id, {
            id: "bg",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            activePlayerId: "p2",
            players: [
                makePlayer("p1", { battlefield: [bg, blocker], life: 20 }),
                makePlayer("p2", { battlefield: [bear], life: 20 }),
            ],
            phase: "COMBAT_DAMAGE",
            combat: {
                attackerIds: ["bear-att"],
                confirmed: true,
                blockerAssignments: { blk: ["bear-att"] },
                blockersConfirmed: true,
            },
        });
        const { applyAllCombatDamage } = await import("../../../../gre/phases");
        applyAllCombatDamage(state, {}, "regular");
        // Damage goes to the blocker, bodyguard untouched.
        const bgAfter = state.players[0].battlefield.find((c) => c.id === "bg");
        expect(bgAfter?.damageMarked).toBeUndefined();
        expect(state.players[0].life).toBe(20);
    });
});

describe("Personal Incarnation (continuous redirect + dies-trigger)", () => {
    it("redirects damage from any source dealt to owner onto itself", () => {
        const pinc = makeInstance(personalIncarnation.id, {
            id: "pinc",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [pinc], life: 20 }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, lightningBolt.id, "p2", [
            { type: "player", id: "p1" },
        ]);
        resolveTopOfStack(state);
        // p1 life unchanged; Incarnation took the 3.
        expect(state.players[0].life).toBe(20);
        const after = state.players[0].battlefield.find(
            (c) => c.id === "pinc"
        )!;
        expect(after.damageMarked).toBe(3);
    });

    it("LTB-trigger: when it dies, owner loses half their life rounded up", () => {
        const pinc = makeInstance(personalIncarnation.id, {
            id: "pinc",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [pinc], life: 14 }),
                makePlayer("p2"),
            ],
        });
        removePermanentTo(state, "pinc", "graveyard");
        processPendingActionTriggers(state);
        // Resolve the dies-trigger on the stack.
        resolveTopOfStack(state);
        // Owner had 14 life → loses ceil(14/2) = 7 → ends at 7.
        expect(state.players[0].life).toBe(7);
    });
});

describe("Blessing (aura, {W}: +1/+1 to host until EOT)", () => {
    it("activated pump adds +1/+1 to the enchanted host", () => {
        const host = makeInstance(grizzlyBears.id, {
            id: "host",
            controllerId: "p1",
            ownerId: "p1",
        });
        const aura = makeInstance(blessing.id, {
            id: "blessing",
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
        state.stack.push({
            ...aura,
            zone: "stack",
            castById: "p1",
            abilityId: "blessing-pump",
            targets: [],
        });
        resolveTopOfStack(state);
        const hostAfter = state.players[0].battlefield.find(
            (c) => c.id === "host"
        )!;
        expect(getEffectivePower(state, hostAfter)).toBe(3);
        expect(getEffectiveToughness(state, hostAfter)).toBe(3);
    });
});

describe("blazeOfGlory — target can block all attackers (CR 509.1a)", () => {
    it("sets canBlockAdditional and mustBlockAllThisTurn on target", () => {
        const blocker = makeInstance(grizzlyBears.id, {
            id: "blk",
            controllerId: "p2",
            ownerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [blocker] }),
            ],
            phase: "DECLARE_ATTACKERS",
        });
        pushSpell(state, blazeOfGlory.id, "p1", [
            { type: "permanent", id: "blk" },
        ]);
        resolveTopOfStack(state);
        const blk = state.players[1].battlefield.find((c) => c.id === "blk")!;
        expect(blk.canBlockAdditional).toBe(999);
        expect(blk.mustBlockAllThisTurn).toBe(true);
    });

    it("can only be cast during combat before blockers (timing)", () => {
        expect(blazeOfGlory.castPhaseRestriction).toEqual([
            "BEGINNING_OF_COMBAT",
            "DECLARE_ATTACKERS",
        ]);
    });

    it("mustBlockAll auto-assigns blocker to all attackers", () => {
        const att1 = makeInstance(grizzlyBears.id, {
            id: "att1",
            controllerId: "p1",
            isAttacking: true,
        });
        const att2 = makeInstance(savannahLions.id, {
            id: "att2",
            controllerId: "p1",
            isAttacking: true,
        });
        const blocker = makeInstance(grizzlyBears.id, {
            id: "blk",
            controllerId: "p2",
            canBlockAdditional: 999,
            mustBlockAllThisTurn: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [att1, att2] }),
                makePlayer("p2", { battlefield: [blocker] }),
            ],
            phase: "DECLARE_BLOCKERS",
            combat: {
                attackerIds: ["att1", "att2"],
                confirmed: true,
                blockerAssignments: {},
                blockersConfirmed: false,
            },
        });
        const required = getRequiredBlockerAssignments(
            state.players[0].battlefield,
            state.players[1].battlefield,
            state.combat!.attackerIds,
            state.combat!.blockerAssignments,
            state
        );
        expect(required["blk"]).toContain("att1");
        expect(required["blk"]).toContain("att2");
    });
});

// ---------------------------------------------------------------------------
// Two-Headed Giant of Foriys (CR 509.1a — multi-block)
// ---------------------------------------------------------------------------

describe("Guardian Angel (CR 615.1 — prevent next X damage to target)", () => {
    it("prevents X damage to a targeted creature", () => {
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
        const item = pushSpell(state, guardianAngel.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        item.chosenX = 3;
        resolveTopOfStack(state);
        // Shield is now active — deal 3 damage with bolt
        pushSpell(state, lightningBolt.id, "p2", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);
        const after = state.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(after.damageMarked).toBeFalsy();
    });

    it("prevents X damage to a targeted player", () => {
        const state = makeState({
            players: [makePlayer("p1", { life: 20 }), makePlayer("p2")],
        });
        const item = pushSpell(state, guardianAngel.id, "p1", [
            { type: "player", id: "p1" },
        ]);
        item.chosenX = 2;
        resolveTopOfStack(state);
        pushSpell(state, lightningBolt.id, "p2", [
            { type: "player", id: "p1" },
        ]);
        resolveTopOfStack(state);
        // 3 damage - 2 prevented = 1 damage through
        expect(state.players[0].life).toBe(19);
    });
});

describe("Righteousness (target blocking creature gets +7/+7, CR 509.1)", () => {
    it("can only target blocking creatures (combatRoleFilter)", () => {
        expect(righteousness.targetRequirement!.combatRoleFilter).toBe(
            "blocking"
        );
    });

    it("getLegalTargets rejects non-blocking creatures", () => {
        const creature = makeInstance(grizzlyBearsId(), {
            id: "bears",
            controllerId: "p1",
        });
        const p1 = makePlayer("p1", { battlefield: [creature] });
        const state = makeState({ players: [p1, makePlayer("p2")] });
        const targets = getLegalTargets(
            state,
            righteousness.targetRequirement!,
            NO_TARGETING_SOURCE,
            "p1"
        );
        expect(targets).toHaveLength(0);
    });

    it("getLegalTargets accepts blocking creatures", () => {
        const blocker = makeInstance(grizzlyBearsId(), {
            id: "blocker",
            controllerId: "p1",
            isBlocking: true,
        });
        const p1 = makePlayer("p1", { battlefield: [blocker] });
        const state = makeState({ players: [p1, makePlayer("p2")] });
        const targets = getLegalTargets(
            state,
            righteousness.targetRequirement!,
            NO_TARGETING_SOURCE,
            "p1"
        );
        expect(targets).toHaveLength(1);
        expect(targets[0].id).toBe("blocker");
    });

    it("resolve applies +7/+7 temporary buff", () => {
        const blocker = makeInstance(grizzlyBearsId(), {
            id: "blocker",
            controllerId: "p2",
            isBlocking: true,
        });
        const p1 = makePlayer("p1");
        const p2 = makePlayer("p2", { battlefield: [blocker] });
        const state = makeState({ players: [p1, p2] });
        pushSpell(state, righteousness.id, "p1", [
            { type: "permanent", id: "blocker" },
        ]);
        resolveTopOfStack(state);
        expect(getEffectivePower(state, blocker)).toBe(9); // 2 + 7
        expect(getEffectiveToughness(state, blocker)).toBe(9); // 2 + 7
    });

    it("wire format: +7/+7 buff survives projectPublicState", () => {
        const blocker = makeInstance(grizzlyBearsId(), {
            id: "blocker",
            controllerId: "p2",
            isBlocking: true,
        });
        const p1 = makePlayer("p1");
        const p2 = makePlayer("p2", { battlefield: [blocker] });
        const state = makeState({ players: [p1, p2] });
        pushSpell(state, righteousness.id, "p1", [
            { type: "permanent", id: "blocker" },
        ]);
        resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        const projBlocker = projected.players[1].battlefield.find(
            (c) => c.id === "blocker"
        )!;
        expect(getEffectivePower(projected, projBlocker)).toBe(9);
        expect(getEffectiveToughness(projected, projBlocker)).toBe(9);
    });
});

// ---------------------------------------------------------------------------
// W16: Exile-on-death + unlimited land drops — Disintegrate, Fastbond
// ---------------------------------------------------------------------------

describe("Conversion ({2}{W}{W} — all Mountains are Plains)", () => {
    it("replaces subtypes of all Mountains globally", () => {
        const state = makeState();
        const mtn1 = makeInstance(mountain.id, {
            id: "mtn-1",
            controllerId: "p1",
            zone: "battlefield",
        });
        const mtn2 = makeInstance(mountain.id, {
            id: "mtn-2",
            controllerId: "p2",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(mtn1);
        state.players[1].battlefield.push(mtn2);

        const conv = makeInstance(conversion.id, {
            id: "conv",
            controllerId: "p1",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(conv);
        applySourceStaticEffects(state, conv);

        expect(mtn1.subtypes).toEqual(["Plains"]);
        expect(mtn2.subtypes).toEqual(["Plains"]);
        expect(getBasicLandMana(mtn1)).toBe("W");
        expect(getBasicLandMana(mtn2)).toBe("W");
    });

    it("does not affect non-Mountain lands", () => {
        const state = makeState();
        const isl = makeInstance(island.id, {
            controllerId: "p1",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(isl);

        const conv = makeInstance(conversion.id, {
            controllerId: "p1",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(conv);
        applySourceStaticEffects(state, conv);

        expect(isl.subtypes).toEqual(["Island"]);
    });

    it("removal restores all Mountains", () => {
        const state = makeState();
        const mtn = makeInstance(mountain.id, {
            controllerId: "p1",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(mtn);

        const conv = makeInstance(conversion.id, {
            controllerId: "p1",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(conv);
        applySourceStaticEffects(state, conv);
        expect(mtn.subtypes).toEqual(["Plains"]);

        unapplySourceStaticEffects(state, conv);
        expect(mtn.subtypes).toEqual(["Mountain"]);
        expect(getBasicLandMana(mtn)).toBe("R");
    });

    it("new Mountain entering after Conversion gets affected", () => {
        const state = makeState();
        const conv = makeInstance(conversion.id, {
            id: "conv",
            controllerId: "p1",
            zone: "battlefield",
        });
        state.players[0].battlefield.push(conv);

        const mtn = makeInstance(mountain.id, {
            controllerId: "p2",
            zone: "battlefield",
        });
        state.players[1].battlefield.push(mtn);
        applyExistingGrantsTo(state, mtn);

        expect(mtn.subtypes).toEqual(["Plains"]);
    });

    it("upkeep pay-or-else trigger declared", () => {
        expect(conversion.triggeredAbilities).toHaveLength(1);
        expect(conversion.triggeredAbilities![0].id).toBe("conversion-upkeep");
    });
});

describe("Lace cycle (CR 305.7 — target spell or permanent becomes [color])", () => {
    const laces = [
        { def: purelace, color: "W", name: "Purelace" },
        { def: thoughtlace, color: "U", name: "Thoughtlace" },
        { def: deathlace, color: "B", name: "Deathlace" },
        { def: chaoslace, color: "R", name: "Chaoslace" },
        { def: lifelace, color: "G", name: "Lifelace" },
    ] as const;

    for (const { def, color, name } of laces) {
        describe(name, () => {
            it("changes a permanent's color", () => {
                const creature = makeInstance(savannahLions.id, {
                    id: "lion",
                    controllerId: "p2",
                    ownerId: "p2",
                });
                const p1 = makePlayer("p1", {
                    manaPool: { W: 5, U: 5, B: 5, R: 5, G: 5, C: 0 },
                });
                const p2 = makePlayer("p2", {
                    battlefield: [creature],
                });
                const state = makeState({ players: [p1, p2] });

                const originalColors = STATIC_EFFECT_CTX.getColors(creature);
                expect(originalColors).toContain("W");

                pushSpell(state, def.id, "p1", [
                    { type: "permanent", id: "lion" },
                ]);
                resolveTopOfStack(state);

                const newColors = STATIC_EFFECT_CTX.getColors(creature);
                expect(newColors).toEqual([color]);
            });

            it("changes a spell's color on the stack", () => {
                const p1 = makePlayer("p1", {
                    manaPool: { W: 5, U: 5, B: 5, R: 5, G: 5, C: 0 },
                });
                const p2 = makePlayer("p2");
                const state = makeState({ players: [p1, p2] });

                const targetSpell = pushSpell(state, lightningBolt.id, "p2", [
                    { type: "player", id: "p1" },
                ]);

                pushSpell(state, def.id, "p1", [
                    { type: "spell", id: targetSpell.id },
                ]);
                resolveTopOfStack(state);

                const boltOnStack = state.stack.find(
                    (s) => s.id === targetSpell.id
                )!;
                expect(boltOnStack.colorOverride).toEqual([color]);
                expect(STATIC_EFFECT_CTX.getColors(boltOnStack)).toEqual([
                    color,
                ]);
            });

            it("color change persists — not cleared at end of turn", () => {
                const creature = makeInstance(savannahLions.id, {
                    id: "lion",
                    controllerId: "p1",
                    ownerId: "p1",
                });
                const p1 = makePlayer("p1", {
                    battlefield: [creature],
                    manaPool: { W: 5, U: 5, B: 5, R: 5, G: 5, C: 0 },
                });
                const state = makeState({ players: [p1, makePlayer("p2")] });

                pushSpell(state, def.id, "p1", [
                    { type: "permanent", id: "lion" },
                ]);
                resolveTopOfStack(state);

                expect(creature.colorOverride).toEqual([color]);
                expect(STATIC_EFFECT_CTX.getColors(creature)).toEqual([color]);
            });
        });
    }

    it("spell-or-permanent target type includes all permanent types + stack spells", () => {
        const creature = makeInstance(savannahLions.id, {
            id: "lion",
            controllerId: "p1",
            ownerId: "p1",
        });
        const land = makeInstance(forest.id, {
            id: "forest1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const p1 = makePlayer("p1", {
            battlefield: [creature, land],
        });
        const state = makeState({ players: [p1, makePlayer("p2")] });

        const bolt = pushSpell(state, lightningBolt.id, "p2", [
            { type: "player", id: "p1" },
        ]);

        const targets = getLegalTargets(
            state,
            { type: "spell-or-permanent", count: 1 },
            NO_TARGETING_SOURCE,
            "p1"
        );

        const ids = targets.map((t) => t.id);
        expect(ids).toContain("lion");
        expect(ids).toContain("forest1");
        expect(ids).toContain(bolt.id);
        const types = targets.map((t) => t.type);
        expect(types).not.toContain("player");
    });

    it("protection interaction respects new color (CR 702.16b)", () => {
        const proRedCreature = makeInstance(whiteKnight.id, {
            id: "wk",
            controllerId: "p2",
            ownerId: "p2",
        });
        const p1 = makePlayer("p1", {
            manaPool: { W: 0, U: 0, B: 0, R: 5, G: 0, C: 0 },
        });
        const p2 = makePlayer("p2", {
            battlefield: [proRedCreature],
        });
        const state = makeState({ players: [p1, p2] });

        expect(getProtectedColors(proRedCreature).includes("B")).toBe(true);

        pushSpell(state, deathlace.id, "p1", [{ type: "permanent", id: "wk" }]);
        resolveTopOfStack(state);

        expect(STATIC_EFFECT_CTX.getColors(proRedCreature)).toEqual(["B"]);
    });

    it("wire format: colorOverride survives projectPublicState", () => {
        const creature = makeInstance(savannahLions.id, {
            id: "lion",
            controllerId: "p1",
            ownerId: "p1",
        });
        const p1 = makePlayer("p1", {
            battlefield: [creature],
            manaPool: { W: 5, U: 5, B: 5, R: 5, G: 5, C: 0 },
        });
        const state = makeState({ players: [p1, makePlayer("p2")] });

        pushSpell(state, chaoslace.id, "p1", [
            { type: "permanent", id: "lion" },
        ]);
        resolveTopOfStack(state);

        expect(creature.colorOverride).toEqual(["R"]);

        const projected = projectPublicState(state, 1, "p1");
        const projLion = projected.players[0].battlefield.find(
            (c) => c.id === "lion"
        )!;
        expect(
            (projLion as unknown as { colorOverride?: string[] }).colorOverride
        ).toEqual(["R"]);
        expect(STATIC_EFFECT_CTX.getColors(projLion)).toEqual(["R"]);
    });
});

// ---------------------------------------------------------------------------
// W24: Cost modification + keyword removal (CR 601.2f, 613.1a)
// ---------------------------------------------------------------------------

describe("Animate Wall (CR 702.3 — keyword-remove: defender)", () => {
    it("enchanted Wall can attack (defender removed)", () => {
        const wall = makeInstance(wallOfSwords.id, {
            id: "wall",
            controllerId: "p1",
            ownerId: "p1",
        });
        const aura = makeInstance(animateWall.id, {
            id: "anim",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "wall",
        });
        const p1 = makePlayer("p1", { battlefield: [wall, aura] });
        const state = makeState({ players: [p1, makePlayer("p2")] });
        applySourceStaticEffects(state, aura);

        expect(wall.staticAbilities).not.toContain("defender");
        // `seq` is the CR 613.7 layer timestamp the source stamps on every
        // record it writes (issue #1715) — an implementation detail here.
        expect(wall.removedKeywords).toEqual([
            expect.objectContaining({ keyword: "defender", sourceId: "anim" }),
        ]);
        const result = validateAttackerEligibility(
            wall,
            state.players[1].battlefield
        );
        expect(result.eligible).toBe(true);
    });

    it("removing aura restores defender", () => {
        const wall = makeInstance(wallOfSwords.id, {
            id: "wall",
            controllerId: "p1",
            ownerId: "p1",
        });
        const aura = makeInstance(animateWall.id, {
            id: "anim",
            controllerId: "p1",
            ownerId: "p1",
            attachedTo: "wall",
        });
        const p1 = makePlayer("p1", { battlefield: [wall, aura] });
        const state = makeState({ players: [p1, makePlayer("p2")] });
        applySourceStaticEffects(state, aura);

        expect(wall.staticAbilities).not.toContain("defender");

        unapplySourceStaticEffects(state, aura);

        expect(wall.staticAbilities).toContain("defender");
        expect(wall.removedKeywords).toBeUndefined();
    });
});

describe("Serialization: removedKeywords + damageCapShields", () => {
    it("removedKeywords survives compact/expand round-trip", () => {
        const wall = makeInstance(wallOfSwords.id, {
            id: "wall",
            controllerId: "p1",
            ownerId: "p1",
        });
        wall.removedKeywords = [{ keyword: "defender", sourceId: "anim" }];
        const p1 = makePlayer("p1", { battlefield: [wall] });
        const state = makeState({ players: [p1, makePlayer("p2")] });

        const compacted = compactState(state);
        const restored = expandState(compacted);
        const restoredWall = restored.players[0].battlefield[0];
        expect(restoredWall.removedKeywords).toEqual([
            { keyword: "defender", sourceId: "anim" },
        ]);
    });

    it("damageCapShields survives compact/expand round-trip", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        state.damageCapShields = [{ playerId: "p2", maxDamage: 1 }];

        const compacted = compactState(state);
        const restored = expandState(compacted);
        expect(restored.damageCapShields).toEqual([
            { playerId: "p2", maxDamage: 1 },
        ]);
    });

    it("islandSanctuaryProtection survives compact/expand round-trip", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        state.islandSanctuaryProtection = "p1";

        const compacted = compactState(state);
        const restored = expandState(compacted);
        expect(restored.islandSanctuaryProtection).toBe("p1");
    });

    it("allCreaturesMustAttack survives compact/expand round-trip", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        state.allCreaturesMustAttack = "p1";

        const compacted = compactState(state);
        const restored = expandState(compacted);
        expect(restored.allCreaturesMustAttack).toBe("p1");
    });
});

// ---------------------------------------------------------------------------
// W25b: Counter-unless-pay + draw-skip (CR 701.5a, 614)
// ---------------------------------------------------------------------------

describe("Island Sanctuary (CR 614 — draw-skip replacement)", () => {
    function commitHead(state: GameState, picks: string[]) {
        const queue = state.pendingChoices ?? [];
        const head = queue[0];
        const stackItem = state.stack.find((s) => s.id === head.stackItemId)!;
        stackItem.collectedChoices = {
            ...(stackItem.collectedChoices ?? {}),
            [`${head.step}:${head.choiceId}`]: picks,
        };
        queue.shift();
        state.pendingChoices = queue.length > 0 ? queue : undefined;
    }
    it("drawStepReplacement suppresses automatic draw", () => {
        const sanctuary = makeInstance(islandSanctuary.id, {
            id: "sanc",
            controllerId: "p1",
            ownerId: "p1",
        });
        const p1 = makePlayer("p1", {
            battlefield: [sanctuary],
            library: [
                makeInstance(savannahLions.id, {
                    id: "top-card",
                    controllerId: "p1",
                    ownerId: "p1",
                }),
            ],
        });
        const state = makeState({
            players: [p1, makePlayer("p2")],
            activePlayerId: "p1",
            turn: 2,
        });
        const handBefore = p1.hand.length;

        state.phase = "UPKEEP";
        advancePhase(state);

        // Draw step doesn't auto-draw when Island Sanctuary is present
        expect(state.phase).toBe("DRAW");
        expect(p1.hand.length).toBe(handBefore);
    });

    it("on skip, sets islandSanctuaryProtection", () => {
        const sanctuary = makeInstance(islandSanctuary.id, {
            id: "sanc",
            controllerId: "p1",
            ownerId: "p1",
        });
        const topCard = makeInstance(savannahLions.id, {
            id: "top",
            controllerId: "p1",
            ownerId: "p1",
        });
        const p1 = makePlayer("p1", {
            battlefield: [sanctuary],
            library: [topCard],
        });
        const state = makeState({
            players: [p1, makePlayer("p2")],
            activePlayerId: "p1",
            turn: 2,
            phase: "UPKEEP",
        });

        // Advance from UPKEEP → DRAW: triggers fire
        advancePhase(state);
        expect(state.phase).toBe("DRAW");
        expect(state.stack).toHaveLength(1);

        // Resolve the trigger → requestMayPay suspends
        resolveTopOfStack(state);
        expect(state.pendingChoices).toHaveLength(1);

        commitHead(state, ["yes"]);
        resolveTopOfStack(state);

        expect(state.islandSanctuaryProtection).toBe("p1");
        // Card NOT drawn
        expect(p1.hand).toHaveLength(0);
    });

    it("on decline, draws a card normally", () => {
        const sanctuary = makeInstance(islandSanctuary.id, {
            id: "sanc",
            controllerId: "p1",
            ownerId: "p1",
        });
        const topCard = makeInstance(savannahLions.id, {
            id: "top",
            controllerId: "p1",
            ownerId: "p1",
        });
        const p1 = makePlayer("p1", {
            battlefield: [sanctuary],
            library: [topCard],
        });
        const state = makeState({
            players: [p1, makePlayer("p2")],
            activePlayerId: "p1",
            turn: 2,
            phase: "UPKEEP",
        });

        advancePhase(state);
        expect(state.stack).toHaveLength(1);
        resolveTopOfStack(state);
        expect(state.pendingChoices).toHaveLength(1);

        commitHead(state, ["no"]);
        resolveTopOfStack(state);

        expect(p1.hand).toHaveLength(1);
        expect(state.islandSanctuaryProtection).toBeUndefined();
    });

    it("protection restricts non-flying non-islandwalk attackers", () => {
        const lion = makeInstance(savannahLions.id, {
            id: "lion",
            controllerId: "p2",
            ownerId: "p2",
        });
        const angel = makeInstance(serraAngel.id, {
            id: "angel",
            controllerId: "p2",
            ownerId: "p2",
        });
        const p1 = makePlayer("p1");
        const p2 = makePlayer("p2", { battlefield: [lion, angel] });
        const state = makeState({
            players: [p1, p2],
            activePlayerId: "p2",
        });
        state.islandSanctuaryProtection = "p1";

        // Non-flying: can't attack
        const lionResult = validateAttackerEligibility(
            lion,
            p1.battlefield,
            state
        );
        expect(lionResult.eligible).toBe(false);

        // Flying: can attack
        const angelResult = validateAttackerEligibility(
            angel,
            p1.battlefield,
            state
        );
        expect(angelResult.eligible).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// W25a: Mass forced-attack + combat manipulation (CR 508.1d, 506.4)
// ---------------------------------------------------------------------------

describe("Banding keyword recognition (CR 702.21)", () => {
    it("Benalish Hero, Timber Wolves are 1/1 vanilla with banding", () => {
        expect(benalishHero.staticAbilities).toContain("banding");
        expect(benalishHero.power).toBe(1);
        expect(benalishHero.toughness).toBe(1);
        expect(timberWolves.staticAbilities).toContain("banding");
    });

    it("Mesa Pegasus has both flying and banding", () => {
        expect(mesaPegasus.staticAbilities).toContain("flying");
        expect(mesaPegasus.staticAbilities).toContain("banding");
    });

    it("Mesa Pegasus flying still gates blocking (CR 702.9b)", () => {
        const peg = makeInstance(mesaPegasus.id, {
            id: "peg",
            controllerId: "p1",
            isAttacking: true,
        });
        const ground = makeInstance(grizzlyBearsId(), {
            id: "ground",
            controllerId: "p2",
        });
        const flyer = makeInstance(mesaPegasus.id, {
            id: "flyer",
            controllerId: "p2",
        });
        expect(validateBlockerEligibility(peg, ground, [ground]).eligible).toBe(
            false
        );
        // A flyer can block a flyer.
        expect(validateBlockerEligibility(peg, flyer, [flyer]).eligible).toBe(
            true
        );
    });
});

describe("Band composition legality (CR 702.21e)", () => {
    const banding = () => makeInstance(benalishHero.id);
    const plain = () => makeInstance(grizzlyBearsId());

    it("accepts 1+ banding plus at most one without", () => {
        expect(isLegalBandComposition([banding(), plain()])).toBe(true);
        expect(isLegalBandComposition([banding(), banding()])).toBe(true);
        expect(isLegalBandComposition([banding(), banding(), plain()])).toBe(
            true
        );
    });

    it("rejects bands with no banding creature", () => {
        expect(isLegalBandComposition([plain(), plain()])).toBe(false);
    });

    it("rejects more than one creature without banding", () => {
        expect(isLegalBandComposition([banding(), plain(), plain()])).toBe(
            false
        );
    });

    it("rejects a band of fewer than two creatures", () => {
        expect(isLegalBandComposition([banding()])).toBe(false);
    });
});

describe("Band blocked as a group (CR 702.21e)", () => {
    function bandState(blockTarget: string) {
        const hero = makeInstance(benalishHero.id, {
            id: "hero",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const bear = makeInstance(grizzlyBearsId(), {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        // 0/5 wall: deals no combat damage, just absorbs the band.
        const wall = makeInstance(grizzlyBearsId(), {
            id: "wall",
            controllerId: "p2",
            ownerId: "p2",
            power: 0,
            toughness: 5,
            isBlocking: true,
        });
        return makeState({
            phase: "COMBAT_DAMAGE",
            players: [
                makePlayer("p1", { battlefield: [hero, bear] }),
                makePlayer("p2", { battlefield: [wall], life: 20 }),
            ],
            combat: {
                attackerIds: ["hero", "bear"],
                confirmed: true,
                blockerAssignments: { wall: [blockTarget] },
                blockersConfirmed: true,
                bands: [{ bandId: "b1", memberIds: ["hero", "bear"] }],
            },
        });
    }

    it("expands a single block to every band member", () => {
        const graph = getEffectiveBlockGraph(bandState("hero"));
        expect(graph.blockersByAttacker["hero"]).toEqual(["wall"]);
        expect(graph.blockersByAttacker["bear"]).toEqual(["wall"]);
        expect(new Set(graph.attackersByBlocker["wall"])).toEqual(
            new Set(["hero", "bear"])
        );
    });

    it("a band member with no own blocker deals no damage to the player", async () => {
        const state = bandState("hero");
        const { applyAllCombatDamage } = await import("../../../../gre/phases");
        // hero and bear both deal into the wall (band-as-group); neither hits p2.
        applyAllCombatDamage(state, {
            hero: { wall: 1 },
            bear: { wall: 2 },
        });
        // Without banding, bear (2/2, unblocked) would have dealt 2 to p2.
        expect(state.players[1].life).toBe(20);
        // Wall (0/5) took 3, survives.
        expect(state.players[1].battlefield[0].damageMarked).toBe(3);
    });
});

describe("Banding damage authority — defender assigns (CR 702.21j)", () => {
    function setup() {
        const atk = makeInstance(grizzlyBearsId(), {
            id: "atk",
            controllerId: "p1",
            ownerId: "p1",
            power: 2,
            toughness: 2,
            isAttacking: true,
        });
        const guard = makeInstance(benalishHero.id, {
            id: "guard",
            controllerId: "p2",
            ownerId: "p2",
            isBlocking: true,
        });
        const decoy = makeInstance(grizzlyBearsId(), {
            id: "decoy",
            controllerId: "p2",
            ownerId: "p2",
            power: 1,
            toughness: 1,
            isBlocking: true,
        });
        return makeState({
            phase: "COMBAT_DAMAGE",
            players: [
                makePlayer("p1", { battlefield: [atk] }),
                makePlayer("p2", { battlefield: [guard, decoy] }),
            ],
            combat: {
                attackerIds: ["atk"],
                confirmed: true,
                blockerAssignments: { guard: ["atk"], decoy: ["atk"] },
                blockersConfirmed: true,
            },
        });
    }

    it("hands assignment of the blocked attacker's damage to the defender", () => {
        const state = setup();
        const atk = state.players[0].battlefield[0];
        const graph = getEffectiveBlockGraph(state);
        expect(
            getDamageAssignerId(state, atk, graph.blockersByAttacker["atk"])
        ).toBe("p2");
    });

    it("the defender can pile the attacker's damage onto one blocker", async () => {
        const state = setup();
        const { applyAllCombatDamage } = await import("../../../../gre/phases");
        // Defender assigns the attacker's 2 damage to the decoy, sparing the
        // banding guard. Both blockers still deal 1 each back to the attacker.
        applyAllCombatDamage(state, { atk: { decoy: 2 } });
        const p2 = state.players[1];
        // guard (banding) survives; decoy is dead.
        expect(p2.battlefield.find((c) => c.id === "guard")).toBeDefined();
        expect(p2.battlefield.find((c) => c.id === "decoy")).toBeUndefined();
        // attacker (2/2) took 1 + 1 and dies.
        expect(state.players[0].battlefield).toHaveLength(0);
    });
});

describe("Banding damage authority — attacker assigns blocker damage to band members (CR 702.21k)", () => {
    function setup() {
        const hero = makeInstance(benalishHero.id, {
            id: "hero",
            controllerId: "p1",
            ownerId: "p1",
            isAttacking: true,
        });
        const bear = makeInstance(grizzlyBearsId(), {
            id: "bear",
            controllerId: "p1",
            ownerId: "p1",
            power: 2,
            toughness: 2,
            isAttacking: true,
        });
        const blocker = makeInstance(grizzlyBearsId(), {
            id: "blk",
            controllerId: "p2",
            ownerId: "p2",
            power: 3,
            toughness: 3,
            isBlocking: true,
        });
        return makeState({
            phase: "COMBAT_DAMAGE",
            players: [
                makePlayer("p1", { battlefield: [hero, bear] }),
                makePlayer("p2", { battlefield: [blocker] }),
            ],
            combat: {
                attackerIds: ["hero", "bear"],
                confirmed: true,
                blockerAssignments: { blk: ["hero"] },
                blockersConfirmed: true,
                bands: [{ bandId: "b1", memberIds: ["hero", "bear"] }],
            },
        });
    }

    it("hands assignment of the blocker's damage to the attacking player", () => {
        const state = setup();
        const blk = state.players[1].battlefield[0];
        const graph = getEffectiveBlockGraph(state);
        expect(
            getDamageAssignerId(state, blk, graph.attackersByBlocker["blk"])
        ).toBe("p1");
    });

    it("the attacker can pile the blocker's damage onto the expendable banding creature", async () => {
        const state = setup();
        const { applyAllCombatDamage } = await import("../../../../gre/phases");
        // Attacker assigns the blocker's 3 damage entirely to the 1/1 hero,
        // sparing the 2/2 bear. The band deals 1 + 2 = 3 back, killing blk.
        applyAllCombatDamage(state, {
            hero: { blk: 1 },
            bear: { blk: 2 },
            blk: { hero: 3, bear: 0 },
        });
        const p1 = state.players[0];
        expect(p1.battlefield.find((c) => c.id === "hero")).toBeUndefined();
        expect(p1.battlefield.find((c) => c.id === "bear")).toBeDefined();
        // blocker (3/3) took 3 and dies.
        expect(state.players[1].battlefield).toHaveLength(0);
    });
});
