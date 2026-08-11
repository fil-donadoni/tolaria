// Legends (LEG) — white per-card behaviour tests (ADR 0043 colour split;
// twin of arn/leb colour test files). Each non-trivial card gets a describe
// block citing the CR section it exercises; assertions check external
// behaviour only. Shared shims live in ./helpers; fixtures in
// convex/cards/__tests__/setup.ts.

import { describe, it, expect } from "vitest";
import {
    ARMAGEDDON_ID,
    CLAY_STATUE_ID,
    COUNTERSPELL_ID,
    FOREST_ID,
    HEADLESS,
    PLAINS_ID,
    STONE_RAIN_ID,
    UPKEEP_C5,
    answerChoice,
    resolveActivated,
    resolveTrigger,
} from "./helpers";
import {
    akronLegionnaire,
    alabasterPotion,
    amrouKithkin,
    angelicVoices,
    azureDrake,
    cleanse,
    clergyOfTheHolyNimbus,
    concordantCrossroads,
    davenantArcher,
    devouringDeep,
    divineIntervention,
    divineOffering,
    divineTransformation,
    dwarvenSong,
    enchantedBeing,
    equinox,
    fortifiedArea,
    frostGiant,
    greatDefender,
    greatWall,
    greaterRealmOfPreservation,
    holyDay,
    indestructibleAura,
    infiniteAuthority,
    ivoryGuardians,
    jasmineBoreal,
    jovialEvil,
    keepersOfTheFaith,
    kismet,
    lifeblood,
    moat,
    osaiVultures,
    partWater,
    petraSphinx,
    presenceOfTheMaster,
    rapidFire,
    removeEnchantments,
    righteousAvengers,
    seeker,
    shieldWall,
    spiritLink,
    spiritualSanctuary,
    thunderSpirit,
    touchOfDarkness,
    tundraWolves,
    undertow,
    visions,
    wallOfCaltrops,
    wallOfLight,
} from "..";
import { projectPublicState } from "../../../../gameProjections";
import {
    getDamageAssignerId,
    hasBanding,
    recordBlockedAttackers,
} from "../../../../gre/banding";
import {
    validateAttackerEligibility,
    validateBlockerEligibility,
} from "../../../../gre/combat";
import { isCombatDamagePreventedFromSource } from "../../../../gre/combatDamagePrevention";
import { effectiveTriggeredAbilities } from "../../../../gre/copy";
import {
    STATIC_EFFECT_CTX,
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { enumerateMoves, type Move } from "../../../../gre/moves";
import { applyNameCardSubmit } from "../../../../gre/pendingChoiceSubmit";
import {
    advancePhase,
    applyAllCombatDamage,
    emitBlockersConfirmedEvents,
    finalizeCleanup,
} from "../../../../gre/phases";
import {
    getLegalActions,
    getLegalTargets,
    spellWouldDestroyLandControlledBy,
    NO_TARGETING_SOURCE,
} from "../../../../gre/rules";
import {
    applySourceStaticEffects,
    destroyWithReplacements,
    emitPermanentEntered,
    emitSpellCastEvent,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
    type StackItem,
} from "../../../../gre/state";
import {
    checkSpellTargetFilters,
    lowerSpellFilters,
    type TargetFilterCtx,
} from "../../../../gre/targetFilters";
import { type Phase } from "../../../../gre/types";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../__tests__/setup";
import { entersTappedByReplacement } from "../../../entersTapped";
import { getCardByName } from "../../../index";
import {
    blackLotus,
    forest,
    grizzlyBears,
    hypnoticSpecter,
    lightningBolt,
} from "../../lea";

// ---------------------------------------------------------------------------
// White free tranche (#371)
// ---------------------------------------------------------------------------

describe("LEG white keyword / vanilla creatures (CR 702)", () => {
    it("Thunder Spirit has flying and first strike", () => {
        expect(thunderSpirit.staticAbilities).toEqual(
            expect.arrayContaining(["flying", "first strike"])
        );
    });
    it("Wall of Light has defender and protection from black", () => {
        expect(wallOfLight.staticAbilities).toEqual(
            expect.arrayContaining(["defender", "protection from black"])
        );
    });
});

describe("Amrou Kithkin (can't be blocked by power ≥3, CR 509.1b)", () => {
    function setup(blockerPower: number) {
        const attacker = makeInstance(amrouKithkin.id, {
            id: "amrou",
            controllerId: "p1",
            isAttacking: true,
        });
        const blocker = makeInstance("d05b92bd-797e-413f-a8b0-32e0937a1ee0", {
            id: "blk",
            controllerId: "p2",
            power: blockerPower,
            toughness: 1,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [attacker] }),
                makePlayer("p2", { battlefield: [blocker] }),
            ],
        });
        return { state, attacker, blocker };
    }
    it("a power-2 creature may block it", () => {
        const { state, attacker, blocker } = setup(2);
        const res = validateBlockerEligibility(
            attacker,
            blocker,
            state.players[1].battlefield,
            state
        );
        expect(res.eligible).toBe(true);
    });
    it("a power-3 creature may not block it", () => {
        const { state, attacker, blocker } = setup(3);
        const res = validateBlockerEligibility(
            attacker,
            blocker,
            state.players[1].battlefield,
            state
        );
        expect(res.eligible).toBe(false);
    });
});

describe("Great Wall / Undertow (landwalk-negation static, CR 509.1b / 702.13)", () => {
    const plainsId = getCardByName("Plains").id;
    const islandId = getCardByName("Island").id;

    // Build a defender board: one matching basic land + a vanilla blocker +
    // optionally the negation enchantment. Returns the attacker, the blocker,
    // and the live state for `validateBlockerEligibility`.
    function setup(opts: {
        attackerId: string;
        landId: string;
        negationId?: string;
    }) {
        const attacker = makeInstance(opts.attackerId, {
            id: "atk",
            controllerId: "p1",
            isAttacking: true,
        });
        const blocker = makeInstance(tundraWolves.id, {
            id: "blk",
            controllerId: "p2",
        });
        const land = makeInstance(opts.landId, {
            id: "land",
            controllerId: "p2",
        });
        const defenderBattlefield = [blocker, land];
        if (opts.negationId) {
            defenderBattlefield.push(
                makeInstance(opts.negationId, {
                    id: "negation",
                    controllerId: "p2",
                })
            );
        }
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [attacker] }),
                makePlayer("p2", { battlefield: defenderBattlefield }),
            ],
        });
        return { state, attacker, blocker, defenderBattlefield };
    }

    it("plainswalk creature is unblockable behind a Plains with no Great Wall (CR 702.13b)", () => {
        const { attacker, blocker, defenderBattlefield, state } = setup({
            attackerId: righteousAvengers.id,
            landId: plainsId,
        });
        const res = validateBlockerEligibility(
            attacker,
            blocker,
            defenderBattlefield,
            state
        );
        expect(res.eligible).toBe(false);
    });

    it("Great Wall lets a plainswalk creature be blocked despite a Plains (CR 509.1b)", () => {
        const { attacker, blocker, defenderBattlefield, state } = setup({
            attackerId: righteousAvengers.id,
            landId: plainsId,
            negationId: greatWall.id,
        });
        const res = validateBlockerEligibility(
            attacker,
            blocker,
            defenderBattlefield,
            state
        );
        expect(res.eligible).toBe(true);
    });

    it("Undertow lets an islandwalk creature be blocked despite an Island (CR 509.1b)", () => {
        const { attacker, blocker, defenderBattlefield, state } = setup({
            attackerId: devouringDeep.id,
            landId: islandId,
            negationId: undertow.id,
        });
        const res = validateBlockerEligibility(
            attacker,
            blocker,
            defenderBattlefield,
            state
        );
        expect(res.eligible).toBe(true);
    });

    it("Great Wall negates only plainswalk — a swampwalk creature stays unblockable (CR 702.13)", () => {
        // Swampwalk attacker, defender controls a Swamp + Great Wall (plains).
        const attacker = makeInstance(righteousAvengers.id, {
            id: "atk",
            controllerId: "p1",
            isAttacking: true,
            staticAbilities: ["swampwalk"],
        });
        const blocker = makeInstance(tundraWolves.id, {
            id: "blk",
            controllerId: "p2",
        });
        const swamp = makeInstance(getCardByName("Swamp").id, {
            id: "swamp",
            controllerId: "p2",
        });
        const wall = makeInstance(greatWall.id, {
            id: "wall",
            controllerId: "p2",
        });
        const defenderBattlefield = [blocker, swamp, wall];
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [attacker] }),
                makePlayer("p2", { battlefield: defenderBattlefield }),
            ],
        });
        const res = validateBlockerEligibility(
            attacker,
            blocker,
            defenderBattlefield,
            state
        );
        expect(res.eligible).toBe(false);
    });

    it("Great Wall does not affect islandwalk (only its own subtype is negated)", () => {
        // Islandwalk attacker, defender controls an Island + Great Wall (plains).
        const { attacker, blocker, defenderBattlefield, state } = setup({
            attackerId: devouringDeep.id,
            landId: islandId,
            negationId: greatWall.id,
        });
        const res = validateBlockerEligibility(
            attacker,
            blocker,
            defenderBattlefield,
            state
        );
        expect(res.eligible).toBe(false);
    });

    it("definitions carry the parametric landwalk-negation static", () => {
        expect(greatWall.staticEffects).toEqual([
            expect.objectContaining({
                kind: "landwalk-negation",
                subtypes: ["Plains"],
            }),
        ]);
        expect(undertow.staticEffects).toEqual([
            expect.objectContaining({
                kind: "landwalk-negation",
                subtypes: ["Island"],
            }),
        ]);
    });
});

describe("Angelic Voices (+1/+1 while no nonartifact nonwhite creature, CR 611)", () => {
    it("buffs your creatures only while the condition holds (GRE + wire)", () => {
        const voices = makeInstance(angelicVoices.id, {
            id: "voices",
            controllerId: "p1",
        });
        const knight = makeInstance(keepersOfTheFaith.id, {
            id: "knight",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [voices, knight] }),
                makePlayer("p2"),
            ],
        });
        // White creature only on board → anthem active.
        expect(getEffectivePower(state, knight)).toBe(3);
        expect(getEffectiveToughness(state, knight)).toBe(4);

        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "knight"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(3);

        // Add a nonwhite, nonartifact creature → condition fails, anthem off.
        const ogre = makeInstance("0ddb98e8-13fe-4786-83f7-b72c56db135a", {
            id: "ogre",
            controllerId: "p1",
        }); // Hill Giant (red)
        state.players[0].battlefield.push(ogre);
        expect(getEffectivePower(state, knight)).toBe(2);
        expect(getEffectiveToughness(state, knight)).toBe(3);
    });
});

describe("Ivory Guardians (protection from red + conditional anthem, CR 611/702.16)", () => {
    it("named copies get +1/+1 only while an opponent has a nontoken red permanent", () => {
        const guard = makeInstance(ivoryGuardians.id, {
            id: "guard",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [guard] }),
                makePlayer("p2"),
            ],
        });
        // No opponent red permanent yet.
        expect(getEffectivePower(state, guard)).toBe(3);

        const redOgre = makeInstance("0ddb98e8-13fe-4786-83f7-b72c56db135a", {
            id: "ogre",
            controllerId: "p2",
        });
        state.players[1].battlefield.push(redOgre);
        expect(getEffectivePower(state, guard)).toBe(4);
        expect(getEffectiveToughness(state, guard)).toBe(4);

        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "guard"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(4);
    });
});

describe("Fortified Area (Walls you control +1/+0 and have banding, CR 611)", () => {
    it("buffs and grants banding to your Walls only (GRE + wire)", () => {
        const area = makeInstance(fortifiedArea.id, {
            id: "area",
            controllerId: "p1",
        });
        const wall = makeInstance(wallOfLight.id, {
            id: "wall",
            controllerId: "p1",
        });
        const oppWall = makeInstance(wallOfLight.id, {
            id: "oppwall",
            controllerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [area, wall] }),
                makePlayer("p2", { battlefield: [oppWall] }),
            ],
        });
        expect(getEffectivePower(state, wall)).toBe(2); // 1 + 1
        expect(getEffectivePower(state, oppWall)).toBe(1); // not yours

        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "wall"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(2);
    });
});

describe("Divine Transformation (aura +3/+3, CR 303.4)", () => {
    it("grants +3/+3 to the host (GRE + wire)", () => {
        const bear = makeInstance("d05b92bd-797e-413f-a8b0-32e0937a1ee0", {
            id: "bear",
            controllerId: "p1",
            power: 2,
            toughness: 2,
        });
        const aura = makeInstance(divineTransformation.id, {
            id: "aura",
            controllerId: "p1",
            attachedTo: "bear",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear, aura] }),
                makePlayer("p2"),
            ],
        });
        expect(getEffectivePower(state, bear)).toBe(5);
        expect(getEffectiveToughness(state, bear)).toBe(5);

        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "bear"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(5);
    });
});

describe("Seeker (host can't be blocked except by artifact/white creatures, CR 509.1b)", () => {
    function setup(blockerCardId: string) {
        const host = makeInstance("0ddb98e8-13fe-4786-83f7-b72c56db135a", {
            id: "host",
            controllerId: "p1",
            isAttacking: true,
        }); // Hill Giant (nonwhite, nonartifact)
        const aura = makeInstance(seeker.id, {
            id: "aura",
            controllerId: "p1",
            attachedTo: "host",
        });
        const blocker = makeInstance(blockerCardId, {
            id: "blk",
            controllerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [host, aura] }),
                makePlayer("p2", { battlefield: [blocker] }),
            ],
        });
        return { state, host, blocker };
    }
    it("a white creature may block the enchanted creature", () => {
        // Savannah Lions is white.
        const { state, host, blocker } = setup(
            "d05b92bd-797e-413f-a8b0-32e0937a1ee0"
        );
        expect(
            validateBlockerEligibility(
                host,
                blocker,
                state.players[1].battlefield,
                state
            ).eligible
        ).toBe(true);
    });
    it("a nonwhite, nonartifact creature may not block it", () => {
        // Hill Giant is red and nonartifact.
        const { state, host, blocker } = setup(
            "0ddb98e8-13fe-4786-83f7-b72c56db135a"
        );
        expect(
            validateBlockerEligibility(
                host,
                blocker,
                state.players[1].battlefield,
                state
            ).eligible
        ).toBe(false);
    });
});

describe("Spirit Link (gain life when enchanted creature deals damage, CR 303.4)", () => {
    it("gains life equal to damage dealt by the host", () => {
        const host = makeInstance("0ddb98e8-13fe-4786-83f7-b72c56db135a", {
            id: "host",
            controllerId: "p1",
        });
        const aura = makeInstance(spiritLink.id, {
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
        resolveTrigger(state, aura, "spirit-link-lifegain", {
            type: "DAMAGE_DEALT",
            sourceInstanceId: "host",
            sourceControllerId: "p1",
            target: { type: "player", id: "p2" },
            amount: 3,
            isCombat: true,
        } as StackItem["triggerEvent"]);
        expect(state.players[0].life).toBe(23);
    });
});

// ---------------------------------------------------------------------------
// Infinite Authority — {W}{W}{W} Aura. "Whenever enchanted creature blocks or
// becomes blocked by a creature with toughness 3 or less, destroy the other
// creature at end of combat. At the beginning of the next end step, if that
// creature was destroyed this way, put a +1/+1 counter on the first creature."
// (CR 303.4 aura, CR 509.1h combat pairing, CR 603.7a delayed destroy + counter)
// ---------------------------------------------------------------------------
describe("Infinite Authority (becomes-blocked-by → end-of-combat destroy + next-end-step counter, CR 509.1h / 603.7a)", () => {
    const GRIZZLY_ID = grizzlyBears.id; // 2/2

    // Enchanted host (p1) ATTACKS; an opponent (p2) creature with the given
    // toughness BLOCKS it. Block confirmed so `emitBlockersConfirmedEvents`
    // fires the per-pair trigger (CR 509.1h).
    function setupCombat(opts: { blockerToughness: number }) {
        const host = makeInstance(GRIZZLY_ID, {
            id: "host",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            isAttacking: true,
        });
        const aura = makeInstance(infiniteAuthority.id, {
            id: "aura",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
            attachedTo: "host",
        });
        const blocker = makeInstance(GRIZZLY_ID, {
            id: "blocker",
            controllerId: "p2",
            ownerId: "p2",
            zone: "battlefield",
            types: ["Creature"],
            toughness: opts.blockerToughness,
            isBlocking: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [host, aura] }),
                makePlayer("p2", { battlefield: [blocker] }),
            ],
            phase: "DECLARE_BLOCKERS",
            combat: {
                attackerIds: ["host"],
                confirmed: true,
                blockerAssignments: { blocker: ["host"] },
                blockersConfirmed: true,
            },
        });
        return { state, host, blocker };
    }

    it("triggers when the enchanted creature is blocked by a toughness-≤3 creature", () => {
        const { state } = setupCombat({ blockerToughness: 2 });
        emitBlockersConfirmedEvents(state);
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].triggeredAbilityId).toBe(
            "infinite-authority-combat-kill"
        );
    });

    it("fires ONCE per pair and references the OTHER creature (the blocker)", () => {
        const { state } = setupCombat({ blockerToughness: 2 });
        emitBlockersConfirmedEvents(state);
        expect(state.stack).toHaveLength(1);
        resolveTopOfStack(state);
        expect(state.delayedTriggers).toHaveLength(1);
        expect(state.delayedTriggers![0].timing).toBe("next-end-of-combat");
        expect(state.delayedTriggers![0].payload.targetId).toBe("blocker");
    });

    it("does NOT trigger when the blocker's toughness is 4 (CR 613 effective toughness)", () => {
        const { state } = setupCombat({ blockerToughness: 4 });
        emitBlockersConfirmedEvents(state);
        expect(state.stack).toHaveLength(0);
    });

    it("destroys the toughness-≤3 blocker at END_OF_COMBAT", () => {
        const { state } = setupCombat({ blockerToughness: 2 });
        emitBlockersConfirmedEvents(state);
        resolveTopOfStack(state); // schedule the deferred destroy
        state.phase = "COMBAT_DAMAGE";
        advancePhase(state);
        expect(state.phase).toBe("END_OF_COMBAT");
        expect(state.stack.length).toBeGreaterThanOrEqual(1);
        resolveTopOfStack(state); // resolve the deferred destroy
        const p2 = state.players[1];
        expect(p2.battlefield.find((c) => c.id === "blocker")).toBeUndefined();
        expect(p2.graveyard.find((c) => c.id === "blocker")).toBeDefined();
    });

    it("puts a +1/+1 counter on the enchanted creature at the NEXT end step (destroyed this way)", () => {
        const { state, host } = setupCombat({ blockerToughness: 2 });
        emitBlockersConfirmedEvents(state);
        resolveTopOfStack(state);
        // End-of-combat: destroy resolves AND schedules the counter trigger.
        state.phase = "COMBAT_DAMAGE";
        advancePhase(state);
        expect(state.phase).toBe("END_OF_COMBAT");
        resolveTopOfStack(state);
        // The "destroyed this way" marker IS the freshly-scheduled next-end-step
        // delayed trigger.
        const counterDelayed = state.delayedTriggers?.find(
            (t) => t.triggerId === "infinite-authority-counter"
        );
        expect(counterDelayed).toBeDefined();
        expect(counterDelayed!.timing).toBe("next-end-step");
        // Walk to the end step; the delayed trigger fires onto the stack.
        state.phase = "POSTCOMBAT_MAIN";
        advancePhase(state);
        expect(state.phase).toBe("END_STEP");
        expect(state.stack.length).toBeGreaterThanOrEqual(1);
        resolveTopOfStack(state);
        expect(host.counters?.["+1/+1"]).toBe(1);
        // Effective toughness reflects the counter (CR 613 layer 7c): 2 + 1.
        expect(getEffectiveToughness(state, host)).toBe(3);

        // Wire format (mandatory for a visible P/T effect): the +1/+1 counter
        // and the resulting effective toughness survive `projectPublicState`.
        const projected = projectPublicState(state, 0, "p1");
        const slimHost = projected.players[0].battlefield.find(
            (c) => c.id === "host"
        )!;
        expect(slimHost.counters?.["+1/+1"]).toBe(1);
        expect(getEffectiveToughness(projected, slimHost)).toBe(3);
    });

    it("does NOT add a counter when no creature was destroyed this way (toughness-4 blocker)", () => {
        const { state, host } = setupCombat({ blockerToughness: 4 });
        emitBlockersConfirmedEvents(state);
        // No trigger, no deferred destroy, no scheduled counter.
        state.phase = "COMBAT_DAMAGE";
        advancePhase(state);
        expect(
            state.delayedTriggers?.some(
                (t) => t.triggerId === "infinite-authority-counter"
            )
        ).toBeFalsy();
        state.phase = "POSTCOMBAT_MAIN";
        advancePhase(state);
        expect(host.counters?.["+1/+1"]).toBeUndefined();
    });
});

describe("Cleanse (destroy all black creatures, CR 701.7)", () => {
    it("destroys black creatures and spares others", () => {
        // Scathe Zombies (black) dies; Hill Giant (red) survives.
        const zombie = makeInstance("e9be6dcf-5e25-4b8c-9cd0-badf3771f81e", {
            id: "zombie",
            controllerId: "p2",
        });
        const giant = makeInstance("0ddb98e8-13fe-4786-83f7-b72c56db135a", {
            id: "giant",
            controllerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [zombie, giant] }),
            ],
        });
        pushSpell(state, cleanse.id, "p1");
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "zombie")
        ).toBeUndefined();
        expect(
            state.players[1].battlefield.find((c) => c.id === "giant")
        ).toBeDefined();
    });
});

describe("Divine Offering (destroy artifact + gain life = MV, CR 701.7)", () => {
    it("destroys the artifact and gains life equal to its mana value", () => {
        const artifact = makeInstance("4b71ff49-ee0a-4065-9131-380468d62a30", {
            id: "art",
            controllerId: "p2",
        }); // Flying Carpet (MV 4) from arn
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [artifact] }),
            ],
        });
        pushSpell(state, divineOffering.id, "p1", [
            { type: "permanent", id: "art" },
        ]);
        resolveTopOfStack(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "art")
        ).toBeUndefined();
        expect(state.players[0].life).toBe(24); // 20 + MV 4
    });
});

describe("Remove Enchantments (mass conditional return+destroy, CR 108.3/110.2/701)", () => {
    const HILL_GIANT = "0ddb98e8-13fe-4786-83f7-b72c56db135a"; // vanilla creature

    // Build a board exercising every ownership/control/attachment branch, then
    // resolve Remove Enchantments cast by p1.
    function setup() {
        // (1) Enchantment p1 owns AND controls → returned to p1's hand.
        const myEnch = makeInstance(presenceOfTheMaster.id, {
            id: "myEnch",
            ownerId: "p1",
            controllerId: "p1",
        });
        // (2) Enchantment p1 does NOT own but controls (gained control) →
        //     destroyed ("all other enchantments you control").
        const foreignEnch = makeInstance(fortifiedArea.id, {
            id: "foreignEnch",
            ownerId: "p2",
            controllerId: "p1",
        });
        // (3) Unrelated enchantment p2 owns+controls → untouched.
        const otherEnch = makeInstance(fortifiedArea.id, {
            id: "otherEnch",
            ownerId: "p2",
            controllerId: "p2",
        });

        // p1's creature host (for an Aura on a permanent p1 controls).
        const myCreature = makeInstance(HILL_GIANT, {
            id: "myCreature",
            ownerId: "p1",
            controllerId: "p1",
        });
        // p2's ATTACKING creature host (for an Aura on an opponent's attacker).
        const oppAttacker = makeInstance(HILL_GIANT, {
            id: "oppAttacker",
            ownerId: "p2",
            controllerId: "p2",
            isAttacking: true,
        });
        // p2's NON-attacking creature host (Aura here is out of scope).
        const oppIdle = makeInstance(HILL_GIANT, {
            id: "oppIdle",
            ownerId: "p2",
            controllerId: "p2",
        });

        // (4) Aura p1 owns on a permanent p1 controls → returned to p1's hand,
        //     NOT destroyed.
        const myAuraOnMine = makeInstance(spiritLink.id, {
            id: "myAuraOnMine",
            ownerId: "p1",
            controllerId: "p1",
            attachedTo: "myCreature",
        });
        // (5) Aura p1 owns on an opponent's ATTACKING creature → returned.
        const myAuraOnAttacker = makeInstance(spiritLink.id, {
            id: "myAuraOnAttacker",
            ownerId: "p1",
            controllerId: "p1",
            attachedTo: "oppAttacker",
        });
        // (6) Aura p2 owns on a permanent p1 controls → destroyed
        //     ("all other Auras attached to permanents you control").
        const foreignAuraOnMine = makeInstance(divineTransformation.id, {
            id: "foreignAuraOnMine",
            ownerId: "p2",
            controllerId: "p2",
            attachedTo: "myCreature",
        });
        // (7) Aura p1 owns on an opponent's NON-attacking creature → out of
        //     scope (no clause matches) → untouched.
        const myAuraOnIdleOpp = makeInstance(spiritLink.id, {
            id: "myAuraOnIdleOpp",
            ownerId: "p1",
            controllerId: "p1",
            attachedTo: "oppIdle",
        });

        const state = makeState({
            phase: "DECLARE_ATTACKERS" as Phase,
            players: [
                makePlayer("p1", {
                    battlefield: [
                        myEnch,
                        foreignEnch,
                        myCreature,
                        myAuraOnMine,
                        myAuraOnAttacker,
                        myAuraOnIdleOpp,
                    ],
                }),
                makePlayer("p2", {
                    battlefield: [
                        otherEnch,
                        oppAttacker,
                        oppIdle,
                        foreignAuraOnMine,
                    ],
                }),
            ],
        });
        return state;
    }

    function onBattlefield(state: ReturnType<typeof setup>, id: string) {
        return state.players.some((p) =>
            p.battlefield.some((c) => c.id === id)
        );
    }
    function inHand(
        state: ReturnType<typeof setup>,
        playerIdx: number,
        id: string
    ) {
        return state.players[playerIdx].hand.some((c) => c.id === id);
    }

    it("returns owned enchantments/Auras in scope and destroys the rest (CR 108.3 owner vs CR 110.2 control)", () => {
        const state = setup();
        pushSpell(state, removeEnchantments.id, "p1");
        resolveTopOfStack(state);

        // Returned to p1's hand (owned + in scope):
        expect(inHand(state, 0, "myEnch")).toBe(true); // own+control enchantment
        expect(inHand(state, 0, "myAuraOnMine")).toBe(true); // Aura on my permanent
        expect(inHand(state, 0, "myAuraOnAttacker")).toBe(true); // Aura on opp attacker

        // Destroyed (in scope but not owned by p1):
        expect(onBattlefield(state, "foreignEnch")).toBe(false); // enchantment p1 controls, p2 owns
        expect(onBattlefield(state, "foreignAuraOnMine")).toBe(false); // Aura on my permanent, p2 owns

        // Untouched (out of scope):
        expect(onBattlefield(state, "otherEnch")).toBe(true); // p2 own+control enchantment
        expect(onBattlefield(state, "myAuraOnIdleOpp")).toBe(true); // Aura on opp NON-attacker

        // Returned cards were not also destroyed (return precedes destroy):
        expect(onBattlefield(state, "myEnch")).toBe(false);
        expect(onBattlefield(state, "myAuraOnMine")).toBe(false);
        expect(onBattlefield(state, "myAuraOnAttacker")).toBe(false);

        // Hosts and unrelated permanents survive the sweep.
        expect(onBattlefield(state, "myCreature")).toBe(true);
        expect(onBattlefield(state, "oppAttacker")).toBe(true);
    });
});

describe("Great Defender (+0/+X where X = target's MV, CR 202.3)", () => {
    it("buffs toughness by the target's mana value until end of turn", () => {
        // Serra Angel MV 5.
        const angel = makeInstance("f8ac5006-91bd-4803-93da-f87cf196dd2f", {
            id: "angel",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [angel] }),
                makePlayer("p2"),
            ],
        });
        const baseTough = getEffectiveToughness(state, angel);
        pushSpell(state, greatDefender.id, "p1", [
            { type: "permanent", id: "angel" },
        ]);
        resolveTopOfStack(state);
        expect(getEffectiveToughness(state, angel)).toBe(baseTough + 5);
    });
});

describe("Shield Wall (+0/+2 to your creatures EOT, CR 611.1)", () => {
    it("buffs every creature you control", () => {
        const c1 = makeInstance(keepersOfTheFaith.id, {
            id: "c1",
            controllerId: "p1",
        });
        const c2 = makeInstance(keepersOfTheFaith.id, {
            id: "c2",
            controllerId: "p1",
        });
        const opp = makeInstance(keepersOfTheFaith.id, {
            id: "opp",
            controllerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [c1, c2] }),
                makePlayer("p2", { battlefield: [opp] }),
            ],
        });
        pushSpell(state, shieldWall.id, "p1");
        resolveTopOfStack(state);
        expect(getEffectiveToughness(state, c1)).toBe(5); // 3 + 2
        expect(getEffectiveToughness(state, c2)).toBe(5);
        expect(getEffectiveToughness(state, opp)).toBe(3); // unaffected
    });
});

describe("Holy Day (prevent all combat damage this turn, CR 615)", () => {
    it("sets the combat-damage prevention flag", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        pushSpell(state, holyDay.id, "p1");
        resolveTopOfStack(state);
        expect(state.preventAllCombatDamageThisTurn).toBe(true);
    });
});

describe("Indestructible Aura (prevent all damage to target this turn, CR 615)", () => {
    it("records a damage-prevention shield on the target", () => {
        const bear = makeInstance("d05b92bd-797e-413f-a8b0-32e0937a1ee0", {
            id: "bear",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [bear] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, indestructibleAura.id, "p1", [
            { type: "permanent", id: "bear" },
        ]);
        resolveTopOfStack(state);
        expect((state.targetPreventionShields ?? []).length).toBeGreaterThan(0);
    });
});

describe("Alabaster Potion (modal: gain X life / prevent X damage, CR 700.2)", () => {
    it("gain-life mode gives the target player X life", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const item = pushSpell(state, alabasterPotion.id, "p1", [
            { type: "player", id: "p1" },
        ]);
        item.chosenModeId = "gain-life";
        item.chosenX = 3;
        resolveTopOfStack(state);
        expect(state.players[0].life).toBe(23);
    });
});

describe("Spiritual Sanctuary (upkeep: if Plains, gain 1, CR 603.6a)", () => {
    it("grants 1 life on the upkeep of a player controlling a Plains", () => {
        const sanct = makeInstance(spiritualSanctuary.id, {
            id: "sanct",
            controllerId: "p1",
        });
        const plains = makeInstance("b1623d57-4729-4796-b3f7-f1837a05c6ed", {
            id: "plains",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [sanct, plains] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(state, sanct, "spiritual-sanctuary-lifegain", {
            type: "PHASE_BEGIN",
            phase: "UPKEEP",
            activePlayerId: "p1",
        } as StackItem["triggerEvent"]);
        expect(state.players[0].life).toBe(21);
    });
});

describe("Lifeblood (opponent's Mountain tapped → gain 1, CR 701.20a)", () => {
    it("gains 1 life when an opponent's Mountain becomes tapped", () => {
        const lb = makeInstance(lifeblood.id, {
            id: "lb",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [lb] }),
                makePlayer("p2"),
            ],
        });
        resolveTrigger(state, lb, "lifeblood-mountain-tapped", {
            type: "PERMANENT_TAPPED",
            permanentId: "mtn",
            controllerId: "p2",
            permanentTypes: ["Land"],
            permanentSubtypes: ["Mountain"],
            forMana: false,
        } as StackItem["triggerEvent"]);
        expect(state.players[0].life).toBe(21);
    });
});

describe("Presence of the Master (counter enchantment spells, CR 701.5a)", () => {
    it("counters an enchantment spell cast by any player", () => {
        const presence = makeInstance(presenceOfTheMaster.id, {
            id: "presence",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [presence] }),
                makePlayer("p2"),
            ],
        });
        // An enchantment spell on the stack (Spiritual Sanctuary as a stand-in).
        const ench = pushSpell(state, spiritualSanctuary.id, "p2");
        resolveTrigger(state, presence, "presence-of-the-master-counter", {
            type: "SPELL_CAST",
            casterId: "p2",
            spellInstanceId: ench.id,
            spellCardId: spiritualSanctuary.id,
            spellTypes: ["Enchantment"],
            spellSubtypes: [],
            spellColors: ["W"],
        } as StackItem["triggerEvent"]);
        expect(state.stack.find((s) => s.id === ench.id)).toBeUndefined();
    });
});

describe("Visions (look at top 5, may shuffle, CR 401.4)", () => {
    it("marks the top five cards known to the caster then optionally shuffles", () => {
        const lib = Array.from({ length: 6 }, (_, i) =>
            makeInstance("d05b92bd-797e-413f-a8b0-32e0937a1ee0", {
                id: `lib-${i}`,
                controllerId: "p2",
                ownerId: "p2",
                zone: "library",
            })
        );
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2", { library: lib })],
        });
        pushSpell(state, visions.id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        // Suspended on the may-shuffle choice — answer "decline" (no shuffle).
        const top5 = state.players[1].library.slice(0, 5);
        expect(top5.every((c) => c.knownTo?.includes("p1"))).toBe(true);
        answerChoice(state, ["no"]);
        // No throw; resolution completed.
        expect(state.stack).toHaveLength(0);
    });
});

describe("Part Water (X creatures gain islandwalk EOT, CR 702.19)", () => {
    it("grants islandwalk to each target", () => {
        const a = makeInstance(keepersOfTheFaith.id, {
            id: "a",
            controllerId: "p1",
        });
        const b = makeInstance(keepersOfTheFaith.id, {
            id: "b",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [a, b] }),
                makePlayer("p2"),
            ],
        });
        const item = pushSpell(state, partWater.id, "p1", [
            { type: "permanent", id: "a" },
            { type: "permanent", id: "b" },
        ]);
        item.chosenX = 2;
        resolveTopOfStack(state);
        expect(
            state.players[0].battlefield
                .find((c) => c.id === "a")!
                .staticAbilities?.includes("islandwalk")
        ).toBe(true);
        expect(
            state.players[0].battlefield
                .find((c) => c.id === "b")!
                .staticAbilities?.includes("islandwalk")
        ).toBe(true);
    });
});

describe("Osai Vultures (end-step carrion accrual + remove-two pump, CR 603.4 / 122 / 700.4)", () => {
    function setup(deaths: number) {
        const vultures = makeInstance(osaiVultures.id, {
            id: "vultures",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            phase: "END_STEP",
            activePlayerId: "p1",
            players: [
                makePlayer("p1", { battlefield: [vultures] }),
                makePlayer("p2"),
            ],
        });
        if (deaths > 0) state.deathsThisTurn = deaths;
        return { state, vultures };
    }

    const endStep = (playerId: string): StackItem["triggerEvent"] =>
        ({
            type: "PHASE_BEGIN" as const,
            phase: "END_STEP" as const,
            activePlayerId: playerId,
        }) as StackItem["triggerEvent"];

    it("gains a carrion counter at the end step when a creature died this turn (CR 603.4)", () => {
        const { state, vultures } = setup(1);
        resolveTrigger(state, vultures, "osai-vultures-carrion", endStep("p1"));
        const live = state.players[0].battlefield.find(
            (c) => c.id === "vultures"
        )!;
        expect(live.counters?.carrion).toBe(1);
    });

    it("gains exactly ONE carrion counter regardless of how many creatures died (printed ruling)", () => {
        const { state, vultures } = setup(3);
        resolveTrigger(state, vultures, "osai-vultures-carrion", endStep("p1"));
        const live = state.players[0].battlefield.find(
            (c) => c.id === "vultures"
        )!;
        expect(live.counters?.carrion).toBe(1);
    });

    it("adds NO counter on a turn with no deaths (intervening-if fizzles, CR 603.4)", () => {
        const { state, vultures } = setup(0);
        resolveTrigger(state, vultures, "osai-vultures-carrion", endStep("p1"));
        const live = state.players[0].battlefield.find(
            (c) => c.id === "vultures"
        )!;
        expect(live.counters?.carrion).toBeUndefined();
    });

    it("the carrion counter survives projection (wire format)", () => {
        const { state, vultures } = setup(1);
        resolveTrigger(state, vultures, "osai-vultures-carrion", endStep("p1"));
        const projected = projectPublicState(state, 0, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "vultures"
        )!;
        expect(slim.counters?.carrion).toBe(1);
    });

    it("removes two carrion counters to pump itself +1/+1 until end of turn (CR 122.6 / 611.1)", () => {
        const vultures = makeInstance(osaiVultures.id, {
            id: "vultures",
            controllerId: "p1",
            ownerId: "p1",
            counters: { carrion: 2 },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [vultures] }),
                makePlayer("p2"),
            ],
        });
        expect(getEffectivePower(state, vultures)).toBe(1);
        expect(getEffectiveToughness(state, vultures)).toBe(1);
        // The activation cost (remove two carrion counters) is paid at
        // activation commit; mirror that here before resolving the effect.
        vultures.counters = { carrion: 0 };
        resolveActivated(state, vultures, "osai-vultures-pump");
        const live = state.players[0].battlefield.find(
            (c) => c.id === "vultures"
        )!;
        expect(getEffectivePower(state, live)).toBe(2);
        expect(getEffectiveToughness(state, live)).toBe(2);
        // Wire format: the +1/+1 EOT buff survives projection.
        const projected = projectPublicState(state, 0, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "vultures"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(2);
        expect(getEffectiveToughness(projected, slim)).toBe(2);
    });

    it("the pump expires at cleanup (CR 514.2 end-of-turn duration)", () => {
        const vultures = makeInstance(osaiVultures.id, {
            id: "vultures",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            phase: "END_STEP",
            activePlayerId: "p1",
            players: [
                makePlayer("p1", { battlefield: [vultures] }),
                makePlayer("p2"),
            ],
        });
        resolveActivated(state, vultures, "osai-vultures-pump");
        const live = state.players[0].battlefield.find(
            (c) => c.id === "vultures"
        )!;
        expect(getEffectivePower(state, live)).toBe(2);
        // advancePhase from END_STEP traverses CLEANUP (auto) and purges
        // until-end-of-turn buffs (CR 514.2).
        advancePhase(state);
        const after = state.players[0].battlefield.find(
            (c) => c.id === "vultures"
        )!;
        expect(getEffectivePower(state, after)).toBe(1);
        expect(getEffectiveToughness(state, after)).toBe(1);
    });
});

describe("Jovial Evil (X = 2× white creatures opponent controls, CR 120.1)", () => {
    it("deals twice the opponent's white-creature count", () => {
        // keepersOfTheFaith is a white creature.
        const w1 = makeInstance(keepersOfTheFaith.id, {
            id: "w1",
            controllerId: "p2",
        });
        const w2 = makeInstance(keepersOfTheFaith.id, {
            id: "w2",
            controllerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [w1, w2] }),
            ],
        });
        pushSpell(state, jovialEvil.id, "p1", [{ type: "player", id: "p2" }]);
        resolveTopOfStack(state);
        // 2 white creatures × 2 = 4 damage.
        expect(state.players[1].life).toBe(16);
    });
});

describe("Touch of Darkness (creatures become black EOT, CR 305.7 layer 5)", () => {
    it("makes targeted creatures black, surviving projection (wire format)", () => {
        const lion = makeInstance(keepersOfTheFaith.id, {
            id: "lion",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [lion] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, touchOfDarkness.id, "p1", [
            { type: "permanent", id: "lion" },
        ]);
        resolveTopOfStack(state);
        expect(STATIC_EFFECT_CTX.getColors(lion)).toEqual(["B"]);
        const projected = projectPublicState(state, 0, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "lion"
        )!;
        expect(STATIC_EFFECT_CTX.getColors(slim)).toEqual(["B"]);
    });
});

describe("Dwarven Song (creatures become red EOT, CR 305.7 layer 5)", () => {
    it("makes targeted creatures red, surviving projection (wire format)", () => {
        const lion = makeInstance(keepersOfTheFaith.id, {
            id: "lion",
            controllerId: "p1",
            ownerId: "p1",
        }); // white creature
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [lion] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, dwarvenSong.id, "p1", [
            { type: "permanent", id: "lion" },
        ]);
        resolveTopOfStack(state);
        expect(STATIC_EFFECT_CTX.getColors(lion)).toEqual(["R"]);

        const projected = projectPublicState(state, 0, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "lion"
        )!;
        expect(STATIC_EFFECT_CTX.getColors(slim)).toEqual(["R"]);
    });

    // Issue #1833: the color change is "until end of turn" (CR 305.7) — a
    // permanent override is a rules violation for every color-matters
    // interaction (protection, devotion, "target white creature", …) for
    // the rest of the game.
    it("reverts to its original color at cleanup (CR 305.7, issue #1833)", () => {
        const lion = makeInstance(keepersOfTheFaith.id, {
            id: "lion",
            controllerId: "p1",
            ownerId: "p1",
        }); // white creature
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [lion] }),
                makePlayer("p2"),
            ],
        });
        pushSpell(state, dwarvenSong.id, "p1", [
            { type: "permanent", id: "lion" },
        ]);
        resolveTopOfStack(state);
        expect(STATIC_EFFECT_CTX.getColors(lion)).toEqual(["R"]);

        state.phase = "CLEANUP";
        finalizeCleanup(state);

        expect(STATIC_EFFECT_CTX.getColors(lion)).toEqual(["W"]);
        const projected = projectPublicState(state, 0, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "lion"
        )!;
        expect(STATIC_EFFECT_CTX.getColors(slim)).toEqual(["W"]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Rapid Fire ({3}{W} instant, #494) — cast only before blockers are declared
// (CR 117.1b); target gains first strike EOT (CR 702.7, 611.2a) and, only if it
// has no rampage, rampage 2 EOT (CR 702.23). Composes existing rampage (#380)
// and first-strike grants with a conditional grant + the parametric cast-phase
// restriction (shared with Teleport / Berserk).
// ─────────────────────────────────────────────────────────────────────────────
describe("Rapid Fire (CR 117.1b cast timing + CR 702.23 conditional rampage)", () => {
    /** A single creature on p1's battlefield + Rapid Fire in p1's hand with a
     *  full mana pool, p1 holding priority. `creatureDef` lets a test field a
     *  vanilla creature or a printed-rampage creature. */
    function setup(
        creatureDef: { id: string },
        phase: Phase = "DECLARE_ATTACKERS"
    ) {
        const creature = makeInstance(creatureDef.id, {
            id: "tgt",
            controllerId: "p1",
            ownerId: "p1",
        });
        const handCard = makeInstance(rapidFire.id, {
            id: "rf",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            phase,
            priorityPlayerId: "p1",
            activePlayerId: "p1",
            players: [
                makePlayer("p1", {
                    battlefield: [creature],
                    hand: [handCard],
                    manaPool: { W: 1, U: 0, B: 0, R: 0, G: 0, C: 3 },
                }),
                makePlayer("p2"),
            ],
        });
        return { state, creature, handCard };
    }

    /** Pushes Rapid Fire on the stack targeting `tgt` and resolves it. */
    function castAtTarget(state: GameState): void {
        pushSpell(state, rapidFire.id, "p1", [
            { type: "permanent", id: "tgt" },
        ]);
        resolveTopOfStack(state);
    }

    function liveTarget(state: GameState): CardInstanceState {
        return state.players[0].battlefield.find((c) => c.id === "tgt")!;
    }

    it("cast is LEGAL up to and including declare-attackers (CR 117.1b)", () => {
        for (const phase of [
            "PRECOMBAT_MAIN",
            "BEGINNING_OF_COMBAT",
            "DECLARE_ATTACKERS",
        ] as Phase[]) {
            const { state, handCard } = setup(grizzlyBears, phase);
            const actions = getLegalActions(state, state.players[0], handCard);
            expect(actions).toContain("cast");
        }
    });

    it("cast is ILLEGAL once declare-blockers (or later) has begun (CR 117.1b)", () => {
        for (const phase of [
            "DECLARE_BLOCKERS",
            "COMBAT_DAMAGE",
            "END_OF_COMBAT",
        ] as Phase[]) {
            const { state, handCard } = setup(grizzlyBears, phase);
            const actions = getLegalActions(state, state.players[0], handCard);
            expect(actions).not.toContain("cast");
        }
    });

    it("grants first strike until end of turn (CR 702.7, 611.2a)", () => {
        const { state } = setup(grizzlyBears);
        castAtTarget(state);
        const t = liveTarget(state);
        expect(t.staticAbilities).toContain("first strike");
        expect(
            t.grantedStaticAbilities?.some(
                (g) => g.ability === "first strike" && g.duration
            )
        ).toBe(true);
    });

    it("target WITHOUT rampage gains rampage 2 EOT — keyword + trigger (CR 702.23)", () => {
        const { state } = setup(grizzlyBears);
        castAtTarget(state);
        const t = liveTarget(state);
        expect(t.staticAbilities).toContain("rampage 2");
        // The matching rampageTrigger(2) is granted for the duration.
        expect(
            effectiveTriggeredAbilities(t).some((a) => a.id === "rampage-2")
        ).toBe(true);
        expect(
            t.grantedTriggeredAbilities?.some(
                (g) => g.abilityId === "rampage-2" && g.duration
            )
        ).toBe(true);
    });

    it("granted rampage 2 actually fires in combat: blocked by THREE → +4/+4", () => {
        const { state } = setup(grizzlyBears);
        castAtTarget(state); // grizzly (2/2) now has rampage 2 EOT
        // Stage a combat where the granted creature attacks into three blockers.
        const t = liveTarget(state);
        t.isAttacking = true;
        const blockers = ["b0", "b1", "b2"].map((id) =>
            makeInstance(grizzlyBears.id, {
                id,
                controllerId: "p2",
                ownerId: "p2",
                isBlocking: true,
            })
        );
        state.players[1].battlefield.push(...blockers);
        state.phase = "DECLARE_BLOCKERS";
        state.combat = {
            attackerIds: ["tgt"],
            confirmed: true,
            blockerAssignments: { b0: ["tgt"], b1: ["tgt"], b2: ["tgt"] },
            blockersConfirmed: true,
        };
        recordBlockedAttackers(state);
        emitBlockersConfirmedEvents(state);
        expect(
            state.stack.filter((s) => s.triggeredAbilityId === "rampage-2")
        ).toHaveLength(1);
        resolveTopOfStack(state);
        const atk = liveTarget(state);
        // base 2/2, rampage 2 × (3 − 1) = +4/+4 → 6/6.
        expect(getEffectivePower(state, atk)).toBe(6);
        expect(getEffectiveToughness(state, atk)).toBe(6);
    });

    it("target that ALREADY has rampage gains NO extra rampage (CR 702.23)", () => {
        // Frost Giant has printed rampage 2.
        const { state } = setup(frostGiant);
        castAtTarget(state);
        const t = liveTarget(state);
        // First strike still granted…
        expect(t.staticAbilities).toContain("first strike");
        // …but rampage is NOT re-granted: exactly one "rampage 2" keyword (the
        // printed one), and no duration-scoped granted rampage trigger.
        expect(
            t.staticAbilities.filter((a) => a.startsWith("rampage"))
        ).toEqual(["rampage 2"]);
        expect(
            t.grantedStaticAbilities?.some((g) =>
                g.ability.startsWith("rampage")
            )
        ).not.toBe(true);
        expect(t.grantedTriggeredAbilities?.some((g) => g.duration)).not.toBe(
            true
        );
    });

    it("both grants wear off at end of turn (CR 514.2 cleanup)", () => {
        const { state } = setup(grizzlyBears, "END_STEP");
        castAtTarget(state);
        const before = liveTarget(state);
        expect(before.staticAbilities).toContain("first strike");
        expect(before.staticAbilities).toContain("rampage 2");
        // advancePhase from END_STEP traverses CLEANUP (auto) and purges EOT grants.
        advancePhase(state);
        const after = liveTarget(state);
        expect(after.staticAbilities).not.toContain("first strike");
        expect(after.staticAbilities).not.toContain("rampage 2");
        expect(after.grantedTriggeredAbilities).toBeUndefined();
        expect(
            effectiveTriggeredAbilities(after).some((a) => a.id === "rampage-2")
        ).toBe(false);
    });

    it("wire format: granted first strike + rampage survive projectPublicState", () => {
        const { state } = setup(grizzlyBears);
        castAtTarget(state);
        for (const viewer of ["p1", "p2"] as const) {
            const projected = projectPublicState(state, 1, viewer);
            const slim = projected.players[0].battlefield.find(
                (c) => c.id === "tgt"
            )!;
            expect(slim.staticAbilities).toContain("first strike");
            expect(slim.staticAbilities).toContain("rampage 2");
            expect(
                effectiveTriggeredAbilities(slim).some(
                    (a) => a.id === "rampage-2"
                )
            ).toBe(true);
        }
    });
});

describe("Divine Intervention (counter-driven game draw, CR 122 / 104.4a)", () => {
    function setup(counters: number) {
        const di = makeInstance(divineIntervention.id, {
            id: "di",
            controllerId: "p1",
            counters: { intervention: counters },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [di] }),
                makePlayer("p2"),
            ],
        });
        return { state, di };
    }

    it("upkeep removal from two → one does NOT end the game", () => {
        const { state, di } = setup(2);
        resolveTrigger(
            state,
            di,
            "divine-intervention-upkeep",
            UPKEEP_C5("p1")
        );
        expect(di.counters?.intervention).toBe(1);
        expect(state.gameOver).toBeUndefined();
    });

    it("removing the LAST counter ends the game in a draw (CR 104.4a)", () => {
        const { state, di } = setup(1);
        resolveTrigger(
            state,
            di,
            "divine-intervention-upkeep",
            UPKEEP_C5("p1")
        );
        expect(state.gameOver?.isDraw).toBe(true);
        expect(state.gameOver?.reason).toBe("draw");
        expect(state.gameOver?.winnerId).toBe("");
        expect(state.gameOver?.loserId).toBe("");
    });
});

describe("Arboria qualifying-action tracking (CR 508.1c plumbing)", () => {
    it("casting a spell sets the caster's qualifyingActionThisTurn flag", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const spell = pushSpell(state, amrouKithkin.id, "p1");
        emitSpellCastEvent(state, spell);
        expect(state.players[0].qualifyingActionThisTurn).toBe(true);
        expect(state.players[1].qualifyingActionThisTurn).toBeUndefined();
    });

    it("a nontoken permanent ETB sets the controller's flag; a token does not", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const nontoken = makeInstance(amrouKithkin.id, { controllerId: "p2" });
        emitPermanentEntered(state, nontoken);
        expect(state.players[1].qualifyingActionThisTurn).toBe(true);

        const fresh = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        const token = makeInstance(amrouKithkin.id, {
            controllerId: "p2",
            isToken: true,
        });
        emitPermanentEntered(fresh, token);
        expect(fresh.players[1].qualifyingActionThisTurn).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// D'Avenant Archer — {T}: 1 damage to target attacking OR blocking creature
// (CR 508.1 / 509.1). Exercises the array form of `combatRoleFilter`.
// ---------------------------------------------------------------------------

describe("D'Avenant Archer ({T}: ping attacking-or-blocking, CR 508.1/509.1)", () => {
    const ARCHER_REQ = davenantArcher.activatedAbilities![0].targetRequirement!;

    it("getLegalTargets with role array admits both attackers and blockers, rejects idle creatures", () => {
        const attacker = makeInstance(HEADLESS, {
            id: "atk",
            controllerId: "p2",
            isAttacking: true,
        });
        const blocker = makeInstance(HEADLESS, {
            id: "blk",
            controllerId: "p1",
            isBlocking: true,
        });
        const idle = makeInstance(HEADLESS, { id: "idle", controllerId: "p2" });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [blocker] }),
                makePlayer("p2", { battlefield: [attacker, idle] }),
            ],
        });
        const legal = getLegalTargets(
            state,
            ARCHER_REQ,
            NO_TARGETING_SOURCE,
            "p1"
        ).map((t) => t.id);
        expect(legal).toContain("atk");
        expect(legal).toContain("blk");
        expect(legal).not.toContain("idle");
    });

    it("deals 1 damage to a chosen attacking creature", () => {
        const archer = makeInstance(davenantArcher.id, {
            id: "archer",
            controllerId: "p1",
        });
        const attacker = makeInstance(HEADLESS, {
            id: "atk",
            controllerId: "p2",
            isAttacking: true,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [archer] }),
                makePlayer("p2", { battlefield: [attacker] }),
            ],
        });
        resolveActivated(state, archer, "davenant-archer-ping", [
            { type: "permanent", id: "atk" },
        ]);
        const hit = state.players[1].battlefield.find((c) => c.id === "atk")!;
        expect(hit.damageMarked).toBe(1);
    });
});

describe("Moat (creatures without flying can't attack, CR 508.1c)", () => {
    it("forbids a non-flying creature from attacking", () => {
        const moatInst = makeInstance(moat.id, { controllerId: "p1" });
        const grounded = makeInstance(tundraWolves.id, {
            id: "grounded",
            controllerId: "p1",
            isSummoningSick: false,
        });
        const state = makeState({
            phase: "DECLARE_ATTACKERS",
            activePlayerId: "p1",
            players: [
                makePlayer("p1", { battlefield: [moatInst, grounded] }),
                makePlayer("p2"),
            ],
        });
        const v = validateAttackerEligibility(grounded, [], state);
        expect(v.eligible).toBe(false);
    });

    it("allows a flier to attack", () => {
        const moatInst = makeInstance(moat.id, { controllerId: "p1" });
        const flier = makeInstance(azureDrake.id, {
            id: "flier",
            controllerId: "p1",
            isSummoningSick: false,
        });
        const state = makeState({
            phase: "DECLARE_ATTACKERS",
            activePlayerId: "p1",
            players: [
                makePlayer("p1", { battlefield: [moatInst, flier] }),
                makePlayer("p2"),
            ],
        });
        expect(validateAttackerEligibility(flier, [], state).eligible).toBe(
            true
        );
    });

    it("is symmetric — locks the OPPONENT's non-flying creatures too", () => {
        const moatInst = makeInstance(moat.id, { controllerId: "p1" });
        const grounded = makeInstance(tundraWolves.id, {
            id: "opp-grounded",
            controllerId: "p2",
            isSummoningSick: false,
        });
        const state = makeState({
            phase: "DECLARE_ATTACKERS",
            activePlayerId: "p2",
            players: [
                makePlayer("p1", { battlefield: [moatInst] }),
                makePlayer("p2", { battlefield: [grounded] }),
            ],
        });
        expect(validateAttackerEligibility(grounded, [], state).eligible).toBe(
            false
        );
    });

    it("the lock survives projection (wire format)", () => {
        const moatInst = makeInstance(moat.id, { controllerId: "p1" });
        const grounded = makeInstance(tundraWolves.id, {
            id: "grounded",
            controllerId: "p1",
            isSummoningSick: false,
        });
        const state = makeState({
            activePlayerId: "p1",
            players: [
                makePlayer("p1", { battlefield: [moatInst, grounded] }),
                makePlayer("p2"),
            ],
        });
        const projected = projectPublicState(
            state,
            1,
            "p1"
        ) as unknown as typeof state;
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "grounded"
        )!;
        expect(validateAttackerEligibility(slim, [], projected).eligible).toBe(
            false
        );
    });

    it("the bot's attacker enumeration respects the lock (moves.ts)", () => {
        const moatInst = makeInstance(moat.id, { controllerId: "p1" });
        const grounded = makeInstance(tundraWolves.id, {
            id: "grounded",
            controllerId: "p1",
            isSummoningSick: false,
        });
        const flier = makeInstance(azureDrake.id, {
            id: "flier",
            controllerId: "p1",
            isSummoningSick: false,
        });
        const state = makeState({
            phase: "DECLARE_ATTACKERS",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            combat: {
                attackerIds: [],
                confirmed: false,
                blockerAssignments: {},
                blockersConfirmed: false,
            },
            players: [
                makePlayer("p1", {
                    battlefield: [moatInst, grounded, flier],
                }),
                makePlayer("p2"),
            ],
        });
        const sets = enumerateMoves(state, "p1")
            .filter(
                (m): m is Extract<Move, { kind: "declare-attackers" }> =>
                    m.kind === "declare-attackers"
            )
            .map((m) => [...m.attackerIds].sort());
        // Only the flier is ever a legal attacker → subsets are {} and {flier}.
        expect(sets).toHaveLength(2);
        expect(sets).toContainEqual([]);
        expect(sets).toContainEqual(["flier"]);
        expect(sets.some((s) => s.includes("grounded"))).toBe(false);
    });
});

describe("Akron Legionnaire (only Akron / artifact creatures you control can attack, CR 508.1c)", () => {
    it("locks your non-artifact, non-Akron creatures", () => {
        const akron = makeInstance(akronLegionnaire.id, {
            id: "akron",
            controllerId: "p1",
            isSummoningSick: false,
        });
        const ally = makeInstance(tundraWolves.id, {
            id: "ally",
            controllerId: "p1",
            isSummoningSick: false,
        });
        const state = makeState({
            phase: "DECLARE_ATTACKERS",
            activePlayerId: "p1",
            players: [
                makePlayer("p1", { battlefield: [akron, ally] }),
                makePlayer("p2"),
            ],
        });
        expect(validateAttackerEligibility(ally, [], state).eligible).toBe(
            false
        );
    });

    it("lets Akron itself attack", () => {
        const akron = makeInstance(akronLegionnaire.id, {
            id: "akron",
            controllerId: "p1",
            isSummoningSick: false,
        });
        const state = makeState({
            phase: "DECLARE_ATTACKERS",
            activePlayerId: "p1",
            players: [
                makePlayer("p1", { battlefield: [akron] }),
                makePlayer("p2"),
            ],
        });
        expect(validateAttackerEligibility(akron, [], state).eligible).toBe(
            true
        );
    });

    it("lets your artifact creatures attack", () => {
        const akron = makeInstance(akronLegionnaire.id, {
            id: "akron",
            controllerId: "p1",
            isSummoningSick: false,
        });
        const robot = makeInstance(CLAY_STATUE_ID, {
            id: "robot",
            controllerId: "p1",
            isSummoningSick: false,
        });
        const state = makeState({
            phase: "DECLARE_ATTACKERS",
            activePlayerId: "p1",
            players: [
                makePlayer("p1", { battlefield: [akron, robot] }),
                makePlayer("p2"),
            ],
        });
        expect(validateAttackerEligibility(robot, [], state).eligible).toBe(
            true
        );
    });

    it("does NOT lock the opponent's creatures (controller-scoped)", () => {
        const akron = makeInstance(akronLegionnaire.id, {
            id: "akron",
            controllerId: "p1",
        });
        const enemy = makeInstance(tundraWolves.id, {
            id: "enemy",
            controllerId: "p2",
            isSummoningSick: false,
        });
        const state = makeState({
            phase: "DECLARE_ATTACKERS",
            activePlayerId: "p2",
            players: [
                makePlayer("p1", { battlefield: [akron] }),
                makePlayer("p2", { battlefield: [enemy] }),
            ],
        });
        expect(validateAttackerEligibility(enemy, [], state).eligible).toBe(
            true
        );
    });

    it("the lock survives projection (wire format)", () => {
        const akron = makeInstance(akronLegionnaire.id, {
            id: "akron",
            controllerId: "p1",
            isSummoningSick: false,
        });
        const ally = makeInstance(tundraWolves.id, {
            id: "ally",
            controllerId: "p1",
            isSummoningSick: false,
        });
        const state = makeState({
            activePlayerId: "p1",
            players: [
                makePlayer("p1", { battlefield: [akron, ally] }),
                makePlayer("p2"),
            ],
        });
        const projected = projectPublicState(
            state,
            1,
            "p1"
        ) as unknown as typeof state;
        const slimAlly = projected.players[0].battlefield.find(
            (c) => c.id === "ally"
        )!;
        const slimAkron = projected.players[0].battlefield.find(
            (c) => c.id === "akron"
        )!;
        expect(
            validateAttackerEligibility(slimAlly, [], projected).eligible
        ).toBe(false);
        expect(
            validateAttackerEligibility(slimAkron, [], projected).eligible
        ).toBe(true);
    });

    it("the bot's attacker enumeration respects the lock (moves.ts)", () => {
        const akron = makeInstance(akronLegionnaire.id, {
            id: "akron",
            controllerId: "p1",
            isSummoningSick: false,
        });
        const ally = makeInstance(tundraWolves.id, {
            id: "ally",
            controllerId: "p1",
            isSummoningSick: false,
        });
        const robot = makeInstance(CLAY_STATUE_ID, {
            id: "robot",
            controllerId: "p1",
            isSummoningSick: false,
        });
        const state = makeState({
            phase: "DECLARE_ATTACKERS",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            combat: {
                attackerIds: [],
                confirmed: false,
                blockerAssignments: {},
                blockersConfirmed: false,
            },
            players: [
                makePlayer("p1", { battlefield: [akron, ally, robot] }),
                makePlayer("p2"),
            ],
        });
        const sets = enumerateMoves(state, "p1")
            .filter(
                (m): m is Extract<Move, { kind: "declare-attackers" }> =>
                    m.kind === "declare-attackers"
            )
            .map((m) => [...m.attackerIds].sort());
        // Only Akron and the artifact creature may attack; the vanilla ally
        // never appears in any declared subset.
        expect(sets.some((s) => s.includes("ally"))).toBe(false);
        expect(sets).toContainEqual(["akron", "robot"].sort());
    });
});

// ---------------------------------------------------------------------------
// Kismet — battlefield-scanned, opponent-filtered enters-tapped replacement.
// CR 614.1c (replacement modifies the enters-the-battlefield event) + CR
// 110.5b (a permanent can enter tapped). "Artifacts, creatures, and lands your
// opponents control enter tapped."
// ---------------------------------------------------------------------------

describe("Kismet (CR 614.1c replacement, CR 110.5b enters tapped)", () => {
    /** p1 controls Kismet; p2 is the opponent whose permanents should enter
     *  tapped. Returns the live state plus the Kismet instance. */
    function makeKismetState(): {
        state: GameState;
        kismet: CardInstanceState;
    } {
        const k = makeInstance(kismet.id, {
            id: "kismet-1",
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        });
        const state = makeState({
            players: [makePlayer("p1", { battlefield: [k] }), makePlayer("p2")],
        });
        return { state, kismet: k };
    }

    /** A would-be-entering permanent view for the scanner (controllerId is its
     *  prospective controller). */
    function entering(cardId: string, controllerId: string): CardInstanceState {
        return makeInstance(cardId, { controllerId, ownerId: controllerId });
    }

    it("forces an opponent's creature/artifact/land to enter tapped", () => {
        const { state } = makeKismetState();
        expect(
            entersTappedByReplacement(
                entering(grizzlyBears.id, "p2"),
                state as never
            )
        ).toBe(true);
        expect(
            entersTappedByReplacement(
                entering(blackLotus.id, "p2"),
                state as never
            )
        ).toBe(true);
        expect(
            entersTappedByReplacement(entering(forest.id, "p2"), state as never)
        ).toBe(true);
    });

    it("does NOT tap the controller's own artifacts/creatures/lands", () => {
        const { state } = makeKismetState();
        expect(
            entersTappedByReplacement(
                entering(grizzlyBears.id, "p1"),
                state as never
            )
        ).toBe(false);
        expect(
            entersTappedByReplacement(entering(forest.id, "p1"), state as never)
        ).toBe(false);
    });

    it("does NOT tap an opponent's non-(artifact/creature/land) permanent", () => {
        const { state } = makeKismetState();
        // Concordant Crossroads is an Enchantment — outside the filter.
        expect(
            entersTappedByReplacement(
                entering(concordantCrossroads.id, "p2"),
                state as never
            )
        ).toBe(false);
    });

    it("does nothing while Kismet is not on the battlefield", () => {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
        });
        expect(
            entersTappedByReplacement(
                entering(grizzlyBears.id, "p2"),
                state as never
            )
        ).toBe(false);
    });

    it("taps an opponent's creature as it resolves onto the battlefield (full ETB path)", () => {
        // p1 controls Kismet; p2 casts a creature. After resolution the creature
        // is on p2's battlefield and tapped.
        const { state } = makeKismetState();
        pushSpell(state, grizzlyBears.id, "p2");
        resolveTopOfStack(state);
        const bears = state.players[1].battlefield.find(
            (c) => (c.card as { id?: string }).id === grizzlyBears.id
        );
        expect(bears).toBeDefined();
        expect(bears!.isTapped).toBe(true);
    });

    it("does not tap the controller's own creature as it resolves (full ETB path)", () => {
        const { state } = makeKismetState();
        // p1 (Kismet's controller) casts the creature.
        pushSpell(state, grizzlyBears.id, "p1");
        resolveTopOfStack(state);
        const bears = state.players[0].battlefield.find(
            (c) => (c.card as { id?: string }).id === grizzlyBears.id
        );
        expect(bears).toBeDefined();
        expect(bears!.isTapped).toBe(false);
    });

    it("re-asserts the tapped outcome after projectPublicState (wire format)", () => {
        // Resolve an opponent's creature with Kismet up, then project and verify
        // the tapped flag AND the replacement re-evaluation both survive the wire.
        const { state } = makeKismetState();
        pushSpell(state, grizzlyBears.id, "p2");
        resolveTopOfStack(state);
        const bearsId = state.players[1].battlefield.find(
            (c) => (c.card as { id?: string }).id === grizzlyBears.id
        )!.id;

        const projected = projectPublicState(state, 1, "p1");
        const slimBears = projected.players[1].battlefield.find(
            (c) => c.id === bearsId
        )!;
        // The tapped state itself is client-visible and must survive projection.
        expect(slimBears.isTapped).toBe(true);
        // The replacement predicate must also still evaluate identically against
        // the projected (slim `card: { id }`) battlefield — Kismet is found by id.
        expect(
            entersTappedByReplacement(
                entering(grizzlyBears.id, "p2"),
                projected as never
            )
        ).toBe(true);
        expect(
            entersTappedByReplacement(
                entering(grizzlyBears.id, "p1"),
                projected as never
            )
        ).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Continuous source-filtered combat-damage prevention (CR 615 / 611, #485).
// Enchanted Being ("by enchanted creatures"), Wall of Vapor ("by creatures it's
// blocking"). The prevention is a `combat-damage-prevention` static evaluated
// LIVE each combat — re-applied for as long as the carrier is on the
// battlefield, never a one-shot turn-scoped shield.
// ---------------------------------------------------------------------------
describe("Enchanted Being (prevent combat damage from enchanted creatures, CR 615/611)", () => {
    /** Builds a combat with Enchanted Being (p1) blocking one p2 attacker.
     *  When `withAura` is set, a Spirit Link Aura is attached to the attacker,
     *  making it an "enchanted creature". */
    function makeBlockState(opts: { withAura: boolean }) {
        const attacker = makeInstance(grizzlyBears.id, {
            id: "atk",
            controllerId: "p2",
            ownerId: "p2",
            isAttacking: true,
        });
        const being = makeInstance(enchantedBeing.id, {
            id: "being",
            controllerId: "p1",
            ownerId: "p1",
            isBlocking: true,
        });
        const p2Field = [attacker];
        if (opts.withAura) {
            p2Field.push(
                makeInstance(spiritLink.id, {
                    id: "aura",
                    controllerId: "p2",
                    ownerId: "p2",
                    attachedTo: "atk",
                })
            );
        }
        // p2 is active (attacking); Enchanted Being on p1 blocks.
        return makeState({
            activePlayerId: "p2",
            players: [
                makePlayer("p1", { battlefield: [being] }),
                makePlayer("p2", { battlefield: p2Field }),
            ],
            combat: {
                attackerIds: ["atk"],
                confirmed: true,
                blockerAssignments: { being: ["atk"] },
                blockersConfirmed: true,
            },
        });
    }

    it("takes NO combat damage from an enchanted attacker", () => {
        const state = makeBlockState({ withAura: true });
        applyAllCombatDamage(state, { atk: { being: 2 } });
        const being = state.players[0].battlefield.find(
            (c) => c.id === "being"
        );
        // 2/2 attacker would otherwise deal 2 and kill the 2/2 — prevented.
        expect(being).toBeDefined();
        expect(being?.damageMarked ?? 0).toBe(0);
    });

    it("takes normal combat damage from a non-enchanted attacker", () => {
        const state = makeBlockState({ withAura: false });
        applyAllCombatDamage(state, { atk: { being: 2 } });
        const being = state.players[0].battlefield.find(
            (c) => c.id === "being"
        );
        // No Aura on the source → not prevented → lethal 2 → dies (CR 704.5g).
        expect(being).toBeUndefined();
        expect(state.players[0].graveyard.some((c) => c.id === "being")).toBe(
            true
        );
    });

    it("re-applies prevention across a second combat (continuous, not one-shot)", () => {
        const state = makeBlockState({ withAura: true });
        applyAllCombatDamage(state, { atk: { being: 2 } });
        // Simulate a fresh combat next turn — no game-state shield was consumed.
        state.combat = {
            attackerIds: ["atk"],
            confirmed: true,
            blockerAssignments: { being: ["atk"] },
            blockersConfirmed: true,
        };
        applyAllCombatDamage(state, { atk: { being: 2 } });
        const being = state.players[0].battlefield.find(
            (c) => c.id === "being"
        );
        expect(being?.damageMarked ?? 0).toBe(0);
    });

    it("prevention survives the wire projection (client-visible static)", () => {
        const state = makeBlockState({ withAura: true });
        const being = state.players[0].battlefield.find(
            (c) => c.id === "being"
        )!;
        const atk = state.players[1].battlefield.find((c) => c.id === "atk")!;
        expect(isCombatDamagePreventedFromSource(state, being, atk)).toBe(true);
        const projected = projectPublicState(state, 2, "p1");
        const pBeing = projected.players[0].battlefield.find(
            (c) => c.id === "being"
        )!;
        const pAtk = projected.players[1].battlefield.find(
            (c) => c.id === "atk"
        )!;
        expect(
            isCombatDamagePreventedFromSource(
                projected as never,
                pBeing as never,
                pAtk as never
            )
        ).toBe(true);
    });
});

describe("Petra Sphinx ({T}: name a card, reveal top; match→hand else→graveyard; CR 202.3 / 701.13)", () => {
    // Builds: a Petra Sphinx on p1's battlefield, a target player (p2) whose
    // library top is `tundraWolves`, plus a deeper card so the library isn't
    // emptied. Returns the live state.
    function setup(targetId: "p1" | "p2" = "p2") {
        const top = makeInstance(tundraWolves.id, {
            id: "top",
            controllerId: targetId,
            ownerId: targetId,
            zone: "library",
        });
        const deeper = makeInstance(jasmineBoreal.id, {
            id: "deep",
            controllerId: targetId,
            ownerId: targetId,
            zone: "library",
        });
        const sphinx = makeInstance(petraSphinx.id, {
            id: "sphinx",
            controllerId: "p1",
            ownerId: "p1",
        });
        const players = [
            makePlayer("p1", {
                battlefield: targetId === "p1" ? [sphinx] : [sphinx],
                library: targetId === "p1" ? [top, deeper] : [],
            }),
            makePlayer("p2", {
                library: targetId === "p2" ? [top, deeper] : [],
            }),
        ];
        const state = makeState({ players });
        return { state, sphinx };
    }

    it("match: named card === top → goes to the chooser's HAND (CR 201.2)", () => {
        const { state, sphinx } = setup("p2");
        resolveActivated(state, sphinx, "petra-sphinx-name-card", [
            { type: "player", id: "p2" },
        ]);
        // Suspended on the name-card choice for the target player.
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("name-card");
        expect(head.playerId).toBe("p2");
        applyNameCardSubmit(state, {
            playerId: "p2",
            cardName: "Tundra Wolves",
        });
        // The top card (Tundra Wolves) matched → it is now in p2's hand, off
        // the library; the deeper card remains.
        expect(state.players[1].hand.map((c) => c.id)).toEqual(["top"]);
        expect(state.players[1].library.map((c) => c.id)).toEqual(["deep"]);
        expect(state.players[1].graveyard).toHaveLength(0);
        expect(state.pendingChoices ?? []).toHaveLength(0);
    });

    it("mismatch: named card !== top → goes to the chooser's GRAVEYARD", () => {
        const { state, sphinx } = setup("p2");
        resolveActivated(state, sphinx, "petra-sphinx-name-card", [
            { type: "player", id: "p2" },
        ]);
        applyNameCardSubmit(state, {
            playerId: "p2",
            cardName: "Jasmine Boreal", // not the top card (Tundra Wolves)
        });
        expect(state.players[1].graveyard.map((c) => c.id)).toEqual(["top"]);
        expect(state.players[1].hand).toHaveLength(0);
        expect(state.players[1].library.map((c) => c.id)).toEqual(["deep"]);
    });

    it("self-target: the controller may name a card for their own top card", () => {
        const { state, sphinx } = setup("p1");
        resolveActivated(state, sphinx, "petra-sphinx-name-card", [
            { type: "player", id: "p1" },
        ]);
        expect(state.pendingChoices![0].playerId).toBe("p1");
        applyNameCardSubmit(state, {
            playerId: "p1",
            cardName: "Tundra Wolves",
        });
        expect(state.players[0].hand.map((c) => c.id)).toEqual(["top"]);
    });

    it("rejects a name not in the registry (CR 201.2)", () => {
        const { state, sphinx } = setup("p2");
        resolveActivated(state, sphinx, "petra-sphinx-name-card", [
            { type: "player", id: "p2" },
        ]);
        expect(() =>
            applyNameCardSubmit(state, {
                playerId: "p2",
                cardName: "Definitely Not A Real Card",
            })
        ).toThrow();
        // The choice is still pending — nothing moved.
        expect(state.pendingChoices![0].kind).toBe("name-card");
        expect(state.players[1].library).toHaveLength(2);
    });

    it("normalizes casing to the canonical registry name", () => {
        const { state, sphinx } = setup("p2");
        resolveActivated(state, sphinx, "petra-sphinx-name-card", [
            { type: "player", id: "p2" },
        ]);
        applyNameCardSubmit(state, {
            playerId: "p2",
            cardName: "tUnDrA wOlVeS",
        });
        // Case-insensitive match still routes the top card to hand.
        expect(state.players[1].hand.map((c) => c.id)).toEqual(["top"]);
    });

    it("wire format: the name-card pending choice survives projectPublicState", () => {
        const { state, sphinx } = setup("p2");
        resolveActivated(state, sphinx, "petra-sphinx-name-card", [
            { type: "player", id: "p2" },
        ]);
        const head = state.pendingChoices![0];
        // p2 is the chooser; project from p2's viewpoint.
        const projected = projectPublicState(state, 1, "p2");
        const projHead = projected.pendingChoices![0];
        expect(projHead.kind).toBe("name-card");
        expect(projHead.playerId).toBe("p2");
        expect(projHead.prompt).toBe(head.prompt);
        // Submitted name round-trips on the choice once committed (chosenName).
        applyNameCardSubmit(state, {
            playerId: "p2",
            cardName: "Tundra Wolves",
        });
        expect(state.players[1].hand.map((c) => c.id)).toEqual(["top"]);
    });
});

// ---------------------------------------------------------------------------
// Clergy of the Holy Nimbus — continuous auto-regeneration replacement
// (CR 614.5) + opponent-only activation (CR 602.1) — issue #491
// ---------------------------------------------------------------------------
describe("Clergy of the Holy Nimbus (CR 614.5, 701.15c, 602.1)", () => {
    const CANT_REGEN_ID = "clergy-cant-regen";

    function setup() {
        const clergy = makeInstance(clergyOfTheHolyNimbus.id, {
            id: "clergy",
            controllerId: "p1",
            ownerId: "p1",
            isSummoningSick: false,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [clergy] }),
                makePlayer("p2"),
            ],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
        });
        return { state, clergy };
    }

    // Activate the {1} ability as `castById` (the player paying). The stack
    // item id equals the source instance id so `setSourceCantBeRegenerated`
    // finds it via `item.id`.
    function activateCantRegen(
        state: GameState,
        source: CardInstanceState,
        castById: string
    ) {
        state.stack.push({
            ...source,
            zone: "stack",
            castById,
            abilityId: CANT_REGEN_ID,
            targets: [],
        });
        resolveTopOfStack(state);
    }

    it("auto-regenerates when it would be destroyed: survives, tapped, damage removed, not consumed (CR 614.5)", () => {
        const { state, clergy } = setup();
        clergy.damageMarked = 5;
        const destroyed = destroyWithReplacements(state, "clergy");
        expect(destroyed).toBe(false);
        const survivor = state.players[0].battlefield.find(
            (c) => c.id === "clergy"
        );
        expect(survivor).toBeDefined();
        // CR 701.15a regen rider: tapped + all marked damage removed.
        expect(survivor!.isTapped).toBe(true);
        expect(survivor!.damageMarked).toBeUndefined();
        // Perpetual replacement: it regenerates AGAIN on the next destroy.
        survivor!.isTapped = false;
        const destroyedAgain = destroyWithReplacements(state, "clergy");
        expect(destroyedAgain).toBe(false);
        expect(
            state.players[0].battlefield.some((c) => c.id === "clergy")
        ).toBe(true);
    });

    it("an OPPONENT pays {1} → cantBeRegeneratedThisTurn set → next destroy is lethal (CR 701.15c)", () => {
        const { state, clergy } = setup();
        activateCantRegen(state, clergy, "p2");
        const onBoard = state.players[0].battlefield.find(
            (c) => c.id === "clergy"
        );
        expect(onBoard!.cantBeRegeneratedThisTurn).toBe(true);
        const destroyed = destroyWithReplacements(state, "clergy");
        expect(destroyed).toBe(true);
        expect(
            state.players[0].battlefield.some((c) => c.id === "clergy")
        ).toBe(false);
        expect(state.players[0].graveyard.some((c) => c.id === "clergy")).toBe(
            true
        );
    });

    it("the CONTROLLER cannot enable the {1} ability as a bot move (CR 602.1)", () => {
        const { state } = setup();
        const p1Moves = enumerateMoves(state, "p1");
        const controllerCanActivate = p1Moves.some(
            (m: Move) =>
                m.kind === "activate-ability" &&
                m.cardInstanceId === "clergy" &&
                m.abilityId === CANT_REGEN_ID
        );
        expect(controllerCanActivate).toBe(false);
    });

    it("an OPPONENT with priority CAN enable the {1} ability as a bot move (CR 602.1)", () => {
        const { state, clergy } = setup();
        // Give p2 priority and an untapped land so the {1} cost is fundable by
        // the mana planner; the enumerator surfaces opponent-only abilities off
        // the opponent's board.
        state.priorityPlayerId = "p2";
        const land = makeInstance(getCardByName("Plains").id, {
            id: "p2-plains",
            controllerId: "p2",
            ownerId: "p2",
        });
        state.players[1].battlefield = [land];
        void clergy;
        const p2Moves = enumerateMoves(state, "p2");
        const opponentCanActivate = p2Moves.some(
            (m: Move) =>
                m.kind === "activate-ability" &&
                m.cardInstanceId === "clergy" &&
                m.abilityId === CANT_REGEN_ID
        );
        expect(opponentCanActivate).toBe(true);
    });

    it("cantBeRegeneratedThisTurn is transient — a fresh turn restores auto-regen", () => {
        const { state, clergy } = setup();
        activateCantRegen(state, clergy, "p2");
        const onBoard = state.players[0].battlefield.find(
            (c) => c.id === "clergy"
        )!;
        expect(onBoard.cantBeRegeneratedThisTurn).toBe(true);
        // Simulate CLEANUP wiping the turn-scoped flag (CR 514.2).
        onBoard.cantBeRegeneratedThisTurn = undefined;
        const destroyed = destroyWithReplacements(state, "clergy");
        expect(destroyed).toBe(false);
        expect(
            state.players[0].battlefield.some((c) => c.id === "clergy")
        ).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Greater Realm of Preservation — "{1}{W}: The next time a black or red source
// of your choice would deal damage to you this turn, prevent that damage."
// (CR 615.1, 615.6 — one-shot prevention shield keyed on a chosen source;
// CR 202.2 — the choice is restricted to sources that are black OR red.)
// ---------------------------------------------------------------------------

describe("Greater Realm of Preservation (CR 615.1, 615.6 / 202.2)", () => {
    function setupRealmOnBattlefield() {
        const realm = makeInstance(greaterRealmOfPreservation.id, {
            id: "realm",
        });
        const p1 = makePlayer("p1", { battlefield: [realm] });
        return makeState({ players: [p1, makePlayer("p2")] });
    }

    // CR 202.2 — legal-target filter: black and red sources qualify; green
    // does not; players are never a colored source.
    it("getLegalTargets includes black and red sources, excludes green sources and players", () => {
        const state = setupRealmOnBattlefield();
        const blackSrc = makeInstance(hypnoticSpecter.id, {
            id: "black-src",
            controllerId: "p2",
            ownerId: "p2",
        });
        const redSrc = makeInstance(lightningBolt.id, {
            id: "red-src",
            controllerId: "p2",
            ownerId: "p2",
            zone: "stack",
        });
        const greenSrc = makeInstance(grizzlyBears.id, {
            id: "green-src",
            controllerId: "p2",
            ownerId: "p2",
        });
        state.players[1].battlefield.push(blackSrc, greenSrc);
        state.stack.push({ ...redSrc, castById: "p2" });

        const ability = greaterRealmOfPreservation.activatedAbilities![0];
        const legal = getLegalTargets(
            state,
            ability.targetRequirement!,
            NO_TARGETING_SOURCE
        );
        const ids = legal.map((t) => t.id);
        expect(ids).toContain("black-src");
        expect(ids).toContain("red-src");
        expect(ids).not.toContain("green-src");
        expect(legal.filter((t) => t.type === "player")).toEqual([]);
    });

    // Fixup (T2 review, issue #1409): `colorFilterAny`'s `spell` check was
    // dropped when the SPELL kind was migrated onto the target-filter
    // registry, silently loosening this ability's "black or red source" gate
    // so `selectTarget`'s accept side stopped enforcing it against a SPELL
    // candidate — the getLegalTargets test above only ever fed PERMANENT
    // candidates. This feeds a SPELL candidate through `checkSpellTargetFilters`,
    // the SAME shared registry check `selectTarget`'s spell branch (game.ts)
    // calls to accept/reject a chosen target (CR 202.2).
    it("accept gate (checkSpellTargetFilters) accepts a black/red spell source, rejects a green one", () => {
        const state = setupRealmOnBattlefield();
        const ability = greaterRealmOfPreservation.activatedAbilities![0];
        const values = lowerSpellFilters(ability.targetRequirement!, undefined);
        const ctx: TargetFilterCtx = {
            state,
            sourceColors: [],
            sourceTypes: [],
            sourceSubtypes: [],
            chooserId: "p1",
            activePlayerId: "p1",
        };
        const redSpell: StackItem = {
            ...makeInstance(lightningBolt.id, { id: "red-spell-src" }),
            castById: "p2",
        };
        const greenSpell: StackItem = {
            ...makeInstance(grizzlyBears.id, { id: "green-spell-src" }),
            castById: "p2",
        };
        expect(checkSpellTargetFilters(ctx, redSpell, values)).toBeNull();
        expect(checkSpellTargetFilters(ctx, greenSpell, values)).not.toBeNull();
    });

    it("registers an end-of-turn prevention effect keyed on the chosen red source when the ability resolves", () => {
        const state = setupRealmOnBattlefield();
        const realm = state.players[0].battlefield[0];
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
            ...realm,
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

    it("prevents the next damage from the chosen black source to the protected player", () => {
        const state = setupRealmOnBattlefield();
        // Shield was scheduled against a chosen black source (a black creature
        // dealing damage via a stack ability targeting the player).
        state.preventionEffects = [
            {
                sourceInstanceId: "black-src",
                playerId: "p1",
                duration: { phase: "end-of-turn" },
            },
        ];
        const specter = makeInstance(hypnoticSpecter.id, {
            id: "black-src",
            controllerId: "p2",
            ownerId: "p2",
            isAttacking: true,
        });
        state.players[1].battlefield.push(specter);
        state.activePlayerId = "p2";
        state.phase = "COMBAT_DAMAGE";
        state.combat = {
            attackerIds: ["black-src"],
            confirmed: true,
            blockerAssignments: {},
            blockersConfirmed: true,
        };
        applyAllCombatDamage(state, {});
        expect(state.players[0].life).toBe(20);
        expect(state.preventionEffects).toBeUndefined();
    });

    it("does NOT prevent damage from a green source (only black/red could be chosen)", () => {
        // The shield can only ever be keyed on a black/red source, so a green
        // source's instance id will never match — its damage goes through.
        const state = setupRealmOnBattlefield();
        state.preventionEffects = [
            {
                sourceInstanceId: "black-src",
                playerId: "p1",
                duration: { phase: "end-of-turn" },
            },
        ];
        const greenAttacker = makeInstance(grizzlyBears.id, {
            id: "green-src",
            controllerId: "p2",
            ownerId: "p2",
            isAttacking: true,
        });
        state.players[1].battlefield.push(greenAttacker);
        state.activePlayerId = "p2";
        state.phase = "COMBAT_DAMAGE";
        state.combat = {
            attackerIds: ["green-src"],
            confirmed: true,
            blockerAssignments: {},
            blockersConfirmed: true,
        };
        applyAllCombatDamage(state, {});
        // Grizzly Bears is 2/2 — 2 damage lands; shield (keyed on black-src) is
        // untouched.
        expect(state.players[0].life).toBe(18);
        expect(state.preventionEffects).toEqual([
            {
                sourceInstanceId: "black-src",
                playerId: "p1",
                duration: { phase: "end-of-turn" },
            },
        ]);
    });

    it("is a one-shot: a second hit from the same kind of source still lands", () => {
        const state = setupRealmOnBattlefield();
        state.preventionEffects = [
            {
                sourceInstanceId: "bolt-first",
                playerId: "p1",
                duration: { phase: "end-of-turn" },
            },
        ];
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
        expect(state.preventionEffects).toBeUndefined();

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

    it("expires at end of turn if unused (CR 514.2)", () => {
        const state = setupRealmOnBattlefield();
        state.preventionEffects = [
            {
                sourceInstanceId: "bolt-stack",
                playerId: "p1",
                duration: { phase: "end-of-turn" },
            },
        ];
        // Tick to CLEANUP: hop to END_STEP then advance the phase so the
        // end-of-turn duration wears off (CR 514.2).
        state.phase = "END_STEP";
        advancePhase(state);
        expect(state.preventionEffects).toBeUndefined();
    });

    // Wire format — the B/R color-any filter must survive the GRE -> public
    // projection so the client highlights legal sources correctly.
    it("colorFilterAny survives projection on the pending target (CR 202.2)", () => {
        const state = setupRealmOnBattlefield();
        state.pendingTarget = {
            playerId: "p1",
            cardInstanceId: "realm",
            targetType: ["any", "spell"],
            count: 1,
            colorFilterAny: ["B", "R"],
            selected: [],
            kind: "ability",
            abilityId: "cop-prevent",
        };
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.pendingTarget?.colorFilterAny).toEqual(["B", "R"]);
    });
});

// ──────────────────────────────────────────────────────────────────────────
// Wall of Caltrops — conditional banding grant on block (issue #495).
//
// "Whenever this creature blocks a creature, if at least one other Wall
// creature is blocking that creature and no non-Wall creatures are blocking
// that creature, this creature gains banding until end of turn."
//
// Exercised through the REAL combat path: `emitBlockersConfirmedEvents` emits
// the per-pair BLOCKERS_CONFIRMED events and pushes the matching block trigger
// via `collectTriggers`; `resolveTopOfStack` re-checks the intervening-if
// (CR 603.4) against the live block graph before granting banding EOT
// (CR 702.22). This proves both the multi-Wall co-block condition and that the
// granted keyword reaches `getDamageAssignerId`.
// ──────────────────────────────────────────────────────────────────────────
describe("Wall of Caltrops (conditional banding grant, CR 509.1h / 603.4 / 702.22)", () => {
    /** p2 fields an `attacker`; p1 fields Caltrops plus `coBlockers`, all
     *  assigned to that attacker at DECLARE_BLOCKERS. `coBlockers` lists the
     *  card definition for each additional blocker (Wall or not). Returns the
     *  live state and the Caltrops instance. */
    function setupCaltropsBlock(coBlockers: { id: string }[]): {
        state: GameState;
        caltrops: CardInstanceState;
    } {
        const attacker = makeInstance(grizzlyBears.id, {
            id: "attacker",
            controllerId: "p2",
            ownerId: "p2",
            isAttacking: true,
        });
        const caltrops = makeInstance(wallOfCaltrops.id, {
            id: "caltrops",
            controllerId: "p1",
            ownerId: "p1",
            isBlocking: true,
        });
        const others = coBlockers.map((def, i) =>
            makeInstance(def.id, {
                id: `co${i}`,
                controllerId: "p1",
                ownerId: "p1",
                isBlocking: true,
            })
        );
        const blockerAssignments: Record<string, string[]> = {
            caltrops: ["attacker"],
        };
        for (let i = 0; i < others.length; i++) {
            blockerAssignments[`co${i}`] = ["attacker"];
        }
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [caltrops, ...others] }),
                makePlayer("p2", { battlefield: [attacker] }),
            ],
            phase: "DECLARE_BLOCKERS",
            combat: {
                attackerIds: ["attacker"],
                confirmed: true,
                blockerAssignments,
                blockersConfirmed: true,
            },
        });
        recordBlockedAttackers(state);
        return { state, caltrops };
    }

    function liveCaltrops(state: GameState): CardInstanceState {
        return state.players[0].battlefield.find((c) => c.id === "caltrops")!;
    }

    it("gains banding EOT when another Wall co-blocks and no non-Wall does", () => {
        const { state } = setupCaltropsBlock([wallOfLight]);
        emitBlockersConfirmedEvents(state);
        // Both Walls' block triggers may be on the stack; resolve all.
        while (state.stack.length > 0) resolveTopOfStack(state);
        expect(hasBanding(liveCaltrops(state))).toBe(true);
    });

    it("does NOT gain banding when a non-Wall co-blocks the same attacker", () => {
        const { state } = setupCaltropsBlock([wallOfLight, grizzlyBears]);
        emitBlockersConfirmedEvents(state);
        while (state.stack.length > 0) resolveTopOfStack(state);
        expect(hasBanding(liveCaltrops(state))).toBe(false);
    });

    it("does NOT gain banding when blocking alone (no other Wall)", () => {
        const { state } = setupCaltropsBlock([]);
        emitBlockersConfirmedEvents(state);
        while (state.stack.length > 0) resolveTopOfStack(state);
        expect(hasBanding(liveCaltrops(state))).toBe(false);
    });

    it("granted banding shifts combat-damage assignment to the blocker's controller (CR 702.22j-k)", () => {
        const { state } = setupCaltropsBlock([wallOfLight]);
        // Before: the attacker's controller assigns (no banding among blockers).
        const attacker = state.players[1].battlefield.find(
            (c) => c.id === "attacker"
        )!;
        expect(getDamageAssignerId(state, attacker, ["caltrops"])).toBe("p2");
        // Grant banding via the real block path.
        emitBlockersConfirmedEvents(state);
        while (state.stack.length > 0) resolveTopOfStack(state);
        // After: a banding blocker among the targets shifts assignment to its
        // controller (the defending player, p1).
        expect(getDamageAssignerId(state, attacker, ["caltrops"])).toBe("p1");
    });

    it("granted banding expires at cleanup (CR 514.2)", () => {
        const { state } = setupCaltropsBlock([wallOfLight]);
        emitBlockersConfirmedEvents(state);
        while (state.stack.length > 0) resolveTopOfStack(state);
        expect(hasBanding(liveCaltrops(state))).toBe(true);
        state.phase = "CLEANUP";
        finalizeCleanup(state);
        expect(hasBanding(liveCaltrops(state))).toBe(false);
    });

    it("the granted banding survives the wire projection", () => {
        const { state } = setupCaltropsBlock([wallOfLight]);
        emitBlockersConfirmedEvents(state);
        while (state.stack.length > 0) resolveTopOfStack(state);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "caltrops"
        )!;
        expect(slim.staticAbilities).toContain("banding");
    });
});

describe("Equinox (enchant land grants conditional counter, CR 303.4/611.2/701.5a)", () => {
    function setup() {
        const myLand = makeInstance(PLAINS_ID, {
            id: "myLand",
            controllerId: "p1",
        });
        const equinoxAura = makeInstance(equinox.id, {
            id: "equinoxAura",
            controllerId: "p1",
            attachedTo: "myLand",
        });
        const oppLand = makeInstance(FOREST_ID, {
            id: "oppLand",
            controllerId: "p2",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [myLand, equinoxAura] }),
                makePlayer("p2", { battlefield: [oppLand] }),
            ],
        });
        // The activated-grant is applied imperatively on enter — apply the
        // Aura's static effects so the enchanted land picks up the grant.
        applySourceStaticEffects(state, equinoxAura);
        return { state, myLand, equinoxAura, oppLand };
    }

    it("the enchanted land gains the granted {T} ability (CR 611.2)", () => {
        const { state } = setup();
        const land = state.players[0].battlefield.find(
            (c) => c.id === "myLand"
        )!;
        expect(land.grantedActivatedAbilities).toHaveLength(1);
        expect(land.grantedActivatedAbilities![0].abilityId).toBe(
            "equinox-counter-land-destruction"
        );
        expect(land.grantedActivatedAbilities![0].sourceCardId).toBe(
            equinox.id
        );
    });

    it("CAN target Stone Rain aimed at a land you control (CR 701.7)", () => {
        const { state } = setup();
        const spell = pushSpell(state, STONE_RAIN_ID, "p2", [
            { type: "permanent", id: "myLand" },
        ]);
        expect(spellWouldDestroyLandControlledBy(state, spell, "p1")).toBe(
            true
        );
        const legal = getLegalTargets(
            state,
            { type: "spell", count: 1, spellWouldDestroyLandYouControl: true },
            NO_TARGETING_SOURCE,
            "p1"
        );
        expect(legal.map((t) => t.id)).toContain(spell.id);
    });

    it("CANNOT target Stone Rain aimed at the OPPONENT's land", () => {
        const { state } = setup();
        const spell = pushSpell(state, STONE_RAIN_ID, "p2", [
            { type: "permanent", id: "oppLand" },
        ]);
        expect(spellWouldDestroyLandControlledBy(state, spell, "p1")).toBe(
            false
        );
        const legal = getLegalTargets(
            state,
            { type: "spell", count: 1, spellWouldDestroyLandYouControl: true },
            NO_TARGETING_SOURCE,
            "p1"
        );
        expect(legal.map((t) => t.id)).not.toContain(spell.id);
    });

    it("CAN target Armageddon (mass land destruction) while you control a land", () => {
        const { state } = setup();
        const spell = pushSpell(state, ARMAGEDDON_ID, "p2", []);
        expect(spellWouldDestroyLandControlledBy(state, spell, "p1")).toBe(
            true
        );
    });

    it("CANNOT target a Counterspell or other non-land-destruction spell", () => {
        const { state } = setup();
        const spell = pushSpell(state, COUNTERSPELL_ID, "p2", []);
        expect(spellWouldDestroyLandControlledBy(state, spell, "p1")).toBe(
            false
        );
        const legal = getLegalTargets(
            state,
            { type: "spell", count: 1, spellWouldDestroyLandYouControl: true },
            NO_TARGETING_SOURCE,
            "p1"
        );
        expect(legal.map((t) => t.id)).not.toContain(spell.id);
    });

    it("activating the granted ability counters a qualifying Stone Rain (CR 701.5a)", () => {
        const { state } = setup();
        const stoneRainSpell = pushSpell(state, STONE_RAIN_ID, "p2", [
            { type: "permanent", id: "myLand" },
        ]);
        // Activate Equinox's granted {T} ability on the enchanted land,
        // targeting the Stone Rain. The land is `ctx.sourceInstanceId`.
        state.stack.push({
            ...makeInstance(PLAINS_ID, {
                id: "myLand",
                controllerId: "p1",
                zone: "stack",
            }),
            castById: "p1",
            abilityId: "equinox-counter-land-destruction",
            grantedSourceCardId: equinox.id,
            targets: [{ type: "spell", id: stoneRainSpell.id }],
        });
        resolveTopOfStack(state);
        // Stone Rain is countered → no longer on the stack, in p2's graveyard.
        expect(
            state.stack.find((s) => s.id === stoneRainSpell.id)
        ).toBeUndefined();
        expect(
            state.players[1].graveyard.some(
                (c) => (c.card as { id: string }).id === STONE_RAIN_ID
            )
        ).toBe(true);
        // The targeted land survives (the spell never resolved).
        expect(
            state.players[0].battlefield.some((c) => c.id === "myLand")
        ).toBe(true);
    });

    it("wire format: the granted ability survives projection (CR 611.2)", () => {
        const { state } = setup();
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === "myLand"
        )!;
        expect(slim.grantedActivatedAbilities).toHaveLength(1);
        expect(slim.grantedActivatedAbilities![0].abilityId).toBe(
            "equinox-counter-land-destruction"
        );
    });

    // Backend integration: reproduces the exact accept/reject decision the
    // `selectTarget` mutation makes server-side for a `pendingTarget` carrying
    // `spellWouldDestroyLandYouControl` (game.ts spell branch). The mutation
    // throws when the predicate returns false; accepts otherwise.
    function selectTargetWouldThrow(
        state: GameState,
        spell: StackItem,
        playerId: string
    ): boolean {
        // pendingTarget.spellWouldDestroyLandYouControl === true (projected).
        return !spellWouldDestroyLandControlledBy(state, spell, playerId);
    }

    it("backend: selectTarget ACCEPTS a qualifying land-destruction spell", () => {
        const { state } = setup();
        const spell = pushSpell(state, STONE_RAIN_ID, "p2", [
            { type: "permanent", id: "myLand" },
        ]);
        expect(selectTargetWouldThrow(state, spell, "p1")).toBe(false);
    });

    it("backend: selectTarget REJECTS a non-qualifying spell", () => {
        const { state } = setup();
        const counter = pushSpell(state, COUNTERSPELL_ID, "p2", []);
        const oppRain = pushSpell(state, STONE_RAIN_ID, "p2", [
            { type: "permanent", id: "oppLand" },
        ]);
        expect(selectTargetWouldThrow(state, counter, "p1")).toBe(true);
        expect(selectTargetWouldThrow(state, oppRain, "p1")).toBe(true);
    });
});
